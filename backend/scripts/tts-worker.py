#!/usr/bin/env python3
"""Persistent F5-TTS worker for the Guide's Voice Profile (ADR 0012).

Loads the model once, then reads one JSON request per line on stdin:
  {"id": "...", "ref_audio": "/abs/reference.wav", "ref_text": "...", "gen_text": "...", "lang": "th|en", "nfe": 16}
and writes one JSON line per request on stdout:
  {"id": "...", "wav": "<base64 PCM16 mono 24 kHz WAV>", "ms": 1234}   or   {"id": "...", "error": "..."}
Prints {"ready": true, "device": "..."} once the model is loaded.

Model paths come from F5_MODEL_DIR (model_1000000.pt + vocab.txt) and F5_VOCODER_DIR (Vocos config.yaml + pytorch_model.bin).
F5_EN_MODEL_DIR, when set, is a separate F5 checkpoint (model .pt/.safetensors + vocab.txt) used for lang "en";
otherwise English uses the Thai checkpoint, which was fine-tuned from the English/Chinese F5 base.
"""
import base64
import io
import json
import os
import sys
import time
from contextlib import redirect_stdout
from pathlib import Path

out = sys.stdout
sys.stdout = sys.stderr  # library prints must never corrupt the JSON protocol

MODEL_CFG = {"dim": 1024, "depth": 22, "heads": 16, "ff_mult": 2, "text_dim": 512,
             "text_mask_padding": False, "conv_layers": 4, "pe_attn_head": 1}
SAMPLE_RATE = 24000


def reply(payload):
    out.write(json.dumps(payload, ensure_ascii=False) + "\n")
    out.flush()


def checkpoint(directory):
    root = Path(directory)
    for name in ("model_1000000.pt", "model_1250000.safetensors", "model.safetensors", "model.pt"):
        if (root / name).is_file():
            return root / name
    found = sorted(list(root.glob("*.pt")) + list(root.glob("*.safetensors")))
    if not found:
        raise FileNotFoundError(f"no F5 checkpoint in {root}")
    return found[0]


def main():
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    import numpy as np
    import soundfile as sf
    import torch
    from f5_tts_th.utils_infer import load_model, load_vocoder, infer_process, preprocess_ref_audio_text

    device = "mps" if torch.backends.mps.is_available() else ("cuda" if torch.cuda.is_available() else "cpu")
    vocoder = load_vocoder("vocos", is_local=True, local_path=os.environ["F5_VOCODER_DIR"], device=device)

    def load(directory):
        model = load_model(MODEL_CFG, str(checkpoint(directory)), mel_spec_type="vocos",
                           vocab_file=str(Path(directory) / "vocab.txt"), device="cpu")
        return model.to(device, dtype=torch.float32)

    models = {"th": load(os.environ["F5_MODEL_DIR"])}
    models["en"] = load(os.environ["F5_EN_MODEL_DIR"]) if os.environ.get("F5_EN_MODEL_DIR") else models["th"]
    reply({"ready": True, "device": device, "englishModel": "separate" if os.environ.get("F5_EN_MODEL_DIR") else "thai"})

    references = {}
    for line in sys.stdin:
        if not line.strip():
            continue
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            started = time.perf_counter()
            key = (request["ref_audio"], request["ref_text"])
            if key not in references:
                with redirect_stdout(sys.stderr):
                    references[key] = preprocess_ref_audio_text(*key)
            ref_audio, ref_text = references[key]
            torch.manual_seed(42)
            np.random.seed(42)
            with redirect_stdout(sys.stderr):
                wav, sr, _ = infer_process(ref_audio, ref_text, request["gen_text"], models.get(request.get("lang"), models["th"]),
                                           vocoder, mel_spec_type="vocos", nfe_step=int(request.get("nfe") or 32), speed=1.0, cfg_strength=2.0,
                                           set_max_chars=100, fix_duration=None, use_ipa=False, device=device)
            wav = np.asarray(wav.cpu().numpy() if hasattr(wav, "cpu") else wav).squeeze()
            if sr != SAMPLE_RATE or wav.ndim != 1 or not wav.size or not np.isfinite(wav).all():
                raise ValueError("invalid audio from model")
            buffer = io.BytesIO()
            sf.write(buffer, wav, sr, format="WAV", subtype="PCM_16")
            reply({"id": request_id, "wav": base64.b64encode(buffer.getvalue()).decode(),
                   "ms": round((time.perf_counter() - started) * 1000)})
        except Exception as error:  # one bad request must not kill the worker
            reply({"id": request_id, "error": f"{type(error).__name__}: {error}"})


if __name__ == "__main__":
    main()
