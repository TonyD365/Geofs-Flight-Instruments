// Entry point: pair, connect, wire everything together.

import { buildPanel } from './panel.js';
import { deriveKey, roomIdFrom } from './crypto.js';
import { createSignaling } from './signaling.js';
import { createAnswerPeer } from './peer.js';
import * as inst from './instruments.js';
import { bindControls } from './controls.js';
import * as gpws from './gpws.js';

const $ = (id) => document.getElementById(id);

const ui = {
  pairOverlay: $('pair-overlay'),
  pairInput: $('pair-input'),
  pairConnect: $('pair-connect'),
  pairStatus: $('pair-status'),
  linkState: $('link-state'),
  linkRoom: $('link-room'),
  linkLatency: $('link-latency'),
  settingsBtn: $('settings-btn'),
  settingsOverlay: $('settings-overlay'),
  setStatus: $('set-status'),
  setRoom: $('set-room'),
  setLatency: $('set-latency'),
  setLost: $('set-lost'),
  setGpws: $('set-gpws'),
  setNight: $('set-night'),
  setWake: $('set-wake'),
  setUnits: $('set-units'),
  setReconnect: $('set-reconnect'),
  setClose: $('set-close'),
};

// Persistent settings
const SETTINGS_KEY = 'geofs-inst-settings-v1';
const settings = Object.assign({
  gpws: true, night: false, wake: true, units: 'imperial',
}, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'));
function persistSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }
function applySettings() {
  document.body.classList.toggle('night', !!settings.night);
  gpws.setEnabled(!!settings.gpws);
  ui.setGpws.checked = settings.gpws;
  ui.setNight.checked = settings.night;
  ui.setWake.checked = settings.wake;
  ui.setUnits.value = settings.units;
  if (settings.wake) requestWakeLock(); else releaseWakeLock();
}

let wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch (_) {}
}
function releaseWakeLock() { if (wakeLock) { try { wakeLock.release(); } catch (_) {} wakeLock = null; } }

// Build the panel right away so the connect screen unblurs onto a populated UI.
const panel = $('panel');
const refs = buildPanel(panel);
inst.bindRefs(refs);
inst.startLoop();

// Debug overlay (?debug=1)
let debugDiv = null;
if (new URLSearchParams(location.search).get('debug') === '1') {
  debugDiv = document.createElement('div');
  debugDiv.id = 'debug-overlay';
  document.body.appendChild(debugDiv);
}

// Stats / link state
const stats = { lastSeq: 0, lost: 0, lastFrameAt: 0, latencyMs: 0, mode: 'idle' };
function setLink(modeText, cls) {
  ui.linkState.textContent = modeText;
  ui.linkState.className = cls || '';
  ui.setStatus.textContent = modeText;
}

let signaling = null;
let peer = null;

async function pair(passphrase) {
  ui.pairStatus.className = 'status';
  ui.pairStatus.textContent = 'Deriving key…';
  const key = await deriveKey(passphrase);
  const roomId = await roomIdFrom(passphrase);
  ui.linkRoom.textContent = '#' + roomId.slice(-4);
  ui.setRoom.textContent = roomId;
  localStorage.setItem('geofs-inst-passphrase', passphrase);

  // Unlock audio while we still have a user gesture
  try { await gpws.unlock(); } catch (_) {}

  ui.pairStatus.textContent = 'Connecting to broker…';
  setLink('Connecting', '');

  // Stub that defers to the live signaling object once it exists.
  const signalingProxy = { publish: (...args) => signaling && signaling.publish(...args) };
  peer = createAnswerPeer({
    signaling: signalingProxy,
    onOpen: () => {
      setLink('Connected (P2P)', 'ok');
      ui.pairOverlay.classList.add('hidden');
      ui.pairStatus.textContent = '';
      stats.mode = 'p2p';
    },
    onClose: (reason) => {
      setLink(`Disconnected (${reason})`, 'err');
      stats.mode = 'idle';
    },
    onTelemetry: (buf) => {
      inst.decodeFrame(buf);
      // Track loss
      if (inst.state.seq && stats.lastSeq && inst.state.seq > stats.lastSeq + 1) {
        stats.lost += inst.state.seq - stats.lastSeq - 1;
      }
      stats.lastSeq = inst.state.seq;
      stats.lastFrameAt = performance.now();
      // GPWS
      gpws.update(inst.state.haglFeet);
      gpws.retardCheck(inst.state.haglFeet, inst.state.onGround, inst.state.throttle);
    },
    onState: (kind, val) => {
      if (debugDiv) debugDiv.textContent += `\n${kind}: ${val}`;
    },
  });

  signaling = createSignaling({
    roomId, key, role: 'ipad',
    onMessage: async (kind, obj) => {
      if (kind === 'offer') {
        try { await peer.handleOffer(obj.sdp); }
        catch (e) { ui.pairStatus.className = 'status err'; ui.pairStatus.textContent = 'Failed: ' + e.message; }
      } else if (kind === 'ice-a') {
        peer.handleRemoteIce(obj);
      } else if (kind === 'telemetry') {
        // Relay-fallback path: telemetry came over MQTT (base64 of Float32 buf)
        try {
          const bin = Uint8Array.from(atob(obj.b64 || ''), c => c.charCodeAt(0));
          inst.decodeFrame(bin.buffer);
          stats.mode = 'relay';
          setLink('Connected (Relay)', 'relay');
        } catch (_) {}
      }
    },
    onState: (s, m) => {
      ui.pairStatus.textContent = `Broker: ${s}${m ? ' — ' + m : ''}`;
    },
  });

  // 60-second timeout for incoming offer
  setTimeout(() => {
    if (stats.lastFrameAt === 0 && stats.mode === 'idle') {
      ui.pairStatus.className = 'status err';
      ui.pairStatus.textContent = 'No response from PC. Check the passphrase and that the userscript is running.';
    }
  }, 60_000);
}

