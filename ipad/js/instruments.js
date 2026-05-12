// Decode telemetry frames and animate the panel built by panel.js.
// One requestAnimationFrame loop reads the latest state object and writes
// SVG attributes; the network handler just updates state (no DOM in there).

const PX_PER_DEG_PITCH = 6;    // 1° pitch = 6 SVG units of vertical translate
const PX_PER_KT  = 4;          // speed tape scale
const PX_PER_FT  = 0.4;        // altitude tape scale
const PX_PER_HDG = 6;          // heading tape scale

export const state = {
  kias: 0, altitude: 0, vs: 0, hdg: 0,
  pitch: 0, roll: 0, turnRate: 0, slip: 0,
  throttle: 0, flaps: 0, gear: 0, aoa: 0,
  mach: 0, onGround: 1, stalling: 0,
  haglFeet: 0, apMaster: false, athr: false, apMode: 0,
  autobrakeMode: 0, autobrakeStatus: 0, seq: 0,
  lastFrameTime: 0,
  apTargetKias: 180, apTargetHdg: 270, apTargetAlt: 3600, apTargetVS: 0,
  qnh: 1013,
};

const AP_MODE_NAME = ['HDG', 'NAV'];

export function decodeFrame(buf) {
  if (!buf || buf.byteLength < 4 * 19) return;
  const a = new Float32Array(buf);
  state.kias = a[0];
  state.altitude = a[1];
  state.vs = a[2];
  state.hdg = a[3];
  state.pitch = a[4];
  state.roll = a[5];
  state.turnRate = a[6];
  state.slip = a[7];
  state.throttle = a[8];
  state.flaps = a[9];
  state.gear = a[10];
  state.aoa = a[11];
  state.mach = a[12];
  state.onGround = a[13];
  state.stalling = a[14];
  state.haglFeet = a[15];
  const apFlags = a[16] | 0;
  state.apMaster = !!(apFlags & 1);
  state.athr = !!(apFlags & 2);
  state.apMode = (apFlags >> 2) & 1;
  const ab = a[17] | 0;
  state.autobrakeMode = ab & 0b11;
  state.autobrakeStatus = (ab >> 2) & 0b11;
  state.seq = a[18];
  state.lastFrameTime = performance.now();
}

function vsiMap(vs, ch) {
  // -3000..3000 fpm mapped to ch/2 .. -ch/2 with linear region, then squashed
  const half = ch / 2;
  const cap = 3000;
  const norm = Math.max(-1, Math.min(1, vs / cap));
  return half - norm * (half - 20);
}

function applyPFD(pfd) {
  if (!pfd) return;
  const { horizon, spdScroll, altScroll, hdgInner, spdReadout, altReadout, vsiNeedle, fmaTxt, cx, cy, ch, sw } = pfd;
  // Horizon: rotate then translate
  const pitchPx = state.pitch * PX_PER_DEG_PITCH;
  horizon.setAttribute('transform', `rotate(${-state.roll} ${cx} ${cy}) translate(0 ${pitchPx})`);
  // Speed tape scrolls so that the current kias aligns with the centre readout
  spdScroll.setAttribute('transform', `translate(0 ${state.kias * PX_PER_KT})`);
  spdReadout.textContent = Math.max(0, Math.round(state.kias)).toString();
  // Altitude tape
  altScroll.setAttribute('transform', `translate(0 ${state.altitude * PX_PER_FT})`);
  const altRound = Math.round(state.altitude / 20) * 20;
  altReadout.textContent = altRound.toString();
  // VSI needle
  const vy = vsiMap(state.vs, ch);
  vsiNeedle.setAttribute('y2', vy);
  // Heading tape
  hdgInner.setAttribute('transform', `translate(${-state.hdg * PX_PER_HDG} 0)`);
  // FMA: SPEED | LAT | VERT | APPR | CAT
  const fmaLat = state.apMaster ? (AP_MODE_NAME[state.apMode] || '') : '';
  const fmaVert = state.apMaster ? (state.vs !== 0 ? 'V/S' : 'ALT') : '';
  const fmaSpd = state.athr ? 'SPEED' : '';
  fmaTxt[0].textContent = fmaSpd;
  fmaTxt[1].textContent = fmaLat;
  fmaTxt[2].textContent = fmaVert;
  fmaTxt[3].textContent = '';
  fmaTxt[4].textContent = '';
}

