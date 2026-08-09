"""Batch inference for the Yong-2023 checkpoint over the eval corpus.

The runner half of the §10d external-checkpoint gate; `bench-external-notes.ts`
is the scorer half. Loads the model ONCE, then transcribes every wav in the
list file (lines of `<key>\t<wav_path>`, key = `<dataset>__<clip>`) into
`<outdir>/<key>.json` as [[onset_s, offset_s, midi], ...]. Idempotent — clips
whose output exists are skipped, so it resumes after interruption.

Setup (the repo is research-grade; torch 2.x works with two one-line patches):
  git clone --depth 1 \
    https://github.com/seyong92/phoneme-informed-note-level-singing-transcription yong2023
  # checkpoint is Git-LFS; fetch the real 106 MB file:
  curl -sL -o yong2023/checkpoints/model.pt \
    https://media.githubusercontent.com/media/seyong92/phoneme-informed-note-level-singing-transcription/main/checkpoints/model.pt
  python3.12 -m venv venv && venv/bin/pip install torch nnAudio mido mir_eval librosa numpy wquantiles
  # run from the directory CONTAINING yong2023/ (sys.path below expects that):
  venv/bin/python bench-yong-runner.py yong2023/checkpoints/model.pt list.tsv out/

Generate list.tsv with lib/realCorpus + lib/split (dataset id, clip, wav path
for the split under test), then score:
  EXT_DIR=out EVAL_SPLIT=test pnpm --filter @mushee/api exec tsx scripts/eval/bench-external-notes.ts

Measured 2026-08-08 (see the findings log §10d entry): RTF 0.15 on one CPU
core; +0.05..+0.08 vs the shipped decoder on amateur solo and choral,
re-onset recall 0.403 vs 0.263, but −0.16 on professional sustained vibrato.
"""
import json
import sys
import time
from pathlib import Path

import librosa
import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).parent / 'yong2023'))
from phn_ast.decoding import FramewiseDecoder
from phn_ast.model import TranscriptionModel

model_file, list_file, out_dir = sys.argv[1], sys.argv[2], sys.argv[3]
out = Path(out_dir)
out.mkdir(parents=True, exist_ok=True)

ckpt = torch.load(model_file, map_location='cpu', weights_only=False)
config = ckpt['config']
model = TranscriptionModel(config)
model.load_state_dict(ckpt['model_state_dict'])
model.to('cpu')
model.eval()
model.pitch_sum = 'weighted_median'
decoder = FramewiseDecoder(config)

rows = [l.strip().split('\t') for l in open(list_file) if l.strip()]
t0 = time.time()
audio_sec = 0.0
for n, (key, wav) in enumerate(rows):
    dest = out / f'{key}.json'
    if dest.exists():
        continue
    audio, sr = librosa.load(wav, sr=None, mono=True)
    audio_sec += len(audio) / sr
    audio_re = librosa.resample(audio, orig_sr=sr, target_sr=config['sample_rate'])
    audio_t = torch.from_numpy(audio_re).float().unsqueeze(0)
    with torch.no_grad():
        pred = model(audio_t)
        p, i = decoder.decode(pred, audio=audio_t)
    scale = config['hop_length'] / config['sample_rate']
    iv = (np.array(i) * scale).reshape(-1, 2)
    notes = [[float(a), float(b), int(round(m))] for (a, b), m in zip(iv, p)]
    dest.write_text(json.dumps(notes))
    if (n + 1) % 25 == 0:
        el = time.time() - t0
        print(f'{n + 1}/{len(rows)}  rtf={el / max(1e-9, audio_sec):.2f}', flush=True)
print(f'done {len(rows)} clips in {time.time() - t0:.0f}s')
