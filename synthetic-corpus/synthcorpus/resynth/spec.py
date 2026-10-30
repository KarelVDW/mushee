"""The note spec: the generator's working object, and the only source of the exported truth.

Ids are stable: a new note gets `n<nextId>` and an id is never reused, so feedback can say
`n12` across versions. Every edit is a list of ops applied atomically (all or nothing),
followed by legato normalisation (a legato note's predecessor ends at its onset; an overlap
is trimmed the same way) and a refresh of the auto-set fields (`cents`, `vel`) of every note
whose timing or pitch changed.

Ops (JSON objects, `edit --ops '[...]'`):
  {"op":"set","id":"n12","midi":88}                 any of on/off/midi/cents/vel/legato/flags
  {"op":"add","on":3.42,"off":3.61,"midi":88}       optional cents/vel/legato/flags
  {"op":"delete","id":"n12"}                        or "ids":[...]
  {"op":"split","id":"n15","at":7.21}               optional "midi" for the second part;
                                                    the second part is legato iff its pitch differs
  {"op":"merge","ids":["n30","n31"]}                adjacent notes → the first id; optional "midi"
  {"op":"shift","ids":["n3","n4"],"dt":0.02}        or "ids":"all"; moves on and off
  {"op":"transpose","ids":"all","semitones":12}
  {"op":"flag","id":"n3","add":["uncertain-pitch"],"remove":[]}
"""

from __future__ import annotations

import copy
import json
from dataclasses import asdict, dataclass, field
from pathlib import Path

import numpy as np

from .analysis import Analysis

SCHEMA = 'resynth-spec/1'
FLAGS = ('uncertain-pitch', 'uncertain-onset', 'uncertain-split', 'uncertain-exists')
MIN_DUR = 0.02  # shortest note the spec accepts (s)
NAMES = ('C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B')


def pitch_name(midi: float) -> str:
    m = int(round(midi))
    return f'{NAMES[m % 12]}{m // 12 - 1}'


class SpecError(ValueError):
    pass


@dataclass
class Note:
    id: str
    on: float
    off: float
    midi: int
    cents: float = 0.0  # intonation offset, auto-set from the original (0 when it is > 50 c off: see refresh)
    vel: int = 100  # level: 100 = the clip's reference level, 2 vel = 1 dB
    legato: bool = False  # joined to the previous note (no new attack)
    flags: list[str] = field(default_factory=list)

    @property
    def dur(self) -> float:
        return self.off - self.on

    def to_json(self) -> dict:
        d = asdict(self)
        d['on'], d['off'] = round(self.on, 4), round(self.off, 4)
        d['cents'] = round(self.cents, 1)
        return d


