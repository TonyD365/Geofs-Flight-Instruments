// Build the full A320 instrument panel as SVG, return a map of refs that the
// animation and control layers bind to. Coordinates use viewBox 0 0 2400 1400.

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs = {}, parent = null) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    node.setAttribute(k, String(v));
  }
  if (parent) parent.appendChild(node);
  return node;
}

function group(attrs, parent) { return el('g', attrs, parent); }

function frame(parent, x, y, w, h, fill = '#2b2f33') {
  el('rect', { x, y, width: w, height: h, rx: 6, fill, stroke: '#14171a', 'stroke-width': 1.5 }, parent);
}

function screen(parent, x, y, w, h) {
  el('rect', { x, y, width: w, height: h, fill: '#000', stroke: '#444', 'stroke-width': 1 }, parent);
}

function txt(parent, x, y, str, cls = 'lbl', anchor = 'middle') {
  const t = el('text', { x, y, class: cls, 'text-anchor': anchor, 'dominant-baseline': 'middle' }, parent);
  t.textContent = str;
  return t;
}

// A "button": rect + label, with a transparent hit-rect on top.
function button(parent, x, y, w, h, label, cls = 'btn-off') {
  const g = group({ class: 'btn', transform: `translate(${x} ${y})` }, parent);
  const r = el('rect', { x: 0, y: 0, width: w, height: h, rx: 4, class: cls }, g);
  const t = txt(g, w / 2, h / 2, label, 'lbl-sm');
  const hit = el('rect', { x: -6, y: -6, width: w + 12, height: h + 12, class: 'hit' }, g);
  g._rect = r; g._txt = t; g._hit = hit;
  return g;
}

// A "knob" with a +/- pair and a centred numeric readout.
function knob(parent, x, y, w, label, initial = 0, fmt = v => v) {
  const g = group({ class: 'knob', transform: `translate(${x} ${y})` }, parent);
  // Frame
  el('rect', { x: 0, y: 0, width: w, height: 180, rx: 8, fill: '#1a1d20', stroke: '#3a3f44' }, g);
  txt(g, w / 2, 20, label, 'lbl-sm');
  // Readout
  const ro = txt(g, w / 2, 70, fmt(initial), 'readout');
  // - and + side buttons
  const dec = button(g, 6, 100, 36, 64, '-', 'btn-off');
  const inc = button(g, w - 42, 100, 36, 64, '+', 'btn-off');
  // big invisible centre tap (opens numeric pad)
  const tap = el('rect', { x: 42, y: 100, width: w - 84, height: 64, class: 'hit' }, g);
  g._readout = ro; g._dec = dec; g._inc = inc; g._tap = tap;
  return g;
}

// Round LED
function led(parent, cx, cy, r, label, cls = 'led-off') {
  const g = group({ transform: `translate(${cx} ${cy})` }, parent);
  el('circle', { cx: 0, cy: 0, r, class: cls }, g);
  if (label) txt(g, 0, r + 14, label, 'lbl-sm');
  return g;
}

// Linear lever (vertical) — used for throttle, flaps, spd-brake
function lever(parent, x, y, w, h, label, opts = {}) {
  const g = group({ transform: `translate(${x} ${y})` }, parent);
  el('rect', { x: 0, y: 0, width: w, height: h, rx: 4, fill: '#0c0e10', stroke: '#3a3f44' }, g);
  txt(g, w / 2, -10, label, 'lbl-sm');
  // Track and handle
  el('line', { x1: w / 2, y1: 10, x2: w / 2, y2: h - 10, stroke: '#444', 'stroke-width': 2 }, g);
  const handle = el('rect', {
    x: 4, y: h - 40, width: w - 8, height: 32,
    rx: 4, fill: opts.handleFill || '#5a5a5a', stroke: '#222',
  }, g);
  // Hit-area for dragging
  const hit = el('rect', { x: -8, y: -8, width: w + 16, height: h + 16, class: 'hit' }, g);
  g._handle = handle; g._hit = hit; g._height = h;
  return g;
}

