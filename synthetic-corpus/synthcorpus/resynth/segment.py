"""Blind note draft from the consensus f0: the starting point when a clip has no prior notes,
the filler for gaps, and the source of pitch-change events for the compare step.

Per voiced phrase (unvoiced gaps ≤ 30 ms bridged):
1. a smoothed contour (mean over ~one vibrato half-period for voices, a short median for
   whistling) is quantised to semitones with hysteresis: the note changes only when the
   contour leaves the current semitone by more than 0.5 + `hysteresis` st;
2. runs shorter than the minimum note are absorbed by the neighbour nearest in pitch; a
   short moving run is a scoop (→ next note), a fall (→ previous) or a glide (→ previous:
   a legato onset is where the new pitch ARRIVES), and alternating ±1 st runs shorter than
   200 ms are vibrato (voices only; whistled trills keep their notes);
3. each legato boundary moves to the arrival frame (first frame within ±50 c of the new
   note), and a held pitch is split where the energy dips and re-rises (re-articulation) or
   at a given anchor onset (jacrc's human syllable onsets).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.ndimage import median_filter, uniform_filter1d

from .analysis import HOP, Analysis


@dataclass(frozen=True)
class SegParams:
    min_note: float  # seconds
    smooth: float  # seconds of smoothing for the quantiser
    smooth_kind: str  # 'mean' | 'median'
    hysteresis: float  # semitones beyond the ±0.5 band before the note changes
    vibrato_merge: bool
    dip_db: float = 4.0  # energy dip that splits a held pitch
    bridge: float = 0.03  # unvoiced gap bridged inside a phrase
    unstable: bool = False  # absorb runs < 200 ms whose pitch never holds (voices)


PARAMS = {
    'whistle': SegParams(0.05, 0.05, 'median', 0.2, False),
    'voice': SegParams(0.06, 0.10, 'mean', 0.25, True, unstable=True),
    'instrument': SegParams(0.06, 0.07, 'median', 0.2, False, dip_db=5.0),
}


@dataclass
class Seg:
    s: int  # first frame
    e: int  # one past the last frame
    q: int  # semitone
    legato: bool = False  # joined to the previous segment (pitch change, no new attack)


class F0Segmenter:
    def __init__(self, a: Analysis, anchors: list[float] | tuple = (), params: SegParams | None = None):
        self.a = a
        self.p = params or PARAMS[a.family]
        self.anchors = sorted(anchors)
        self.minf = max(2, int(round(self.p.min_note / HOP)))
        self._segs: list[Seg] | None = None
        self._raw: np.ndarray | None = None

    # ------------------------------------------------------------ public
    def notes(self, t0: float = 0.0, t1: float = float('inf')) -> list[dict]:
        """Draft notes [{on, off, midi, cents, legato, flags}] whose onset lies in [t0, t1)."""
        out = []
        r = self.raw
        for g in self.segments():
            on, off = g.s * HOP, g.e * HOP
            if not (t0 <= on < t1):
                continue
            seg = r[g.s : g.e]
            k = len(seg)
            mid = seg[k // 5 : k - k // 5] if k * HOP > 0.15 else seg
            mid = mid[np.isfinite(mid)]
            med = float(np.median(mid)) if len(mid) else float(g.q)
            midi = int(round(med))
            flags = ['uncertain-pitch'] if abs(med - midi) >= 0.35 else []
            out.append({'on': round(on, 3), 'off': round(off, 3), 'midi': midi, 'cents': round(float(np.clip((med - midi) * 100, -50, 50)), 1),
                        'legato': g.legato, 'flags': flags})
        return out

    def pitch_events(self) -> list[tuple[float, int, int]]:
        """(arrival time, from semitone, to semitone) for every legato pitch change between two
        segments that both trackers agree on for at least 30 % of their frames (one tracker alone
        is not evidence)."""
        segs = self.segments()
        sure = lambda g: (self.a.conf[g.s : g.e] == 2).mean() >= 0.3  # noqa: E731
        return [(b.s * HOP, a.q, b.q) for a, b in zip(segs, segs[1:]) if b.legato and a.e == b.s and a.q != b.q and sure(a) and sure(b)]

    @property
    def raw(self) -> np.ndarray:
        if self._raw is None:
            f = np.where(self.a.conf >= 1, self.a.f0, np.nan)
            self._raw = median_filter(np.nan_to_num(f, nan=-1000.0), size=3, mode='nearest')
            self._raw[~np.isfinite(f)] = np.nan
            self._raw[self._raw < -500] = np.nan
        return self._raw

    def segments(self) -> list[Seg]:
        if self._segs is None:
            self._segs = []
            for s, e in self._phrases():
                self._segs.extend(self._phrase(s, e))
        return self._segs

    # ------------------------------------------------------------ phrases
    def _phrases(self) -> list[tuple[int, int]]:
        v = np.isfinite(self.raw)
        out: list[list[int]] = []
        bridge = int(round(self.p.bridge / HOP))
        i, n = 0, len(v)
        while i < n:
            if not v[i]:
                i += 1
                continue
            j = i
            while j < n and v[j]:
                j += 1
            if out and i - out[-1][1] <= bridge:
                out[-1][1] = j
            else:
                out.append([i, j])
            i = j
        return [(s, e) for s, e in out if e - s >= self.minf]

    def _phrase(self, s: int, e: int) -> list[Seg]:
        r = self.raw[s:e].copy()
        idx = np.arange(len(r))
        ok = np.isfinite(r)
        r[~ok] = np.interp(idx[~ok], idx[ok], r[ok])
        w = max(1, int(round(self.p.smooth / HOP)))
        sm = uniform_filter1d(r, w, mode='nearest') if self.p.smooth_kind == 'mean' else median_filter(r, size=w | 1, mode='nearest')
        # 1. hysteresis quantiser
        q = np.empty(len(r), int)
        cur = int(round(np.median(sm[: min(len(sm), 3)])))
        for i, v in enumerate(sm):
            if abs(v - cur) > 0.5 + self.p.hysteresis:
                cur = int(round(v))
            q[i] = cur
        segs: list[Seg] = []
        for i in range(len(q)):
            if segs and segs[-1].q == q[i]:
                segs[-1].e = i + 1
            else:
                segs.append(Seg(i, i + 1, int(q[i]), legato=bool(segs)))
        # 2. absorb short / moving runs
        segs = self._absorb(segs, r, sm)
        if self.p.vibrato_merge:
            segs = self._vibrato(segs, r)
        # 3. arrival-placed legato boundaries
        for a, b in zip(segs, segs[1:]):
            if a.q == b.q:
                continue
            lo = max(a.s + self.minf, b.s - 8)
            hi = min(b.e - self.minf, b.s + 8)
            for k in range(lo, hi + 1):
                if abs(r[k] - b.q) <= 0.5 and (k + 1 >= len(r) or abs(r[k + 1] - b.q) <= 0.5):
                    a.e = b.s = k
                    break
        segs = [Seg(g.s + s, g.e + s, g.q, g.legato) for g in segs]
        segs[0].legato = False
        return self._splits(segs)

    def _absorb(self, segs: list[Seg], r: np.ndarray, sm: np.ndarray) -> list[Seg]:
        glide, scoop, unstable = int(round(0.12 / HOP)), int(round(0.15 / HOP)), int(round(0.2 / HOP))
        changed = True
        while changed and len(segs) > 1:
            changed = False
            # shortest offender first: a run below the minimum, or a short run that is moving
            cands = []
            for i, g in enumerate(segs):
                L = g.e - g.s
                # moving: the raw pitch travels ≥ 50 c across a run shorter than 120 ms (150 ms for
                # the scoop that opens a phrase) — a transit, not a held pitch
                moving = L < (scoop if i == 0 else glide) and abs(r[g.e - 1] - r[g.s]) >= 0.5
                if self.p.unstable and not moving and L < unstable and len(segs) > 1:
                    # voices: a short run that never holds its pitch (range > 60 c) is a transit too
                    seg = r[g.s : g.e]
                    moving = float(seg.max() - seg.min()) > 0.6
                if L < self.minf or moving:
                    cands.append((L, i, moving))
            if not cands:
                break
            L, i, moving = min(cands)
            g = segs[i]
            prev = segs[i - 1] if i > 0 else None
            nxt = segs[i + 1] if i + 1 < len(segs) else None
            if moving and prev is None:
                into = nxt  # scoop into the first note
            elif moving and nxt is None:
                into = prev  # fall off the last note
            elif moving:
                into = prev  # glide: the transit belongs to the note it leaves
            else:
                mean = float(np.mean(r[g.s : g.e]))
                dp = abs(prev.q - mean) if prev else 99
                dn = abs(nxt.q - mean) if nxt else 99
                into = prev if dp < dn else nxt
            if into is None:
                break
            if into is prev:
                prev.e = g.e
            else:
                nxt.s = g.s
                nxt.legato = g.legato
            segs.pop(i)
            changed = True
            segs = self._join(segs)
        return segs

    @staticmethod
    def _join(segs: list[Seg]) -> list[Seg]:
        out: list[Seg] = []
        for g in segs:
            if out and out[-1].q == g.q and out[-1].e == g.s:
                out[-1].e = g.e
            else:
                out.append(g)
        return out

    def _vibrato(self, segs: list[Seg], r: np.ndarray) -> list[Seg]:
        """Runs alternating between two adjacent semitones, each < 200 ms, are one vibrato note."""
        short = int(round(0.2 / HOP))
        out: list[Seg] = []
        i = 0
        while i < len(segs):
            j = i
            while (j + 1 < len(segs) and abs(segs[j + 1].q - segs[j].q) == 1 and (j + 1 - i < 2 or segs[j + 1].q == segs[j - 1].q)
                   and (segs[j + 1].e - segs[j + 1].s) < short):
                j += 1
            if j - i >= 2:
                g = Seg(segs[i].s, segs[j].e, int(round(float(np.median(r[segs[i].s : segs[j].e])))), segs[i].legato)
                out.append(g)
            else:
                out.extend(segs[i : j + 1])
            i = j + 1
        return self._join(out)

    def _splits(self, segs: list[Seg]) -> list[Seg]:
        """Split held pitches at energy re-articulations and at anchor onsets."""
        cuts = [t for t, d in zip(self.a.onsets, self.a.onset_dip) if d >= self.p.dip_db] + list(self.anchors)
        if not cuts:
            return segs
        out = []
        for g in segs:
            parts = [g]
            for t in sorted(cuts):
                k = int(round(t / HOP))
                last = parts[-1]
                if not (last.s + self.minf <= k <= last.e - self.minf):
                    continue
                if any(abs(k - b) < 6 for b in (last.s, last.e)):
                    continue
                parts[-1] = Seg(last.s, k, last.q, last.legato)
                parts.append(Seg(k, last.e, last.q, False))
            out.extend(parts)
        # a re-articulation cut off the transit tail of a legato change (the frames the arrival
        # rule gave the previous note): that piece is the next note's attack scoop
        r = self.raw
        for i in range(len(out) - 2, -1, -1):
            g, nx = out[i], out[i + 1]
            if (not g.legato and nx.legato and nx.s == g.e and (g.e - g.s) * HOP < 0.15
                    and abs(np.nanmedian(r[g.s : g.e]) - g.q) >= 0.5 and i > 0 and out[i - 1].e == g.s):
                nx.s, nx.legato = g.s, False
                out.pop(i)
        return out
