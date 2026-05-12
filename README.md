# GeoFS Remote Flight Instruments

Stream live [GeoFS](https://www.geo-fs.com/) telemetry from a desktop browser
to an iPad and render it as an Airbus A320-style virtual cockpit. The iPad
also acts as a control surface — FCU knobs, gear lever, throttle, autobrake,
flaps, etc.

```
 ┌──────────────────────┐                            ┌──────────────────────┐
 │ PC: GeoFS (Chrome)   │                            │ iPad: Safari         │
 │ + Tampermonkey       │                            │ + CF Pages HTML      │
 │                      │   WebRTC DataChannel       │                      │
 │  geofs.animation     │  ◀══ DTLS-encrypted P2P ═▶ │  A320 panel SVG      │
 │  .values  (60 Hz)    │                            │  + GPWS callouts     │
 │  controls.*  setters │                            │                      │
 │                      │   MQTT signaling           │                      │
 │  MQTT.js over WSS    │ ───▶ broker.emqx.io ◀───── │  MQTT.js over WSS    │
 └──────────────────────┘   (AES-GCM envelope)       └──────────────────────┘
```

## How it works

- The two sides agree on a **shared passphrase**. From it both derive:
  - the same AES-GCM key (PBKDF2, 100 000 rounds, fixed salt), and
  - the same 12-hex room ID (`SHA-256("room:" + passphrase)`).
- They use a free public MQTT broker (`broker.emqx.io:8084`, WSS) **only for
  signaling** — SDP offer/answer and ICE candidates, each wrapped in an
  encrypted envelope. Random listeners see ciphertext.
- Once WebRTC is up, telemetry (30 Hz `Float32Array` frames, 76 bytes) and
  control commands (event-driven JSON) flow over two DataChannels with DTLS
  end-to-end encryption.
- A free STUN server is used for NAT traversal. There is no TURN — symmetric
  NATs may fail to connect P2P.

No Cloudflare Workers, no VPS, no payment, no extra software on the PC beyond
the userscript.

## Repository layout

```
userscript/
  geofs-instruments.user.js   # Tampermonkey script for the PC side
ipad/                         # static site deployed to Cloudflare Pages
  index.html
  manifest.webmanifest
  css/style.css
  js/{app,panel,instruments,controls,crypto,signaling,peer,gpws}.js
  assets/audio/gpws/          # GPWS callout MP3s (locally generated, MIT)
shared/protocol.md            # wire-format spec, single source of truth
scripts/generate-gpws-audio.sh
```

## Quick start

### 1. Deploy the iPad page to Cloudflare Pages

1. Push this repo to GitHub.
2. In the Cloudflare dashboard, *Workers & Pages → Create → Pages → Connect to Git*.
3. Pick this repo. **Build command:** leave blank. **Output directory:** `ipad`.
4. After deploy you get a URL like `https://geofs-instruments.pages.dev`.
5. On the iPad, open that URL in Safari, then *Share → Add to Home Screen*
   to launch chromeless in landscape.

### 2. Install the userscript on your PC

1. Install Tampermonkey for Chrome / Firefox / Edge.
2. Open the raw URL of `userscript/geofs-instruments.user.js` from GitHub:
   <https://raw.githubusercontent.com/TonyD365/Geofs-Flight-Instruments/main/userscript/geofs-instruments.user.js>
3. Tampermonkey detects it — click *Install*.
4. Browse to <https://www.geo-fs.com/>.

The script's `@updateURL` points at the `main` branch raw file, so
Tampermonkey auto-checks for new versions in the background (default
every 24 h, configurable in Tampermonkey settings). To publish an
update, bump `@version` in the header (e.g. `0.1.0` → `0.1.1`) and
push to `main` — users get a prompt within a day, or immediately via
*Tampermonkey dashboard → Check for userscript updates*.

#### Alternative: bookmarklet (no Tampermonkey required)

For environments where a userscript manager is unavailable — iPad
Safari, macOS Safari, locked-down Chromebooks, etc. — use the
bookmarklet version. Create a new bookmark with this URL:

```
javascript:(function(){var s=document.createElement('script');s.src='https://cdn.jsdelivr.net/gh/TonyD365/Geofs-Flight-Instruments@main/ipad/loader.js';document.head.appendChild(s);})();
```

Name it "GeoFS Inst" (or whatever). On <https://www.geo-fs.com/>, tap
the bookmark — a floating control panel appears in the top-left, with
*Connect* / *Stop* / *Pass…* buttons. The bookmarklet loads
[`ipad/loader.js`](./ipad/loader.js) from jsDelivr's CDN, which mirrors
the userscript's MQTT + WebRTC + Auto Brake stack but uses
`localStorage` instead of `GM_*` storage and renders its own DOM UI.

jsDelivr caches `@main` for ~12 h. To force-refresh after pushing an
update, hit
<https://purge.jsdelivr.net/gh/TonyD365/Geofs-Flight-Instruments@main/ipad/loader.js>
once, or pin the bookmark to a specific commit SHA (`@<sha>` instead
of `@main`).

### 3. Pair

1. Spawn an aircraft in GeoFS so `geofs.aircraft.instance` is populated.
2. Open the Tampermonkey menu (toolbar icon) → **▶ Connect iPad Panel**.
3. Enter a passphrase you'll remember (≥ 4 characters).
4. On the iPad, tap the input on the cockpit page, enter the *same*
   passphrase, tap **Connect**.
5. Within a few seconds the panel comes alive. The top-right indicator
   shows `Connected (P2P)` and the room ID.

### 4. Generate the GPWS callouts (optional but recommended)

```
pip install piper-tts
# download a voice model (one-time):
mkdir -p voices
wget -P voices/ https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/libritts/high/en_US-libritts-high.onnx
wget -P voices/ https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/libritts/high/en_US-libritts-high.onnx.json
brew install ffmpeg   # or apt install ffmpeg

bash scripts/generate-gpws-audio.sh
```

Commit the resulting `ipad/assets/audio/gpws/*.mp3` files. The iPad pre-loads
them on first tap so the callouts have no buffering during a flare.

## What's actually wired

The iPad panel reproduces the full A320 layout — FCU, captain & FO PFD,
captain & FO ND, standby instruments, upper ECAM (E/WD), lower ECAM (SD),
landing gear & autobrake column, plus the pedestal with throttle, flaps,
speed brake, trim, lights, transponder, camera selector and a system column.

Not every A320 control maps to a GeoFS feature. The buttons are grouped
into three categories in [the plan][plan]:

- **Native API** — `ap.set{Kias,Heading,Altitude,VS}`, `ap.toggle`,
  `controls.throttle`, `controls.flaps.target`, `controls.airbrakes.target`,
  `controls.brakes`, `controls.elevatorTrim`, `geofs.camera.set`,
  `geofs.nav.selectNavaid`. Bound to real handlers.
- **Keyboard fallback** — gear (`g`), parking brake (`.`), external lights
  (`l`). Synthesised via `KeyboardEvent`.
- **Decorative** — A/SKID, N/WS, APU, anti-ice, fuel pumps, ignition,
  TCAS/TERR/WX overlays, EFIS sub-buttons. They light up locally so the
  panel looks alive, but send no command. GeoFS doesn't model these systems.

Special simulated behaviours implemented locally in the userscript:

- **Auto Brake** (LO / MED / MAX). The script runs a P-controller on
  `controls.brakes` aiming at 1.7 / 3.0 / 6.0 m/s². Arms in the air;
  becomes active on ground contact; deactivates when ground speed
  drops below 2 m/s or the pilot presses the brake key (override).

[plan]: ./.claude/plans/

## Security notes

- Anyone holding the passphrase can connect to the same room ID. Treat it
  like a password — pick a long, random one.
- The MQTT broker is public. Subscribers without the key see only random
  base64. SDP and ICE payloads (which would otherwise leak your LAN IP) are
  encrypted before publish.
- WebRTC DataChannel uses DTLS (mandatory in the spec). Telemetry and control
  frames never traverse the broker once the peer is up.
- A symmetric-NAT / CGNAT user will fail to connect P2P. A future revision
  could relay through MQTT in that case — not implemented yet.

## Licence

MIT — see [LICENSE](./LICENSE).

Fonts: [B612 Mono](https://github.com/polarsys/b612), SIL OFL, loaded from
Google Fonts.

There are no embedded third-party graphics, audio, or code from copyrighted
flight-simulator products in this repository.