// ---------- EFIS panel (left/right) ----------
function buildEfis(parent, x, y, refs, side) {
  const g = group({ transform: `translate(${x} ${y})` }, parent);
  frame(g, 0, 0, 500, 220);
  txt(g, 250, 16, `EFIS ${side.toUpperCase()}`, 'lbl-sm');

  // QNH knob + STD button
  const qnh = knob(g, 12, 26, 110, 'QNH', 1013, v => Math.round(v));
  const std = button(g, 12, 188, 110, 24, 'STD', 'btn-off');

  // FD / LS toggle pair
  const fd = button(g, 140, 30, 70, 36, 'FD', 'btn-off');
  const ls = button(g, 220, 30, 70, 36, 'LS', 'btn-off');

  // CSTR / WPT / VOR / NDB / ARPT row
  const labels = ['CSTR', 'WPT', 'VORD', 'NDB', 'ARPT'];
  const ndButtons = labels.map((lab, i) => button(g, 140 + i * 60, 76, 54, 30, lab, 'btn-off'));

  // ND mode selector (ROSE / ARC / PLAN / LS / VOR / NAV)
  const modes = ['LS', 'VOR', 'NAV', 'ARC', 'PLAN'];
  const modeBtns = modes.map((m, i) =>
    button(g, 140 + i * 60, 116, 54, 28, m, i === 3 ? 'btn-armed' : 'btn-off'));

  // Range selector
  const ranges = ['10', '20', '40', '80', '160', '320'];
  const rangeBtns = ranges.map((r, i) =>
    button(g, 140 + i * 50, 156, 44, 24, r, i === 2 ? 'btn-armed' : 'btn-off'));

  // ADF / VOR side switch
  txt(g, 470, 80, 'ADF', 'lbl-sm');
  txt(g, 470, 120, 'VOR', 'lbl-sm');
  led(g, 470, 96, 6, '', 'led-on');
  led(g, 470, 136, 6, '', 'led-off');

  refs[`efis_${side}`] = { qnh, std, fd, ls, ndButtons, modeBtns, rangeBtns };
}

// ---------- FCU center ----------
function buildFCU(parent, x, y, refs) {
  const g = group({ transform: `translate(${x} ${y})` }, parent);
  frame(g, 0, 0, 1000, 220);
  txt(g, 500, 14, 'FLIGHT CONTROL UNIT', 'lbl-sm');

  // Big knobs SPD HDG ALT V/S
  const spd = knob(g, 30, 26, 200, 'SPD', 180, v => String(Math.round(v)).padStart(3, '0'));
  const hdg = knob(g, 250, 26, 200, 'HDG', 270, v => String(Math.round(v)).padStart(3, '0'));
  const alt = knob(g, 470, 26, 240, 'ALT', 3600, v => String(Math.round(v)).padStart(5, '0'));
  const vs  = knob(g, 730, 26, 240, 'V/S', 0,
    v => (v >= 0 ? '+' : '-') + String(Math.abs(Math.round(v))).padStart(4, '0'));

  // Mode / armaments row across the bottom
  const ap1   = button(g, 30,  170, 80, 38, 'AP1',  'btn-off');
  const ap2   = button(g, 120, 170, 80, 38, 'AP2',  'btn-off');
  const athr  = button(g, 220, 170, 80, 38, 'A/THR','btn-off');
  const loc   = button(g, 320, 170, 80, 38, 'LOC',  'btn-off');
  const appr  = button(g, 420, 170, 80, 38, 'APPR', 'btn-off');
  const exped = button(g, 520, 170, 80, 38, 'EXPED','btn-off');
  const navBt = button(g, 620, 170, 80, 38, 'NAV',  'btn-off');
  const hdgBt = button(g, 720, 170, 80, 38, 'HDG',  'btn-off');
  const vsBt  = button(g, 820, 170, 80, 38, 'V/S',  'btn-off');
  const mach  = button(g, 920, 170, 60, 38, 'MACH', 'btn-off');

  refs.fcu = { spd, hdg, alt, vs, ap1, ap2, athr, loc, appr, exped, navBt, hdgBt, vsBt, mach };
}