@dataclass
class Spec:
    dataset: str
    clip: str
    timbre: dict
    render: dict
    notes: list[Note] = field(default_factory=list)
    version: int = 1
    next_id: int = 1
    prior: dict = field(default_factory=dict)

    # ------------------------------------------------------------ io
    def to_json(self) -> dict:
        return {'schema': SCHEMA, 'dataset': self.dataset, 'clip': self.clip, 'version': self.version, 'timbre': self.timbre, 'render': self.render,
                'nextId': self.next_id, 'prior': self.prior, 'notes': [n.to_json() for n in self.notes]}

    @classmethod
    def from_json(cls, d: dict) -> 'Spec':
        if d.get('schema') != SCHEMA:
            raise SpecError(f'not a {SCHEMA} document')
        notes = [Note(**{k: v for k, v in n.items() if k in Note.__dataclass_fields__}) for n in d['notes']]
        nxt = d.get('nextId') or 1 + max((int(n.id[1:]) for n in notes), default=0)
        return cls(d['dataset'], d['clip'], d['timbre'], d['render'], notes, d.get('version', 1), nxt, d.get('prior', {}))

    def save(self, path: Path) -> None:
        tmp = path.with_suffix('.tmp')
        tmp.write_text(json.dumps(self.to_json(), indent=1))
        tmp.replace(path)

    @classmethod
    def load(cls, path: Path) -> 'Spec':
        return cls.from_json(json.loads(path.read_text()))

    def copy(self) -> 'Spec':
        return copy.deepcopy(self)

    # ------------------------------------------------------------ notes
    def new_id(self) -> str:
        i = self.next_id
        self.next_id += 1
        return f'n{i}'

    def by_id(self, nid: str) -> Note:
        for n in self.notes:
            if n.id == nid:
                return n
        raise SpecError(f'no note {nid!r}')

    def add_note(self, on: float, off: float, midi: int, **kw) -> Note:
        n = Note(self.new_id(), float(on), float(off), int(midi), **kw)
        self.notes.append(n)
        return n

    def normalise(self) -> None:
        """Sort, then make the line monophonic: a legato note's predecessor ends at its onset,
        and an overlap is trimmed the same way. Raises on a note left too short."""
        self.notes.sort(key=lambda n: (n.on, n.off))
        for a, b in zip(self.notes, self.notes[1:]):
            if b.legato or a.off > b.on:
                a.off = b.on
        if self.notes:
            self.notes[0].legato = False
        bad = [n.id for n in self.notes if n.dur < MIN_DUR - 1e-9]
        if bad:
            raise SpecError(f'notes shorter than {MIN_DUR * 1000:.0f} ms after normalisation: {", ".join(bad)}')

    def truth_notes(self) -> list[dict]:
        """The exported truth: on → onsetSec, off − on → durSec, midi; sorted, rounded to 1 ms."""
        out = []
        prev_off = -1
        for n in sorted(self.notes, key=lambda n: n.on):
            on, off = int(round(n.on * 1000)), int(round(n.off * 1000))
            if off <= on:
                raise SpecError(f'{n.id}: non-positive duration')
            if on < prev_off:
                raise SpecError(f'{n.id}: overlaps the previous note (not monophonic)')
            prev_off = off
            out.append({'onsetSec': on / 1000, 'durSec': (off - on) / 1000, 'midi': int(n.midi)})
        return out

    # ------------------------------------------------------------ auto fields
    def refresh(self, a: Analysis | None, notes: list[Note] | None = None) -> None:
        """Set `cents` (the original's median offset from midi) and `vel` (its level).

        `cents` copies intonation only: when the original sits more than 50 c from `midi` (65 c
        for an uncertain-pitch note) the note is wrong or a judgement call, and the copy plays it
        as written (cents 0). Clamping instead would pull the copy half-way towards the original
        and hide a wrong midi (measured: a +1 st error sounded only ~45 c off)."""
        if a is None:
            return
        for n in notes if notes is not None else self.notes:
            sl = a.span(n.on, n.off)
            f = a.f0[sl][a.conf[sl] >= 1]
            k = len(f)
            mid = f[k // 5 : k - k // 5] if n.dur > 0.15 and k >= 5 else f
            if len(mid):
                dev = float(np.median(mid) - n.midi) * 100
                n.cents = dev if abs(dev) <= (65 if 'uncertain-pitch' in n.flags else 50) else 0.0
            lv = a.rms_db[sl][a.conf[sl] >= 1]
            if not len(lv):
                lv = a.rms_db[sl]
            if len(lv):
                db = 10 * np.log10(np.mean(10 ** (lv / 10)))
                n.vel = int(np.clip(round(100 + 2 * (db - a.level_ref_db)), 1, 127))

    # ------------------------------------------------------------ edit ops
    def apply(self, ops: list[dict], a: Analysis | None) -> list[str]:
        """Apply ops atomically; returns one line per change. Bumps the version."""
        work = self.copy()
        log: list[str] = []
        touched: set[str] = set()
        keep_cents: set[str] = set()
        for i, op in enumerate(ops):
            try:
                work._op(op, log, touched, keep_cents)
            except (KeyError, TypeError, ValueError) as e:
                raise SpecError(f'op {i + 1} {json.dumps(op)}: {e}') from None
        work.normalise()
        work.refresh(a, [n for n in work.notes if n.id in touched and n.id not in keep_cents])
        work.version += 1
        self.__dict__.update(work.__dict__)
        return log

    def _ids(self, op: dict) -> list[str]:
        ids = op.get('ids', [op['id']] if 'id' in op else None)
        if ids == 'all':
            return [n.id for n in self.notes]
        if not ids:
            raise SpecError('needs "id" or "ids"')
        for x in ids:
            self.by_id(x)
        return list(ids)

    def _op(self, op: dict, log: list[str], touched: set[str], keep_cents: set[str]) -> None:
        kind = op.get('op')
        if kind == 'set':
            n = self.by_id(op['id'])
            before = f'{n.on:.3f}–{n.off:.3f} {n.midi}'
            for k in ('on', 'off', 'cents'):
                if k in op:
                    setattr(n, k, float(op[k]))
            if 'midi' in op:
                n.midi = int(op['midi'])
            if 'vel' in op:
                n.vel = int(op['vel'])
            if 'legato' in op:
                n.legato = bool(op['legato'])
            if 'flags' in op:
                n.flags = self._flags(op['flags'])
            if any(k in op for k in ('on', 'off', 'midi')):
                touched.add(n.id)
            if 'cents' in op:
                keep_cents.add(n.id)
            log.append(f'set {n.id}: {before} → {n.on:.3f}–{n.off:.3f} {n.midi}' + (f' legato={n.legato}' if 'legato' in op else '')
                       + (f' flags={",".join(n.flags) or "-"}' if 'flags' in op else '') + (f' cents={n.cents:+.0f}' if 'cents' in op else '')
                       + (f' vel={n.vel}' if 'vel' in op else ''))
        elif kind == 'add':
            kw = {k: op[k] for k in ('cents', 'vel', 'legato') if k in op}
            n = self.add_note(float(op['on']), float(op['off']), int(op['midi']), flags=self._flags(op.get('flags', [])), **kw)
            touched.add(n.id)
            if 'cents' in op:
                keep_cents.add(n.id)
            log.append(f'add {n.id}: {n.on:.3f}–{n.off:.3f} {n.midi}')
        elif kind in ('delete', 'del'):
            for x in self._ids(op):
                gone = self.by_id(x)
                after = [n for n in self.notes if n.on >= gone.off - 1e-9 and n is not gone]
                nxt = min(after, key=lambda n: n.on) if after else None
                if nxt is not None and nxt.legato and nxt.on - gone.off < 0.015:
                    # a delete never moves other notes: without this, normalise would stretch the
                    # deleted note's predecessor over its span to keep the successor legato
                    nxt.legato = False
                self.notes.remove(gone)
                log.append(f'delete {x}')
        elif kind == 'split':
            n = self.by_id(op['id'])
            at = float(op['at'])
            if not (n.on + MIN_DUR <= at <= n.off - MIN_DUR):
                raise SpecError(f'split point {at} not inside {n.id} ({n.on:.3f}–{n.off:.3f})')
            midi2 = int(op.get('midi', n.midi))
            m = self.add_note(at, n.off, midi2, legato=bool(op.get('legato', midi2 != n.midi)), flags=list(n.flags))
            n.off = at
            touched.update((n.id, m.id))
            log.append(f'split {n.id} at {at:.3f} → {n.id} {n.midi} + {m.id} {m.midi}')
        elif kind == 'merge':
            ids = self._ids(op)
            if len(ids) < 2:
                raise SpecError('merge needs at least two ids')
            order = sorted(self.notes, key=lambda n: n.on)
            pos = sorted(order.index(self.by_id(x)) for x in ids)
            if pos != list(range(pos[0], pos[0] + len(pos))):
                raise SpecError('merge ids must be adjacent notes')
            group = order[pos[0] : pos[-1] + 1]
            first = group[0]
            longest = max(group, key=lambda n: n.dur)
            first.off = max(n.off for n in group)
            first.midi = int(op.get('midi', longest.midi))
            first.flags = sorted({f for n in group for f in n.flags})
            for n in group[1:]:
                self.notes.remove(n)
            touched.add(first.id)
            log.append(f'merge {"+".join(n.id for n in group)} → {first.id} {first.on:.3f}–{first.off:.3f} {first.midi}')
        elif kind == 'shift':
            dt = float(op['dt'])
            for x in self._ids(op):
                n = self.by_id(x)
                n.on += dt
                n.off += dt
                touched.add(x)
            log.append(f'shift {len(self._ids(op))} notes by {dt * 1000:+.0f} ms')
        elif kind == 'transpose':
            st = int(op['semitones'])
            for x in self._ids(op):
                self.by_id(x).midi += st
                touched.add(x)
            log.append(f'transpose {len(self._ids(op))} notes by {st:+d}')
        elif kind == 'flag':
            for x in self._ids(op):
                n = self.by_id(x)
                n.flags = sorted((set(n.flags) | set(self._flags(op.get('add', [])))) - set(op.get('remove', [])))
                log.append(f'flag {x}: {",".join(n.flags) or "-"}')
        else:
            raise SpecError(f'unknown op {kind!r}')
        for n in self.notes:
            if n.on < 0:
                raise SpecError(f'{n.id} starts before 0')

    @staticmethod
    def _flags(flags) -> list[str]:
        bad = [f for f in flags if f not in FLAGS]
        if bad:
            raise SpecError(f'unknown flags {bad}; known: {", ".join(FLAGS)}')
        return sorted(set(flags))

    # ------------------------------------------------------------ summary
    def lines(self, per_line: int = 4, t0: float = 0.0, t1: float = float('inf')) -> list[str]:
        """Compact note listing: `n12 5.10-5.55 E6+16 L` (L = legato, ? = flagged)."""
        cells = []
        for n in sorted(self.notes, key=lambda n: n.on):
            if not (t0 <= n.on < t1):
                continue
            c = f'{n.id} {n.on:.2f}-{n.off:.2f} {pitch_name(n.midi)}{n.cents:+.0f}'
            if n.legato:
                c += ' L'
            if n.flags:
                c += ' ?' + ','.join(f.replace('uncertain-', '') for f in n.flags)
            cells.append(c)
        w = max((len(c) for c in cells), default=0) + 2
        return [''.join(c.ljust(w) for c in cells[i : i + per_line]).rstrip() for i in range(0, len(cells), per_line)]


def spec_from_notes(dataset: str, clip: str, timbre: dict, seed: int, notes: list[dict], prior: dict) -> Spec:
    """A fresh spec (version 1) from draft notes ({on, off, midi, legato, …}) or from a prior
    truth ({onsetSec, durSec, midi}), where touching notes of different pitch become legato."""
    sp = Spec(dataset, clip, timbre, {'seed': seed, 'contour': 'copy-detrended', 'levelMatch': True}, prior=prior)
    truth = bool(notes) and 'onsetSec' in notes[0]
    for d in sorted(notes, key=lambda d: d['onsetSec'] if truth else d['on']):
        if truth:
            on, off = float(d['onsetSec']), float(d['onsetSec']) + float(d['durSec'])
            kw = {}
        else:
            on, off = float(d['on']), float(d['off'])
            kw = {k: d[k] for k in ('cents', 'legato', 'flags') if k in d}
        if off - on >= MIN_DUR:
            sp.add_note(round(on, 4), round(off, 4), int(d['midi']), **kw)
    if truth:
        for a, b in zip(sp.notes, sp.notes[1:]):
            b.legato = b.on - a.off < 0.015 and a.midi != b.midi
    # a prior may overlap itself: trim, and drop what trimming leaves too short
    sp.notes.sort(key=lambda n: (n.on, n.off))
    for a, b in zip(sp.notes, sp.notes[1:]):
        if a.off > b.on:
            a.off = b.on
    sp.notes = [n for n in sp.notes if n.dur >= MIN_DUR]
    sp.normalise()
    return sp


class AutoFixer:
    """Conservative, evidence-led corrections; every change is reported with its reason.

    phantoms — delete a note the original is silent through (< 15 % of it voiced)
    pitch    — re-pitch a note whose original pitch is confident, steady and ≥ 60 c away
    gaps     — add notes (blind draft) over ≥ 100 ms of confident sound no note covers,
               or extend a touching note of the same pitch
    offsets  — move the end of a note followed by silence to where its sound ends (> 80 ms off)
    onsets   — move an onset 40–120 ms to the nearest evidence of its kind, when it is unique
    """

    KINDS = ('phantoms', 'pitch', 'gaps', 'offsets', 'onsets')

    def __init__(self, spec: Spec, ev):
        self.spec = spec
        self.ev = ev

    def plan(self, kinds=KINDS) -> list[tuple[dict, str]]:
        sp, ev = self.spec, self.ev
        notes = sorted(sp.notes, key=lambda n: n.on)
        ops: list[tuple[dict, str]] = []
        gone: set[str] = set()
        if 'phantoms' in kinds:
            for n in notes:
                vf = ev.voiced_fraction(n)
                if vf < 0.15:
                    ops.append(({'op': 'delete', 'id': n.id}, f'{n.id} {n.on:.2f}–{n.off:.2f}: original voiced over {vf:.0%} of it'))
                    gone.add(n.id)
        live = [n for n in notes if n.id not in gone]
        if 'pitch' in kinds:
            for n in live:
                p = ev.note_pitch(n)
                # not near a semitone boundary (±15 c): that call is the agents', with a flag
                if (p.median is not None and p.confident and p.coverage >= 0.5 and p.iqr <= 0.6 and abs(p.median - n.midi) >= 0.6
                        and abs((p.median % 1) - 0.5) >= 0.15):
                    ops.append(({'op': 'set', 'id': n.id, 'midi': int(round(p.median))},
                                f'{n.id} {n.on:.2f}: midi {n.midi} → {int(round(p.median))} (original {p.median:.1f}, {p.coverage:.0%} confident)'))
        if 'gaps' in kinds:
            for t0, t1, med in ev.uncovered(live, min_dur=0.1):
                touch = [n for n in live if abs(n.off - t0) <= 0.03 and not ev.rearticulated(t0) or abs(n.on - t1) <= 0.03 and not ev.rearticulated(t1)]
                same = [n for n in touch if abs(n.midi - med) <= 0.5]
                if same:
                    n = same[0]
                    op = {'op': 'set', 'id': n.id, 'off': round(t1, 3)} if abs(n.off - t0) <= 0.03 else {'op': 'set', 'id': n.id, 'on': round(t0, 3)}
                    ops.append((op, f'{n.id}: extend over uncovered sound {t0:.2f}–{t1:.2f} at {med:.1f}'))
                    continue
                for d in ev.seg.notes(t0 - 0.03, t1):
                    on, off = max(d['on'], t0 - 0.02), min(d['off'], t1 + 0.02)
                    if off - on < 0.05 or any(n.on < off - 0.02 and on + 0.02 < n.off for n in live):
                        continue
                    ops.append(({'op': 'add', 'on': round(on, 3), 'off': round(off, 3), 'midi': d['midi']},
                                f'add {on:.2f}–{off:.2f} {pitch_name(d["midi"])} (uncovered confident sound)'))
        if 'offsets' in kinds:
            for i, n in enumerate(live):
                nxt = live[i + 1] if i + 1 < len(live) else None
                if nxt is not None and nxt.on - n.off < 0.15:
                    continue
                end = ev.sound_end(n, nxt)
                if end is None or abs(end - n.off) <= 0.08 or end - n.on < 0.05:
                    continue
                if nxt is not None and end > nxt.on - 0.03:
                    continue
                ops.append(({'op': 'set', 'id': n.id, 'off': round(end, 3)}, f'{n.id}: off {n.off:.2f} → {end:.2f} (original sound ends)'))
        if 'onsets' in kinds:
            for i, n in enumerate(live):
                prev = live[i - 1] if i else None
                cands = ev.onset_candidates(n, prev)
                if not cands:
                    continue
                best = cands[0]
                dt = best.t - n.on
                rivals = [c for c in cands[1:] if abs(c.t - best.t) > 0.03 and abs(c.t - n.on) < abs(dt) + 0.04]
                if not (0.04 < abs(dt) <= 0.12) or rivals:
                    continue
                if best.t >= n.off - 0.03 or (prev is not None and best.t <= prev.on + 0.03):
                    continue
                if prev is not None and not n.legato and best.t < prev.off:
                    continue  # a detached note moving into its predecessor: a structural call, not a nudge
                ops.append(({'op': 'set', 'id': n.id, 'on': round(best.t, 3)}, f'{n.id}: on {n.on:.2f} → {best.t:.2f} ({best.kind} evidence, {dt * 1000:+.0f} ms)'))
        return ops

    def run(self, kinds=KINDS, a: Analysis | None = None) -> list[str]:
        """Apply the plan; an op that would break the spec is skipped and reported."""
        plan = self.plan(kinds)
        if not plan:
            return []
        try:
            self.spec.apply([op for op, _ in plan], a)
            return [why for _, why in plan]
        except SpecError:
            pass
        lines = []
        applied = []
        for op, why in plan:
            trial = self.spec.copy()
            try:
                trial.apply(applied + [op], a)
                applied.append(op)
                lines.append(why)
            except SpecError as e:
                lines.append(f'skipped ({e}): {why}')
        if applied:
            self.spec.apply(applied, a)
        return lines