function sendCmd(cmd, value) {
  if (peer) peer.sendControl(cmd, value);
}

bindControls(refs, sendCmd);

// Auto-fill passphrase if we have one stored
const stored = localStorage.getItem('geofs-inst-passphrase');
if (stored) ui.pairInput.value = stored;

ui.pairConnect.addEventListener('click', async () => {
  const pp = (ui.pairInput.value || '').trim();
  if (pp.length < 4) {
    ui.pairStatus.className = 'status err';
    ui.pairStatus.textContent = 'Passphrase must be at least 4 characters.';
    return;
  }
  ui.pairConnect.disabled = true;
  try {
    await pair(pp);
  } catch (e) {
    ui.pairStatus.className = 'status err';
    ui.pairStatus.textContent = 'Error: ' + (e.message || e);
  } finally {
    ui.pairConnect.disabled = false;
  }
});

ui.pairInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') ui.pairConnect.click();
});

// Settings
ui.settingsBtn.addEventListener('click', () => ui.settingsOverlay.classList.remove('hidden'));
ui.setClose.addEventListener('click', () => ui.settingsOverlay.classList.add('hidden'));
ui.setReconnect.addEventListener('click', () => {
  if (peer) peer.close();
  if (signaling) signaling.close();
  peer = null; signaling = null;
  localStorage.removeItem('geofs-inst-passphrase');
  ui.pairInput.value = '';
  ui.settingsOverlay.classList.add('hidden');
  ui.pairOverlay.classList.remove('hidden');
  setLink('Disconnected', '');
});
ui.setGpws.addEventListener('change', () => { settings.gpws = ui.setGpws.checked; persistSettings(); applySettings(); });
ui.setNight.addEventListener('change', () => { settings.night = ui.setNight.checked; persistSettings(); applySettings(); });
ui.setWake.addEventListener('change', () => { settings.wake = ui.setWake.checked; persistSettings(); applySettings(); });
ui.setUnits.addEventListener('change', () => { settings.units = ui.setUnits.value; persistSettings(); });

applySettings();

// Suppress pinch-zoom and double-tap zoom on iOS Safari
document.addEventListener('gesturestart', e => e.preventDefault());
let lastTouchEnd = 0;
document.addEventListener('touchend', e => {
  const now = Date.now();
  if (now - lastTouchEnd < 350) e.preventDefault();
  lastTouchEnd = now;
}, { passive: false });

// Periodic UI updates (latency, lost frames, debug)
setInterval(() => {
  const now = performance.now();
  if (stats.lastFrameAt) {
    const age = now - stats.lastFrameAt;
    stats.latencyMs = Math.min(age, 9999);
    ui.linkLatency.textContent = `${Math.round(age)}ms`;
    ui.setLatency.textContent  = `${Math.round(age)}ms`;
    if (age > 3000 && stats.mode !== 'idle') {
      setLink('Stalled', 'err');
    }
  }
  ui.setLost.textContent = String(stats.lost);
  if (debugDiv) {
    debugDiv.textContent = `seq:${stats.lastSeq} lost:${stats.lost} mode:${stats.mode}\n` +
      `kias:${inst.state.kias.toFixed(0)} alt:${inst.state.altitude.toFixed(0)} hagl:${inst.state.haglFeet.toFixed(0)}\n` +
      `pitch:${inst.state.pitch.toFixed(1)} roll:${inst.state.roll.toFixed(1)}`;
  }
}, 500);

// Visibility / wake handling
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && settings.wake) requestWakeLock();
});
