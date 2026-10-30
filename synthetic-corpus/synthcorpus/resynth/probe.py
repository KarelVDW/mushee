"""Read-only deeper views for the agents: the numbers and close-ups behind the report.

  inspect  a frame table over a window: both trackers, level, onset envelope + events, the
           copy, and the note covering each row (≤ 120 rows; the hop coarsens beyond that)
  zoom     the three panel rows for one short window (≤ 4 s), finer time axis, event strengths
  note     one note's evidence: pitch (stable part, first / last 100 ms), voicing, the nearest
           evidence of every kind to its onset, events inside it, its end, its neighbours

They read the cached analyses (`orig.npz`, `synth.npz`), the spec and the latest report; nothing
is rendered and `inspect` / `note` write nothing (`zoom` writes `panels/zoom-<t0>-<t1>.png`),
except that a cache made stale by an analyzer change is refreshed once, as by any command (the
copy is re-analysed, not re-rendered). The copy shown is the latest render: when the spec has
moved on, the header says so.
"""

from __future__ import annotations

import math

import numpy as np

from .analysis import HOP, Analysis
from .evidence import SYL_STRONG, SYL_WEAK, Event
from .spec import pitch_name

TRACKER_ABBR = {'swiftf0': 'sw', 'pyin': 'py', 'sine': 'si'}


def note_cents(m: float | None, ref: int | None = None) -> str:
    """MIDI as a note name and a cents offset: 67.12 → 'G4+12'. Relative to `ref` (the covering
    note) when within a semitone of it, so a pitch near a semitone boundary does not flip between
    'E6+49' and 'F6-49' along one note; else to the nearest semitone."""
    if m is None or not np.isfinite(m):
        return '-'
    k = ref if ref is not None and abs(m - ref) <= 1.0 else int(round(m))
    return f'{pitch_name(k)}{(m - k) * 100:+03.0f}'


def _median(x: np.ndarray) -> float | None:
    x = x[np.isfinite(x)]
    return float(np.median(x)) if len(x) else None