function applyStandby(stby) {
  if (!stby) return;
  stby.stbySpd.textContent = Math.max(0, Math.round(state.kias)).toString();
  stby.stbyAlt.textContent = Math.round(state.altitude).toString();
  // Mini horizon
  stby.sbHorizon.setAttribute('transform', `rotate(${-state.roll}) translate(0 ${state.pitch * 4})`);
  stby.qnh.textContent = `QNH ${Math.round(state.qnh)}`;
}

function applyEWD(ewd) {
  if (!ewd) return;
  const pct = Math.max(0, Math.min(1, state.throttle));
  // N1 needle: 0..100% maps to -135..+135 deg
  const angle = -135 + pct * 270;
  const setEng = (eng) => {
    const cx = parseFloat(eng.n1Needle.getAttribute('x1'));
    const cy = parseFloat(eng.n1Needle.getAttribute('y1'));
    eng.n1Needle.setAttribute('transform', `rotate(${angle} ${cx} ${cy})`);
    eng.n1Txt.textContent = (pct * 100).toFixed(1);
    eng.egtTxt.textContent = String(Math.round(350 + pct * 250));
    eng.n2Txt.textContent = (pct * 100 * 1.1).toFixed(1);
    eng.ffTxt.textContent = String(Math.round(pct * 4500));
  };
  setEng(ewd.engL);
  setEng(ewd.engR);
  // Flaps bar (0..1)
  const fb = Math.max(0, Math.min(1, state.flaps));
  const flapsBarMaxW = 380; // approximate; rect frame is (W-80)
  ewd.flapBar.setAttribute('width', String(fb * flapsBarMaxW));
  const flapStage = ['CLEAN', 'CONF 1', 'CONF 2', 'CONF 3', 'FULL'][Math.round(fb * 4)] || 'CLEAN';
  ewd.flapsTxt.textContent = flapStage;
}

function applySD(sd, state) {
  if (!sd) return;
  // Brake temps: simulate from throttle/brake activity — keep static-ish for now
  for (let i = 0; i < sd.brakeTemps.length; i++) {
    sd.brakeTemps[i].textContent = `${100 + i * 10}°C`;
  }
  const modeName = ['OFF', 'LO', 'MED', 'MAX'][state.autobrakeMode];
  const statusName = ['DIS', 'ARM', 'ACT', 'OVR'][state.autobrakeStatus];
  sd.abrTxt.textContent = `AUTOBRK ${modeName} (${statusName})`;
  sd.parkTxt.textContent = `PARK BRK ${state.onGround ? 'GRD' : 'AIR'}`;
}

function applyLdg(ldg) {
  if (!ldg) return;
  const gear = state.gear; // 0 up, 1 down
  ldg.gearLEDs.forEach((g, i) => {
    if (gear < 0.05) g.rect.setAttribute('fill', '#5a5a5a');
    else if (gear > 0.95) g.rect.setAttribute('fill', '#2ee06b');
    else g.rect.setAttribute('fill', '#ff4b4b');
  });
  // Autobrake button states
  const m = state.autobrakeMode;
  const status = state.autobrakeStatus;
  const setBtn = (btn, on, mode) => {
    if (on && mode === m) {
      if (status === 2) btn._rect.setAttribute('class', 'btn-active');
      else if (status === 1) btn._rect.setAttribute('class', 'btn-armed');
      else btn._rect.setAttribute('class', 'btn-sel');
    } else btn._rect.setAttribute('class', 'btn-off');
  };
  setBtn(ldg.abrLo,  true, 1);
  setBtn(ldg.abrMed, true, 2);
  setBtn(ldg.abrMax, true, 3);
  ldg.abrOff._rect.setAttribute('class', m === 0 ? 'btn-active' : 'btn-off');
}

