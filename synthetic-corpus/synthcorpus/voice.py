"""Singing voice from real singers: VocalSet unit analysis + TD-PSOLA resynthesis.

Every waveform grain in the output was sung by a real person (VocalSet,
CC-BY-4.0, 20 professional singers). What we design is only the *performance*:

1. Analysis (`VoiceBank`) — each VocalSet recording (scales, arpeggios, long
   tones on the five vowels, per technique) is pitch-tracked; stable pitch
   plateaus become note units, each with pitch marks (one per glottal period)
   so its grains can be re-placed. Per singer we also measure tessitura (→ voice
   type), vibrato rate/extent per technique, and cut real breath noises from the
   silence before phrases.
2. Performance (`SingerModel`) — a designed f0 contour per phrase: note pitches
   with the singer's intonation error, legato transitions shaped like measured
   human ones (Saitou-style preparation dip and overshoot, ~60–150 ms), vibrato
   with delayed onset and rate/extent jitter taken from that singer's own
   vibrato, slow drift and fine jitter; soft vocal onsets with a scoop from
   below, releases with a slight fall, re-articulated repeated notes, breaths.
3. Synthesis (`PsolaSinger`) — TD-PSOLA: output pitch marks follow the
   designed contour; each output period is a Hann-windowed two-period grain
   taken from the note's unit (formants preserved; shifts kept within a few
   semitones by unit selection); legato joins morph grain-by-grain between
   the two notes' units.

The note truth is the designed contour's notes, exactly.
"""

from __future__ import annotations

import json
import math
import random
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.ndimage import median_filter, uniform_filter1d
from scipy.signal import butter, resample_poly, sosfiltfilt

from .performance import Performance, PerformedNote

ROOT = Path(__file__).resolve().parent.parent
VOCALSET = ROOT / 'assets' / 'vocalset'
CACHE = ROOT / 'work' / 'voicebank'
SR = 44100

VOWELS = ('a', 'e', 'i', 'o', 'u')


@dataclass
class Unit:
    singer: str
    tech: str
    vowel: str
    file: str
    midi: float  # median pitch of the plateau (fractional)
    start: int  # samples
    end: int
    rms: float
    kind: str = 'note'  # 'note' | 'onset' | 'breath'
    vib_rate: float = 0.0
    vib_extent: float = 0.0  # cents, peak


@dataclass
class SingerInfo:
    singer: str
    low: float
    high: float
    median: float
    voice_type: str = ''
    vib: dict = field(default_factory=dict)  # tech -> (rate, extent)


