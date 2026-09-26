"""Second pass: "record" every accepted dry take under each acoustic condition.

  PYTHONPATH=. uv run python -m synthcorpus.record --conditions studio,room,home-phone,noisy-phone [--force]

Kept separate from the render pass so the corpus can be re-recorded (new rooms,
devices or noise beds) without re-performing it, and so render QA runs on the
dry take alone. Each condition's draw is seeded from the clip id, so re-running
is reproducible; the drawn parameters are merged into `<clip>.meta.json`.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
from pathlib import Path

import soundfile as sf

from .acoustics import CONDITIONS, RecordingChain

OUT = Path(__file__).resolve().parent.parent / 'out'


def record(conditions: list[str], force: bool = False, log=print, pattern: str = '*/*') -> int:
    chain = RecordingChain()
    n = 0
    for meta_p in sorted(OUT.glob(f'{pattern}/*.meta.json')):
        if meta_p.parent.name.startswith('_'):
            continue
        meta = json.loads(meta_p.read_text())
        if not meta.get('passed'):
            continue
        clip = meta_p.name[: -len('.meta.json')]
        dry_p = meta_p.parent / f'{clip}__dry.wav'
        if not dry_p.exists():
            continue
        dry = None
        conds = meta.setdefault('conditions', {})
        for c in conditions:
            out = meta_p.parent / f'{clip}__{c}.wav'
            if out.exists() and not force and c in conds:
                continue
            if dry is None:
                dry, sr = sf.read(dry_p, dtype='float32')
            seed = int(hashlib.sha1(f'{clip}:{c}'.encode()).hexdigest()[:8], 16)
            y, m = chain.apply(dry, CONDITIONS[c], random.Random(seed))
            sf.write(out, y, 48000, subtype='PCM_16')
            conds[c] = m
            n += 1
        meta_p.write_text(json.dumps(meta, indent=1, default=str))
    log(f'recorded {n} condition files')
    return n


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--conditions', default='studio,room,home-phone,noisy-phone')
    ap.add_argument('--force', action='store_true')
    ap.add_argument('--pattern', default='*/*', help="group/timbre glob, e.g. 'instruments/[a-e]*'")
    a = ap.parse_args()
    record([c for c in a.conditions.split(',') if c], a.force, pattern=a.pattern)
