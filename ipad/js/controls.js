// Wire up touchable controls on the panel: knobs (+/- buttons with hold-to-
// accelerate), buttons, levers (vertical drag). Sends commands via sendCmd
// for non-decorative controls, and updates local state for decorative ones.

import { state } from './instruments.js';

const HOLD_DELAY = 350;     // ms before repeat starts
const HOLD_FAST  = 1500;    // ms before fast repeat
const REPEAT_SLOW = 80;     // ms
const REPEAT_FAST = 25;     // ms

// Bind a momentary button: fires on pointerdown, optional onUp.
function bindButton(btnGroup, onDown, onUp) {
  const hit = btnGroup._hit || btnGroup;
  hit.addEventListener('pointerdown', e => {
    e.preventDefault();
    onDown && onDown(e);
  });
  if (onUp) {
    hit.addEventListener('pointerup', e => onUp(e));
    hit.addEventListener('pointercancel', e => onUp(e));
    hit.addEventListener('pointerleave', e => onUp(e));
  }
}

// Bind a hold-to-repeat +/- pair to a numeric value with onChange callback.
function bindStepper(decBtn, incBtn, getVal, setVal, step) {
  let timer = null, started = 0;
  const tick = (dir) => () => {
    setVal(getVal() + dir * step);
    const elapsed = performance.now() - started;
    const rate = elapsed > HOLD_FAST ? REPEAT_FAST : REPEAT_SLOW;
    timer = setTimeout(tick(dir), rate);
  };
  const start = (dir) => {
    if (timer) return;
    setVal(getVal() + dir * step);
    started = performance.now();
    timer = setTimeout(tick(dir), HOLD_DELAY);
  };
  const stop = () => { if (timer) { clearTimeout(timer); timer = null; } };
  bindButton(decBtn, () => start(-1), stop);
  bindButton(incBtn, () => start(+1), stop);
}

// Wrap a "decorative" toggle (no cmd sent, only local visual state).
function bindToggleVisual(btn, initiallyOn = false) {
  let on = initiallyOn;
  const apply = () => btn._rect.setAttribute('class', on ? 'btn-active' : 'btn-off');
  apply();
  bindButton(btn, () => { on = !on; apply(); });
  return { isOn: () => on, set: (v) => { on = v; apply(); } };
}

// Wrap a "real" toggle: fires a cmd, but visual state typically comes from
// telemetry feedback rather than local toggling.
function bindToggleCmd(btn, sendCmd, cmd) {
  bindButton(btn, () => sendCmd(cmd));
}

// Bind a knob's centre-tap to a numeric prompt.
function bindKnobPrompt(knobG, label, getVal, setVal) {
  knobG._tap.addEventListener('pointerdown', e => {
    e.preventDefault();
    const v = prompt(`Enter new ${label}`, String(getVal()));
    if (v != null && v !== '' && !isNaN(Number(v))) setVal(Number(v));
  });
}

// Bind a lever to vertical-drag → 0..1 value with onChange.
function bindLever(lever, onChange) {
  const h = lever._height;
  const handle = lever._handle;
  const hit = lever._hit;
  let dragging = false;
  hit.addEventListener('pointerdown', e => {
    e.preventDefault();
    dragging = true;
    hit.setPointerCapture(e.pointerId);
  });
  hit.addEventListener('pointermove', e => {
    if (!dragging) return;
    // map iPad client Y to viewBox Y
    const svg = lever.ownerSVGElement;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const localPt = pt.matrixTransform(lever.getScreenCTM().inverse());
    let frac = 1 - (localPt.y / h);
    frac = Math.max(0, Math.min(1, frac));
    handle.setAttribute('y', String(h - 40 - frac * (h - 60)));
    onChange(frac);
  });
  const stop = (e) => {
    if (!dragging) return;
    dragging = false;
    try { hit.releasePointerCapture(e.pointerId); } catch (_) {}
  };
  hit.addEventListener('pointerup', stop);
  hit.addEventListener('pointercancel', stop);
}