class VoiceBank:
    """Analysed VocalSet: note units, onsets and breaths per singer (cached as JSON)."""

    TECHS = ('straight', 'vibrato', 'slow_piano', 'slow_forte', 'fast_piano', 'fast_forte', 'breathy', 'belt', 'forte', 'pp', 'messa')

    def __init__(self, root: Path = VOCALSET):
        self.root = root
        self.units: list[Unit] = []
        self.singers: dict[str, SingerInfo] = {}
        self._audio: dict[str, np.ndarray] = {}

    # ------------------------------------------------------------ io
    def audio(self, rel: str) -> np.ndarray:
        if rel not in self._audio:
            x, sr = sf.read(self.root / rel, dtype='float32', always_2d=True)
            x = x.mean(axis=1)
            if sr != SR:
                x = resample_poly(x, SR, sr).astype(np.float32)
            self._audio[rel] = x
        return self._audio[rel]

    def files(self) -> list[Path]:
        out = []
        for p in sorted(self.root.rglob('*.wav')):
            rel = p.relative_to(self.root).parts
            if rel[0].startswith('__') or len(rel) < 4:
                continue
            if rel[1] == 'excerpts':
                continue
            out.append(p)
        return out

    # ------------------------------------------------------------ analysis
    @staticmethod
    def _parse(p: Path) -> tuple[str, str, str, str]:
        parts = p.relative_to(VOCALSET).parts
        singer, exercise, tech = parts[0], parts[1], parts[2]
        tech = 'vibrato' if tech == 'vibrado' else tech
        m = re.search(r'_([aeiou])\.wav$', p.name)
        vowel = m.group(1) if m else 'a'
        return singer, exercise, tech, vowel

    def analyse(self, log=print) -> None:
        CACHE.mkdir(parents=True, exist_ok=True)
        cf = CACHE / 'units.json'
        if cf.exists():
            d = json.loads(cf.read_text())
            self.units = [Unit(**u) for u in d['units']]
            self.singers = {k: SingerInfo(**v) for k, v in d['singers'].items()}
            return
        from .qa import f0_track

        for i, p in enumerate(self.files()):
            singer, exercise, tech, vowel = self._parse(p)
            rel = str(p.relative_to(self.root))
            x = self.audio(rel)
            ts, hz, cf_ = f0_track(x, SR, fmin=60, fmax=1400)
            self.units.extend(self._units_from_track(singer, tech, vowel, rel, x, ts, hz, cf_))
            self._audio.pop(rel, None)
            if i % 100 == 0:
                log(f'analysed {i} files, {len(self.units)} units')
        self._singer_stats()
        cf.write_text(json.dumps({'units': [asdict(u) for u in self.units], 'singers': {k: asdict(v) for k, v in self.singers.items()}}))

    def _units_from_track(self, singer, tech, vowel, rel, x, ts, hz, cf_) -> list[Unit]:
        hop = ts[1] - ts[0] if len(ts) > 1 else 0.016
        v = cf_ > 0.7
        midi = np.full(len(hz), np.nan)
        midi[v] = 69 + 12 * np.log2(np.maximum(hz[v], 1) / 440)
        # smooth over ~ one vibrato cycle to find note centres
        filled = midi.copy()
        idx = np.arange(len(midi))
        if v.sum() < 5:
            return []
        filled[~v] = np.interp(idx[~v], idx[v], midi[v])
        smooth = uniform_filter1d(filled, size=max(3, int(0.2 / hop)))
        q = np.round(smooth)
        units: list[Unit] = []
        i = 0
        n = len(q)
        while i < n:
            if not v[i]:
                i += 1
                continue
            j = i
            while j + 1 < n and v[j + 1] and q[j + 1] == q[i] and abs(smooth[j + 1] - q[i]) < 0.6:
                j += 1
            dur = (j - i + 1) * hop
            if dur >= 0.18:
                s0, s1 = int(ts[i] * SR), int(ts[j] * SR)
                seg = x[s0:s1]
                rms = float(np.sqrt(np.mean(seg**2)) + 1e-9)
                raw = midi[i : j + 1]
                raw = raw[np.isfinite(raw)]
                u = Unit(singer, tech, vowel, rel, float(np.median(raw)), s0, s1, rms)
                # vibrato: oscillation of the raw contour around its smoothed mean
                dev = (filled[i : j + 1] - smooth[i : j + 1]) * 100
                if len(dev) > int(0.5 / hop):
                    sp = np.abs(np.fft.rfft(dev - dev.mean(), 512))
                    fr = np.fft.rfftfreq(512, hop)
                    band = (fr > 3.5) & (fr < 8.5)
                    if band.any():
                        k = np.argmax(sp * band)
                        u.vib_rate = float(fr[k])
                        u.vib_extent = float(np.percentile(np.abs(dev), 90))
                units.append(u)
                # onset unit: voiced start of the file / after a silence
                if not units[:-1] or all(uu.file != rel for uu in units[:-1]):
                    pre = int(max(0, ts[i] - 0.05) * SR)
                    units.append(Unit(singer, tech, vowel, rel, u.midi, pre, min(s1, pre + int(0.35 * SR)), rms, kind='onset'))
            i = j + 1
        # breath: noise before the first voiced frame (inhale), if audible
        first = int(np.argmax(v)) if v.any() else 0
        t0 = ts[first]
        if t0 > 0.35:
            b0, b1 = int(max(0, t0 - 0.9) * SR), int((t0 - 0.06) * SR)
            seg = x[b0:b1]
            if len(seg) > 0.2 * SR:
                e = np.sqrt(np.mean(seg**2))
                floor = np.sqrt(np.mean(x[: int(0.1 * SR)] ** 2)) + 1e-9
                if e > 2.5 * floor:
                    units.append(Unit(singer, tech, vowel, rel, 0.0, b0, b1, float(e), kind='breath'))
        return units

    def _singer_stats(self) -> None:
        by: dict[str, list[Unit]] = {}
        for u in self.units:
            if u.kind == 'note':
                by.setdefault(u.singer, []).append(u)
        for s, us in by.items():
            ms = np.array([u.midi for u in us])
            info = SingerInfo(s, float(np.percentile(ms, 3)), float(np.percentile(ms, 97)), float(np.median(ms)))
            for tech in {u.tech for u in us}:
                vv = [u for u in us if u.tech == tech and u.vib_rate > 0]
                if vv:
                    info.vib[tech] = (float(np.median([u.vib_rate for u in vv])), float(np.median([u.vib_extent for u in vv])))
            male = s.startswith('male')
            med = info.median
            if male:
                info.voice_type = 'countertenor' if med > 62 else 'tenor' if med > 55 else 'baritone' if med > 50 else 'bass'
            else:
                info.voice_type = 'soprano' if med > 68 else 'mezzo' if med > 63 else 'alto'
            self.singers[s] = info

    # ------------------------------------------------------------ selection
    CLEAN_TECHS = ('straight', 'slow_piano', 'slow_forte', 'forte', 'pp', 'messa')

    def notes_for(self, singer: str, tech: str, vowel: str) -> list[Unit]:
        """Carrier units for a (singer, vowel). `tech` 'clean' pools the steady-voiced
        techniques (vibrato is then designed, not inherited); any other value selects it."""
        techs = self.CLEAN_TECHS if tech == 'clean' else (tech,)
        return [u for u in self.units if u.kind == 'note' and u.singer == singer and u.tech in techs and u.vowel == vowel]

    def breaths(self, singer: str) -> list[Unit]:
        return [u for u in self.units if u.kind == 'breath' and u.singer == singer]


