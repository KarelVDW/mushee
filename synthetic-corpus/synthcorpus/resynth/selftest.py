"""Perturbation self-test: does the compare report DETECT wrong notes?

For a clip WITH human truth, the spec is built from that truth (auto cents/vel, copied
contour), rendered and compared: the BASELINE. Its note-level diffs are false alarms (or
genuine quirks of the human truth). Then one error family at a time is injected on seeded
random notes (several per render, ≥ 0.8 s apart so their diffs cannot mix), the spec is
re-rendered and compared, and each injected error counts as

- detected: a NEW diff (not in the baseline) of a sensible type points at it (±0.1 s);
- other:    a new diff points at it, but of a type that would not lead to the right fix;
- missed:   nothing new near it.

Targets are drawn from notes with no baseline note-level diff within ±0.1 s, so a hit is
attributable. For wrong pitches the copy's own deviation from the original over the note
is recorded too (`copyDevCents`): the contour copy must not hide a wrong `midi`.

  PYTHONPATH=. .venv/bin/python -m synthcorpus.resynth selftest [<ds>/<clip> …] [--per-family 6] [--seed 1]

Writes `work/resynth/_selftest/<timestamp>.json` (+ `latest.json`); no audio is written.
"""

from __future__ import annotations

import json
import random
import time
from dataclasses import asdict, dataclass, field

import numpy as np

from .analysis import Analysis, Analyzer, load_audio
from .compare import Comparison
from .datasets import DatasetConfig, parse_ref
from .evidence import SCOOP, Evidence
from .render import SR, VoiceRenderer, render, seed_for
from .segment import F0Segmenter
from .spec import Spec, SpecError, spec_from_notes
from . import store
from .store import now, write_json

DEFAULT_CLIPS = ('vocadito/vocadito_1', 'vocadito/vocadito_7', 'urmp-flute/03_Dance_fl1')
NOTE_TYPES = ('missing-sound', 'extra-sound', 'pitch', 'extra-onset', 'unsupported', 'timing', 'offset')
NEAR = 0.1  # a diff points at an error when it lies within ±100 ms of it
SPACING = 0.8  # targets of one render are at least this far apart (s)


@dataclass
class Family:
    name: str
    sensible: tuple[str, ...]  # diff types that lead to the right fix


FAMILIES = [
    Family('pitch+1', ('pitch',)),
    Family('pitch-1', ('pitch',)),
    Family('pitch+2', ('pitch',)),
    Family('pitch+12', ('pitch',)),
    Family('delete', ('missing-sound',)),
    Family('merge-diff', ('extra-onset',)),
    Family('merge-diff-short', ('extra-onset',)),  # one part 80–120 ms: the scoop / fall / grace-note grey zone
    Family('merge-same', ('extra-onset',)),
    Family('split', ('unsupported',)),
    Family('onset+60', ('timing', 'unsupported', 'missing-sound')),
    Family('onset+100', ('timing', 'unsupported', 'missing-sound')),
    Family('onset-80', ('timing', 'unsupported')),
    Family('offset+150', ('offset',)),
]
BY_NAME = {f.name: f for f in FAMILIES}


@dataclass
class Injected:
    family: str
    note: str  # the note the diff should name (the second part of a split)
    t0: float  # where the error is (the window a diff must touch, ±NEAR)
    t1: float
    ops: list[dict]
    truth: dict  # what the original really has, e.g. {'midi': 62} or {'on': 3.21}
    outcome: str = 'missed'
    diff: dict | None = None  # the diff that points at it
    fixes: bool | None = None  # its suggested op restores the truth
    copy_dev_cents: float | None = None  # pitch families: copy vs original over the note


def _overlaps(d: dict, t0: float, t1: float, slack: float = NEAR) -> bool:
    return d['t1'] >= t0 - slack and d['t0'] <= t1 + slack