// ---------- PFD ----------
function buildPFD(parent, x, y, refs, side) {
  const W = 340, H = 680;
  const g = group({ transform: `translate(${x} ${y})` }, parent);
  frame(g, 0, 0, W, H);
  // Screen area
  screen(g, 8, 8, W - 16, H - 16);
  // Inner clip-friendly inner area
  const sx = 8, sy = 8, sw = W - 16, sh = H - 16;
  const cx = sx + sw / 2;
  // FMA strip (top 50)
  const fmaG = group({ transform: `translate(${sx + 4} ${sy + 4})` }, g);
  el('rect', { x: 0, y: 0, width: sw - 8, height: 50, fill: '#0d1116', stroke: '#1c2228' }, fmaG);
  // 5 columns
  const cols = ['SPEED', 'LAT', 'VERT', 'APPR', 'CAT'];
  const fmaTxt = cols.map((label, i) => {
    const t = txt(fmaG, (sw - 8) * (i + 0.5) / 5, 25, '', 'lbl-sm');
    t.setAttribute('fill', '#2ee06b');
    return t;
  });

  // Attitude indicator (the big PFD body)
  const attTop = sy + 60;
  const attH = sh - 60 - 110; // leave room for heading at bottom
  const attG = group({ transform: `translate(${sx} ${attTop})` }, g);
  // Clip
  const clipId = `clip-att-${side}`;
  const defs = el('defs', {}, attG);
  const clip = el('clipPath', { id: clipId }, defs);
  el('rect', { x: 60, y: 0, width: sw - 120, height: attH }, clip);
  const attBody = group({ 'clip-path': `url(#${clipId})` }, attG);
  // The rotating/translating horizon group
  const horizon = group({ id: `pfd-${side}-horizon` }, attBody);
  const cw = sw - 120, ch = attH;
  const hx = 60 + cw / 2, hy = ch / 2;
  // Sky and ground (large enough that translation doesn't reveal edges)
  el('rect', { x: hx - 600, y: hy - 1000, width: 1200, height: 1000, fill: '#1e74d4' }, horizon);
  el('rect', { x: hx - 600, y: hy, width: 1200, height: 1000, fill: '#7a4a23' }, horizon);
  // Horizon line
  el('line', { x1: hx - 600, y1: hy, x2: hx + 600, y2: hy, stroke: '#fff', 'stroke-width': 3 }, horizon);
  // Pitch ladder
  for (let p = -90; p <= 90; p += 10) {
    if (p === 0) continue;
    const w = p % 30 === 0 ? 120 : 60;
    const yy = hy - p * 4;
    el('line', { x1: hx - w / 2, y1: yy, x2: hx + w / 2, y2: yy, stroke: '#fff', 'stroke-width': 2 }, horizon);
    if (p % 10 === 0) {
      txt(horizon, hx - w / 2 - 14, yy, String(Math.abs(p)), 'lbl-sm').setAttribute('fill', '#fff');
      txt(horizon, hx + w / 2 + 14, yy, String(Math.abs(p)), 'lbl-sm').setAttribute('fill', '#fff');
    }
  }
  // Fixed roll arc (overlay)
  const rollArc = group({}, attG);
  el('path', {
    d: `M ${hx - 110} 14 A 110 110 0 0 1 ${hx + 110} 14`,
    fill: 'none', stroke: '#fff', 'stroke-width': 2,
  }, rollArc);
  // Roll bug (fixed pointer)
  el('polygon', { points: `${hx - 6},14 ${hx + 6},14 ${hx},26`, fill: '#fff' }, rollArc);
  // Fixed aircraft symbol (W)
  const ac = group({}, attG);
  el('polyline', {
    points: `${hx - 60},${hy} ${hx - 30},${hy} ${hx - 30},${hy + 10}`,
    fill: 'none', stroke: '#ffd400', 'stroke-width': 4,
  }, ac);
  el('polyline', {
    points: `${hx + 60},${hy} ${hx + 30},${hy} ${hx + 30},${hy + 10}`,
    fill: 'none', stroke: '#ffd400', 'stroke-width': 4,
  }, ac);
  el('rect', { x: hx - 4, y: hy - 4, width: 8, height: 8, fill: '#ffd400' }, ac);

  // Speed tape (left)
  const tapeW = 60;
  const spdTape = group({ id: `pfd-${side}-spdTape` }, attG);
  el('rect', { x: 0, y: 0, width: tapeW, height: ch, fill: '#0d1116', stroke: '#1c2228' }, spdTape);
  const spdClipId = `clip-spd-${side}`;
  const spdDefs = el('defs', {}, spdTape);
  const spdClip = el('clipPath', { id: spdClipId }, spdDefs);
  el('rect', { x: 0, y: 0, width: tapeW, height: ch }, spdClip);
  const spdClipped = group({ 'clip-path': `url(#${spdClipId})` }, spdTape);
  const spdScroll = group({}, spdClipped);
  for (let v = 0; v <= 400; v += 10) {
    const yy = ch / 2 - v * 4;
    el('line', { x1: tapeW - 14, y1: yy, x2: tapeW, y2: yy, stroke: '#fff', 'stroke-width': 1.5 }, spdScroll);
    if (v % 20 === 0) txt(spdScroll, tapeW - 20, yy, String(v), 'lbl-sm', 'end').setAttribute('fill', '#fff');
  }
  // Speed readout box (fixed at centre) — wide enough for 3 digits at f-s 26
  el('rect', { x: -2, y: ch / 2 - 22, width: 80, height: 44, fill: '#000', stroke: '#fff', 'stroke-width': 2 }, attG);
  const spdReadout = txt(attG, 38, ch / 2, '0', 'readout', 'middle');
  spdReadout.setAttribute('fill', '#2ee06b');
  spdReadout.setAttribute('font-size', '26');

  // Altitude tape (right)
  const altX = sw - tapeW;
  const altTape = group({ id: `pfd-${side}-altTape` }, attG);
  el('rect', { x: altX, y: 0, width: tapeW, height: ch, fill: '#0d1116', stroke: '#1c2228' }, altTape);
  const altClipId = `clip-alt-${side}`;
  const altDefs = el('defs', {}, altTape);
  const altClip = el('clipPath', { id: altClipId }, altDefs);
  el('rect', { x: altX, y: 0, width: tapeW, height: ch }, altClip);
  const altClipped = group({ 'clip-path': `url(#${altClipId})` }, altTape);
  const altScroll = group({}, altClipped);
  for (let v = 0; v <= 50000; v += 100) {
    const yy = ch / 2 - v * 0.4;
    el('line', { x1: altX, y1: yy, x2: altX + 14, y2: yy, stroke: '#fff', 'stroke-width': 1.5 }, altScroll);
    if (v % 500 === 0) txt(altScroll, altX + 20, yy, String(v), 'lbl-sm', 'start').setAttribute('fill', '#fff');
  }
  // Altitude readout — widened leftward into the attitude pane for 5 digits
  el('rect', { x: altX - 20, y: ch / 2 - 22, width: 80, height: 44, fill: '#000', stroke: '#fff', 'stroke-width': 2 }, attG);
  const altReadout = txt(attG, altX + 20, ch / 2, '0', 'readout', 'middle');
  altReadout.setAttribute('fill', '#2ee06b');
  altReadout.setAttribute('font-size', '22');

  // VSI bar (far right of the PFD, after altitude tape)
  // (kept inside the panel; simple line indicator)
  const vsiX = altX + tapeW - 1;
  const vsiArea = group({}, attG);
  el('rect', { x: vsiX - 4, y: 0, width: 4, height: ch, fill: '#0d1116' }, vsiArea);
  const vsiNeedle = el('line', {
    x1: vsiX - 4, y1: ch / 2, x2: vsiX, y2: ch / 2,
    stroke: '#2ee06b', 'stroke-width': 3,
  }, vsiArea);

  // Heading tape at bottom of PFD body
  const hdgY = sy + sh - 50;
  const hdgTape = group({ transform: `translate(${sx + 4} ${hdgY})` }, g);
  el('rect', { x: 0, y: 0, width: sw - 8, height: 46, fill: '#0d1116', stroke: '#1c2228' }, hdgTape);
  const hdgClipId = `clip-hdg-${side}`;
  const hdgDefs = el('defs', {}, hdgTape);
  const hdgClip = el('clipPath', { id: hdgClipId }, hdgDefs);
  el('rect', { x: 0, y: 0, width: sw - 8, height: 46 }, hdgClip);
  const hdgScroll = group({ 'clip-path': `url(#${hdgClipId})` }, hdgTape);
  const hdgInner = group({ id: `pfd-${side}-hdgScroll` }, hdgScroll);
  for (let h = 0; h < 720; h += 10) {
    const xx = (h - 360) * 6 + (sw - 8) / 2;
    el('line', { x1: xx, y1: 0, x2: xx, y2: h % 30 === 0 ? 16 : 8, stroke: '#fff', 'stroke-width': 1.5 }, hdgInner);
    if (h % 30 === 0) {
      const label = ((h % 360) / 10).toString().padStart(2, '0');
      txt(hdgInner, xx, 32, label, 'lbl-sm').setAttribute('fill', '#fff');
    }
  }
  // Heading pointer fixed
  el('polygon', { points: `${(sw - 8) / 2 - 6},2 ${(sw - 8) / 2 + 6},2 ${(sw - 8) / 2},14`, fill: '#ffd400' }, hdgTape);

  refs[`pfd_${side}`] = {
    horizon, spdScroll, altScroll, hdgInner, spdReadout, altReadout, vsiNeedle, fmaTxt,
    cx: hx, cy: hy, ch, sw, sh,
  };
}

