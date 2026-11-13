"""Persistent speech-to-text worker (one process, models stay loaded).

Protocol: one JSON object per line on stdin  {"id", "path", "language": "th"|"en", "prompt"?}
          one JSON object per line on stdout {"id", "text", "language", "provider", "durationMs"} or {"id", "error"}
Run by an STT Service (server/stt-service.mjs), one process per worker, `python stt_worker.py <lang>`.
Models are chosen per language and loaded from the local Hugging Face cache (never downloaded here):
  STT_MODEL_TH (default biodatlab/whisper-th-small-combined)  Thai fine-tuned Whisper (ADR 0009 appendix)
  STT_MODEL_EN (default openai/whisper-base.en)                English-only Whisper
  STT_QUANTIZE=int8   dynamic int8 quantization of the Linear layers (CPU only; ADR 0009 appendix measured it)
"""
import json, os, sys, time, wave

os.environ.setdefault('HF_HUB_OFFLINE', '1')
os.environ.setdefault('TRANSFORMERS_OFFLINE', '1')
import numpy as np
import torch
from transformers import WhisperForConditionalGeneration, WhisperProcessor

MODELS = {
    'th': os.environ.get('STT_MODEL_TH', 'biodatlab/whisper-th-small-combined'),
    'en': os.environ.get('STT_MODEL_EN', 'openai/whisper-base.en'),
}
QUANTIZE = os.environ.get('STT_QUANTIZE', '').lower()
if QUANTIZE not in ('', 'int8'):
    raise SystemExit(f'STT_QUANTIZE must be empty or int8, not {QUANTIZE!r}')
# int8 kernels exist only on CPU, so a quantized worker always runs on CPU
DEVICE = 'mps' if torch.backends.mps.is_available() and os.environ.get('STT_DEVICE') != 'cpu' and not QUANTIZE else 'cpu'
VARIANT = f'{DEVICE}-int8' if QUANTIZE else DEVICE
# float32 everywhere: fp16 on MPS overflowed and produced only '!!!!' tokens (measured 2026-11-10).
DTYPE = torch.float32
loaded = {}


def model_for(language):
    name = MODELS[language]
    if name not in loaded:
        processor = WhisperProcessor.from_pretrained(name)
        model = WhisperForConditionalGeneration.from_pretrained(name, dtype=DTYPE).to(DEVICE).eval()
        if QUANTIZE == 'int8':
            torch.backends.quantized.engine = 'qnnpack' if 'qnnpack' in torch.backends.quantized.supported_engines and 'fbgemm' not in torch.backends.quantized.supported_engines else 'fbgemm'
            model = torch.ao.quantization.quantize_dynamic(model, {torch.nn.Linear}, dtype=torch.qint8)
        loaded[name] = (processor, model)
    return name, loaded[name]


def read_wav(path):
    """16 kHz mono 16-bit WAV (the server converts with ffmpeg first)."""
    with wave.open(path, 'rb') as audio:
        if audio.getframerate() != 16000 or audio.getnchannels() != 1 or audio.getsampwidth() != 2:
            raise ValueError('expected 16 kHz mono 16-bit WAV')
        return np.frombuffer(audio.readframes(audio.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0


def transcribe(request):
    language = request.get('language', 'th')
    if language not in MODELS:
        raise ValueError(f'unsupported language {language!r}')
    loading = time.monotonic()
    name, (processor, model) = model_for(language)
    started = time.monotonic()  # durationMs is transcription only; a first-use model load is reported as loadMs
    load_ms = round((started - loading) * 1000)
    inputs = processor(read_wav(request['path']), sampling_rate=16000, return_tensors='pt', return_attention_mask=True)
    features = inputs.input_features.to(DEVICE, DTYPE)
    options = {'max_new_tokens': 128, 'num_beams': 1, 'attention_mask': inputs.attention_mask.to(DEVICE)}
    if not name.endswith('.en'):
        options.update(language=language, task='transcribe')
    if request.get('prompt'):
        options['prompt_ids'] = torch.tensor(processor.get_prompt_ids(request['prompt'])).to(DEVICE)
    with torch.inference_mode():
        ids = model.generate(features, **options)
    text = processor.batch_decode(ids, skip_special_tokens=True)[0].strip()
    if request.get('prompt') and text.startswith(request['prompt'].strip()):
        text = text[len(request['prompt'].strip()):].strip()
    result = {'text': text, 'language': language, 'provider': f'{name}@{VARIANT}', 'durationMs': round((time.monotonic() - started) * 1000)}
    if load_ms >= 50:
        result['loadMs'] = load_ms
    if DEVICE == 'mps' and os.environ.get('STT_REPORT_DEVICE_MEMORY') == '1':
        # GPU memory held by this worker's models (Apple unified memory); only the benchmark turns this on
        result['deviceMemoryBytes'] = int(torch.mps.driver_allocated_memory())
    return result


def warm_up(language):
    """Load the model and run it once on silence: the first inference on MPS is ~4 s slower (kernel set-up)."""
    name, (processor, model) = model_for(language)
    inputs = processor(np.zeros(8000, dtype=np.float32), sampling_rate=16000, return_tensors='pt')
    options = {'max_new_tokens': 4}
    if not name.endswith('.en'):
        options.update(language=language, task='transcribe')
    with torch.inference_mode():
        model.generate(inputs.input_features.to(DEVICE, DTYPE), **options)


def main():
    for preload in filter(None, os.environ.get('STT_PRELOAD', '').split(',')):
        warm_up(preload)
    print(json.dumps({'ready': True, 'device': VARIANT, 'models': MODELS}), flush=True)
    for line in sys.stdin:
        if not line.strip():
            continue
        request = json.loads(line)
        try:
            result = transcribe(request)
        except Exception as error:  # report per request; keep the worker alive
            result = {'error': f'{type(error).__name__}: {error}'}
        result['id'] = request.get('id')
        print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