class ClipSelfTest:
    def __init__(self, cfg: DatasetConfig, clip: str, seed: int = 1, per_family: int = 6, log=print):
        self.cfg, self.clip = cfg, clip
        self.ref = f'{cfg.id}/{clip}'
        self.seed, self.per_family = seed, per_family
        self.log = log
        self.analyzer = Analyzer(cfg.family, cfg.f0_range_for(clip))
        self.truth = self._truth()
        self.orig = self._orig()
        self.ev = Evidence(self.orig, F0Segmenter(self.orig, anchors=cfg.prior_notes(clip).anchors))
        self.base_spec = self._spec()

    # ------------------------------------------------------------ inputs
    def _truth(self) -> list[dict]:
        pr = self.cfg.prior_notes(self.clip)
        if pr.notes:
            return pr.notes
        p = self.cfg.truth_path(self.clip)
        if p is None:
            raise SystemExit(f'{self.ref}: no truth to test against')
        return json.loads(p.read_text())['notes']

    def _orig(self) -> Analysis:
        p = store.WORK / '_selftest' / 'cache' / self.cfg.id / f'{self.clip}.orig.npz'
        st = self.cfg.audio_path(self.clip).stat()
        sig = {'size': st.st_size, 'mtime': st.st_mtime_ns}
        if p.exists():
            a = Analysis.load(p)
            if a.meta.get('analyzer') == self.analyzer.config() and a.meta.get('audio') == sig:
                return a
        y, sr = load_audio(self.cfg.audio_path(self.clip))
        a = self.analyzer.analyse(y, sr)
        a.meta['audio'] = sig
        p.parent.mkdir(parents=True, exist_ok=True)
        a.save(p)
        return a

    def _spec(self) -> Spec:
        timbre = self.cfg.timbre_for(self.clip)
        if timbre['kind'] == 'voice' and 'singer' not in timbre:
            timbre['singer'] = VoiceRenderer.choose_singer(timbre.get('vowel', 'a'), [n['midi'] for n in self.truth], timbre.pop('sex', None))
        timbre.pop('sex', None)
        sp = spec_from_notes(self.cfg.id, self.clip, timbre, seed_for(self.cfg.id, self.clip), self.truth, {'source': 'human truth'})
        sp.refresh(self.orig)
        return sp

    # ------------------------------------------------------------ one render
    def report(self, sp: Spec) -> tuple[dict, Analysis]:
        y = render(sp, self.orig)
        c = self.analyzer.analyse(y, SR)
        return Comparison(sp, self.orig, c, self.ev).report(), c

    # ------------------------------------------------------------ targets
    def _clean(self, base_diffs: list[dict], t0: float, t1: float) -> bool:
        return not any(d['type'] in NOTE_TYPES and _overlaps(d, t0, t1) for d in base_diffs)

    def plan(self, fam: Family, base_diffs: list[dict]) -> list[Injected]:
        notes = sorted(self.base_spec.notes, key=lambda n: n.on)
        end = self.orig.dur
        cands: list[Injected] = []
        for i, n in enumerate(notes):
            prev = notes[i - 1] if i else None
            nxt = notes[i + 1] if i + 1 < len(notes) else None
            name = fam.name
            if name.startswith('pitch') and n.dur >= 0.12:
                st = int(name[5:])
                cands.append(Injected(name, n.id, n.on, n.off, [{'op': 'set', 'id': n.id, 'midi': n.midi + st}], {'midi': n.midi}))
            elif name == 'delete' and n.dur >= 0.1:
                cands.append(Injected(name, n.id, n.on, n.off, [{'op': 'delete', 'id': n.id}], {'midi': n.midi, 'on': n.on, 'off': n.off}))
            elif name.startswith('merge') and nxt is not None and nxt.on - n.off < 0.1 and min(n.dur, nxt.dur) >= 0.08:
                short = min(n.dur, nxt.dur) < SCOOP
                if (n.midi != nxt.midi) == name.startswith('merge-diff') and short == (name == 'merge-diff-short'):
                    cands.append(Injected(name, n.id, nxt.on, nxt.on, [{'op': 'merge', 'ids': [n.id, nxt.id]}], {'at': nxt.on, 'midi': [n.midi, nxt.midi]}))
            elif name == 'split' and n.dur >= 0.3:
                at = round(n.on + n.dur * random.Random(f'{self.seed}/{n.id}').uniform(0.4, 0.6), 3)
                cands.append(Injected(name, '?', at, at, [{'op': 'split', 'id': n.id, 'at': at}], {'id': n.id}))
            elif name.startswith('onset'):
                dt = int(name[5:]) / 1000
                room = n.on - (prev.on + 0.1) if prev is not None else n.on
                if n.dur >= 0.25 and (dt > 0 or room >= -dt):
                    cands.append(Injected(name, n.id, min(n.on, n.on + dt), max(n.on, n.on + dt), [{'op': 'set', 'id': n.id, 'on': round(n.on + dt, 3)}],
                                          {'on': n.on}))
            elif name == 'offset+150' and n.dur >= 0.1 and (nxt.on if nxt is not None else end) - n.off >= 0.35:
                cands.append(Injected(name, n.id, n.off, n.off + 0.15, [{'op': 'set', 'id': n.id, 'off': round(n.off + 0.15, 3)}], {'off': n.off}))
        # a target's whole neighbourhood must be clean in the baseline (merges: both notes)
        span = {n.id: (n.on, n.off) for n in notes}
        ok = []
        for c in cands:
            ids = c.ops[0].get('ids') or [c.ops[0]['id']]
            lo, hi = min(span[x][0] for x in ids), max(span[x][1] for x in ids)
            if self._clean(base_diffs, lo, hi):
                ok.append((lo, hi, c))
        random.Random(f'{self.seed}/{self.ref}/{fam.name}').shuffle(ok)
        chosen: list[tuple[float, float, Injected]] = []
        for lo, hi, c in ok:
            if len(chosen) >= self.per_family:
                break
            if all(hi + SPACING <= a or lo >= b + SPACING for a, b, _ in chosen):
                chosen.append((lo, hi, c))
        return [c for _, _, c in sorted(chosen, key=lambda x: x[0])]

    # ------------------------------------------------------------ scoring
    @staticmethod
    def _new(diffs: list[dict], base: list[dict]) -> list[dict]:
        """Diffs the perturbation caused: not the same type at the same place in the baseline."""
        def seen(d):
            return any(b['type'] == d['type'] and abs(b['t0'] - d['t0']) <= 0.03 and abs(b['t1'] - d['t1']) <= 0.03 for b in base)
        return [d for d in diffs if d['type'] != 'uncertain-region' and not seen(d)]

    def score(self, inj: Injected, new: list[dict], sp: Spec, copy: Analysis) -> None:
        fam = BY_NAME[inj.family]
        near = [d for d in new if _overlaps(d, inj.t0, inj.t1)]
        if inj.family.startswith(('pitch', 'onset', 'offset')):
            # a note-level error: the diff must be about that note (or, onsets: its uncovered start)
            near = [d for d in near if d.get('note') == inj.note or (d['type'] == 'missing-sound' and inj.family.startswith('onset'))]
        if inj.family.startswith('pitch'):
            near = [d for d in near if d['type'] != 'pitch' or d.get('op')]  # not the render-mismatch line
            inj.copy_dev_cents = self._copy_dev(sp.by_id(inj.note), copy)
        good = [d for d in near if d['type'] in fam.sensible]
        pick = good or near
        if not pick:
            return
        inj.outcome = 'detected' if good else 'other'
        inj.diff = {k: pick[0].get(k) for k in ('id', 'type', 'note', 't0', 't1', 'text', 'hint', 'op')}
        inj.fixes = self._fixes(inj, pick[0])

    def _copy_dev(self, n, copy: Analysis) -> float | None:
        o = self.orig
        sl = o.span(n.on + 0.2 * n.dur, n.off - 0.2 * n.dur)
        m = (o.conf[sl] == 2) & (copy.conf[sl] >= 1) if sl.stop <= copy.n else np.zeros(0, bool)
        if not m.any():
            return None
        return round(float(np.median(copy.f0[sl][m] - o.f0[sl][m])) * 100, 1)

    @staticmethod
    def _fixes(inj: Injected, d: dict) -> bool | None:
        ops = d.get('op')
        if not ops:
            return None
        ops = ops if isinstance(ops, list) else [ops]
        tr = inj.truth
        f = inj.family
        if f.startswith('pitch'):
            return any(o.get('midi') == tr['midi'] for o in ops)
        if f == 'delete':
            return any(o['op'] == 'add' and o.get('midi') == tr['midi'] for o in ops)  # extending a neighbour loses the note
        if f.startswith('merge'):
            return any(o['op'] == 'split' and abs(o['at'] - tr['at']) <= 0.06 for o in ops)
        if f == 'split':
            return any(o['op'] == 'merge' for o in ops)
        if f.startswith('onset'):
            return any(o['op'] == 'set' and 'on' in o and abs(o['on'] - tr['on']) <= 0.04 for o in ops)
        if f.startswith('offset'):
            return any(o['op'] == 'set' and 'off' in o and abs(o['off'] - tr['off']) <= 0.08 for o in ops)
        return None

    # ------------------------------------------------------------ run
    def run(self, families: list[Family]) -> dict:
        t = time.time()
        base, _ = self.report(self.base_spec)
        bd = base['diffs']
        self.log(f'{self.ref}: {len(self.base_spec.notes)} truth notes, baseline {len(bd)} diffs '
                 f'({sum(d["type"] in NOTE_TYPES for d in bd)} note-level), pitch {base["metrics"]["pitch"]:.1%}, F1 {base["metrics"]["onsetF1"]:.2f}')
        fams = {}
        for fam in families:
            inj = self.plan(fam, bd)
            if not inj:
                fams[fam.name] = {'injected': 0, 'targets': []}
                continue
            sp = self.base_spec.copy()
            for x in inj:
                before = {n.id for n in sp.notes}
                try:
                    sp.apply(x.ops, self.orig)
                except SpecError as e:
                    x.outcome, x.diff = 'skipped', {'text': str(e)}
                    continue
                if x.family == 'split':
                    x.note = next(iter({n.id for n in sp.notes} - before))
            rep, copy = self.report(sp)
            new = self._new(rep['diffs'], bd)
            live = [x for x in inj if x.outcome != 'skipped']
            for x in live:
                self.score(x, new, sp, copy)
            claimed = {x.diff['id'] for x in live if x.diff}
            stray = [d for d in new if d['id'] not in claimed and not any(_overlaps(d, x.t0, x.t1, 0.3) for x in live)]
            det = sum(x.outcome == 'detected' for x in live)
            fams[fam.name] = {'injected': len(live), 'detected': det, 'other': sum(x.outcome == 'other' for x in live),
                              'missed': sum(x.outcome == 'missed' for x in live), 'fixes': sum(bool(x.fixes) for x in live if x.outcome == 'detected'),
                              'stray': len(stray), 'targets': [asdict(x) for x in inj]}
            self.log(f'  {fam.name:<11} {det}/{len(live)} detected' + (f', {fams[fam.name]["other"]} other type' if fams[fam.name]['other'] else '')
                     + (f', {fams[fam.name]["stray"]} stray new diffs' if stray else ''))
        counts: dict[str, int] = {}
        for d in bd:
            counts[d['type']] = counts.get(d['type'], 0) + 1
        return {'ref': self.ref, 'notes': len(self.base_spec.notes), 'durSec': round(self.orig.dur, 2), 'seconds': round(time.time() - t, 1),
                'baseline': {'metrics': base['metrics'], 'byType': counts, 'noteLevel': sum(v for k, v in counts.items() if k in NOTE_TYPES),
                             'diffs': [{k: d.get(k) for k in ('id', 'type', 'note', 't0', 't1', 'text')} for d in bd]},
                'families': fams}