export function bindControls(refs, sendCmd) {
  // ===== FCU =====
  const fcu = refs.fcu;
  if (fcu) {
    bindStepper(fcu.spd._dec, fcu.spd._inc,
      () => state.apTargetKias,
      v => { state.apTargetKias = Math.max(80, Math.min(400, v)); sendCmd('ap.setKias', state.apTargetKias); }, 1);
    bindKnobPrompt(fcu.spd, 'Speed (kt)', () => state.apTargetKias,
      v => { state.apTargetKias = Math.max(80, Math.min(400, v)); sendCmd('ap.setKias', state.apTargetKias); });
    bindStepper(fcu.hdg._dec, fcu.hdg._inc,
      () => state.apTargetHdg,
      v => { state.apTargetHdg = ((v % 360) + 360) % 360; sendCmd('ap.setHeading', state.apTargetHdg); }, 1);
    bindKnobPrompt(fcu.hdg, 'Heading (deg)', () => state.apTargetHdg,
      v => { state.apTargetHdg = ((v % 360) + 360) % 360; sendCmd('ap.setHeading', state.apTargetHdg); });
    bindStepper(fcu.alt._dec, fcu.alt._inc,
      () => state.apTargetAlt,
      v => { state.apTargetAlt = Math.max(0, Math.min(45000, v)); sendCmd('ap.setAltitude', state.apTargetAlt); }, 100);
    bindKnobPrompt(fcu.alt, 'Altitude (ft)', () => state.apTargetAlt,
      v => { state.apTargetAlt = Math.max(0, Math.min(45000, v)); sendCmd('ap.setAltitude', state.apTargetAlt); });
    bindStepper(fcu.vs._dec, fcu.vs._inc,
      () => state.apTargetVS,
      v => { state.apTargetVS = Math.max(-6000, Math.min(6000, v)); sendCmd('ap.setVS', state.apTargetVS); }, 100);
    bindKnobPrompt(fcu.vs, 'Vertical Speed (fpm)', () => state.apTargetVS,
      v => { state.apTargetVS = Math.max(-6000, Math.min(6000, v)); sendCmd('ap.setVS', state.apTargetVS); });

    bindToggleCmd(fcu.ap1,  sendCmd, 'ap.toggle');
    bindToggleVisual(fcu.ap2, false);  // GeoFS has one AP
    bindButton(fcu.athr, () => sendCmd('ap.toggle')); // best-effort proxy
    bindButton(fcu.navBt, () => sendCmd('ap.setMode', 'NAV'));
    bindButton(fcu.hdgBt, () => sendCmd('ap.setMode', 'HDG'));
    // Decorative
    bindToggleVisual(fcu.loc, false);
    bindToggleVisual(fcu.appr, false);
    bindToggleVisual(fcu.exped, false);
    bindToggleVisual(fcu.vsBt, false);
    bindToggleVisual(fcu.mach, false);
  }

  // ===== EFIS L/R (decorative for the most part; QNH is local-only) =====
  for (const side of ['l', 'r']) {
    const ef = refs[`efis_${side}`];
    if (!ef) continue;
    bindStepper(ef.qnh._dec, ef.qnh._inc,
      () => state.qnh,
      v => { state.qnh = Math.max(940, Math.min(1080, v));
             // mirror to the other side's readout
             const other = refs[`efis_${side === 'l' ? 'r' : 'l'}`];
             if (other) other.qnh._readout.textContent = String(Math.round(state.qnh));
             ef.qnh._readout.textContent = String(Math.round(state.qnh));
           }, 1);
    bindToggleVisual(ef.std, false);
    bindToggleVisual(ef.fd, false);
    bindToggleVisual(ef.ls, false);
    ef.ndButtons.forEach(b => bindToggleVisual(b, false));
    // Mode buttons are mutually exclusive (decorative)
    const modeStates = ef.modeBtns.map((b, i) => bindToggleVisual(b, i === 3));
    ef.modeBtns.forEach((b, i) => {
      bindButton(b, () => {
        modeStates.forEach((s, j) => s.set(j === i));
      });
    });
    const rangeStates = ef.rangeBtns.map((b, i) => bindToggleVisual(b, i === 2));
    ef.rangeBtns.forEach((b, i) => {
      bindButton(b, () => {
        rangeStates.forEach((s, j) => s.set(j === i));
      });
    });
  }

  // ===== LDG GEAR + AUTOBRK =====
  const ldg = refs.ldg;
  if (ldg) {
    bindLever(ldg.gearLever, (frac) => {
      // Treat lever bottom as DN, top as UP — fire toggle once when crossing 0.5
      if (frac < 0.3 && state.gear > 0.5) sendCmd('gear.toggle');
      if (frac > 0.7 && state.gear < 0.5) sendCmd('gear.toggle');
    });
    bindButton(ldg.abrLo,  () => sendCmd('autobrake.set', 'LO'));
    bindButton(ldg.abrMed, () => sendCmd('autobrake.set', 'MED'));
    bindButton(ldg.abrMax, () => sendCmd('autobrake.set', 'MAX'));
    bindButton(ldg.abrOff, () => sendCmd('autobrake.set', 'OFF'));
  }

  // ===== Pedestal =====
  const ped = refs.pedestal;
  if (ped) {
    bindStepper(ped.rud._dec, ped.rud._inc,
      () => parseFloat(ped.rud._readout.textContent) || 0,
      v => { ped.rud._readout.textContent = v.toFixed(1); /* decorative */ }, 0.1);
    bindLever(ped.thr, frac => {
      // Map 0..1 lever to -0.2..1.0 throttle so the bottom 20% is reverse
      const thr = frac * 1.2 - 0.2;
      sendCmd('throttle.set', thr);
    });
    bindLever(ped.flapsLever, frac => {
      // Quantise to 0..4
      const detent = Math.round(frac * 4);
      sendCmd('flaps.set', detent);
    });
    bindLever(ped.spdBrake, frac => {
      sendCmd('airbrakes.set', frac);
    });
    bindStepper(ped.trim._dec, ped.trim._inc,
      () => parseFloat(ped.trim._readout.textContent) || 0,
      v => { ped.trim._readout.textContent = v.toFixed(1); sendCmd('trim.adj', v > 0 ? 1 : -1); },
      0.1);
    ped.camBtns.forEach((b, i) => bindButton(b, () => sendCmd('camera.set', i)));
    // Lights — visually independent but all funnel into one toggle on GeoFS
    let anyLightOn = false;
    for (const [k, btn] of Object.entries(ped.lights)) {
      const sw = bindToggleVisual(btn, false);
      bindButton(btn, () => {
        const turningOn = !sw.isOn();
        sw.set(turningOn);
        if (turningOn !== anyLightOn) {
          anyLightOn = turningOn;
          sendCmd('lights.toggle');
        }
      });
    }
  }

  // Park brake + brakes (pedestal bottom)
  if (refs.pedestalParkBrk) {
    const sw = bindToggleVisual(refs.pedestalParkBrk, false);
    bindButton(refs.pedestalParkBrk, () => {
      sw.set(!sw.isOn());
      sendCmd('parkbrake');
    });
  }
  if (refs.pedestalBrakes) {
    bindButton(refs.pedestalBrakes,
      () => { refs.pedestalBrakes._rect.setAttribute('class', 'btn-active'); sendCmd('brakes.hold', 1); },
      () => { refs.pedestalBrakes._rect.setAttribute('class', 'btn-off');    sendCmd('brakes.hold', 0); });
  }
}