class ClipProbe:
    MAX_ROWS = 120
    HOPS = (0.01, 0.02, 0.03, 0.04, 0.05, 0.1, 0.2)
    KEEP_ZOOMS = 4

    def __init__(self, session):
        self.s = session
        self.store = session.store
        self.state = self.store.state()  # SystemExit when the clip is not initialised
        self.spec = self.store.spec()
        self.notes = sorted(self.spec.notes, key=lambda n: n.on)
        self.orig: Analysis = session.orig()
        self.ev = session.evidence()
        self.copy, self.copy_note = self._copy()
        self._onset_support: dict | None = None

    def _copy(self) -> tuple[Analysis | None, str]:
        p = self.store.path('synth.npz')
        if not p.exists():
            return None, 'no copy yet (run iterate)'
        c = Analysis.load(p)
        if c.meta.get('analyzer') != self.s.analyzer.config():
            if self.state.get('renderedVersion') != self.spec.version or not self.store.path('synth.flac').exists():
                return None, 'copy analysis stale (run iterate)'
            c, _ = self.s.render()  # the spec has not moved on: re-analyse the existing copy (no re-render)
        v = c.meta.get('specVersion')
        return c, '' if v == self.spec.version else f'copy = spec v{v}, spec is v{self.spec.version} (run iterate)'

    def _support(self) -> dict:
        """The report's onset evidence per note (computed once; the copy is not needed for it)."""
        if self._onset_support is None:
            from .compare import Comparison

            self._onset_support = Comparison(self.spec, self.orig, self.copy, self.ev).onset_support()
        return self._onset_support

    def _report(self) -> dict | None:
        rep = self.store.report()
        return rep if rep and rep.get('specVersion') == self.spec.version else None

    def _window(self, t0: float, t1: float) -> tuple[float, float]:
        t1 = min(t1, self.orig.dur)
        t0 = max(0.0, t0)
        if not t1 > t0:
            raise SystemExit(f'{self.s.ref}: empty window {t0:.2f}–{t1:.2f} (clip is {self.orig.dur:.2f} s)')
        return t0, t1

    def note_at(self, t: float):
        for n in self.notes:
            if n.on <= t < n.off:
                return n
        return None

    def _events(self) -> list[tuple[float, str]]:
        """(time, compact label) of every piece of evidence plus note on/offs, time-sorted."""
        ev = self.ev
        out = [(e.t, f'E{e.t:.2f} r{e.rise:.0f} d{e.dip:.0f}') for e in ev.energy]
        out += [(e.t, f'P{e.t:.2f} {pitch_name(e.from_midi)}→{pitch_name(e.to_midi)}') for e in ev.pitch]
        out += [(e.t, f'A{e.t:.2f}') for e in ev.attacks]
        out += [(e.t, f'S{e.t:.2f} {e.strength:.2f}' + ('!' if e.strength >= SYL_STRONG else '' if e.strength >= SYL_WEAK else '?')) for e in ev.syllables]
        out += [(e.t, f'H{e.t:.2f}') for e in ev.anchors]
        for n in self.notes:
            out.append((n.on, f'[{n.id}' + (' L' if n.legato else '')))
            out.append((n.off, f'{n.id}]'))
        return sorted(out, key=lambda x: x[0])

    # ------------------------------------------------------------ inspect
    def inspect(self, t0: float, t1: float, hop: float = 0.02) -> str:
        o, c = self.orig, self.copy
        t0, t1 = self._window(t0, t1)
        hop = max(HOP, round(hop / HOP) * HOP)
        note = ''
        if (t1 - t0) / hop > self.MAX_ROWS:
            fit = [h for h in self.HOPS if (t1 - t0) / h <= self.MAX_ROWS]
            if not fit:
                raise SystemExit(f'{self.s.ref}: inspect window {t1 - t0:.1f} s is too long for a frame table '
                                 f'(≤ {self.MAX_ROWS * self.HOPS[-1]:.0f} s); narrow it, or use the panels / zoom')
            note = f' (coarsened from {hop:.2f}: ≤ {self.MAX_ROWS} rows)'
            hop = fit[0]
        na, nb = (TRACKER_ABBR.get(x, x[:2]) for x in o.trackers)
        win = [n for n in self.notes if n.off > t0 and n.on < t1]
        lines = [f'{self.s.ref}  {t0:.2f}–{t1:.2f} s  hop {hop:.2f}{note}  spec v{self.spec.version}  level ref {o.level_ref_db:.0f} dB'
                 + (f'  [{self.copy_note}]' if self.copy_note else ''),
                 'notes: ' + (' · '.join(f'{n.id} {n.on:.2f}–{n.off:.2f} {pitch_name(n.midi)}{n.cents:+.0f}' + (' L' if n.legato else '')
                                         + (' ?' + ','.join(f.replace('uncertain-', '') for f in n.flags) if n.flags else '') for n in win) or 'none'),
                 f'pitch = name+cents (vs the covering note) · ~ = trackers disagree or one is silent ({na}/{nb} shown) · dB = level · env = onset envelope · '
                 'E energy onset (r rise / d dip dB) · P pitch change · A attack · '
                 + (f'S syllable (timbre change) strength (! ≥ {SYL_STRONG}: evidence, ? < {SYL_WEAK}: faint) · ' if len(o.syl_nov) else '')
                 + ('H human onset · ' if self.ev.anchors else '') + '[n note on · n] off',
                 f'{"t":>6}  {"orig":<8} {"trackers":<18} {"dB":>4} {"env":>4}  {"copy":<7} {"dB":>4}  {"note":<9} events']
        evs = self._events()
        rows = int(math.ceil((t1 - t0) / hop - 1e-6))
        for i in range(rows):
            a, b = t0 + i * hop, min(t1, t0 + (i + 1) * hop)
            sl = o.span(a, b)
            if sl.stop <= sl.start:
                sl = slice(sl.start, sl.start + 1)
            conf = o.conf[sl]
            v = conf >= 1
            n = self.note_at((a + b) / 2)
            ref = n.midi if n else None
            f0 = _median(o.f0[sl][v]) if v.any() else None
            mark = '~' if v.any() and (conf[v] < 2).any() else ''
            trk = ''
            if v.any() and mark:
                fa, fb = _median(o.f0a[sl]), _median(o.f0b[sl])
                trk = f'{na} {note_cents(fa, ref)} {nb} {note_cents(fb, ref)}'
            db = max(-99.0, float(np.max(o.rms_db[sl]))) if len(o.rms_db[sl]) else -99.0
            env = float(np.max(o.flux[sl])) if len(o.flux[sl]) else 0.0
            ccell, cdb = '', ''
            if c is not None and sl.start < c.n:
                cs = slice(sl.start, min(sl.stop, c.n))
                cv = c.conf[cs] >= 1
                ccell = note_cents(_median(c.f0[cs][cv]), ref) if cv.any() else '-'
                cdb = f'{max(-99.0, float(np.max(c.rms_db[cs]))):4.0f}'
            ncell = f'{n.id} {pitch_name(n.midi)}' if n else ''
            here = [lab for t, lab in evs if a - 1e-6 <= t < b - 1e-6]
            if len(here) > 5:
                here = here[:5] + [f'+{len(here) - 5}']
            lines.append(f'{a:6.2f}  {(note_cents(f0, ref) + mark) if f0 is not None else "-":<8} {trk:<18} {db:4.0f} {env:4.2f}  {ccell:<7} {cdb:>4}  {ncell:<9} '
                         + ' '.join(here))
        return '\n'.join(line.rstrip() for line in lines)

    # ------------------------------------------------------------ note
    def note(self, ids: list[str]) -> str:
        out = []
        for nid in ids:
            out += self._note(self.spec.by_id(nid) if any(n.id == nid for n in self.notes) else _missing(self.s.ref, nid))
        return '\n'.join(out)

    def _note(self, n) -> list[str]:
        ev, o = self.ev, self.orig
        i = self.notes.index(n)
        prev = self.notes[i - 1] if i else None
        nxt = self.notes[i + 1] if i + 1 < len(self.notes) else None
        if ev.detached(n, prev):
            kind = 'attack from silence'
        elif prev.midi != n.midi:
            kind = f'legato change from {prev.id} {pitch_name(prev.midi)}' if n.legato else f'touching change from {prev.id} {pitch_name(prev.midi)}'
        else:
            kind = f'same-pitch repeat after {prev.id}'
        flags = ','.join(n.flags) or '-'
        lines = [f'{n.id}  {n.on:.3f}–{n.off:.3f} ({(n.off - n.on) * 1000:.0f} ms)  {pitch_name(n.midi)} ({n.midi}) {n.cents:+.0f} c  vel {n.vel}'
                 f'  {"legato" if n.legato else "articulated"}  flags {flags}']
        p = ev.note_pitch(n)

        def part(a: float, b: float) -> str:
            sl = o.span(a, b)
            return note_cents(_median(o.f0[sl][o.conf[sl] >= 1]))

        stable = (f'{note_cents(p.median)} = {p.median:.2f} (IQR {p.iqr * 100:.0f} c, {p.coverage:.0%} {"confident" if p.confident else "uncertain"})'
                  if p.median is not None else 'none')
        lines.append(f'  orig pitch: stable {stable} · first 100 ms {part(n.on, min(n.off, n.on + 0.1))} · last 100 ms {part(max(n.on, n.off - 0.1), n.off)}'
                     f' · voiced {ev.voiced_fraction(n):.0%}')
        # what counts is the report's rule (Comparison.onset_support): evidence the previous note's
        # onset already matched cannot start this note too (^)
        support = self._support()
        counts = {id(e) for e in support.get(n.id, [])}
        taken = {id(e) for e in ev.onset_candidates(n, prev)} - counts if n.id in support else set()
        near = ev.near(n.on)
        cells = []
        for k, e in near.items():
            if k == 'anchor' and not ev.anchors or k == 'syllable' and not ev.syllables:
                continue
            mark = '' if e is None else '*' if id(e) in counts else '^' if id(e) in taken else ''
            cells.append(f'{Event.LABELS.get(k, k)} ' + ('–' if e is None else f'{e.t:.2f} ({(e.t - n.on) * 1000:+.0f} ms{_strength(e)})' + mark))
        if n.id not in support:
            legend = 'an extra sound (orig hardly voiced): no onset evidence counts'
        else:
            legend = '* = counts as evidence for this onset' + (f', ^ = would, but it is {prev.id}\'s onset' if taken and prev is not None else '')
        lines.append(f'  onset ({kind}): ' + ' · '.join(cells) + f'   ({legend})')
        inside = [e for e in ev.energy if n.on + 0.03 < e.t < n.off - 0.03]
        inside += [e for e in ev.pitch if n.on + 0.03 < e.t < n.off - 0.03]
        inside += [e for e in ev.attacks if n.on + 0.03 < e.t < n.off - 0.03]
        inside += [e for e in ev.syllables if n.on + 0.03 < e.t < n.off - 0.03]
        inside += [e for e in ev.anchors if n.on + 0.03 < e.t < n.off - 0.03]
        inside.sort(key=lambda e: e.t)
        cells = [f'{e.label} {e.t:.2f}{_strength(e, True)}' for e in inside[:8]] + ([f'+{len(inside) - 8} more'] if len(inside) > 8 else [])
        lines.append('  inside: ' + (' · '.join(cells) if cells else 'nothing'))
        if nxt is None or nxt.on - n.off >= 0.1:
            end = ev.sound_end(n, nxt)
            lines.append(f'  end: orig sound ends {end:.2f} ({(end - n.off) * 1000:+.0f} ms)' if end is not None else '  end: orig silent at the end')
        nb = []
        for lab, m in (('prev', prev), ('next', nxt)):
            if m is None:
                nb.append(f'{lab} -')
                continue
            gap = (n.on - m.off) if lab == 'prev' else (m.on - n.off)
            nb.append(f'{lab} {m.id} {m.on:.2f}–{m.off:.2f} {pitch_name(m.midi)}' + (' L' if m.legato else '') + (f' (gap {gap * 1000:.0f} ms)' if gap > 0.0005 else ' (touching)'))
        lines.append('  ' + ' · '.join(nb))
        rep = self._report()
        if rep is not None:
            ds = [d for d in rep['diffs'] if d.get('note') == n.id]
            for d in ds[:4]:
                lines.append(f'  {d["id"]} {d["type"]}: {d["text"]}' + (f'  → {d["hint"]}' if d.get('hint') else ''))
            if len(ds) > 4:
                lines.append(f'  +{len(ds) - 4} more diffs')
        elif self.store.report():
            lines.append('  (report is for an older spec version: run iterate for this note\'s diffs)')
        return lines

    # ------------------------------------------------------------ zoom
    def zoom(self, t0: float, t1: float) -> str:
        from .analysis import SR_A, load_audio, resample
        from .compare import Panels

        import soundfile as sf

        t0, t1 = self._window(t0, t1)
        msg = ''
        if t1 - t0 > Panels.ZOOM_MAX:
            msg = f' (clamped from {t1:.2f}: zoom is ≤ {Panels.ZOOM_MAX:.0f} s)'
            t1 = t0 + Panels.ZOOM_MAX
        if self.copy is None:
            raise SystemExit(f'{self.s.ref}: {self.copy_note}')
        y, sr = load_audio(self.s.cfg.audio_path(self.s.clip))
        yc, csr = sf.read(str(self.store.path('synth.flac')), dtype='float32')
        rep = self._report()
        panels = Panels(self.spec, self.orig, self.copy, resample(y, sr, SR_A), resample(yc, csr, SR_A), rep['diffs'] if rep else [],
                        self.s.cfg.f0_range_for(self.s.clip), self.ev.seg.anchors)
        d = self.store.panels
        d.mkdir(parents=True, exist_ok=True)
        path = d / f'zoom-{t0:.2f}-{t1:.2f}.png'
        panels.zoom(path, t0, t1)
        for old in sorted(d.glob('zoom-*.png'), key=lambda q: q.stat().st_mtime, reverse=True)[self.KEEP_ZOOMS :]:
            old.unlink()
        return f'{path}  ({t0:.2f}–{t1:.2f} s{msg}' + (f'; {self.copy_note}' if self.copy_note else '') + ('' if rep else '; no diff markers: the report is stale') + ')'


def _strength(e: Event, inside: bool = False) -> str:
    if e.kind == 'energy':
        return f', rise {e.rise:.0f} dip {e.dip:.0f} dB' if not inside else f' (rise {e.rise:.0f}, dip {e.dip:.0f} dB)'
    if e.kind == 'pitch':
        return f', {pitch_name(e.from_midi)}→{pitch_name(e.to_midi)}' if not inside else f' ({pitch_name(e.from_midi)}→{pitch_name(e.to_midi)})'
    if e.kind == 'syllable':
        tag = ' strong' if e.strength >= SYL_STRONG else ' weak' if e.strength >= SYL_WEAK else ' faint'
        return f', strength {e.strength:.2f}{tag}' if not inside else f' ({e.strength:.2f}{tag})'
    return ''


def _missing(ref: str, nid: str):
    raise SystemExit(f'{ref}: no note {nid!r} in the current spec')