# ======================================================================== synthesis


def pitch_marks(x: np.ndarray, f0_hz: np.ndarray) -> np.ndarray:
    """Pitch-synchronous marks, one per glottal period, following vibrato.

    The period is re-estimated at every mark by autocorrelation (searched within
    ±25 % of the previous period), and the mark snaps to the waveform maximum of a
    low-passed copy near the predicted position, so marks stay period-locked
    through ±1 semitone vibrato. `f0_hz` seeds the first period."""
    f_seed = float(np.median(f0_hz))
    sos = butter(4, min(0.45, 2.2 * f_seed / (SR / 2)), 'low', output='sos')
    lp = sosfiltfilt(sos, x)
    n = len(x)
    P = SR / f_seed
    first = int(np.argmax(lp[: int(P) + 1]))
    marks = [first]
    while True:
        t = marks[-1]
        w = int(2.5 * P)
        if t + w + int(1.3 * P) >= n:
            break
        seg = lp[t : t + w]
        lo, hi = int(0.75 * P), int(1.25 * P) + 1
        ac = np.array([np.dot(seg[: w - k], seg[k:w]) for k in range(lo, hi)]) if hi < w else None
        if ac is not None and len(ac):
            P = 0.7 * P + 0.3 * (lo + int(np.argmax(ac)))
        a, b = int(t + 0.8 * P), int(t + 1.2 * P) + 1
        k = a + int(np.argmax(lp[a:b]))
        marks.append(k)
    return np.asarray(marks, dtype=np.int64)


