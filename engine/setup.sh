#!/usr/bin/env bash
# Prepare a fresh container: python deps + Piper Russian voices
set -e
cd "$(dirname "$0")/.."
pip install -q --break-system-packages piper-tts pillow numpy faster-whisper 2>/dev/null || true
mkdir -p assets/voices
for n in dmitri ruslan denis; do
  for e in onnx onnx.json; do
    f="assets/voices/ru_RU-$n-medium.$e"
    [ -s "$f" ] && [ "$(stat -c%s "$f")" -gt 1000 ] && continue
    curl -sL -m 300 -o "$f" "https://huggingface.co/rhasspy/piper-voices/resolve/main/ru/ru_RU/$n/medium/ru_RU-$n-medium.$e"
  done
done
echo "setup ok"