// ---------- ND ----------
function buildND(parent, x, y, refs, side) {
  const W = 340, H = 680;
  const g = group({ transform: `translate(${x} ${y})` }, parent);
  frame(g, 0, 0, W, H);
  screen(g, 8, 8, W - 16, H - 16);
  const cx = W / 2, cy = H / 2 + 40;
  const R = 145;  // outer ring fits inside the 324-px-wide screen
  // Compass rose
  const rose = group({ id: `nd-${side}-rose`, transform: `translate(${cx} ${cy})` }, g);
  el('circle', { cx: 0, cy: 0, r: R, fill: 'none', stroke: '#aaa', 'stroke-width': 1.5 }, rose);
  for (let d = 0; d < 360; d += 5) {
    const a = (d - 90) * Math.PI / 180;
    const r1 = d % 30 === 0 ? R - 14 : d % 10 === 0 ? R - 8 : R - 4;
    const r2 = R;
    el('line', {
      x1: Math.cos(a) * r1, y1: Math.sin(a) * r1,
      x2: Math.cos(a) * r2, y2: Math.sin(a) * r2,
      stroke: '#fff', 'stroke-width': d % 30 === 0 ? 2 : 1,
    }, rose);
    if (d % 30 === 0) {
      const label = (d / 10).toString();
      const tx = Math.cos(a) * (R - 26), ty = Math.sin(a) * (R - 26);
      const t = txt(rose, tx, ty, label, 'lbl-sm');
      t.setAttribute('fill', '#fff');
    }
  }
  const ac = group({}, g);
  const acx = cx, acy = cy;
  el('polyline', {
    points: `${acx},${acy - 18} ${acx},${acy + 14} ${acx - 16},${acy + 6} ${acx + 16},${acy + 6}`,
    fill: 'none', stroke: '#ffd400', 'stroke-width': 3,
  }, ac);
  // Top heading box
  el('rect', { x: cx - 32, y: 16, width: 64, height: 32, fill: '#000', stroke: '#fff' }, g);
  const hdgRead = txt(g, cx, 32, '000', 'readout');
  hdgRead.setAttribute('font-size', '20'); hdgRead.setAttribute('fill', '#2ee06b');
  txt(g, cx, 60, 'MAG', 'lbl-sm');

  // Data corners
  const gsTxt = txt(g, 36, 36, 'GS  0', 'lbl-sm', 'start'); gsTxt.setAttribute('fill', '#2ee06b');
  const tasTxt = txt(g, 36, 56, 'TAS 0', 'lbl-sm', 'start'); tasTxt.setAttribute('fill', '#2ee06b');
  const winTxt = txt(g, W - 36, 36, '---/--', 'lbl-sm', 'end'); winTxt.setAttribute('fill', '#2ee06b');

  refs[`nd_${side}`] = { rose, hdgRead, gsTxt, tasTxt, winTxt };
}