class UnitGrains:
    """A unit's audio with pitch marks and per-mark period, ready for PSOLA."""

    _cache: dict[tuple, 'UnitGrains'] = {}

    def __init__(self, bank: VoiceBank, u: Unit):
        x = bank.audio(u.file)
        pad = int(0.03 * SR)
        s0, s1 = max(0, u.start - pad), min(len(x), u.end + pad)
        # 55 Hz high-pass: VocalSet takes carry occasional rumble / handling thumps
        # that PSOLA would otherwise repeat every period (lowest sung E2 = 82 Hz)
        self.x = sosfiltfilt(butter(2, 55 / (SR / 2), 'high', output='sos'), x[s0:s1]).astype(np.float32)
        f0 = 440 * 2 ** ((u.midi - 69) / 12)
        # per-sample f0 from a short-window tracker would be better; plateau units are
        # within +-60 cents of their median, so a constant seed + max-refinement suffices
        self.marks = pitch_marks(self.x, np.full(len(self.x), f0))
        self.periods = np.diff(self.marks, append=self.marks[-1] + (self.marks[-1] - self.marks[-2] if len(self.marks) > 1 else int(SR / f0)))
        self.rms = u.rms
        self.u = u
        self.lead = u.start - s0  # samples before the plateau start

    @classmethod
    def get(cls, bank: VoiceBank, u: Unit) -> 'UnitGrains':
        k = (u.file, u.start, u.end)
        if k not in cls._cache:
            if len(cls._cache) > 3000:
                cls._cache.clear()
            cls._cache[k] = cls(bank, u)
        return cls._cache[k]

    def grain(self, pos: float, formant: float = 1.0):
        """Two-period Hann grain centred at the mark nearest `pos` (samples within unit).

        `formant` > 1 compresses the grain in time, raising every formant by that factor
        (a shorter vocal tract); < 1 lowers them. Pitch is set by grain placement, not here."""
        i = int(np.clip(np.searchsorted(self.marks, pos), 1, len(self.marks) - 2))
        if abs(self.marks[i - 1] - pos) < abs(self.marks[i] - pos):
            i -= 1
        c = self.marks[i]
        P = int(self.periods[i])
        a, b = c - P, c + P
        if a < 0 or b > len(self.x):
            a, b = max(0, a), min(len(self.x), b)
        g = self.x[a:b] * np.hanning(b - a).astype(np.float32)
        if abs(formant - 1.0) > 1e-3:
            n_new = max(4, int(round(len(g) / formant)))
            g = np.interp(np.linspace(0, len(g) - 1, n_new), np.arange(len(g)), g).astype(np.float32)
            return g, int(round((c - a) / formant))
        return g, c - a

    @property
    def usable(self) -> tuple[float, float]:
        return float(self.lead), float(len(self.x) - int(0.03 * SR))


@dataclass
class SingerStyle:
    singer: str
    tech: str
    vowel: str
    skill: str = 'good'
    vib_rate: float = 5.6
    vib_extent: float = 40.0  # cents peak
    vib_delay: tuple[float, float] = (0.15, 0.4)
    trans_time: tuple[float, float] = (0.06, 0.14)
    overshoot: tuple[float, float] = (0.05, 0.25)  # fraction of interval
    scoop_cents: tuple[float, float] = (30, 120)
    drift_cents: float = 8.0
    jitter_cents: float = 4.0
    breath_gain_db: tuple[float, float] = (-34, -24)
    formant: float = 1.0  # vocal-tract scaling (voice type / child)


