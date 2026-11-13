#!/usr/bin/env bash
# Run without Docker (e.g. on a Mac, so the STT workers use the GPU through MPS).
# Puts the parts back into the layout the code expects (handoff/build/app), installs, and starts the three units.
#   prerequisites: Node 22+, ffmpeg, Python 3.10+ with `pip install torch` and `pip install -r deploy/requirements.txt`,
#                  the two STT models in the Hugging Face cache (first run: see README, "Run without Docker")
#   usage: deploy/run-native.sh            (reads deploy/.env when it exists)
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
app="$here/build/app"
mkdir -p "$app"
rsync -a --delete --exclude node_modules --exclude maps --exclude gestures "$here/backend/" "$app/"
rsync -a --delete "$here/frontend/public/" "$app/public/"
rsync -a --delete "$here/frontend/shared/" "$app/shared/"
rsync -a --delete "$here/assets/models/" "$app/assets/"
# maps/ and gestures/ hold Author-mode edits: copy them only the first time
[[ -d "$app/maps" ]] || rsync -a "$here/assets/maps/" "$app/maps/"
[[ -d "$app/gestures" ]] || rsync -a "$here/assets/gestures/" "$app/gestures/"
(cd "$app" && npm ci --omit=dev --no-audit --no-fund >/dev/null)
if [[ -f "$here/deploy/.env" ]]; then set -a; source "$here/deploy/.env"; set +a; fi
export WHISPER_PYTHON="${WHISPER_PYTHON:-python3}" PORT="${PORT:-3300}"
cd "$app"
echo "starting: web http://127.0.0.1:${PORT} · Thai ${STT_WORKERS_TH:-3} workers · English ${STT_WORKERS_EN:-2} workers (Ctrl-C stops all)"
exec node scripts/start-all.mjs