// ---------- Standby instruments ----------
function buildStandby(parent, x, y, refs) {
  const W = 150, H = 680;
  const g = group({ transform: `translate(${x} ${y})` }, parent);
  frame(g, 0, 0, W, H);
  txt(g, W / 2, 16, 'STBY', 'lbl-sm');
  // Tiny stbyspeed
  screen(g, 8, 30, W - 16, 180);
  const stbySpd = txt(g, W / 2, 120, '---', 'readout');
  stbySpd.setAttribute('font-size', '36'); stbySpd.setAttribute('fill', '#2ee06b');
  txt(g, W / 2, 196, 'KT', 'lbl-sm');
  // Tiny stby attitude (mini horizon)
  screen(g, 8, 220, W - 16, 220);
  const sbA = group({ transform: `translate(${W / 2} ${330})` }, g);
  el('clipPath', { id: 'clip-stby-att' }, el('defs', {}, sbA));
  // Just a colored disc to keep simple
  const sbHorizon = group({ id: 'stby-horizon' }, sbA);
  el('rect', { x: -68, y: -200, width: 136, height: 200, fill: '#1e74d4' }, sbHorizon);
  el('rect', { x: -68, y: 0, width: 136, height: 200, fill: '#7a4a23' }, sbHorizon);
  el('line', { x1: -68, y1: 0, x2: 68, y2: 0, stroke: '#fff' }, sbHorizon);
  el('polyline', { points: '-30,0 0,0 0,8 30,0', fill: 'none', stroke: '#ffd400', 'stroke-width': 3 }, sbA);
  // Tiny stbyalt
  screen(g, 8, 450, W - 16, 180);
  const stbyAlt = txt(g, W / 2, 540, '----', 'readout');
  stbyAlt.setAttribute('font-size', '32'); stbyAlt.setAttribute('fill', '#2ee06b');
  txt(g, W / 2, 612, 'FT', 'lbl-sm');
  // QNH below
  const qnh = txt(g, W / 2, 656, 'QNH 1013', 'lbl-sm');
  qnh.setAttribute('fill', '#2ee06b');

  refs.stby = { stbySpd, stbyAlt, sbHorizon, qnh };
}

