# GPWS callout audio

These files are loaded by `ipad/js/gpws.js` and played when the aircraft
descends through the matching radio-altitude threshold.

Run `bash scripts/generate-gpws-audio.sh` from the repo root to generate them
locally with [Piper TTS](https://github.com/rhasspy/piper) (MIT licensed),
then commit the resulting `*.mp3` files into git.

**Do not** vendor recordings extracted from MSFS, X-Plane, Honeywell EGPWS,
or other commercial sources here — those are copyrighted and cannot be
redistributed under this project's license.

Expected files:

```
10.mp3 20.mp3 30.mp3 40.mp3 50.mp3
100.mp3 200.mp3 300.mp3 400.mp3 500.mp3
1000.mp3 2500.mp3
retard.mp3 minimums.mp3
```

Missing files are tolerated at runtime — `gpws.js` silently skips a callout
whose audio buffer didn't load.
