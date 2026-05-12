# Wire Protocol

Two DataChannels between the PC userscript (offerer) and the iPad page (answerer).

| Channel        | Reliability                              | Direction        | Payload                       |
| -------------- | ---------------------------------------- | ---------------- | ----------------------------- |
| `dc-telemetry` | `ordered:false, maxRetransmits:0`        | PC → iPad        | Binary `Float32Array` frame   |
| `dc-control`   | `ordered:true` (default reliable)        | iPad → PC        | UTF-8 JSON object             |

When the underlying ICE connection fails (relay fallback), the same frames are
republished on MQTT topics `geofs/<roomId>/telemetry` and `geofs/<roomId>/control`,
wrapped in the same AES-GCM envelope used for signaling.

## 1. Telemetry frame (PC → iPad, 30 Hz)

A `Float32Array(19)` = 76 bytes. Each frame is one `dc.send(buffer)` call.

| idx | field            | unit         | notes                                                   |
| --: | ---------------- | ------------ | ------------------------------------------------------- |
|   0 | `kias`           | kt           | indicated airspeed (`geofs.animation.values.kias`)      |
|   1 | `altitude`       | ft MSL       | barometric (`...altitude`)                              |
|   2 | `verticalSpeed`  | ft/min       | (`...verticalSpeed`)                                    |
|   3 | `heading360`     | deg          | magnetic 0..360 (`...heading360`)                       |
|   4 | `apitch`         | deg          | pitch in degrees (`...apitch`)                          |
|   5 | `aroll`          | deg          | bank in degrees (`...aroll`)                            |
|   6 | `turnRate`       | deg/s        | derived from `rigidBody.v_angularVelocity[2]`           |
|   7 | `slip`           | -1..1        | normalized lateral accel (rough side-slip indicator)    |
|   8 | `throttle`       | 0..1         | (`...throttle`)                                         |
|   9 | `flapsPosition`  | 0..1         | (`...flapsPosition`)                                    |
|  10 | `gearPosition`   | 0..1         | 0 up, 1 down                                            |
|  11 | `aoa`            | deg          | (`...aoa`)                                              |
|  12 | `mach`           | ratio        | (`...mach`)                                             |
|  13 | `onGround`       | 0/1          | (`...groundContact`)                                    |
|  14 | `stalling`       | 0/1          | (`...stalling`)                                         |
|  15 | `haglFeet`       | ft AGL       | radio altimeter (`...haglFeet`) — drives GPWS callouts  |
|  16 | `apFlags`        | bitfield     | see below                                               |
|  17 | `autobrake`      | bitfield     | low 2 bits = mode (0..3), high 2 bits = status (0..3)   |
|  18 | `seq`            | uint         | monotonically increasing frame counter                  |

### `apFlags` (idx 16)

| bit | meaning                            |
| --: | ---------------------------------- |
|   0 | AP master on                       |
|   1 | A/THR on                           |
|   2 | mode: 0 = HDG, 1 = NAV             |
|   3 | reserved                           |

### `autobrake` (idx 17)

- low 2 bits (0..3): mode — `0=OFF 1=LO 2=MED 3=MAX`
- high 2 bits (0..3): status — `0=disarmed 1=armed 2=active 3=overridden`

Frames may be dropped or arrive out of order. The iPad keeps only the
highest-`seq` state; older frames are ignored.

## 2. Control frame (iPad → PC, event-driven)

UTF-8 JSON, one message per send. `value` is optional depending on `cmd`.

```json
{ "cmd": "ap.setKias",     "value": 250 }
{ "cmd": "ap.setHeading",  "value": 270 }
{ "cmd": "ap.setAltitude", "value": 36000 }
{ "cmd": "ap.setVS",       "value": 1500 }
{ "cmd": "ap.toggle" }
{ "cmd": "ap.setMode",     "value": "HDG" }       // or "NAV"
{ "cmd": "throttle.set",   "value": 0.85 }        // -1..1
{ "cmd": "flaps.set",      "value": 2 }           // 0..flapsSteps
{ "cmd": "airbrakes.set",  "value": 0.5 }         // 0..1
{ "cmd": "brakes.hold",    "value": 1 }           // 1=press, 0=release
{ "cmd": "trim.adj",       "value": -1 }          // multiples of step
{ "cmd": "gear.toggle" }
{ "cmd": "parkbrake" }
{ "cmd": "lights.toggle" }
{ "cmd": "camera.set",     "value": 0 }           // 0..5
{ "cmd": "nav.tune",       "value": "KSEA" }
{ "cmd": "autobrake.set",  "value": "MED" }       // OFF | LO | MED | MAX
```

Unrecognised `cmd` values are silently dropped on the PC side.

## 3. Signaling envelope (MQTT)

Topics under `geofs/<roomId>/`:
- `offer`  — PC → iPad, SDP offer
- `answer` — iPad → PC, SDP answer
- `ice-a`  — PC → iPad, ICE candidates
- `ice-b`  — iPad → PC, ICE candidates
- `telemetry`, `control` — relay fallback only

Every payload is the AES-GCM ciphertext of a UTF-8 JSON string. The wire
format is a base64 string of `iv (12 bytes) || ciphertext || tag`.

`roomId` = first 12 hex chars of `SHA-256("room:" + passphrase)`.
AES-GCM key = `PBKDF2(passphrase, salt="geofs-instruments-v1", 100k rounds, SHA-256, 256-bit)`.

QoS 0, `retain:false`. Bad decrypts are dropped silently — wrong passphrase
just looks like silence to both sides.