// ---------- Upper ECAM (E/WD) ----------
function buildUpperEcam(parent, x, y, refs) {
  const W = 460, H = 680;
  const g = group({ transform: `translate(${x} ${y})` }, parent);
  frame(g, 0, 0, W, H);
  screen(g, 8, 8, W - 16, H - 16);
  txt(g, W / 2, 24, 'E/WD', 'lbl-sm').setAttribute('fill', '#2ee06b');

  // Two engines side by side
  const eng = (engX, idx) => {
    // N1 dial
    const cx = engX, cy = 100;
    el('circle', { cx, cy, r: 70, fill: 'none', stroke: '#fff', 'stroke-width': 2 }, g);
    // Tick marks
    for (let p = 0; p <= 100; p += 10) {
      const a = (p / 100 * 270 - 225) * Math.PI / 180;
      const r1 = 60, r2 = 70;
      el('line', {
        x1: cx + Math.cos(a) * r1, y1: cy + Math.sin(a) * r1,
        x2: cx + Math.cos(a) * r2, y2: cy + Math.sin(a) * r2,
        stroke: '#fff', 'stroke-width': p % 50 === 0 ? 2 : 1,
      }, g);
    }
    // Needle
    const n1Needle = el('line', {
      x1: cx, y1: cy, x2: cx, y2: cy - 60,
      stroke: '#2ee06b', 'stroke-width': 3,
      transform: `rotate(-90 ${cx} ${cy})`,
    }, g);
    // Centre numeric
    const n1Txt = txt(g, cx, cy + 4, '0.0', 'readout');
    n1Txt.setAttribute('font-size', '26'); n1Txt.setAttribute('fill', '#2ee06b');
    txt(g, cx, cy + 30, 'N1', 'lbl-sm');

    // EGT, N2, FF stacked below
    const egtTxt = txt(g, cx, 220, '450', 'lbl');
    egtTxt.setAttribute('fill', '#2ee06b'); egtTxt.setAttribute('font-size', '22');
    txt(g, cx, 244, 'EGT', 'lbl-sm');
    const n2Txt = txt(g, cx, 280, '0.0', 'lbl');
    n2Txt.setAttribute('fill', '#2ee06b'); n2Txt.setAttribute('font-size', '22');
    txt(g, cx, 304, 'N2', 'lbl-sm');
    const ffTxt = txt(g, cx, 340, '0', 'lbl');
    ffTxt.setAttribute('fill', '#2ee06b'); ffTxt.setAttribute('font-size', '22');
    txt(g, cx, 364, 'FF', 'lbl-sm');

    return { n1Needle, n1Txt, egtTxt, n2Txt, ffTxt };
  };
  const engL = eng(140, 1);
  const engR = eng(W - 140, 2);

  // Fuel total
  txt(g, W / 2, 420, 'FOB', 'lbl-sm');
  const fobTxt = txt(g, W / 2, 444, '20000 KG', 'lbl');
  fobTxt.setAttribute('fill', '#2ee06b'); fobTxt.setAttribute('font-size', '20');

  // Flaps indicator at bottom
  const flapsG = group({ transform: `translate(40 ${H - 200})` }, g);
  txt(flapsG, 0, 0, 'FLAPS', 'lbl-sm', 'start');
  // Bar
  el('rect', { x: 0, y: 12, width: W - 80, height: 14, fill: '#1a1d20', stroke: '#444' }, flapsG);
  const flapBar = el('rect', { x: 0, y: 12, width: 0, height: 14, fill: '#2ee06b' }, flapsG);
  // Notches
  ['0', '1', '2', '3', 'F'].forEach((lab, i, arr) => {
    const xx = i / (arr.length - 1) * (W - 80);
    el('line', { x1: xx, y1: 12, x2: xx, y2: 30, stroke: '#fff' }, flapsG);
    txt(flapsG, xx, 50, lab, 'lbl-sm');
  });
  const flapsTxt = txt(g, W / 2, H - 130, 'CLEAN', 'lbl');
  flapsTxt.setAttribute('fill', '#2ee06b');

  // Status / warning lines area
  const warnLines = [];
  for (let i = 0; i < 4; i++) {
    const t = txt(g, W / 2, H - 90 + i * 18, '', 'lbl-sm');
    warnLines.push(t);
  }

  refs.ewd = { engL, engR, fobTxt, flapBar, flapsTxt, warnLines };
}

