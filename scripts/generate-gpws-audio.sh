#!/usr/bin/env bash
# Generate the GPWS callout audio files using Piper TTS (MIT licensed).
#
# Prerequisites (one-time, on macOS / Linux):
#   pip install piper-tts
#   # Download a voice model to ./voices/, e.g.:
#   wget -P voices/ \
#     https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/libritts/high/en_US-libritts-high.onnx \
#     https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/libritts/high/en_US-libritts-high.onnx.json
#   # And ffmpeg for wav -> mp3 conversion.
#
# Run from the repo root:
#   bash scripts/generate-gpws-audio.sh
#
# Output: ipad/assets/audio/gpws/*.mp3 (commit these into git).

set -euo pipefail

OUT=ipad/assets/audio/gpws
VOICE=${VOICE:-voices/en_US-libritts-high.onnx}
mkdir -p "$OUT"

declare -A LINES=(
  [2500]="Two Thousand Five Hundred"
  [1000]="One Thousand"
  [500]="Five Hundred"
  [400]="Four Hundred"
  [300]="Three Hundred"
  [200]="Two Hundred"
  [100]="One Hundred"
  [50]="Fifty"
  [40]="Forty"
  [30]="Thirty"
  [20]="Twenty"
  [10]="Ten"
  [retard]="Retard"
  [minimums]="Minimums"
  [pull-up]="Pull up. Pull up."
  [sink-rate]="Sink rate."
  [stall]="Stall. Stall."
  [bank-angle]="Bank angle. Bank angle."
)

for key in "${!LINES[@]}"; do
  text="${LINES[$key]}"
  echo "→ $key.mp3   ($text)"
  echo "$text" | piper --model "$VOICE" --output_file "$OUT/$key.wav" --quiet
  ffmpeg -y -loglevel error -i "$OUT/$key.wav" -ac 1 -ar 22050 -b:a 32k "$OUT/$key.mp3"
  rm "$OUT/$key.wav"
done

cat > "$OUT/LICENSE.txt" <<'EOF'
GPWS callout audio in this directory was generated locally with
Piper TTS (https://github.com/rhasspy/piper, MIT) using the
en_US-libritts-high voice model. The resulting audio files are
released under the MIT license alongside the rest of this project.

They are NOT extracted from any commercial flight simulator or
Honeywell EGPWS recording.
EOF
echo
echo "Done. Output in $OUT/"
echo "Commit the .mp3 files (and LICENSE.txt) into git."