@dataclass
class SelfTest:
    refs: list[str] = field(default_factory=lambda: list(DEFAULT_CLIPS))
    families: list[str] = field(default_factory=lambda: [f.name for f in FAMILIES])
    per_family: int = 6
    seed: int = 1

    def run(self, log=print) -> dict:
        clips = []
        for ref in self.refs:
            cfg, clip = parse_ref(ref)
            clips.append(ClipSelfTest(cfg, clip, self.seed, self.per_family, log).run([BY_NAME[f] for f in self.families]))
        summary = {}
        for f in self.families:
            rows = [c['families'][f] for c in clips if c['families'].get(f, {}).get('injected')]
            inj = sum(r['injected'] for r in rows)
            det = sum(r['detected'] for r in rows)
            summary[f] = {'injected': inj, 'detected': det, 'other': sum(r['other'] for r in rows), 'missed': sum(r['missed'] for r in rows),
                          'fixes': sum(r['fixes'] for r in rows), 'rate': round(det / inj, 3) if inj else None}
        fa = {}
        for c in clips:
            for k, v in c['baseline']['byType'].items():
                fa[k] = fa.get(k, 0) + v
        return {'schema': 'resynth-selftest/1', 'createdAt': now(), 'seed': self.seed, 'perFamily': self.per_family, 'summary': summary,
                'baselineDiffs': {'byType': fa, 'noteLevel': sum(v for k, v in fa.items() if k in NOTE_TYPES),
                                  'notes': sum(c['notes'] for c in clips)},
                'clips': clips}

    @staticmethod
    def table(res: dict) -> str:
        lines = [f'{"family":<12}{"injected":>9}{"detected":>9}{"rate":>7}{"other":>7}{"missed":>7}{"fixes":>7}']
        for f, s in res['summary'].items():
            rate = '-' if s['rate'] is None else f'{s["rate"]:.0%}'
            lines.append(f'{f:<12}{s["injected"]:>9}{s["detected"]:>9}{rate:>7}{s["other"]:>7}{s["missed"]:>7}{s["fixes"]:>7}')
        b = res['baselineDiffs']
        lines.append(f'baseline (clean human-truth spec): {b["noteLevel"]} note-level diffs over {b["notes"]} notes; by type: '
                     + ', '.join(f'{v} {k}' for k, v in sorted(b['byType'].items(), key=lambda kv: -kv[1])))
        return '\n'.join(lines)

    def save(self, res: dict) -> str:
        d = store.WORK / '_selftest'
        d.mkdir(parents=True, exist_ok=True)
        p = d / f'{time.strftime("%Y-%m-%dT%H-%M-%S")}.json'
        write_json(p, res)
        write_json(d / 'latest.json', res)
        return str(p)