class PsolaSinger:
    def __init__(self, bank: VoiceBank, style: SingerStyle, rng: random.Random, sr_out: int = 48000):
        self.bank = bank
        self.st = style
        self.rng = rng
        self.sr_out = sr_out
        self.pool = bank.notes_for(style.singer, style.tech, style.vowel)
        if not self.pool:
            raise ValueError(f'no units for {style.singer}/{style.tech}/{style.vowel}')
        self._rr: dict[int, int] = {}

    def _unit_for(self, midi: float, dur: float) -> Unit:
        rng = self.rng
        c = sorted(self.pool, key=lambda u: (abs(u.midi - midi), -(u.end - u.start)))
        best = abs(c[0].midi - midi)
        near = [u for u in c if abs(u.midi - midi) <= best + 1.01]
        # stretch at most ~1.6x: long notes want long units (long tones)
        long_enough = [u for u in near if (u.end - u.start) / SR >= dur / 1.6]
        if not long_enough:
            wider = [u for u in c if abs(u.midi - midi) <= best + 3.01 and (u.end - u.start) / SR >= dur / 1.6]
            long_enough = wider[:6]
        cand = long_enough or near
        k = self._rr.get(round(midi), rng.randrange(len(cand)))
        self._rr[round(midi)] = k + 1
        return cand[k % len(cand)]

    # ------------------------------------------------------------ contour
    def contour(self, notes: list[PerformedNote], t0: float, t1: float) -> np.ndarray:
        """Designed f0 (MIDI, fractional) at SR for one voiced run [t0, t1)."""
        rng = self.rng
        st = self.st
        n = int((t1 - t0) * SR)
        t = np.arange(n) / SR + t0
        m = np.zeros(n)
        # piecewise-constant targets
        for i, nt in enumerate(notes):
            a = int((nt.onset - t0) * SR)
            m[max(0, a) :] = nt.midi + nt.cents / 100
        # transitions between consecutive notes: smooth step centred just before the onset
        for i in range(1, len(notes)):
            prev, cur = notes[i - 1], notes[i]
            iv = (cur.midi + cur.cents / 100) - (prev.midi + prev.cents / 100)
            if abs(iv) < 1e-6:
                continue
            d = rng.uniform(*st.trans_time) * (1 + 0.04 * min(12, abs(iv)))
            d = min(d, 0.3 * (prev.offset - prev.onset), 0.3 * (cur.offset - cur.onset))
            # the pitch move is centred just before the labelled onset (slight
            # anticipation): an annotator marks a legato note where its pitch arrives
            c = cur.onset - 0.1 * d
            w = (t >= c - d) & (t <= c + d * 1.5)
            tt = t[w]
            base = prev.midi + prev.cents / 100
            k = np.clip((tt - (c - d / 2)) / d, 0, 1)
            step = base + iv * (3 * k**2 - 2 * k**3)
            # overshoot (damped) after reaching the target, preparation dip before
            ov = rng.uniform(*st.overshoot) * iv * (1.0 if iv > 0 else 0.6)
            after = np.clip((tt - (c + d / 2)) / 0.12, 0, None)
            step += ov * np.exp(-3 * after) * np.sin(np.pi * np.clip(after * 1.2, 0, 1)) * (after > 0)
            prep = -0.08 * iv * np.exp(-(((tt - (c - d)) / (0.35 * d)) ** 2))
            m[w] = step + prep
        # onset scoop from below, release fall
        sc = rng.uniform(*st.scoop_cents) / 100
        k = np.clip((t - t0) / rng.uniform(0.07, 0.16), 0, 1)
        m -= sc * (1 - k) ** 2
        fall = rng.uniform(0.1, 0.5)
        k2 = np.clip((t - (t1 - 0.12)) / 0.12, 0, 1)
        m -= fall * k2**2
        # vibrato. Trained (light/operatic) singers keep one continuous oscillator
        # through the phrase — phase never resets at a note — narrowing briefly
        # during transitions and widening a little on long notes. Straight-tone
        # singing only lets a small vibrato bloom late in longer notes.
        vib = np.zeros(n)
        if st.vib_extent >= 5:
            g0 = np.random.default_rng(rng.randrange(1 << 30))
            slow = uniform_filter1d(g0.normal(size=n // 441 + 3), 8)
            rate = st.vib_rate * (1 + 0.06 * np.interp(np.arange(n), np.linspace(0, n, len(slow)), slow))
            ph = 2 * np.pi * np.cumsum(rate) / SR + rng.uniform(0, 2 * np.pi)
            ext = np.zeros(n)
            continuous = st.vib_extent >= 30
            if continuous:
                d0 = rng.uniform(0.08, 0.25)
                ext[:] = np.clip((t - t0 - d0) / 0.25, 0, 1)
                for nt in notes[1:]:
                    dip = np.exp(-(((t - nt.onset) / 0.07) ** 2))
                    ext *= 1 - 0.55 * dip
                for nt in notes:
                    L = nt.offset - nt.onset
                    if L > 0.8:
                        k = np.clip((t - nt.onset) / L, 0, 1) * ((t >= nt.onset) & (t < nt.offset))
                        ext *= 1 + 0.15 * k
            else:
                for nt in notes:
                    L = nt.offset - nt.onset
                    if L < 0.45:
                        continue
                    delay = rng.uniform(*st.vib_delay)
                    w = (t >= nt.onset) & (t < nt.offset + 0.05)
                    ext[w] = np.maximum(ext[w], np.clip((t[w] - nt.onset - delay) / 0.3, 0, 1))
            vib = st.vib_extent / 100 * rng.uniform(0.85, 1.1) * ext * np.sin(ph)
        m += vib
        # drift + jitter (low-passed noise)
        g = np.random.default_rng(rng.randrange(1 << 30))
        dr = uniform_filter1d(g.normal(size=n // 441 + 2), 40) * st.drift_cents / 100 * 6
        jt = uniform_filter1d(g.normal(size=n // 44 + 2), 3) * st.jitter_cents / 100
        m += np.interp(np.arange(n), np.linspace(0, n, len(dr)), dr) + np.interp(np.arange(n), np.linspace(0, n, len(jt)), jt)
        return m

    # ------------------------------------------------------------ synthesis
    def _run(self, notes: list[PerformedNote], t0: float, t1: float) -> np.ndarray:
        rng = self.rng
        m = self.contour(notes, t0, t1)
        f0 = 440 * 2 ** ((m - 69) / 12)
        n = len(m)
        out = np.zeros(n + 4096, np.float32)
        units = [self._unit_for(nt.midi, nt.offset - nt.onset) for nt in notes]
        grains = [UnitGrains.get(self.bank, u) for u in units]
        # per-note time maps into its unit: start a little inside the plateau, stretch if short
        maps = []
        for nt, g in zip(notes, grains):
            lo, hi = g.usable
            span = max(1.0, hi - lo)
            dur = (nt.offset - nt.onset) * SR
            rate = min(1.0, span / max(dur, 1.0)) if dur > span else rng.uniform(0.8, 1.0)
            off = lo + (rng.uniform(0, max(0.0, span - dur * rate)) if dur * rate < span else 0)
            maps.append((nt.onset, off, rate, lo, hi))
        durs = [nt.offset - nt.onset for nt in notes]
        xf = max(0.01, min(rng.uniform(0.03, 0.06), 0.2 * min(durs)))
        s = 0.0
        amp_target = 0.1
        while s < n - 1:
            ts_ = t0 + s / SR
            # which note owns this instant (and the next, for crossfading)
            i = 0
            while i + 1 < len(notes) and ts_ >= notes[i + 1].onset - xf / 2:
                i += 1
            w_next = 0.0
            if i + 1 < len(notes):
                dt = ts_ - (notes[i + 1].onset - xf / 2 - xf)
                if dt > 0:
                    w_next = min(1.0, dt / xf)
            srcs = [(i, 1.0 - w_next)] + ([(i + 1, w_next)] if w_next > 0 else [])
            P_out = SR / f0[int(s)]
            for j, w in srcs:
                if w <= 0:
                    continue
                on, off, rate, lo, hi = maps[j]
                pos = off + (ts_ - on) * SR * rate
                pos = float(np.clip(pos, lo, hi))
                g, c = grains[j].grain(pos, self.st.formant)
                gain = w * amp_target / max(grains[j].rms, 1e-4)
                a = int(s) - c
                if a < 0:
                    g = g[-a:]
                    a = 0
                e = min(len(out), a + len(g))
                out[a:e] += g[: e - a] * gain
            s += P_out
        out = out[:n]
        # dynamics: per-note velocity, smoothed; rearticulation dips for repeated pitches
        env = np.zeros(n)
        for i, nt in enumerate(notes):
            a, b = int((nt.onset - t0) * SR), int((nt.offset - t0) * SR)
            env[max(0, a) : min(n, b)] = 10 ** ((nt.vel - 80) / 127 * 9 / 20)
            if i > 0 and notes[i - 1].midi == nt.midi:
                d = int(rng.uniform(0.04, 0.08) * SR)
                c = max(0, a)
                dip = 1 - rng.uniform(0.45, 0.85) * np.sin(np.linspace(0, np.pi, 2 * d)) ** 2
                lo_ = max(0, c - d)
                env[lo_ : c + d] *= dip[: min(2 * d, n - lo_)][: len(env[lo_ : c + d])]
        env[env == 0] = env[env > 0].min() if (env > 0).any() else 1
        env = uniform_filter1d(env, int(0.15 * SR))
        att = int(rng.uniform(0.04, 0.12) * SR)
        rel = int(rng.uniform(0.08, 0.2) * SR)
        env[:att] *= np.linspace(0, 1, att) ** 1.5
        env[-rel:] *= np.linspace(1, 0, rel) ** 1.2
        return (out * env).astype(np.float32)

    def render(self, perf: Performance) -> tuple[np.ndarray, list[dict]]:
        rng = self.rng
        notes = perf.notes
        total = int((perf.duration + 1.5) * SR)
        y = np.zeros(total, np.float32)
        # split into voiced runs: consecutive notes that touch (legato or repeated w/o gap)
        runs: list[list[PerformedNote]] = []
        for nt in notes:
            if runs and nt.onset - runs[-1][-1].offset < 0.03:
                runs[-1].append(nt)
            else:
                runs.append([nt])
        breaths = self.bank.breaths(self.st.singer)
        for ri, run in enumerate(runs):
            t0 = run[0].onset
            t1 = run[-1].offset + 0.08
            seg = self._run(run, t0, t1)
            a = int(t0 * SR)
            y[a : a + len(seg)] += seg[: len(y) - a]
            # audible inhale before a phrase that follows a gap
            gap = t0 - (runs[ri - 1][-1].offset if ri else 0.0)
            if breaths and gap > 0.4 and rng.random() < 0.85:
                b = rng.choice(breaths)
                bx = self.bank.audio(b.file)[b.start : b.end]
                bx = bx[-int(min(len(bx), (gap - 0.1) * SR)) :]
                gain = 10 ** (rng.uniform(*self.st.breath_gain_db) / 20) / max(b.rms, 1e-5) * 0.1
                s0 = max(0, a - len(bx) - int(0.05 * SR))
                fade = np.minimum(1, np.linspace(0, 6, len(bx))) * np.minimum(1, np.linspace(6, 0, len(bx)))
                y[s0 : s0 + len(bx)] += (bx * gain * fade).astype(np.float32)
        truth = [{'onsetSec': round(n.onset, 4), 'durSec': round(n.offset - n.onset, 4), 'midi': int(n.midi)} for n in notes]
        end = int((notes[-1].offset + 1.0) * SR)
        y = y[:end]
        if self.sr_out != SR:
            y = resample_poly(y, self.sr_out // math.gcd(self.sr_out, SR), SR // math.gcd(self.sr_out, SR)).astype(np.float32)
        return y, truth
