// Bookmarklet loader — equivalent to the Tampermonkey userscript but runnable
// from a Safari/Chrome bookmark, for environments without a userscript manager
// (e.g. iPad Safari, vanilla Chrome). Run on https://www.geo-fs.com/ via the
// bookmarklet at the bottom of README.

(function () {
  'use strict';
  if (window.__geofsInstLoaded) {
    console.warn('[geofs-inst] already loaded');
    showToast('Already running. Open the floating panel.');
    return;
  }
  window.__geofsInstLoaded = true;

  // ---------- Storage shims (replace GM_setValue / GM_getValue) ----------
  const setVal = (k, v) => localStorage.setItem('gfs-inst-' + k, JSON.stringify(v));
  const getVal = (k, d) => {
    try { const v = localStorage.getItem('gfs-inst-' + k); return v == null ? d : JSON.parse(v); }
    catch (_) { return d; }
  };

  // ---------- Floating UI (draggable, minimisable) ----------
  const STATE_KEY = 'gfs-inst-window-state';
  function loadWinState() {
    try { return Object.assign({ x: 12, y: 12, minimized: false },
      JSON.parse(localStorage.getItem(STATE_KEY) || '{}')); }
    catch (_) { return { x: 12, y: 12, minimized: false }; }
  }
  function saveWinState(s) { try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch (_) {} }
  const winState = loadWinState();

  const wrap = document.createElement('div');
  wrap.id = 'geofs-inst-ui';
  Object.assign(wrap.style, {
    position: 'fixed', left: winState.x + 'px', top: winState.y + 'px',
    zIndex: '999999', font: '12px/1.4 system-ui, sans-serif', color: '#fff',
    background: 'rgba(15,18,21,.92)', border: '1px solid #2a3036',
    borderRadius: '8px', boxShadow: '0 6px 22px rgba(0,0,0,.5)',
    minWidth: '200px', userSelect: 'none', touchAction: 'none',
  });
  const titlebar = document.createElement('div');
  Object.assign(titlebar.style, {
    padding: '6px 10px', cursor: 'move', display: 'flex',
    alignItems: 'center', justifyContent: 'space-between',
    borderBottom: '1px solid #2a3036', background: '#1a1d20',
    borderTopLeftRadius: '8px', borderTopRightRadius: '8px',
  });
  titlebar.innerHTML =
    '<span style="font-weight:700;">GeoFS Inst</span>' +
    '<span style="display:flex;gap:4px;align-items:center;">' +
      '<button id="gfs-min" style="background:transparent;border:0;color:#9aa4ad;font-size:16px;cursor:pointer;padding:0 6px;line-height:1;">' +
      (winState.minimized ? '+' : '–') + '</button>' +
      '<button id="gfs-close" style="background:transparent;border:0;color:#9aa4ad;font-size:14px;cursor:pointer;padding:0 4px;line-height:1;">×</button>' +
    '</span>';
  const body = document.createElement('div');
  Object.assign(body.style, { padding: '10px', display: winState.minimized ? 'none' : 'block' });
  body.innerHTML =
    '<div id="gfs-status" style="color:#9aa4ad;margin-bottom:8px;">Loading mqtt.js…</div>' +
    '<div style="display:flex;flex-wrap:wrap;gap:4px;">' +
      '<button id="gfs-connect" style="display:none;flex:1 1 70px;background:#1a8a44;color:#fff;border:0;padding:6px 10px;border-radius:4px;cursor:pointer;font-family:inherit;">Connect</button>' +
      '<button id="gfs-stop" style="display:none;flex:1 1 70px;background:#7a2222;color:#fff;border:0;padding:6px 10px;border-radius:4px;cursor:pointer;font-family:inherit;">Stop</button>' +
      '<button id="gfs-pw"  style="flex:1 1 70px;background:#2a3036;color:#fff;border:0;padding:6px 10px;border-radius:4px;cursor:pointer;font-family:inherit;">Pass…</button>' +
    '</div>';
  wrap.appendChild(titlebar);
  wrap.appendChild(body);
  document.body.appendChild(wrap);

  const $ = (id) => document.getElementById(id);
  const statusEl = $('gfs-status');
  const setStatus = (t) => { statusEl.textContent = t; };

  // Drag
  let dragging = false, offX = 0, offY = 0;
  const minBtn = $('gfs-min'), closeBtn = $('gfs-close');
  function dragStart(e) {
    if (e.target === minBtn || e.target === closeBtn) return;
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

  minBtn.onclick = (e) => {
    e.stopPropagation();
    winState.minimized = !winState.minimized;
    body.style.display = winState.minimized ? 'none' : 'block';
    minBtn.textContent = winState.minimized ? '+' : '–';
    saveWinState(winState);
  };
  function showToast(msg) {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);' +
      'background:#222;color:#fff;padding:10px 16px;border-radius:6px;z-index:99999;' +
      'font:13px sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.4);';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }
  closeBtn.onclick = (e) => { e.stopPropagation(); wrap.remove(); };
  $('gfs-pw').onclick = () => {
    const pp = prompt('New passphrase (same as iPad):', getVal('passphrase', ''));
    if (pp) setVal('passphrase', pp);
  };

  // ---------- Load mqtt.js then boot ----------
  if (typeof window.mqtt !== 'undefined') return boot();
  const s = document.createElement('script');
  s.src = 'https://unpkg.com/mqtt@5.10.1/dist/mqtt.min.js';
  s.crossOrigin = 'anonymous';
  s.onload = boot;
  s.onerror = () => setStatus('Failed to load mqtt.js (CSP?)');
  document.head.appendChild(s);

  function boot() {
    setStatus('Ready. Click Connect.');
    $('gfs-connect').style.display = 'inline-block';

    // ---------- Crypto ----------
    const SALT = new TextEncoder().encode('geofs-instruments-v1');
    const IV_LEN = 12;
    const b64encode = (bytes) => {
      let str = '';
      for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
      return btoa(str);
    };
    const b64decode = (str) => {
      const s = atob(str); const out = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
      return out;
    };
    async function deriveKey(pp) {
      const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pp),
        'PBKDF2', false, ['deriveKey']);
      return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: SALT, iterations: 100000, hash: 'SHA-256' },
        base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    }
    async function roomIdFrom(pp) {
      const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('room:' + pp));
      const bytes = new Uint8Array(h).slice(0, 6);
      return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    async function encryptJson(key, obj) {
      const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key,
        new TextEncoder().encode(JSON.stringify(obj)));
      const cb = new Uint8Array(ct);
      const out = new Uint8Array(IV_LEN + cb.length);
      out.set(iv, 0); out.set(cb, IV_LEN);
      return b64encode(out);
    }
    async function decryptJson(key, b64) {
      try {
        const bytes = b64decode(b64);
        const plain = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: bytes.slice(0, IV_LEN) }, key, bytes.slice(IV_LEN));
        return JSON.parse(new TextDecoder().decode(plain));
      } catch (_) { return null; }
    }

    // ---------- State ----------
    const BROKER = 'wss://broker.emqx.io:8084/mqtt';
    const ICE_SERVERS = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
    ];
    let mqttClient = null, pc = null, dcTel = null, dcCtl = null;
    let aesKey = null, roomId = null, running = false;
    let pendingIce = [], remoteSet = false, seq = 0;

    const AUTOBRK = { mode: 0, status: 0 };
    const ABRK_T = { 1: 1.7, 2: 3.0, 3: 6.0 };
    let lastTas = 0, lastABRT = 0;
    function autobrakeTick(now) {
      if (AUTOBRK.mode === 0) { AUTOBRK.status = 0; return; }
      const v = (window.geofs && window.geofs.animation && window.geofs.animation.values) || {};
      const onGround = !!v.groundContact;
      const tas = (Number(v.ktas) || 0) * 0.5144;
      const dt = lastABRT ? Math.max(0.01, (now - lastABRT) / 1000) : 1 / 30;
      const decel = (lastTas - tas) / dt;
      lastTas = tas; lastABRT = now;
      if (!onGround) { AUTOBRK.status = 1; return; }
      AUTOBRK.status = 2;
      if (tas < 2) { AUTOBRK.mode = 0; AUTOBRK.status = 0; try { window.controls.brakes = 0; } catch (_) {} return; }
      const err = (ABRK_T[AUTOBRK.mode] || 0) - decel;
      try {
        const cur = window.controls.brakes || 0;
        window.controls.brakes = Math.max(0, Math.min(1, cur + 0.4 * err * dt));
      } catch (_) {}
    }
    document.addEventListener('keydown', (e) => {
      if ((e.key === 'b' || e.key === '.') && AUTOBRK.status === 2) {
        AUTOBRK.status = 3; AUTOBRK.mode = 0;
      }
    });

    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const dispatchKey = (k) => {
      try {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
        setTimeout(() => document.dispatchEvent(new KeyboardEvent('keyup', { key: k, bubbles: true })), 50);
      } catch (_) {}
    };
    const handlers = {
      'ap.setKias':     v => { try { window.geofs.autopilot.setKias(+v); } catch (_) {} },
      'ap.setHeading':  v => { try { window.geofs.autopilot.setHeading(+v); } catch (_) {} },
      'ap.setAltitude': v => { try { window.geofs.autopilot.setAltitude(+v); } catch (_) {} },
      'ap.setVS':       v => { try { window.geofs.autopilot.setVerticalSpeed(+v); } catch (_) {} },
      'ap.toggle':      _ => { try { window.geofs.autopilot.toggle(); } catch (_) {} },
      'ap.setMode':     v => { try { window.geofs.autopilot.setMode(String(v)); } catch (_) {} },
      'throttle.set':   v => { try { window.controls.throttle = clamp(+v, -1, 1); } catch (_) {} },
      'flaps.set':      v => { try { window.controls.flaps.target = (+v) | 0; } catch (_) {} },
      'airbrakes.set':  v => { try { window.controls.airbrakes.target = clamp(+v, 0, 1); } catch (_) {} },
      'brakes.hold':    v => { try { window.controls.brakes = v ? 1 : 0; } catch (_) {} },
      'trim.adj':       v => {
        try {
          const step = window.controls.elevatorTrimStep || 0.01;
          window.controls.elevatorTrim = (window.controls.elevatorTrim || 0) + (+v) * step;
        } catch (_) {}
      },
      'gear.toggle':    _ => dispatchKey('g'),
      'parkbrake':      _ => dispatchKey('.'),
      'lights.toggle':  _ => dispatchKey('l'),
      'camera.set':     v => { try { window.geofs.camera.set((+v) | 0); } catch (_) {} },
      'nav.tune':       v => { try { window.geofs.nav.selectNavaid(v); } catch (_) {} },
      'autobrake.set':  v => {
        const map = { OFF: 0, LO: 1, MED: 2, MAX: 3 };
        AUTOBRK.mode = map[String(v).toUpperCase()] ?? 0;
        AUTOBRK.status = AUTOBRK.mode === 0 ? 0 : 1;
      },
    };
    const handleControl = (m) => { if (m && m.cmd && handlers[m.cmd]) try { handlers[m.cmd](m.value); } catch (_) {} };

    function sampleFrame() {
      const v = (window.geofs && window.geofs.animation && window.geofs.animation.values) || {};
      const inst = window.geofs && window.geofs.aircraft && window.geofs.aircraft.instance;
      const ang = (inst && inst.rigidBody && inst.rigidBody.v_angularVelocity) || [0, 0, 0];
      const lin = (inst && inst.rigidBody && inst.rigidBody.v_linearVelocity)  || [0, 0, 0];
      const ap = (window.geofs && window.geofs.autopilot) || {};
      const apOn = !!ap.on;
      const modeStr = (ap.mode || 'HDG').toString().toUpperCase();
      const apModeBit = modeStr.startsWith('NAV') ? 1 : 0;
      const apFlags = (apOn ? 1 : 0) | (apOn ? 2 : 0) | (apModeBit << 2);
      const ab = (AUTOBRK.mode & 3) | ((AUTOBRK.status & 3) << 2);
      const f = new Float32Array(19);
      f[0]=+v.kias||0; f[1]=+v.altitude||0; f[2]=+v.verticalSpeed||0; f[3]=+v.heading360||0;
      f[4]=+v.apitch||0; f[5]=+v.aroll||0; f[6]=(ang[2]||0)*57.2958;
      f[7]=Math.max(-1,Math.min(1,(lin[0]||0)/30));
      f[8]=+v.throttle||0; f[9]=+v.flapsPosition||0; f[10]=+v.gearPosition||0;
      f[11]=+v.aoa||0; f[12]=+v.mach||0; f[13]=v.groundContact?1:0; f[14]=v.stalling?1:0;
      f[15]=+v.haglFeet||0; f[16]=apFlags; f[17]=ab; f[18]=++seq;
      return f;
    }
    let lastSent = 0;
    function rafLoop() {
      if (!running) return;
      const now = performance.now();
      autobrakeTick(now);
      if (dcTel && dcTel.readyState === 'open' && now - lastSent >= 33) {
        try { dcTel.send(sampleFrame().buffer); lastSent = now; } catch (_) {}
      }
      requestAnimationFrame(rafLoop);
    }

    function buildPeer() {
      pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      dcTel = pc.createDataChannel('telemetry', { ordered: false, maxRetransmits: 0 });
      dcTel.binaryType = 'arraybuffer';
      dcCtl = pc.createDataChannel('control', { ordered: true });
      dcCtl.onmessage = (e) => { try { handleControl(JSON.parse(e.data)); } catch (_) {} };
      pc.onicecandidate = (e) => { if (e.candidate) publish('ice-a', e.candidate.toJSON()); };
      pc.onconnectionstatechange = () => {
        setStatus('RTC: ' + pc.connectionState);
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
          setTimeout(restart, 5000);
        }
      };
      dcTel.onopen = () => {
        setStatus('Connected (P2P)');
        $('gfs-connect').style.display = 'none';
        $('gfs-stop').style.display = 'inline-block';
        running = true; requestAnimationFrame(rafLoop);
      };
      dcTel.onclose = () => { running = false; };
    }
    async function publish(kind, obj) {
      if (!mqttClient || !aesKey) return;
      try {
        const env = await encryptJson(aesKey, obj);
        mqttClient.publish('geofs/' + roomId + '/' + kind, env, { qos: 0, retain: false });
      } catch (_) {}
    }
    async function startOffer() {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await publish('offer', { sdp: offer.sdp });
    }
    async function handleAnswer(obj) {
      try {
        await pc.setRemoteDescription({ type: 'answer', sdp: obj.sdp });
        remoteSet = true;
        for (const c of pendingIce) try { await pc.addIceCandidate(c); } catch (_) {}
        pendingIce = [];
      } catch (e) { setStatus('setRemote err: ' + e.message); }
    }
    async function handleRemoteIce(obj) {
      if (!remoteSet) { pendingIce.push(obj); return; }
      try { await pc.addIceCandidate(obj); } catch (_) {}
    }

    async function start() {
      let pp = getVal('passphrase', '');
      if (!pp) {
        pp = prompt('GeoFS Instruments — passphrase (same on iPad):', '');
        if (!pp) return;
        setVal('passphrase', pp);
      }
      setStatus('Deriving key…');
      aesKey = await deriveKey(pp);
      roomId = await roomIdFrom(pp);
      setStatus('Broker: connecting…');
      mqttClient = mqtt.connect(BROKER, {
        clientId: 'geofs-pc-' + Math.random().toString(16).slice(2, 10),
        clean: true, reconnectPeriod: 2000, connectTimeout: 10000,
      });
      mqttClient.on('connect', () => {
        mqttClient.subscribe([
          'geofs/' + roomId + '/answer',
          'geofs/' + roomId + '/ice-b',
          'geofs/' + roomId + '/control',
        ], { qos: 0 });
        setStatus('Broker connected. Room #' + roomId.slice(-4));
        buildPeer(); startOffer();
      });
      mqttClient.on('message', async (topic, payload) => {
        const obj = await decryptJson(aesKey, payload.toString());
        if (!obj) return;
        const kind = topic.split('/').pop();
        if (kind === 'answer') handleAnswer(obj);
        else if (kind === 'ice-b') handleRemoteIce(obj);
        else if (kind === 'control') handleControl(obj);
      });
      mqttClient.on('error', (e) => setStatus('Broker err: ' + e.message));
    }
    function stop() {
      running = false;
      try { dcTel && dcTel.close(); } catch (_) {}
      try { dcCtl && dcCtl.close(); } catch (_) {}
      try { pc && pc.close(); } catch (_) {}
      try { mqttClient && mqttClient.end(true); } catch (_) {}
      pc = dcTel = dcCtl = mqttClient = null;
      setStatus('Stopped.');
      $('gfs-connect').style.display = 'inline-block';
      $('gfs-stop').style.display = 'none';
    }
    function restart() {
      if (!aesKey || !roomId || !mqttClient) return;
      try { pc && pc.close(); } catch (_) {}
      remoteSet = false; pendingIce = [];
      buildPeer(); startOffer();
    }

    $('gfs-connect').onclick = start;
    $('gfs-stop').onclick = stop;
    console.log('[geofs-inst] bookmarklet loader ready');
  }
})();
