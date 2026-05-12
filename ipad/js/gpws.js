// GPWS-style radio altitude callouts driven by haglFeet from telemetry.
// Audio context is unlocked on first user gesture; buffers are pre-decoded so
// the actual playback is immediate during the final flare.

const CALLOUTS = [
  { ft: 2500, key: '2500' },
  { ft: 1000, key: '1000' },
  { ft:  500, key:  '500' },
  { ft:  400, key:  '400' },
  { ft:  300, key:  '300' },
  { ft:  200, key:  '200' },
  { ft:  100, key:  '100' },
  { ft:   50, key:   '50' },
  { ft:   40, key:   '40' },
  { ft:   30, key:   '30' },
  { ft:   20, key:   '20' },
  { ft:   10, key:   '10' },
];

let ctx = null;
const buffers = {};
let armed = new Set();
let lastAlt = Infinity;
let enabled = true;
let unlocked = false;
let lastPlayedAt = 0;

export function setEnabled(v) { enabled = !!v; }
export function isUnlocked() { return unlocked; }

export async function unlock() {
  if (unlocked) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  try { await ctx.resume(); } catch (_) {}
  // 1-sample silent buffer to fully unlock iOS audio.
  const silence = ctx.createBuffer(1, 1, 22050);
  const src = ctx.createBufferSource();
  src.buffer = silence; src.connect(ctx.destination); src.start(0);
  // Pre-fetch all callouts (best-effort; failures just leave that key silent).
  await Promise.all(CALLOUTS.map(c => loadOne(c.key)));
  await loadOne('retard');
  await loadOne('minimums');
  unlocked = true;
}

async function loadOne(key) {
  try {
    const res = await fetch(`./assets/audio/gpws/${key}.mp3`);
    if (!res.ok) return;
    const buf = await res.arrayBuffer();
    buffers[key] = await ctx.decodeAudioData(buf);
  } catch (_) {
    // Missing file is fine — the matching callout will be silent
  }
}

function play(key) {
  if (!enabled || !ctx) return;
  const buf = buffers[key];
  if (!buf) return;
  const now = performance.now();
  if (now - lastPlayedAt < 300) return; // throttle
  lastPlayedAt = now;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
}

export function update(haglFeet) {
  if (!isFinite(haglFeet)) return;
  if (haglFeet > lastAlt) {
    // Climbing — re-arm thresholds we have safely cleared
    for (const c of CALLOUTS) {
      if (haglFeet > c.ft + 50) armed.add(c.key);
    }
  } else if (haglFeet < lastAlt) {
    for (const c of CALLOUTS) {
      if (armed.has(c.key) && lastAlt > c.ft && haglFeet <= c.ft) {
        play(c.key);
        armed.delete(c.key);
      }
    }
  }
  lastAlt = haglFeet;
}

let retardSpoken = false;
export function retardCheck(haglFeet, onGround, throttle) {
  if (!enabled || !ctx) return;
  if (haglFeet < 20 && !onGround && throttle > 0.15) {
    if (!retardSpoken) { play('retard'); retardSpoken = true; }
  }
  if (onGround) retardSpoken = false;
}