// ---------- LDG GEAR + AUTO BRK column ----------
function buildLdgGear(parent, x, y, refs) {
  const W = 170, H = 680;
  const g = group({ transform: `translate(${x} ${y})` }, parent);
  frame(g, 0, 0, W, H);
  txt(g, W / 2, 16, 'LDG GEAR', 'lbl-sm');
  // Three gear LEDs (red unsafe / green safe)
  const gearLEDs = [];
  ['NOSE', 'LEFT', 'RIGHT'].forEach((lab, i) => {
    const cy = 60 + i * 50;
    el('rect', { x: 20, y: cy - 18, width: W - 40, height: 36, rx: 4, fill: '#1a1d20', stroke: '#444' }, g);
    const r = el('rect', { x: 24, y: cy - 14, width: 28, height: 28, fill: '#5a5a5a' }, g);
    const t = txt(g, 70, cy, lab, 'lbl-sm', 'start');
    gearLEDs.push({ rect: r, txt: t });
  });

  // Big lever down/up
  txt(g, W / 2, 230, 'GEAR LEVER', 'lbl-sm');
  const gearLever = lever(g, 30, 250, 110, 200, '');
  // Two visible labels
  txt(g, W / 2, 250 - 14, 'UP', 'lbl-sm');
  txt(g, W / 2, 250 + 200 + 22, 'DN', 'lbl-sm');

  // Auto Brake
  txt(g, W / 2, 480, 'AUTO BRK', 'lbl-sm');
  const abrLo  = button(g, 20, 500, W - 40, 34, 'LO',  'btn-off');
  const abrMed = button(g, 20, 540, W - 40, 34, 'MED', 'btn-off');
  const abrMax = button(g, 20, 580, W - 40, 34, 'MAX', 'btn-off');
  const abrOff = button(g, 20, 620, W - 40, 34, 'OFF', 'btn-active');

  refs.ldg = { gearLEDs, gearLever, abrLo, abrMed, abrMax, abrOff };
}

// ---------- Lower ECAM SD (system page) ----------
function buildLowerEcam(parent, x, y, refs) {
  const W = 800, H = 240;
  const g = group({ transform: `translate(${x} ${y})` }, parent);
  frame(g, 0, 0, W, H);
  screen(g, 8, 8, W - 16, H - 16);
  txt(g, W / 2, 24, 'SD — WHEEL', 'lbl-sm').setAttribute('fill', '#2ee06b');
  // Four brake temp indicators
  const brakeTemps = [];
  for (let i = 0; i < 4; i++) {
    const x0 = 80 + i * 170;
    el('rect', { x: x0, y: 60, width: 140, height: 100, rx: 4, fill: '#1a1d20', stroke: '#3a3f44' }, g);
    txt(g, x0 + 70, 80, `BRK ${i + 1}`, 'lbl-sm');
    const t = txt(g, x0 + 70, 130, '0°C', 'lbl');
    t.setAttribute('fill', '#2ee06b'); t.setAttribute('font-size', '24');
    brakeTemps.push(t);
  }
  // Park brake indicator
  const parkTxt = txt(g, W / 2, 200, 'PARK BRK ---', 'lbl-sm');
  // Autobrake indicator (mirrors LDG section)
  const abrTxt = txt(g, W / 2, 220, 'AUTOBRK OFF', 'lbl-sm');

  refs.sd = { brakeTemps, parkTxt, abrTxt };
}

// ---------- DCDU (left/right blank screens) ----------
function buildDcdu(parent, x, y, refs, side) {
  const W = 300, H = 240;
  const g = group({ transform: `translate(${x} ${y})` }, parent);
  frame(g, 0, 0, W, H);
  screen(g, 8, 8, W - 16, H - 16);
  txt(g, W / 2, 28, `DCDU ${side.toUpperCase()}`, 'lbl-sm').setAttribute('fill', '#2ee06b');
  const lines = [];
  for (let i = 0; i < 6; i++) {
    const t = txt(g, 16, 60 + i * 24, '', 'lbl-sm', 'start');
    t.setAttribute('fill', '#2ee06b');
    lines.push(t);
  }
  lines[0].textContent = 'NO MSG';
  refs[`dcdu_${side}`] = { lines };
}

