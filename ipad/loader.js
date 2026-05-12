// Bookmarklet loader — equivalent to the Tampermonkey userscript but runnable
// from a Safari/Chrome bookmark, for environments without a userscript manager
// (e.g. iPad Safari, vanilla Chrome). Run on https://www.geo-fs.com/ via the
// bookmarklet at the bottom of README.

(function () {
  'use strict';
  if (window.__geofsInstLoaded) {
    console.warn('[geofs-inst] already loaded');
    showToast('Already running. Open the panel in the bottom-right corner.');
    return;
  }
  window.__geofsInstLoaded = true;

  // ---------- Storage shims (replace GM_setValue / GM_getValue) ----------
  const setVal = (k, v) => localStorage.setItem('gfs-inst-' + k, JSON.stringify(v));
  const getVal = (k, d) => {
    try { const v = localStorage.getItem('gfs-inst-' + k); return v == null ? d : JSON.parse(v); }
    catch (_) { return d; }
  };

  // ---------- Floating UI ----------
  const ui = document.createElement('div');
  ui.id = 'geofs-inst-ui';
  ui.innerHTML =
    '<div style="font:12px/1.4 sans-serif;color:#fff;background:rgba(15,18,21,.85);' +
    'border:1px solid #2a3036;border-radius:8px;padding:10px 12px;' +
    'position:fixed;top:8px;left:8px;z-index:99999;max-width:280px;' +
    'box-shadow:0 6px 22px rgba(0,0,0,.4);">' +
    '<div style="font-weight:700;margin-bottom:6px;">GeoFS Inst</div>' +
    '<div id="gfs-status" style="color:#9aa4ad;margin-bottom:6px;">Loading mqtt.js…</div>' +
    '<button id="gfs-connect" style="display:none;background:#1a8a44;color:#fff;border:0;' +
    'padding:6px 10px;border-radius:4px;cursor:pointer;margin-right:4px;">Connect</button>' +
    '<button id="gfs-stop" style="display:none;background:#7a2222;color:#fff;border:0;' +
    'padding:6px 10px;border-radius:4px;cursor:pointer;margin-right:4px;">Stop</button>' +
    '<button id="gfs-pw" style="background:#2a3036;color:#fff;border:0;' +
    'padding:6px 10px;border-radius:4px;cursor:pointer;">Pass…</button>' +
    '<button id="gfs-close" style="background:transparent;color:#9aa4ad;border:0;' +
    'padding:6px 4px;cursor:pointer;float:right;">×</button>' +
    '</div>';
  document.body.appendChild(ui);
  const $ = (id) => document.getElementById(id);
  const statusEl = $('gfs-status');
  const setStatus = (t) => { statusEl.textContent = t; };
  function showToast(msg) {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);' +
      'background:#222;color:#fff;padding:10px 16px;border-radius:6px;z-index:99999;' +
      'font:13px sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.4);';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }
  $('gfs-close').onclick = () => ui.remove();
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
