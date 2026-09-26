"""Corpus builder: plan clips, perform, render, record, verify, write.

  PYTHONPATH=. uv run python -m synthcorpus.build --timbres violin,oboe --per-source 4
  PYTHONPATH=. uv run python -m synthcorpus.build --voices --per-voice 6

Layout (out/):
  out/<group>/<timbre>/<clip>.truth.json        {bpm, notes:[{onsetSec,durSec,midi}]}
  out/<group>/<timbre>/<clip>.meta.json         everything needed to reproduce / audit the clip
  out/<group>/<timbre>/<clip>__<condition>.wav  dry + recorded variants (48 kHz, 24-bit)
where group ∈ {instruments, voices}.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import time
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
import soundfile as sf

from .acoustics import CONDITIONS, RecordingChain
from .instruments import BY_ID, TIMBRES, Timbre
from .melody import MelodyLibrary, Phrase
from .performance import Performer, PlayerProfile
from .qa import artefacts, label_fidelity
from .sampler import MonoSampler
from .voice import PsolaSinger, SingerStyle, VoiceBank

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'out'
SR = 48000

STYLE_QPM = {'air': (54, 84), 'chorale': (60, 92), 'fiddle-tune': (70, 112), 'polyphony': (60, 96), 'madrigal': (60, 96), 'quartet': (58, 112), 'baroque': (60, 104)}


@dataclass
class Plan:
    phrase: Phrase
    qpm: float
    shift: int


class ClipPlanner:
    """Chooses idiomatic, playable excerpts for a timbre (range, part, tempo, note speed)."""

    def __init__(self, lib: MelodyLibrary, rng: random.Random):
        self.lib = lib
        self.rng = rng
        self.by_style: dict[str, list[Phrase]] = {}
        for p in lib.phrases:
            self.by_style.setdefault(p.style, []).append(p)

    def _fit(self, p: Phrase, lo: int, hi: int, pitch_set: tuple[int, ...] | None) -> int | None:
        a, b = p.span
        if b - a > hi - lo:
            return None
        shifts = [s for s in range(lo - a, hi - b + 1)]
        if pitch_set:
            shifts = [s for s in shifts if all((n.midi + s) in pitch_set for n in p.notes)]
        if not shifts:
            return None
        # prefer small transpositions (keeps the tune's own key) but vary it
        shifts.sort(key=lambda s: abs(s) + self.rng.random() * 6)
        return shifts[0]

    def plan(self, t: Timbre, n: int, max_tries: int = 4000) -> list[Plan]:
        rng = self.rng
        lo, hi = t.range
        out: list[Plan] = []
        seen: set[str] = set()
        tries = 0
        while len(out) < n and tries < max_tries:
            tries += 1
            style = rng.choice(t.styles)
            pool = self.by_style.get(style) or []
            if not pool:
                continue
            p = rng.choice(pool)
            if p.id in seen or len(p.notes) < 8:
                continue
            if t.parts and style in ('chorale', 'polyphony', 'quartet', 'madrigal') and rng.random() < 0.8:
                if not any(k.lower() in p.part.lower() for k in t.parts):
                    continue
            s = self._fit(p, lo, hi, t.pitch_set)
            if s is None:
                continue
            q0, q1 = STYLE_QPM.get(style, (60, 100))
            q0, q1 = max(q0, t.qpm[0]), min(q1, t.qpm[1])
            if q1 < q0:
                q1 = q0
            qpm = rng.uniform(q0, q1) if p.tempo_qpm is None else float(np.clip(p.tempo_qpm * rng.uniform(0.85, 1.05), q0 * 0.8, q1 * 1.1))
            shortest = min(n.dur for n in p.notes) * 60 / qpm
            if shortest < t.min_note:
                qpm = min(n.dur for n in p.notes) * 60 / t.min_note
                if qpm < q0 * 0.7:
                    continue
            dur = p.length_q * 60 / qpm
            if not (6.0 <= dur <= 26.0):
                continue
            seen.add(p.id)
            out.append(Plan(p.transposed(s), qpm, s))
        return out


def _clip_id(*parts) -> str:
    return hashlib.sha1('|'.join(map(str, parts)).encode()).hexdigest()[:10]


class CorpusBuilder:
    def __init__(self, conditions: list[str], seed: int = 20260926, log=print):
        self.conditions = conditions
        self.seed = seed
        self.log = log
        self.lib = MelodyLibrary()
        self.lib.build(max_files_per_source=80, log=lambda *a: None)
        self.chain = RecordingChain()

    # ------------------------------------------------------------ writing
    def _write(self, group: str, name: str, clip: str, dry: np.ndarray, truth: list[dict], qpm: float, meta: dict, rng: random.Random) -> dict:
        d = OUT / group / name
        d.mkdir(parents=True, exist_ok=True)
        peak = float(np.abs(dry).max()) + 1e-9
        dry = dry / peak * 10 ** (-3 / 20)
        fid = label_fidelity(dry, SR, truth)
        art = artefacts(dry, SR)
        meta = {**meta, 'clip': clip, 'fidelity': fid.as_dict(), 'artefacts': art, 'passed': fid.passed() and art['clip_frac'] == 0}
        if not meta['passed']:
            # quality gate: a clip whose labels an independent tracker can't confirm never enters the corpus
            with open(OUT / 'rejects.jsonl', 'a') as f:
                f.write(json.dumps({'group': group, 'timbre': name, **meta}, default=str) + '\n')
            rd = OUT / '_rejects'
            rd.mkdir(parents=True, exist_ok=True)
            sf.write(rd / f'{clip}.wav', dry, SR, subtype='PCM_16')
            (rd / f'{clip}.truth.json').write_text(json.dumps({'bpm': round(qpm, 2), 'notes': truth}))
            return meta
        (d / f'{clip}.truth.json').write_text(json.dumps({'bpm': round(qpm, 2), 'notes': truth}, indent=1))
        sf.write(d / f'{clip}__dry.wav', dry, SR, subtype='PCM_24')
        meta['conditions'] = {}
        for c in self.conditions:
            y, m = self.chain.apply(dry, CONDITIONS[c], random.Random(rng.randrange(1 << 30)))
            sf.write(d / f'{clip}__{c}.wav', y, SR, subtype='PCM_24')
            meta['conditions'][c] = m
        (d / f'{clip}.meta.json').write_text(json.dumps(meta, indent=1, default=str))
        return meta

    _breaths: list | None = None

    def breath_pool(self) -> list:
        """Real inhales cut from VocalSet (the silence before each phrase)."""
        if self._breaths is None:
            bank = VoiceBank()
            bank.analyse()
            pool = []
            for u in [u for u in bank.units if u.kind == 'breath'][:400]:
                x = bank.audio(u.file)[u.start : u.end]
                if len(x) > 0.15 * 44100:
                    pool.append((x.astype(np.float32), 44100))
            self._breaths = pool
            self.log(f'breath pool: {len(pool)} real inhales')
        return self._breaths

    # ------------------------------------------------------------ instruments
    def instrument(self, t: Timbre, per_source: int, target: int | None = None) -> list[dict]:
        rng = random.Random(f'{self.seed}:{t.id}')
        planner = ClipPlanner(self.lib, rng)
        results = []
        srcs = t.available_sources()
        if not srcs:
            self.log(f'{t.id}: no sample source available')
            return results
        if target:
            # spread `target` clips over the sources (at least 2 each)
            per_source = max(2, -(-target // len(srcs)))
        plans = planner.plan(t, per_source * len(srcs) * 3)
        for si, src in enumerate(srcs):
            try:
                sset = src.load()
            except Exception as e:
                self.log(f'{t.id}/{src.id}: load failed: {e}')
                continue
            if not sset.zones:
                self.log(f'{t.id}/{src.id}: no zones')
                continue
            klo, khi = sset.key_range
            passed_here = 0
            attempts = 0
            while passed_here < per_source and plans and attempts < per_source * 3:
                attempts += 1
                k = attempts
                plan = plans.pop(0)
                a, b = plan.phrase.span
                if a < klo - 3 or b > khi + 3:
                    # source covers less than the timbre range: re-transpose inside it
                    shift = max(klo - a, min(0, khi - b)) if b - a <= khi - klo else None
                    if shift is None:
                        continue
                    plan = Plan(plan.phrase.transposed(shift), plan.qpm, plan.shift + shift)
                skill = rng.choices(['pro', 'good', 'amateur'], [0.4, 0.4, 0.2])[0]
                dyn = rng.choice(t.dynamics)
                crng = random.Random(rng.randrange(1 << 30))
                perf = Performer(t.player, crng).perform(plan.phrase, plan.qpm, skill, dyn, lead_in=crng.choice((1, 2)) * 60 / plan.qpm)
                t0 = time.time()
                breaths = self.breath_pool() if t.player.family in ('wind', 'reed', 'brass', 'freereed') else None
                smp = MonoSampler(sset, t.sampler, crng, SR, breaths=breaths)
                try:
                    dry, truth = smp.render(perf)
                except Exception as e:
                    self.log(f'{t.id}/{src.id}: render failed ({type(e).__name__}: {e}); next plan')
                    continue
                clip = f'{t.id}_{src.id}_{_clip_id(plan.phrase.id, src.id, k)}'
                meta = {
                    'timbre': t.id, 'app_ids': t.app_ids, 'source': src.id, 'phrase': plan.phrase.source, 'style': plan.phrase.style,
                    'part': plan.phrase.part, 'transpose': plan.shift, 'qpm': round(plan.qpm, 1), 'skill': skill, 'dynamic': dyn,
                    'render_sec': round(time.time() - t0, 2), 'duration': round(len(dry) / SR, 2), 'notes': len(truth),
                    'legato_notes': sum(n.legato_in for n in perf.notes), 'tempo': perf.meta.get('tempo'),
                    # per truth note: [legato-in, staccato, glide-in s, intonation cents]
                    'note_attrs': [[int(n.legato_in), int(n.staccato), round(n.glide_in, 3), round(n.cents, 1)] for n in perf.notes],
                }
                r = self._write('instruments', t.id, clip, dry, truth, plan.qpm, meta, crng)
                results.append(r)
                passed_here += r['passed']
                self.log(f"{t.id:14s} {src.id:32s} {clip} {r['duration']:5.1f}s notes={r['notes']:3d} fid={r['fidelity']['pitch_ok']:.2f} pass={r['passed']}")
        return results


@dataclass
class VoiceType:
    id: str
    range: tuple[int, int]
    singers: tuple[str, ...]
    formant: tuple[float, float] = (1.0, 1.0)
    parts: tuple[str, ...] = ()
    derived: bool = False  # timbre transformed beyond the recorded singer (child)


FEMALE = tuple(f'female{i}' for i in range(1, 10))
MALE = tuple(f'male{i}' for i in (1, 2, 3, 4, 5, 6, 7, 10, 11))
VOICE_TYPES = [
    VoiceType('soprano', (62, 81), FEMALE, (1.02, 1.06), ('Soprano', 'Cantus', 'Superius')),
    VoiceType('mezzo', (57, 77), FEMALE, (0.99, 1.02), ('Soprano', 'Alto', 'Cantus')),
    VoiceType('alto', (53, 73), FEMALE, (0.96, 0.99), ('Alto', 'Altus')),
    VoiceType('tenor', (48, 68), MALE, (1.0, 1.03), ('Tenor',)),
    VoiceType('baritone', (44, 64), MALE + ('male8',), (0.98, 1.0), ('Bass', 'Tenor', 'Bassus')),
    VoiceType('bass', (40, 60), ('male8',) * 4 + MALE, (0.94, 0.97), ('Bass', 'Bassus')),
    VoiceType('countertenor', (55, 74), ('male9',), (1.0, 1.0), ('Alto', 'Altus')),
    VoiceType('child', (60, 79), FEMALE, (1.12, 1.18), ('Soprano',), derived=True),
]
VOICE_PLAYER = PlayerProfile('voice', legato_default=0.85, detache_gap=(0.02, 0.05), intonation_sd=12, breath_capacity=(4.5, 8.0), breath_time=(0.3, 0.5))


def voice_timbre(vt: VoiceType):
    from .instruments import Timbre

    return Timbre(vt.id, ['voice-lead'], 'voice', vt.range, ['chorale', 'polyphony', 'madrigal', 'air'], VOICE_PLAYER, None, [], qpm=(56, 96),
                  min_note=0.16, parts=vt.parts, dynamics=('p', 'mp', 'mf', 'mf', 'f'))


class VoiceBuilder:
    def __init__(self, cb: 'CorpusBuilder'):
        self.cb = cb
        self.bank = VoiceBank()
        self.bank.analyse()

    def build(self, vt: VoiceType, n: int) -> list[dict]:
        cb = self.cb
        rng = random.Random(f'{cb.seed}:voice:{vt.id}')
        t = voice_timbre(vt)
        plans = ClipPlanner(cb.lib, rng).plan(t, n * 3)
        out = []
        while plans and sum(r['passed'] for r in out) < n:
            plan = plans.pop(0)
            singer = rng.choice(vt.singers)
            info = self.bank.singers[singer]
            style_kind = rng.choices(['straight', 'light', 'operatic'], [0.4, 0.4, 0.2] if not vt.derived else [0.6, 0.4, 0.0])[0]
            vr, ve = info.vib.get('vibrato', (5.5, 90))
            vs = info.vib.get('straight', (5.3, 15))
            if style_kind == 'straight':
                rate, ext = vs[0], min(25.0, vs[1])
            elif style_kind == 'light':
                rate, ext = vr, min(55.0, 0.45 * ve)
            else:
                rate, ext = vr, min(130.0, ve)
            vowel = rng.choices(VOWELS := ('a', 'e', 'i', 'o', 'u'), [0.35, 0.15, 0.1, 0.25, 0.15])[0]
            skill = rng.choices(['pro', 'good', 'amateur'], [0.35, 0.4, 0.25])[0]
            dyn = rng.choice(t.dynamics)
            crng = random.Random(rng.randrange(1 << 30))
            st = SingerStyle(singer, 'clean', vowel, skill=skill, vib_rate=rate, vib_extent=ext, formant=crng.uniform(*vt.formant))
            try:
                singer_r = PsolaSinger(self.bank, st, crng, SR)
            except ValueError:
                continue
            perf = Performer(VOICE_PLAYER, crng).perform(plan.phrase, plan.qpm, skill, dyn, lead_in=crng.choice((1, 2)) * 60 / plan.qpm)
            t0 = time.time()
            dry, truth = singer_r.render(perf)
            clip = f'{vt.id}_{singer}_{_clip_id(plan.phrase.id, singer, vowel)}'
            meta = {
                'timbre': f'voice-{vt.id}', 'voice_type': vt.id, 'app_ids': ['voice-lead'], 'source': f'vocalset-{singer}', 'singer': singer,
                'vowel': vowel, 'vibrato_style': style_kind, 'vib_rate': round(rate, 2), 'vib_extent_cents': round(ext, 1), 'formant': round(st.formant, 3),
                'derived_timbre': vt.derived, 'phrase': plan.phrase.source, 'style': plan.phrase.style, 'part': plan.phrase.part, 'transpose': plan.shift,
                'qpm': round(plan.qpm, 1), 'skill': skill, 'dynamic': dyn, 'render_sec': round(time.time() - t0, 2), 'duration': round(len(dry) / SR, 2),
                'notes': len(truth), 'tempo': perf.meta.get('tempo'),
                'note_attrs': [[int(n.legato_in), int(n.staccato), 0.0, round(n.cents, 1)] for n in perf.notes],
            }
            r = cb._write('voices', vt.id, clip, dry, truth, plan.qpm, meta, crng)
            out.append(r)
            cb.log(f"voice {vt.id:12s} {singer:9s} {vowel} {style_kind:8s} {clip} {r['duration']:5.1f}s notes={r['notes']:3d} fid={r['fidelity']['pitch_ok']:.2f} pass={r['passed']}")
        return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--timbres', default='')
    ap.add_argument('--per-source', type=int, default=3)
    ap.add_argument('--target', type=int, default=0, help='clips per timbre, spread over its sources')
    ap.add_argument('--conditions', default='', help='record conditions inline (default: dry only; use synthcorpus.record)')
    ap.add_argument('--voices', default='', help="comma list of voice types, or 'all'")
    ap.add_argument('--per-voice', type=int, default=6)
    args = ap.parse_args()
    conds = [c for c in args.conditions.split(',') if c]
    b = CorpusBuilder(conds)
    all_res = []
    if args.voices:
        vb = VoiceBuilder(b)
        vts = VOICE_TYPES if args.voices == 'all' else [v for v in VOICE_TYPES if v.id in args.voices.split(',')]
        for vt in vts:
            all_res += vb.build(vt, args.per_voice)
    ids = [t.strip() for t in args.timbres.split(',') if t.strip()] or ([] if args.voices else [t.id for t in TIMBRES])
    for tid in ids:
        all_res += b.instrument(BY_ID[tid], args.per_source, args.target or None)
    ok = sum(r['passed'] for r in all_res)
    print(f'\n{len(all_res)} clips, {ok} passed')


if __name__ == '__main__':
    main()