// ---------- Pedestal ----------
function buildPedestal(parent, y, refs) {
  const g = group({ transform: `translate(0 ${y})` }, parent);
  frame(g, 60, 0, 2280, 200);
  txt(g, 1200, 16, 'PEDESTAL', 'lbl-sm');

  // Rudder trim
  const rud = knob(g, 100, 24, 130, 'RUD TRIM', 0, v => v.toFixed(1));
  // Radio panel (decorative)
  const radio = group({ transform: 'translate(280 24)' }, g);
  frame(radio, 0, 0, 280, 170);
  txt(radio, 140, 14, 'RADIO', 'lbl-sm');
  screen(radio, 20, 32, 240, 30);
  const com1 = txt(radio, 140, 50, '118.000', 'lbl');
  com1.setAttribute('fill', '#2ee06b');
  screen(radio, 20, 72, 240, 30);
  const com2 = txt(radio, 140, 90, '121.500', 'lbl');
  com2.setAttribute('fill', '#2ee06b');
  // ATC
  txt(radio, 70, 130, 'XPDR', 'lbl-sm');
  screen(radio, 110, 116, 110, 30);
  const xpdr = txt(radio, 165, 132, '2000', 'lbl');
  xpdr.setAttribute('fill', '#2ee06b');

  // Throttle quadrant
  const thr = lever(g, 660, 24, 200, 160, 'THROTTLE', { handleFill: '#cc7a33' });
  // Reverse markings
  txt(g, 760, 24 + 170, 'IDLE | TOGA', 'lbl-sm');

  // Flaps lever (5 detents)
  txt(g, 980, 18, 'FLAPS', 'lbl-sm');
  const flapsLever = lever(g, 920, 24, 120, 160, '');
  // Detents
  ['0', '1', '2', '3', 'FULL'].forEach((lab, i, arr) => {
    const yy = 24 + 16 + i * 32;
    el('line', { x1: 920, y1: yy, x2: 920 + 120, y2: yy, stroke: '#666', 'stroke-dasharray': '4 4' }, g);
    txt(g, 920 + 130, yy, lab, 'lbl-sm', 'start');
  });

  // Speed brake
  txt(g, 1140, 18, 'SPD BRK', 'lbl-sm');
  const spdBrake = lever(g, 1110, 24, 80, 160, '');

  // Pitch trim
  const trim = knob(g, 1230, 24, 130, 'PITCH TRIM', 0, v => v.toFixed(1));
  // Camera selector
  const cam = group({ transform: 'translate(1400 24)' }, g);
  txt(cam, 90, 14, 'CAMERA', 'lbl-sm');
  const camBtns = [];
  ['CKPT', 'CHASE', 'ORBT', 'FLBY', 'TOWR', 'FREE'].forEach((lab, i) => {
    const r = i % 3, c = Math.floor(i / 3);
    camBtns.push(button(cam, c * 100, 30 + r * 40, 90, 32, lab, i === 0 ? 'btn-active' : 'btn-off'));
  });
  // Lights cluster
  const lt = group({ transform: 'translate(1640 24)' }, g);
  txt(lt, 130, 14, 'EXT LIGHTS', 'lbl-sm');
  const lights = {};
  ['NAV', 'BCN', 'STRB', 'LDG', 'TAXI'].forEach((lab, i) => {
    lights[lab] = button(lt, i * 52, 30, 48, 32, lab, 'btn-off');
  });
  const intLt = group({ transform: 'translate(1640 80)' }, g);
  txt(intLt, 130, 14, 'INTERIOR', 'lbl-sm');
  ['DOME', 'PNL', 'EMER'].forEach((lab, i) => {
    lights['I_' + lab] = button(intLt, i * 80, 30, 76, 32, lab, 'btn-off');
  });

  // APU, anti-ice, pitot heat — decorative
  const sys = group({ transform: 'translate(1960 24)' }, g);
  txt(sys, 160, 14, 'SYSTEMS (DECORATIVE)', 'lbl-sm');
  ['APU MSTR', 'APU START', 'ENG START', 'ANTI-ICE', 'PITOT HEAT', 'FUEL PUMP'].forEach((lab, i) => {
    const r = i % 3, c = Math.floor(i / 3);
    button(sys, c * 170, 32 + r * 36, 160, 30, lab, 'btn-off');
  });

  // Park brake + brakes + reset
  const brakes = group({ transform: 'translate(1230 130)' }, g);
  refs.pedestalParkBrk = button(brakes, 0, 0, 130, 36, 'PARK BRK', 'btn-off');
  refs.pedestalBrakes  = button(brakes, 140, 0, 130, 36, 'BRAKES (hold)', 'btn-off');

  refs.pedestal = { rud, com1, com2, xpdr, thr, flapsLever, spdBrake, trim, camBtns, lights };
}

// ---------- Top-level entry ----------
export function buildPanel(svg) {
  svg.innerHTML = '';
  // Background tint
  el('rect', { x: 0, y: 0, width: 2400, height: 1400, fill: '#1a1d20' }, svg);

  const refs = {};

  // FCU band (Y 0..220)
  buildEfis(svg, 50, 0, refs, 'l');
  buildFCU(svg, 700, 0, refs);
  buildEfis(svg, 1850, 0, refs, 'r');

  // Main panel band (Y 240..920)
  buildPFD(svg, 80, 240, refs, 'cpt');
  buildND(svg, 440, 240, refs, 'cpt');
  buildStandby(svg, 800, 240, refs);
  buildUpperEcam(svg, 970, 240, refs);
  buildLdgGear(svg, 1450, 240, refs);
  buildND(svg, 1640, 240, refs, 'fo');
  buildPFD(svg, 2000, 240, refs, 'fo');

  // Lower ECAM + DCDU band (Y 940..1180)
  buildDcdu(svg, 80, 940, refs, 'l');
  buildLowerEcam(svg, 800, 940, refs);
  buildDcdu(svg, 2020, 940, refs, 'r');

  // Pedestal (Y 1200..1400)
  buildPedestal(svg, 1200, refs);

  return refs;
}
