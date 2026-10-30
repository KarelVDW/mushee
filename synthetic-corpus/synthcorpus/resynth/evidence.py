"""What the ORIGINAL says about a note list: each note's pitch, the onset evidence near it,
re-articulations or pitch changes inside it, where its sound ends, and sound no note covers.

Shared by the compare report (which lists the disagreements) and autofix (which acts on the
unambiguous ones), so both read the evidence the same way.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .analysis import HOP, Analysis
from .segment import F0Segmenter

WINDOW = 0.15  # onset evidence is searched within ±150 ms of a note onset
DETACHED_GAP = 0.05  # a note starting this long after the previous one ended is an attack from silence
SCOOP = 0.12  # pitch movement this close to a note's start or end belongs to the note (scoop, fall)
# sung syllables (analysis.SyllableTracker; strength 1.0 = MFCC novelty 35). A STRONG event is
# evidence like a re-articulation: it supports a same-pitch onset within ±SYL_WINDOW (events sit
# a median 6 ms before annotated boundaries; a tight window keeps a chance event from supporting a
# wrong split), it ends a note's sound, and inside a held note it is a possible same-pitch split
# (the `syllable` diff). A WEAK one (1.0–1.25) is only named in an `unsupported` diff, so the
# agents look before merging; it supports nothing (a merge across it would go unflagged).
SYL_STRONG = 1.25
SYL_WEAK = 1.0
SYL_WINDOW = 0.05


@dataclass
class NotePitch:
    median: float | None  # the original's median pitch over the note's stable middle (MIDI)
    coverage: float  # fraction of the middle with a confident consensus
    iqr: float  # semitones
    confident: bool  # measured on confident frames (else on uncertain ones)


@dataclass
class Event:
    t: float
    # 'attack' (sound starts) | 'energy' (onset event) | 'pitch' (legato arrival) |
    # 'syllable' (timbre change, sung material) | 'anchor' (a human syllable onset, jacrc)
    kind: str
    rise: float = 0.0
    dip: float = 0.0
    to_midi: int | None = None
    from_midi: int | None = None
    strength: float = 0.0  # syllable events

    LABELS = {'anchor': 'human onset'}

    @property
    def label(self) -> str:
        return self.LABELS.get(self.kind, self.kind)


class Evidence:
    def __init__(self, a: Analysis, seg: F0Segmenter | None = None):
        self.a = a
        self.seg = seg or F0Segmenter(a)
        self.energy = [Event(float(t), 'energy', float(r), float(d)) for t, r, d in zip(a.onsets, a.onset_rise, a.onset_dip)]
        self.pitch = [Event(t, 'pitch', to_midi=b, from_midi=a0) for t, a0, b in self.seg.pitch_events()]
        self.attacks = [Event(float(t), 'attack') for t in a.voicing_starts(DETACHED_GAP)]
        # human-placed onsets (jacrc syllables) are evidence for any kind of onset
        self.anchors = [Event(float(t), 'anchor') for t in self.seg.anchors]
        # sung syllables (timbre change; empty for whistling, humming and instruments)
        self.syllables = [Event(float(t), 'syllable', strength=float(s)) for t, s in zip(a.syl, a.syl_strength)]

    # ------------------------------------------------------------ per note
    def note_pitch(self, n) -> NotePitch:
        a = self.a
        sl = a.span(n.on, n.off)
        k = sl.stop - sl.start
        if n.off - n.on > 0.15 and k >= 5:
            sl = slice(sl.start + k // 5, sl.stop - k // 5)
        conf, f = a.conf[sl], a.f0[sl]
        if not len(f):
            return NotePitch(None, 0.0, 0.0, False)
        for level, confident in ((2, True), (1, False)):
            v = f[conf >= level]
            if len(v) >= 2 and len(v) >= 0.3 * len(f):
                q75, q25 = np.percentile(v, [75, 25])
                return NotePitch(float(np.median(v)), len(v) / len(f), float(q75 - q25), confident)
        return NotePitch(None, float((conf >= 1).mean()), 0.0, False)

    def voiced_fraction(self, n) -> float:
        sl = self.a.span(n.on, n.off)
        v = self.a.conf[sl] >= 1
        return float(v.mean()) if len(v) else 0.0

    @staticmethod
    def detached(n, prev) -> bool:
        return prev is None or n.on - prev.off >= DETACHED_GAP

    def onset_candidates(self, n, prev) -> list[Event]:
        """Evidence that a note starts here, by the kind of onset the note makes.

        A strong sung syllable (timbre change within ±50 ms) is evidence for a same-pitch repeat,
        like a level dip; for any other onset it only stands in when nothing else is there, so it
        never moves the timing reference of a note that has an attack, energy or pitch onset."""
        syl = [e for e in self.syllables if e.strength >= SYL_STRONG and abs(e.t - n.on) <= SYL_WINDOW]
        if self.detached(n, prev):
            pool = self.attacks + [e for e in self.energy if e.rise >= 3] + self.pitch
        elif prev is not None and prev.midi != n.midi:
            pool = self.pitch + [e for e in self.energy if e.rise >= 2]
        else:  # a re-articulated repeat: the level dips (a swell without a dip is not an onset), or a new syllable starts
            pool = [e for e in self.energy if e.dip >= 2] + syl
            syl = []
        pool = pool + self.anchors
        near = lambda es: sorted((e for e in es if abs(e.t - n.on) <= WINDOW), key=lambda e: abs(e.t - n.on))  # noqa: E731
        return near(pool) or near(syl)

    def syllables_inside(self, n, explained: list[float] = ()) -> list[Event]:
        """Strong syllable events inside a note, away from its edges (60 ms) and from anything that
        already splits it there (`explained`: times of re-articulations / pitch changes, ±100 ms):
        a new sung syllable on the same pitch, i.e. a possible same-pitch split."""
        return [e for e in self.syllables if e.strength >= SYL_STRONG and n.on + 0.06 < e.t < n.off - 0.06
                and not any(abs(e.t - t) <= 0.1 for t in explained)]

    def weak_syllable(self, t: float, window: float = 0.06) -> Event | None:
        """The strongest WEAK syllable event (SYL_WEAK ≤ strength < SYL_STRONG) within ±window."""
        c = [e for e in self.syllables if SYL_WEAK <= e.strength < SYL_STRONG and abs(e.t - t) <= window]
        return max(c, key=lambda e: e.strength) if c else None

    def near(self, t: float, window: float = 0.3) -> dict[str, Event | None]:
        """The nearest event of each kind within ±window of t (for the `note` view)."""
        out = {}
        for kind, es in (('attack', self.attacks), ('energy', self.energy), ('pitch', self.pitch), ('syllable', self.syllables), ('anchor', self.anchors)):
            cand = [e for e in es if abs(e.t - t) <= window]
            out[kind] = min(cand, key=lambda e: abs(e.t - t)) if cand else None
        return out

    def inside(self, n, min_dip: float = 3.0) -> list[Event]:
        """Re-articulations and pitch changes of the original strictly inside the note.

        A pitch change within SCOOP of the note's start that ARRIVES at the note's pitch is its
        scoop (or, legato, its arrival: a timing question), and one within SCOOP of its end that
        LEAVES the note's pitch is its fall; neither is another note (truth convention 5)."""
        out = [e for e in self.energy if n.on + 0.06 < e.t < n.off - 0.05 and e.dip >= min_dip and e.rise >= 3]
        # sound that starts again after ≥ 50 ms of silence (with a real energy rise): an attack, so
        # another note; its dip reads 0 because the level before it is the silence itself
        out += [x for x in self.attacks if n.on + 0.06 < x.t < n.off - 0.05 and any(abs(e.t - x.t) <= 0.05 and e.rise >= 3 for e in self.energy)]
        out += [e for e in self.pitch if n.on + 0.05 < e.t < n.off - 0.05 and not (e.t - n.on < SCOOP and e.to_midi == n.midi)
                and not (n.off - e.t < SCOOP and e.from_midi == n.midi)]
        return sorted(out, key=lambda e: e.t)

    def median_midi(self, t0: float, t1: float, default: int) -> int:
        """The original's median pitch over [t0, t1), as a semitone (default where it is unvoiced)."""
        f = self.a.f0[self.a.span(t0, t1)][self.a.conf[self.a.span(t0, t1)] >= 1]
        return int(round(float(np.median(f)))) if len(f) else default

    def silence_before(self, t: float) -> float:
        """Where the silence that ends at t (a voicing start) began."""
        a = self.a
        k = a.frame(t) - 1
        while k > 0 and not a.voiced[k]:
            k -= 1
        return (k + 1) * HOP

    def rearticulated(self, t: float, tol: float = 0.05) -> bool:
        """A re-articulation (dip and rise ≥ 3 dB) or a strong sung syllable within ±tol of t: two
        notes meet here, not one."""
        return (any(abs(e.t - t) <= tol and e.rise >= 3 and e.dip >= 3 for e in self.energy)
                or any(abs(e.t - t) <= tol and e.strength >= SYL_STRONG for e in self.syllables))

    def sound_end(self, n, nxt) -> float | None:
        """Where the original's sound around the note's end stops (before the next note).

        The note's sound also stops where the original moves on to a held different pitch or
        re-articulates: that sound is another note (missing-sound), not this note's tail."""
        a = self.a
        v = a.conf >= 1
        limit = a.frame(nxt.on - 0.03) if nxt is not None else min(a.n - 1, a.frame(n.off + 1.0))
        p = self.note_pitch(n).median
        ref = p if p is not None else n.midi + n.cents / 100
        raw = self.seg.raw
        for g in self.seg.segments():
            if g.s >= a.frame(n.off - 0.05) and (g.e - g.s) * HOP >= 0.08 and g.q != round(ref) and abs(np.nanmedian(raw[g.s : g.e]) - ref) >= 0.5:
                limit = min(limit, g.s - 1)
                break
        for e in self.energy:
            if e.t > n.off - 0.02 and e.rise >= 3 and e.dip >= 3:
                limit = min(limit, a.frame(e.t) - 1)
                break
        for e in self.syllables:  # a new sung syllable is another note too
            if e.t > n.off - 0.02 and e.strength >= SYL_STRONG:
                limit = min(limit, a.frame(e.t) - 1)
                break
        k = a.frame(n.off - HOP)
        if k >= a.n:
            return None
        if v[k]:
            gap = 0
            while k + 1 <= limit and gap <= 3:
                k += 1
                gap = 0 if v[k] else gap + 1
            k -= gap
            return (k + 1) * HOP
        lo = a.frame(n.on)
        while k > lo and not v[k]:
            k -= 1
        return (k + 1) * HOP if v[k] else None

    # ------------------------------------------------------------ whole clip
    def uncovered(self, notes, min_dur: float = 0.06, level: int = 2) -> list[tuple[float, float, float]]:
        """(t0, t1, median MIDI) of the original's sound that no note covers (±20 ms slack)."""
        a = self.a
        m = a.conf >= level
        for n in notes:
            m[a.span(n.on - 0.02, n.off + 0.02)] = False
        return [(s * HOP, e * HOP, float(np.nanmedian(a.f0[s:e]))) for s, e in _runs(m, 3) if (e - s) * HOP >= min_dur]

    def uncertain(self, notes, min_dur: float = 0.15) -> list[tuple[float, float, str]]:
        """(t0, t1, description) where the trackers disagree or only one of them hears pitch."""
        a = self.a
        out = []
        for s, e in _runs(a.conf == 1, 2):
            if (e - s) * HOP < min_dur:
                continue
            fa, fb = a.f0a[s:e], a.f0b[s:e]
            ha, hb = np.isfinite(fa), np.isfinite(fb)
            na, nb = a.trackers
            if (ha & hb).sum() >= 0.5 * (e - s):
                what = f'trackers disagree: {na} {_name(np.nanmedian(fa))} / {nb} {_name(np.nanmedian(fb))}'
            elif ha.sum() >= hb.sum():
                what = f'only {na} hears pitch ({_name(np.nanmedian(fa))})'
            else:
                what = f'only {nb} hears pitch ({_name(np.nanmedian(fb))})'
            out.append((s * HOP, e * HOP, what))
        return out


def _name(m: float) -> str:
    from .spec import pitch_name

    return f'{pitch_name(m)} {m:.1f}'


def _runs(mask: np.ndarray, bridge: int) -> list[tuple[int, int]]:
    """[start, end) runs of True, bridging False gaps of up to `bridge` frames."""
    out: list[list[int]] = []
    idx = np.nonzero(mask)[0]
    for i in idx:
        if out and i - out[-1][1] <= bridge:
            out[-1][1] = i + 1
        else:
            out.append([i, i + 1])
    return [(s, e) for s, e in out]
