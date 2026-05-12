// ==UserScript==
// @name         GeoFS Remote Instruments (PC side)
// @namespace    https://github.com/TonyD365/Geofs-Flight-Instruments
// @version      0.2.0
// @description  Stream GeoFS telemetry to a remote iPad panel over WebRTC, with command channel and Auto Brake simulation.
// @author       TonyD365
// @homepageURL  https://github.com/TonyD365/Geofs-Flight-Instruments
// @supportURL   https://github.com/TonyD365/Geofs-Flight-Instruments/issues
// @updateURL    https://raw.githubusercontent.com/TonyD365/Geofs-Flight-Instruments/main/userscript/geofs-instruments.user.js
// @downloadURL  https://raw.githubusercontent.com/TonyD365/Geofs-Flight-Instruments/main/userscript/geofs-instruments.user.js
// @match        https://www.geo-fs.com/*
// @match        https://geo-fs.com/*
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_notification
// @run-at       document-idle
// @require      https://unpkg.com/mqtt@5.10.1/dist/mqtt.min.js
// ==/UserScript==

/* global geofs, controls, mqtt */

(function () {
  'use strict';

  // ---------- Crypto (mirror of ipad/js/crypto.js, inlined) ----------
  const SALT = new TextEncoder().encode('geofs-instruments-v1');
  const IV_LEN = 12;

  function b64encode(bytes) {
    let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function b64decode(str) {
    const s = atob(str); const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  async function deriveKey(passphrase) {
    const base = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: SALT, iterations: 100_000, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function roomIdFrom(passphrase) {
    const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('room:' + passphrase));
    const bytes = new Uint8Array(h).slice(0, 6);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  async function encryptJson(key, obj) {
    const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key,
      new TextEncoder().encode(JSON.stringify(obj)));
    const ctBytes = new Uint8Array(ct);
    const out = new Uint8Array(IV_LEN + ctBytes.length);
    out.set(iv, 0); out.set(ctBytes, IV_LEN);
    return b64encode(out);
  }
  async function decryptJson(key, b64) {
    try {
      const bytes = b64decode(b64);
      const iv = bytes.slice(0, IV_LEN);
      const ct = bytes.slice(IV_LEN);
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
      return JSON.parse(new TextDecoder().decode(plain));
    } catch (_) { return null; }
  }

  // ---------- State ----------
  const BROKER = 'wss://broker.emqx.io:8084/mqtt';
  const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ];

  let mqttClient = null;
  let pc = null;
  let dcTelemetry = null;
  let dcControl = null;
  let aesKey = null;
  let roomId = null;
  let running = false;
  let pendingIce = [];
  let remoteSet = false;
  let seq = 0;

  // ---------- Auto Brake state machine ----------
  const AUTOBRK = {
    mode: 0,        // 0 OFF, 1 LO, 2 MED, 3 MAX
    status: 0,      // 0 disarmed, 1 armed, 2 active, 3 overridden
  };
  const AUTOBRK_TARGETS = { 1: 1.7, 2: 3.0, 3: 6.0 };
  let lastTas = 0, lastABRT = 0;
  function autobrakeTick(now) {
    if (AUTOBRK.mode === 0) { AUTOBRK.status = 0; return; }
    const v = (window.geofs && window.geofs.animation && window.geofs.animation.values) || {};
    const onGround = !!v.groundContact;
    const tasMs = (Number(v.ktas) || 0) * 0.5144;
    const dt = lastABRT ? Math.max(0.01, (now - lastABRT) / 1000) : 1 / 30;
    const decel = (lastTas - tasMs) / dt; // m/s²
    lastTas = tasMs; lastABRT = now;

    if (!onGround) { AUTOBRK.status = 1; return; }
    AUTOBRK.status = 2;
    if (tasMs < 2) {
      AUTOBRK.mode = 0; AUTOBRK.status = 0;
      try { window.controls.brakes = 0; } catch (_) {}
      return;
    }
    const target = AUTOBRK_TARGETS[AUTOBRK.mode] || 0;
    const err = target - decel;
    const k = 0.4;
    try {
      const cur = window.controls.brakes || 0;
      const next = Math.max(0, Math.min(1, cur + k * err * dt));
      window.controls.brakes = next;
    } catch (_) {}
  }
  // Pilot-pressed brake overrides autobrake
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'b' || e.key === '.') && AUTOBRK.status === 2) {
      AUTOBRK.status = 3;
      AUTOBRK.mode = 0;
    }
  });

  // ---------- Command handlers ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function dispatchKey(k) {
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
      setTimeout(() => document.dispatchEvent(new KeyboardEvent('keyup', { key: k, bubbles: true })), 50);
    } catch (_) {}
  }
  const handlers = {
    'ap.setKias':     v => { try { window.geofs.autopilot.setKias(Number(v)); } catch (_) {} },
    'ap.setHeading':  v => { try { window.geofs.autopilot.setHeading(Number(v)); } catch (_) {} },
    'ap.setAltitude': v => { try { window.geofs.autopilot.setAltitude(Number(v)); } catch (_) {} },
    'ap.setVS':       v => { try { window.geofs.autopilot.setVerticalSpeed(Number(v)); } catch (_) {} },
    'ap.toggle':      _ => { try { window.geofs.autopilot.toggle(); } catch (_) {} },
    'ap.setMode':     v => { try { window.geofs.autopilot.setMode(String(v)); } catch (_) {} },
    'throttle.set':   v => { try { window.controls.throttle = clamp(Number(v), -1, 1); } catch (_) {} },
    'flaps.set':      v => { try { window.controls.flaps.target = (Number(v) | 0); } catch (_) {} },
    'airbrakes.set':  v => { try { window.controls.airbrakes.target = clamp(Number(v), 0, 1); } catch (_) {} },
    'brakes.hold':    v => { try { window.controls.brakes = v ? 1 : 0; } catch (_) {} },
    'trim.adj':       v => {
      try {
        const step = window.controls.elevatorTrimStep || 0.01;
        window.controls.elevatorTrim = (window.controls.elevatorTrim || 0) + Number(v) * step;
      } catch (_) {}
    },
    'gear.toggle':    _ => dispatchKey('g'),
    'parkbrake':      _ => dispatchKey('.'),
    'lights.toggle':  _ => dispatchKey('l'),
    'camera.set':     v => { try { window.geofs.camera.set(Number(v) | 0); } catch (_) {} },
    'nav.tune':       v => { try { window.geofs.nav.selectNavaid(v); } catch (_) {} },
    'autobrake.set':  v => {
      const map = { OFF: 0, LO: 1, MED: 2, MAX: 3 };
      AUTOBRK.mode = map[String(v).toUpperCase()] ?? 0;
      AUTOBRK.status = AUTOBRK.mode === 0 ? 0 : 1;
    },
  };

  function handleControl(msg) {
    if (!msg || !msg.cmd) return;
    const fn = handlers[msg.cmd];
    if (fn) {
      try { fn(msg.value); } catch (e) { console.warn('[geofs-inst] handler error', msg.cmd, e); }
    }
  }

  // ---------- Telemetry sampling ----------
  function sampleFrame() {
    const v = (window.geofs && window.geofs.animation && window.geofs.animation.values) || {};
    const inst = window.geofs && window.geofs.aircraft && window.geofs.aircraft.instance;
    const ang = (inst && inst.rigidBody && inst.rigidBody.v_angularVelocity) || [0, 0, 0];
    const lin = (inst && inst.rigidBody && inst.rigidBody.v_linearVelocity)  || [0, 0, 0];
    const ap = (window.geofs && window.geofs.autopilot) || {};
    const apOn = !!ap.on;
    const modeStr = (ap.mode || 'HDG').toString().toUpperCase();
    const apModeBit = modeStr.startsWith('NAV') ? 1 : 0;
    const apFlags = (apOn ? 1 : 0) | (apOn ? 2 : 0) | (apModeBit << 2); // a/thr inferred = ap (GeoFS has no separate)
    const ab = (AUTOBRK.mode & 0b11) | ((AUTOBRK.status & 0b11) << 2);
    const slip = Math.max(-1, Math.min(1, (lin[0] || 0) / 30));

    const frame = new Float32Array(19);
    frame[0] = Number(v.kias) || 0;
    frame[1] = Number(v.altitude) || 0;
    frame[2] = Number(v.verticalSpeed) || 0;
    frame[3] = Number(v.heading360) || 0;
    frame[4] = Number(v.apitch) || 0;
    frame[5] = Number(v.aroll) || 0;
    frame[6] = (ang[2] || 0) * 57.2958;
    frame[7] = slip;
    frame[8] = Number(v.throttle) || 0;
    frame[9] = Number(v.flapsPosition) || 0;
    frame[10] = Number(v.gearPosition) || 0;
    frame[11] = Number(v.aoa) || 0;
    frame[12] = Number(v.mach) || 0;
    frame[13] = v.groundContact ? 1 : 0;
    frame[14] = v.stalling ? 1 : 0;
    frame[15] = Number(v.haglFeet) || 0;
    frame[16] = apFlags;
    frame[17] = ab;
    frame[18] = ++seq;
    return frame;
  }

  let lastSent = 0;
  function rafLoop() {
    if (!running) return;
    const now = performance.now();
    autobrakeTick(now);
    // 30 Hz throttle on send
    if (dcTelemetry && dcTelemetry.readyState === 'open' && now - lastSent >= 33) {
      try {
        const buf = sampleFrame();
        dcTelemetry.send(buf.buffer);
        lastSent = now;
      } catch (_) {}
    }
    requestAnimationFrame(rafLoop);
  }

  // ---------- WebRTC offerer ----------
  function buildPeer() {
    pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    dcTelemetry = pc.createDataChannel('telemetry', { ordered: false, maxRetransmits: 0 });
    dcTelemetry.binaryType = 'arraybuffer';
    dcControl = pc.createDataChannel('control', { ordered: true });
    dcControl.onmessage = e => { try { handleControl(JSON.parse(e.data)); } catch (_) {} };

    pc.onicecandidate = e => {
      if (e.candidate) publish('ice-a', e.candidate.toJSON());
    };
    pc.onconnectionstatechange = () => {
      console.log('[geofs-inst] rtc state:', pc.connectionState);
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        setTimeout(restart, 5000);
      }
    };
    dcTelemetry.onopen = () => {
      console.log('[geofs-inst] telemetry channel open');
      running = true;
      requestAnimationFrame(rafLoop);
    };
    dcTelemetry.onclose = () => { running = false; };
  }

  async function publish(kind, obj) {
    if (!mqttClient || !aesKey) return;
    try {
      const env = await encryptJson(aesKey, obj);
      mqttClient.publish(`geofs/${roomId}/${kind}`, env, { qos: 0, retain: false });
    } catch (_) {}
  }

  async function startOffer() {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await publish('offer', { sdp: offer.sdp });
  }

  async function handleAnswer(obj) {
    if (!obj || !obj.sdp) return;
    try {
      await pc.setRemoteDescription({ type: 'answer', sdp: obj.sdp });
      remoteSet = true;
      for (const c of pendingIce) { try { await pc.addIceCandidate(c); } catch (_) {} }
      pendingIce = [];
    } catch (e) { console.warn('[geofs-inst] setRemoteDescription failed', e); }
  }

  async function handleRemoteIce(obj) {
    if (!remoteSet) { pendingIce.push(obj); return; }
    try { await pc.addIceCandidate(obj); } catch (_) {}
  }

  // ---------- Top-level start/stop ----------
  async function start() {
    const passphrase = (await GM_getValue('passphrase', '')) || prompt('GeoFS Instruments — enter passphrase (same on iPad):', '');
    if (!passphrase) return;
    GM_setValue('passphrase', passphrase);

    aesKey = await deriveKey(passphrase);
    roomId = await roomIdFrom(passphrase);
    console.log('[geofs-inst] room:', roomId);

    mqttClient = mqtt.connect(BROKER, {
      clientId: `geofs-pc-${Math.random().toString(16).slice(2, 10)}`,
      clean: true, reconnectPeriod: 2000, connectTimeout: 10_000,
    });
    mqttClient.on('connect', () => {
      mqttClient.subscribe([
        `geofs/${roomId}/answer`,
        `geofs/${roomId}/ice-b`,
        `geofs/${roomId}/control`,
      ], { qos: 0 });
      console.log('[geofs-inst] broker connected, room', roomId);
      buildPeer();
      startOffer();
    });
    mqttClient.on('message', async (topic, payload) => {
      const obj = await decryptJson(aesKey, payload.toString());
      if (!obj) return;
      const kind = topic.split('/').pop();
      if (kind === 'answer') handleAnswer(obj);
      else if (kind === 'ice-b') handleRemoteIce(obj);
      else if (kind === 'control') handleControl(obj);
    });
    mqttClient.on('error', e => console.warn('[geofs-inst] mqtt error', e));
  }

  function stop() {
    running = false;
    try { dcTelemetry && dcTelemetry.close(); } catch (_) {}
    try { dcControl && dcControl.close(); } catch (_) {}
    try { pc && pc.close(); } catch (_) {}
    try { mqttClient && mqttClient.end(true); } catch (_) {}
    pc = null; dcTelemetry = null; dcControl = null; mqttClient = null;
  }

  function restart() {
    if (!aesKey || !roomId || !mqttClient) return;
    console.log('[geofs-inst] restarting peer');
    try { pc && pc.close(); } catch (_) {}
    remoteSet = false; pendingIce = [];
    buildPeer();
    startOffer();
  }

  function status() {
    GM_notification && GM_notification({
      title: 'GeoFS Remote Instruments',
      text:
        `Room: ${roomId || '—'}\n` +
        `MQTT: ${mqttClient && mqttClient.connected ? 'connected' : 'disconnected'}\n` +
        `RTC : ${pc ? pc.connectionState : '—'}\n` +
        `seq : ${seq}`,
      timeout: 4000,
    });
  }

  GM_registerMenuCommand('▶ Connect iPad Panel', start);
  GM_registerMenuCommand('■ Disconnect', stop);
  GM_registerMenuCommand('ⓘ Status', status);
  GM_registerMenuCommand('✎ Change passphrase', async () => {
    const pp = prompt('New passphrase (same on iPad):', await GM_getValue('passphrase', ''));
    if (pp) GM_setValue('passphrase', pp);
  });

  // ---------- Floating control window (draggable, minimisable) ----------
  const STATE_KEY = 'geofs-inst-window-state';
  function loadWinState() {
    try { return Object.assign({ x: 12, y: 12, minimized: false }, JSON.parse(localStorage.getItem(STATE_KEY) || '{}')); }
    catch (_) { return { x: 12, y: 12, minimized: false }; }
  }
  function saveWinState(s) { try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch (_) {} }
  const winState = loadWinState();

  const wrap = document.createElement('div');
  wrap.id = 'geofs-inst-window';
  Object.assign(wrap.style, {
    position: 'fixed', left: winState.x + 'px', top: winState.y + 'px',
    zIndex: '999999', font: '12px/1.4 system-ui, sans-serif', color: '#fff',
    background: 'rgba(15,18,21,.93)', border: '1px solid #2a3036',
    borderRadius: '8px', boxShadow: '0 6px 22px rgba(0,0,0,.55)',
    minWidth: '180px', userSelect: 'none', touchAction: 'none',
  });

  const titlebar = document.createElement('div');
  Object.assign(titlebar.style, {
    padding: '6px 10px', cursor: 'move', display: 'flex',
    alignItems: 'center', justifyContent: 'space-between',
    borderBottom: '1px solid #2a3036', borderTopLeftRadius: '8px',
    borderTopRightRadius: '8px', background: '#1a1d20',
  });
  const title = document.createElement('span');
  title.textContent = 'GeoFS Inst';
  title.style.fontWeight = '700';
  titlebar.appendChild(title);
  const minBtn = document.createElement('button');
  minBtn.textContent = winState.minimized ? '+' : '–';
  Object.assign(minBtn.style, {
    background: 'transparent', border: 'none', color: '#9aa4ad',
    fontSize: '16px', cursor: 'pointer', padding: '0 6px', lineHeight: '1',
  });
  titlebar.appendChild(minBtn);

  const body = document.createElement('div');
  Object.assign(body.style, {
    padding: '10px', display: winState.minimized ? 'none' : 'block',
  });
  body.innerHTML =
    '<div id="gfs-status" style="color:#9aa4ad;margin-bottom:8px;min-height:16px;">Not connected.</div>' +
    '<div style="display:flex;gap:4px;flex-wrap:wrap;">' +
      '<button id="gfs-w-connect" style="flex:1 1 70px;min-width:70px;background:#1a8a44;color:#fff;border:0;padding:6px 8px;border-radius:4px;cursor:pointer;font-family:inherit;">Connect</button>' +
      '<button id="gfs-w-stop"    style="flex:1 1 70px;min-width:70px;background:#7a2222;color:#fff;border:0;padding:6px 8px;border-radius:4px;cursor:pointer;font-family:inherit;">Stop</button>' +
      '<button id="gfs-w-pass"    style="flex:1 1 70px;min-width:70px;background:#2a3036;color:#fff;border:0;padding:6px 8px;border-radius:4px;cursor:pointer;font-family:inherit;">Pass…</button>' +
      '<button id="gfs-w-status"  style="flex:1 1 70px;min-width:70px;background:#2a3036;color:#fff;border:0;padding:6px 8px;border-radius:4px;cursor:pointer;font-family:inherit;">Status</button>' +
    '</div>';
  wrap.appendChild(titlebar);
  wrap.appendChild(body);
  // Defer body append until DOM is ready (this script runs at document-idle)
  (document.body || document.documentElement).appendChild(wrap);

  const statusEl = body.querySelector('#gfs-status');
  function setUiStatus(text) { if (statusEl) statusEl.textContent = text; }

  // Drag — works for mouse and touch
  let dragging = false, offX = 0, offY = 0;
  function dragStart(e) {
    if (e.target === minBtn) return;
    dragging = true;
    const pt = e.touches ? e.touches[0] : e;
    const rect = wrap.getBoundingClientRect();
    offX = pt.clientX - rect.left;
    offY = pt.clientY - rect.top;
    e.preventDefault();
  }
  function dragMove(e) {
    if (!dragging) return;
    const pt = e.touches ? e.touches[0] : e;
    const w = wrap.offsetWidth, h = wrap.offsetHeight;
    winState.x = Math.max(0, Math.min(window.innerWidth  - 40, pt.clientX - offX));
    winState.y = Math.max(0, Math.min(window.innerHeight - 28, pt.clientY - offY));
    wrap.style.left = winState.x + 'px';
    wrap.style.top  = winState.y + 'px';
    e.preventDefault();
  }
  function dragEnd() { if (dragging) { dragging = false; saveWinState(winState); } }
  titlebar.addEventListener('mousedown', dragStart);
  titlebar.addEventListener('touchstart', dragStart, { passive: false });
  window.addEventListener('mousemove', dragMove);
  window.addEventListener('touchmove', dragMove, { passive: false });
  window.addEventListener('mouseup', dragEnd);
  window.addEventListener('touchend', dragEnd);

  // Minimise
  minBtn.addEventListener('click', e => {
    e.stopPropagation();
    winState.minimized = !winState.minimized;
    body.style.display = winState.minimized ? 'none' : 'block';
    minBtn.textContent = winState.minimized ? '+' : '–';
    saveWinState(winState);
  });

  body.querySelector('#gfs-w-connect').onclick = async () => { setUiStatus('Connecting…'); await start(); setUiStatus('Connected. Room: ' + (roomId || '—')); };
  body.querySelector('#gfs-w-stop').onclick    = () => { stop(); setUiStatus('Stopped.'); };
  body.querySelector('#gfs-w-pass').onclick    = async () => {
    const pp = prompt('New passphrase (same on iPad):', await GM_getValue('passphrase', ''));
    if (pp) GM_setValue('passphrase', pp);
  };
  body.querySelector('#gfs-w-status').onclick  = () => {
    setUiStatus(
      'Room: ' + (roomId || '—') +
      ' | MQTT: ' + (mqttClient && mqttClient.connected ? 'OK' : '–') +
      ' | RTC: ' + (pc ? pc.connectionState : '–') +
      ' | seq: ' + seq
    );
  };

  console.log('[geofs-inst] userscript loaded — floating window in top-left, or Tampermonkey menu.');
})();
