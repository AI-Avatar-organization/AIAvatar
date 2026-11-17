# syntax=docker/dockerfile:1
# AI Avatar 3D — one image, three units: web app · Thai STT Service · English STT Service (see ../README.md)
# Build from the handoff/ folder:   docker build -f deploy/Dockerfile -t ai-avatar-3d .
# x86 server:                       docker build --platform linux/amd64 -f deploy/Dockerfile -t ai-avatar-3d .
# Inside the image the parts go back to the layout the code expects:
#   backend/ → /app   frontend/public → /app/public   frontend/shared → /app/shared
#   assets/maps → /app/maps   assets/gestures → /app/gestures   assets/models → /app/assets

FROM node:22-bookworm-slim

# ── System: ffmpeg (audio → 16 kHz WAV) + Python for the STT workers ───────────────────
RUN rm -f /etc/apt/apt.conf.d/docker-clean
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg python3 python3-venv ca-certificates

# ── Python: CPU-only torch (PyPI's x86 torch is the CUDA build, several GB larger) ─────
RUN python3 -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH
COPY deploy/requirements.txt /tmp/requirements.txt
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --upgrade pip setuptools wheel \
 && pip install torch --index-url https://download.pytorch.org/whl/cpu \
 && pip install -r /tmp/requirements.txt \
 && ! pip list 2>/dev/null | grep -i -E '^(nvidia-|triton )'

# ── STT models, downloaded once at build time (workers run offline) ────────────────────
# To use other models: --build-arg STT_MODELS="<thai> <english>" and set STT_MODEL_TH / STT_MODEL_EN in .env
USER node
ARG STT_MODELS="biodatlab/whisper-th-small-combined openai/whisper-base.en"
ENV HOME=/home/node HF_HOME=/home/node/.cache/huggingface
RUN python -c "import sys; from huggingface_hub import snapshot_download as d; [d(m, allow_patterns=['*.json','*.safetensors','*.txt']) for m in sys.argv[1:]]" $STT_MODELS

# ── App ─────────────────────────────────────────────────────────────────────────────────
WORKDIR /app
RUN --mount=type=bind,source=backend/package.json,target=package.json \
    --mount=type=bind,source=backend/package-lock.json,target=package-lock.json \
    --mount=type=cache,target=/home/node/.npm,uid=1000,gid=1000 \
    npm ci --omit=dev
COPY --chown=node:node backend/ ./
COPY --chown=node:node frontend/public ./public
COPY --chown=node:node frontend/shared ./shared
COPY --chown=node:node assets/models ./assets
COPY --chown=node:node assets/maps ./maps
COPY --chown=node:node assets/gestures ./gestures
# Compile walking paths once (checks every Station is reachable); the page downloads them instead of building a navmesh.
RUN node scripts/build-navigation.mjs

ENV NODE_ENV=production HOST=0.0.0.0 PORT=3300 WHISPER_PYTHON=/opt/venv/bin/python STT_DEVICE=cpu
EXPOSE 3300
VOLUME ["/app/maps", "/app/gestures"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3300/api/maps').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Web app by default; compose runs the STT Services from this image with: node server/stt-service.mjs
CMD ["node", "server/index.mjs"]