function applyFCU(fcu) {
  if (!fcu) return;
  fcu.spd._readout.textContent = String(Math.round(state.apTargetKias)).padStart(3, '0');
  fcu.hdg._readout.textContent = String(Math.round(state.apTargetHdg)).padStart(3, '0');
  fcu.alt._readout.textContent = String(Math.round(state.apTargetAlt)).padStart(5, '0');
  const v = Math.round(state.apTargetVS);
  fcu.vs._readout.textContent = (v >= 0 ? '+' : '-') + String(Math.abs(v)).padStart(4, '0');
  fcu.ap1._rect.setAttribute('class',  state.apMaster ? 'btn-active' : 'btn-off');
  fcu.ap2._rect.setAttribute('class', 'btn-off');
  fcu.athr._rect.setAttribute('class', state.athr ? 'btn-active' : 'btn-off');
  fcu.navBt._rect.setAttribute('class', state.apMode === 1 ? 'btn-armed' : 'btn-off');
  fcu.hdgBt._rect.setAttribute('class', state.apMode === 0 ? 'btn-armed' : 'btn-off');
}

let refs = null;

export function bindRefs(panelRefs) {
  refs = panelRefs;
  // Fix: the ND `rose` group had a translate(cx, cy) baked in by panel.js, but
  // here we re-set transform to rotate. We need to compose with the translate.
  // Easiest: wrap the rotation in a parent group. For now, patch the rose
  // element so its transform applies both translate and rotation. Done by
  // saving the original translate and rebuilding here.
  for (const side of ['cpt', 'fo']) {
    const nd = refs[`nd_${side}`];
    if (nd && nd.rose) {
      const cur = nd.rose.getAttribute('transform') || '';
      const m = cur.match(/translate\(([-\d.]+)\s+([-\d.]+)\)/);
      nd._origX = m ? parseFloat(m[1]) : 170;
      nd._origY = m ? parseFloat(m[2]) : 380;
    }
  }
}

export function tick() {
  if (!refs) return;
  applyPFD(refs.pfd_cpt);
  applyPFD(refs.pfd_fo);
  if (refs.nd_cpt) {
    refs.nd_cpt.rose.setAttribute('transform',
      `translate(${refs.nd_cpt._origX} ${refs.nd_cpt._origY}) rotate(${-state.hdg})`);
    refs.nd_cpt.hdgRead.textContent = String(Math.round(state.hdg)).padStart(3, '0');
    refs.nd_cpt.gsTxt.textContent = `GS ${Math.round(Math.max(0, state.kias))}`;
    refs.nd_cpt.tasTxt.textContent = `TAS ${Math.round(Math.max(0, state.kias))}`;
  }
  if (refs.nd_fo) {
    refs.nd_fo.rose.setAttribute('transform',
      `translate(${refs.nd_fo._origX} ${refs.nd_fo._origY}) rotate(${-state.hdg})`);
    refs.nd_fo.hdgRead.textContent = String(Math.round(state.hdg)).padStart(3, '0');
    refs.nd_fo.gsTxt.textContent = `GS ${Math.round(Math.max(0, state.kias))}`;
    refs.nd_fo.tasTxt.textContent = `TAS ${Math.round(Math.max(0, state.kias))}`;
  }
  applyStandby(refs.stby);
  applyEWD(refs.ewd);
  applySD(refs.sd, state);
  applyLdg(refs.ldg);
  applyFCU(refs.fcu);
}

let rafHandle = 0;
export function startLoop() {
  function loop() {
    tick();
    rafHandle = requestAnimationFrame(loop);
  }
  rafHandle = requestAnimationFrame(loop);
}
export function stopLoop() { cancelAnimationFrame(rafHandle); }
