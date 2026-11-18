#!/usr/bin/env bash
# Install the Guide's voice runtime inside this project (ADR 0012, spec R6.1): nothing at run time points at
# the AI Study Companion Avatar folder.
#
#   npm run setup:voice                       download: Python 3.11 venv + f5-tts-th 1.0.9 + pinned models (~3 GB)
#   npm run setup:voice -- --yes              same, without the confirmation question (CI / deploy scripts)
#   npm run setup:voice -- --from <folder>    setup-time only: copy the venv and models from a Companion checkout on this
#                                             machine (no download). After setup nothing reads that folder.
#
# Result: .runtime/voice/{venv, models/f5-tts-thai-v1, vocoders/vocos-mel-24khz}, every model file checked by sha256.
set -euo pipefail
cd "$(dirname "$0")/.."
DEST=.runtime/voice
MODEL_REPO=VIZINTZOR/F5-TTS-THAI
MODEL_REV=af023c707f4208e5fc1fce59c1fd1501cfc3fc22
VOCODER_REPO=charactr/vocos-mel-24khz
VOCODER_REV=0feb3fdd929bcd6649e0e7c5a688cf7dd012ef21
declare -a CHECKS=(
  "models/f5-tts-thai-v1/model_1000000.pt 304db1ac0ff1d0a92f3cc14951ee053e52e25ae13abfdb5dc339cdb9b3bebc62"
  "models/f5-tts-thai-v1/vocab.txt 88200c1e2121226fb9b7a12f5d8bab399b856bb7538b1e6b39a220ee9475187c"
  "vocoders/vocos-mel-24khz/config.yaml da9033922f969a47f0c160010226919e59f27761fd5066f3828d46de6650b0fc"
  "vocoders/vocos-mel-24khz/pytorch_model.bin 97ec976ad1fd67a33ab2682d29c0ac7df85234fae875aefcc5fb215681a91b2a"
)
mkdir -p "$DEST/models/f5-tts-thai-v1" "$DEST/vocoders/vocos-mel-24khz"

if [[ "${1:-}" == "--from" ]]; then
  SRC="${2:?usage: setup-voice.sh --from <AI Study Companion Avatar folder>}/.runtime/voice"
  echo "Copying voice runtime from $SRC (local disk, no download)…"
  [[ -x "$SRC/venv/bin/python" ]] || { echo "No venv at $SRC/venv"; exit 1; }
  rm -rf "$DEST/venv"
  # A venv copied this way works when its python is run directly (pyvenv.cfg is found next to it).
  cp -R "$SRC/venv" "$DEST/venv"
  cp "$SRC/models/f5-tts-thai-v1/$MODEL_REV/model_1000000.pt" "$SRC/models/f5-tts-thai-v1/$MODEL_REV/vocab.txt" "$DEST/models/f5-tts-thai-v1/"
  cp "$SRC/vocoders/charactr-vocos-mel-24khz/$VOCODER_REV/config.yaml" "$SRC/vocoders/charactr-vocos-mel-24khz/$VOCODER_REV/pytorch_model.bin" "$DEST/vocoders/vocos-mel-24khz/"
else
  PY="${PYTHON:-python3.11}"
  command -v "$PY" >/dev/null || { echo "Need Python 3.11 ($PY) — set PYTHON=/path/to/python3.11"; exit 1; }
  if [[ "${1:-}" != "--yes" ]]; then
    read -r -p "This downloads Python packages and models from PyPI and Hugging Face (about 3 GB). Continue? [y/N] " answer
    [[ "$answer" =~ ^[Yy] ]] || { echo "Cancelled."; exit 1; }
  fi
  echo "Creating venv and downloading f5-tts-th 1.0.9 + models (about 3 GB)…"
  "$PY" -m venv "$DEST/venv"
  "$DEST/venv/bin/python" -m pip install --upgrade pip
  "$DEST/venv/bin/python" -m pip install "f5-tts-th==1.0.9" soundfile huggingface_hub
  "$DEST/venv/bin/python" - "$DEST" <<PY
import shutil, sys
from huggingface_hub import hf_hub_download
dest = sys.argv[1]
for repo, rev, name, folder in [("$MODEL_REPO", "$MODEL_REV", "model_1000000.pt", "models/f5-tts-thai-v1"),
                                ("$MODEL_REPO", "$MODEL_REV", "vocab.txt", "models/f5-tts-thai-v1"),
                                ("$VOCODER_REPO", "$VOCODER_REV", "config.yaml", "vocoders/vocos-mel-24khz"),
                                ("$VOCODER_REPO", "$VOCODER_REV", "pytorch_model.bin", "vocoders/vocos-mel-24khz")]:
    shutil.copy(hf_hub_download(repo, name, revision=rev), f"{dest}/{folder}/{name}")
PY
fi

echo "Checking model files…"
for check in "${CHECKS[@]}"; do
  read -r file sum <<<"$check"
  actual=$(shasum -a 256 "$DEST/$file" | cut -d' ' -f1)
  [[ "$actual" == "$sum" ]] || { echo "sha256 mismatch: $file"; exit 1; }
done
"$DEST/venv/bin/python" -c "import f5_tts_th, soundfile, torch; print('voice runtime ok, torch', torch.__version__)"
echo "Done. Next: npm run voice:import-companion (copy an existing consented Voice Profile) or record one in Author mode."
