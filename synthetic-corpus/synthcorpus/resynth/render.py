"""Render the synthetic copy of a clip from its note spec.

The copy is a function of (spec, seed, the original's cached analysis) only: same inputs,
identical samples. Its note structure comes from the spec alone; from the original it borrows
only what the truth does not encode:

- the pitch contour within each note (`copy-detrended`): rendered pitch = midi + cents/100 +
  d(t), where d(t) is the original's in-note deviation with its slow trend (250 ms moving
  median) removed, clamped to ±60 c — so vibrato is copied, but a held pitch step inside a
  note, or a wrong `midi`, is not. A note that starts from silence also copies its first
  100 ms relative to the note's median, clamped to ±200 c (the attack scoop);
- the level of each note (`vel`, 2 vel = 1 dB re the clip's reference level), and the
  overall level (`levelMatch`).

Timbres: `whistle` (a phase-continuous sine with a weak 2nd harmonic and band-passed breath
noise), `voice` (VocalSet TD-PSOLA, `voice.PsolaSinger` following this contour), and
`instrument` (`sampler.MonoSampler` through its optional per-note contour hook).
Output: 24 kHz mono float32.
"""

from __future__ import annotations

import dataclasses
import hashlib
import random
from contextlib import contextmanager

import numpy as np
from scipy.ndimage import median_filter, uniform_filter1d
from scipy.signal import butter, sosfiltfilt

from ..performance import Performance, PerformedNote
from .analysis import HOP, SR_A, Analysis, frame_rms_db, resample
from .spec import Note, Spec

SR = 24000


def seed_for(dataset: str, clip: str) -> int:
    return int(hashlib.sha256(f'{dataset}/{clip}'.encode()).hexdigest()[:8], 16)


class Contour:
    """The copy's pitch (fractional MIDI) as a function of time, on a 10 ms grid."""

    TREND = 0.25  # s: moving median removed from the original's in-note pitch
    CLAMP = 0.6  # st
    SCOOP = (0.10, 2.0)  # first 100 ms of an attack from silence: ±200 c

    def __init__(self, notes: list[Note], a: Analysis | None, mode: str = 'copy-detrended'):
        notes = sorted(notes, key=lambda n: n.on)
        end = (notes[-1].off if notes else 0.0) + 2.5
        n = int(end / HOP) + 2
        p = np.full(n, np.nan)
        for i, nt in enumerate(notes):
            nxt = notes[i + 1] if i + 1 < len(notes) else None
            s = max(0, int(round(nt.on / HOP)))
            e = min(n, int(round(((nxt.on if nxt is not None and nxt.on - nt.off < 0.3 else nt.off + 0.3)) / HOP)))
            if e <= s:
                continue
            base = nt.midi + nt.cents / 100.0
            d = self._deviation(nt, a, s, e, i == 0 or nt.on - notes[i - 1].off >= 0.05) if a is not None and mode == 'copy-detrended' else 0.0
            p[s:e] = base + d
        ok = np.isfinite(p)
        if ok.any():
            # between notes the pitch HOLDS (a release tail must not glide to the next note)
            idx = np.where(ok, np.arange(n), 0)
            np.maximum.accumulate(idx, out=idx)
            p = p[idx]
            p[: int(np.argmax(ok))] = p[int(np.argmax(ok))]
        else:
            p[:] = 69.0
        self.grid = uniform_filter1d(p, 3, mode='nearest')  # ~30 ms: legato joins glide, never step

    def _deviation(self, nt: Note, a: Analysis, s: int, e: int, attack: bool) -> np.ndarray:
        L = e - s
        ne = min(e, a.n)
        o = np.full(L, np.nan)
        if ne > s:
            seg = a.f0[s:ne].astype(float)
            seg[a.conf[s:ne] < 1] = np.nan
            o[: ne - s] = seg
        own = o[: max(1, int(round(nt.dur / HOP)))]
        if not np.isfinite(own).any():
            return np.zeros(L)
        med = float(np.nanmedian(own))
        filled = np.where(np.isfinite(o), o, med)
        w = max(3, int(self.TREND / HOP) | 1)
        trend = median_filter(filled, size=w, mode='nearest')
        d = np.clip(np.where(np.isfinite(o), o - trend, 0.0), -self.CLAMP, self.CLAMP)
        if attack:
            k = min(L, int(self.SCOOP[0] / HOP))
            sc = np.clip(np.where(np.isfinite(o[:k]), o[:k] - med, 0.0), -self.SCOOP[1], self.SCOOP[1])
            fade = np.clip((np.arange(k) - (k - 3)) / 3.0, 0, 1)  # hand over to the detrended part over 30 ms
            d[:k] = sc * (1 - fade) + d[:k] * fade
        return d

    def __call__(self, t: np.ndarray) -> np.ndarray:
        return np.interp(np.asarray(t, float) / HOP, np.arange(len(self.grid)), self.grid)

    def for_note(self, n: Note):
        """One note's own contour: held at its first value before the onset (a sample's lead-in)
        and at its last value through the release, so no sample is ever shifted towards a neighbour."""
        lo, hi = n.on + HOP, max(n.on + HOP, n.off - 2 * HOP)
        return lambda t: self(np.clip(t, lo, hi))


class Renderer:
    """Base: per-note level shaping, post filters and level matching shared by every timbre."""

    def __init__(self, spec: Spec, orig: Analysis | None):
        self.spec = spec
        self.orig = orig
        self.notes = sorted(spec.notes, key=lambda n: n.on)
        self.seed = int(spec.render.get('seed', seed_for(spec.dataset, spec.clip)))
        self.contour = Contour(self.notes, orig, spec.render.get('contour', 'copy-detrended'))

    def render(self) -> np.ndarray:
        if not self.notes:
            dur = self.orig.dur if self.orig is not None else 1.0
            return np.zeros(int(dur * SR), np.float32)
        y = self.raw()
        y = self.shape(y)
        y = self.post(y)
        dur = max(self.orig.dur if self.orig is not None else 0.0, self.notes[-1].off + 0.5)
        n = int(dur * SR)
        y = y[:n] if len(y) >= n else np.concatenate([y, np.zeros(n - len(y), np.float32)])
        return self.level(y)

    def raw(self) -> np.ndarray:
        raise NotImplementedError

    def performance(self, vel: float = 80.0) -> Performance:
        pn = [PerformedNote(onset=n.on, offset=n.off, midi=int(n.midi), vel=vel, legato_in=n.legato, cents=n.cents) for n in self.notes]
        for a, b in zip(pn, pn[1:]):
            if b.legato_in:
                a.offset = b.onset
        return Performance(pn, qpm=120, skill='copy', dynamic='mf', duration=pn[-1].offset + 1.0, breaths=[])

    def shape(self, y: np.ndarray) -> np.ndarray:
        """Per-note gain from `vel` (2 vel = 1 dB), held through releases, 20 ms smoothed."""
        if self.timbre_kind == 'whistle':
            return y  # the whistle oscillator applies its levels itself
        g = np.zeros(len(y))
        for i, n in enumerate(self.notes):
            nxt = self.notes[i + 1] if i + 1 < len(self.notes) else None
            a = int(n.on * SR)
            b = int((nxt.on if nxt is not None else n.off + 1.0) * SR)
            g[max(0, a) : min(len(y), b)] = 10 ** ((n.vel - 100) / 2 / 20)
        g[: max(0, int(self.notes[0].on * SR))] = 10 ** ((self.notes[0].vel - 100) / 2 / 20)
        g = uniform_filter1d(g, int(0.02 * SR), mode='nearest')
        if self.timbre_kind == 'voice':
            # a sung note's sound ends at its offset (the truth convention): PsolaSinger's run
            # outlasts the last note by 80 ms, so close it with a 40 ms fade
            for i, n in enumerate(self.notes):
                nxt = self.notes[i + 1] if i + 1 < len(self.notes) else None
                if nxt is None or nxt.on - n.off >= 0.03:
                    a, b = int(n.off * SR), int((n.off + 0.04) * SR)
                    if a < len(g):
                        g[a:b] *= np.linspace(1, 0, b - a)[: len(g[a:b])]
                        g[b : int(nxt.on * SR) if nxt is not None else len(g)] = 0
            # PsolaSinger joins touching notes into one voiced run; a re-articulated note (not
            # legato) gets an audible level dip ending at its onset, as a singer's would
            for a, b in zip(self.notes, self.notes[1:]):
                if not b.legato and b.on - a.off < 0.03:
                    w = int(min(0.04, 0.4 * a.dur) * SR)
                    c = int(b.on * SR)
                    if w > 4 and c < len(g):
                        k = np.sin(np.linspace(0, np.pi, 2 * w)) ** 2
                        lo = max(0, c - 2 * w)
                        g[lo:c] *= 1 - 0.85 * k[2 * w - (c - lo):]
        return (y * g).astype(np.float32)

    def post(self, y: np.ndarray) -> np.ndarray:
        t = self.spec.timbre
        if t.get('lowpassHz'):
            y = sosfiltfilt(butter(4, t['lowpassHz'] / (SR / 2), 'low', output='sos'), y).astype(np.float32)
        if self.orig is not None and self.orig.sr < SR_A:
            # a band-limited original (8 kHz telephone-grade): the copy loses the same band
            y = sosfiltfilt(butter(8, 0.45 * self.orig.sr / (SR / 2), 'low', output='sos'), y).astype(np.float32)
        return y

    def level(self, y: np.ndarray) -> np.ndarray:
        """Match the copy's reference level (90th percentile over the notes) to the original's."""
        peak = float(np.abs(y).max()) + 1e-9
        y = y / peak * 0.5
        if self.orig is not None and self.spec.render.get('levelMatch', True):
            y16 = resample(y, SR, SR_A)
            db = frame_rms_db(y16, len(y16) // 160 + 1)
            inside = np.zeros(len(db), bool)
            for n in self.notes:
                inside[int(n.on / HOP) : int(n.off / HOP)] = True
            if inside.sum() >= 3:
                cur = float(np.percentile(db[inside], 90))
                y = y * 10 ** ((self.orig.level_ref_db - cur) / 20)
        peak = float(np.abs(y).max())
        if peak > 0.98:
            y = y * (0.98 / peak)
        return y.astype(np.float32)

    @property
    def timbre_kind(self) -> str:
        return self.spec.timbre['kind']


class WhistleRenderer(Renderer):
    ATTACK = 0.015
    RELEASE = 0.03
    REARTIC = 0.04  # a re-articulated note (not legato) is preceded by at least this much silence

    def raw(self) -> np.ndarray:
        rng = np.random.default_rng(self.seed)
        notes = self.notes
        n = int((notes[-1].off + 1.0) * SR)
        t = np.arange(n) / SR
        f = 440 * 2 ** ((self.contour(t) - 69) / 12)
        phase = 2 * np.pi * np.cumsum(f) / SR
        tone = np.sin(phase) + 0.03 * np.sin(2 * phase)
        env = np.zeros(n)
        for i, nt in enumerate(notes):
            nxt = notes[i + 1] if i + 1 < len(notes) else None
            g = 10 ** ((nt.vel - 100) / 2 / 20)
            a = int(nt.on * SR)
            legato_out = nxt is not None and nxt.legato
            touching = nxt is not None and not nxt.legato and nxt.on - nt.off < self.REARTIC
            end = nxt.on if legato_out else (max(nxt.on - self.REARTIC, nt.on + 0.6 * nt.dur) if touching else nt.off)
            b = max(a + 1, int(end * SR))
            seg = np.full(b - a, g)
            if not nt.legato:
                k = min(len(seg), int(self.ATTACK * SR))
                seg[:k] *= 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, k))
            env[a:b] = seg
            if not legato_out:
                r = int(self.RELEASE * SR) if not touching else int(0.012 * SR)
                c = min(n, b + r)
                env[b:c] = np.maximum(env[b:c], g * np.exp(-np.arange(c - b) / (r / 4)))
        env = uniform_filter1d(env, int(0.003 * SR), mode='nearest')  # no clicks at legato level steps
        f0 = 440 * 2 ** ((np.median([x.midi for x in notes]) - 69) / 12)
        lo, hi = max(50.0, f0 / 1.6), min(SR / 2 * 0.95, f0 * 1.6)
        noise = sosfiltfilt(butter(2, [lo / (SR / 2), hi / (SR / 2)], 'band', output='sos'), rng.standard_normal(n))
        noise *= 10 ** (-28 / 20) / (np.std(noise) + 1e-9) * np.sqrt(0.5)
        return ((tone + noise) * env).astype(np.float32)


class VoiceRenderer(Renderer):
    _bank = None

    @classmethod
    def bank(cls):
        if cls._bank is None:
            from ..voice import VoiceBank

            cls._bank = VoiceBank()
            cls._bank.analyse(log=lambda *a: None)
        return cls._bank

    @classmethod
    def choose_singer(cls, vowel: str, midis: list[float], sex: str | None = None) -> str:
        """The singer whose measured range covers the clip's notes best (ties: nearest median)."""
        bank = cls.bank()
        lo, hi = (float(np.percentile(midis, 10)), float(np.percentile(midis, 90))) if midis else (60.0, 70.0)
        med = float(np.median(midis)) if midis else 65.0
        best = None
        for name in sorted(bank.singers):
            if sex and not name.startswith(sex):
                continue
            if len(bank.notes_for(name, 'clean', vowel)) < 20:
                continue
            s = bank.singers[name]
            cost = max(0.0, s.low - lo) + max(0.0, hi - s.high) + 0.1 * abs(s.median - med)
            if best is None or cost < best[0]:
                best = (cost, name)
        if best is None:
            raise ValueError(f'no singer with vowel {vowel!r}')
        return best[1]

    def raw(self) -> np.ndarray:
        from ..voice import PsolaSinger, SingerStyle

        t = self.spec.timbre
        style = SingerStyle(t['singer'], 'clean', t.get('vowel', 'a'), vib_extent=0.0, scoop_cents=(0, 0), overshoot=(0, 0), drift_cents=0.0,
                            jitter_cents=0.0, breath_gain_db=(-200.0, -200.0))
        contour = self.contour

        class CopySinger(PsolaSinger):
            def contour(self, notes, t0, t1):  # noqa: D401 — PsolaSinger's per-run f0 hook
                self._am = None
                return contour(t0 + np.arange(int((t1 - t0) * 44100)) / 44100)

        y, _ = CopySinger(self.bank(), style, random.Random(self.seed), SR).render(self.performance(vel=80.0))
        return self._steady(y)

    def _steady(self, y: np.ndarray) -> np.ndarray:
        """Divide out PsolaSinger's in-note level wobble (shimmer, vibrato AM): the copy's level
        must follow the notes only, or the wobble reads as onsets the spec never asked for."""
        env = np.sqrt(np.maximum(uniform_filter1d(y.astype(np.float64) ** 2, int(0.05 * SR), mode='nearest'), 0.0)) + 1e-9
        g = np.ones(len(y))
        runs: list[list[Note]] = []
        for n in self.notes:
            if runs and n.on - runs[-1][-1].off < 0.03:
                runs[-1].append(n)
            else:
                runs.append([n])
        for run in runs:
            a, b = int((run[0].on + 0.06) * SR), int((run[-1].off - 0.05) * SR)
            if b - a < int(0.05 * SR):
                continue
            ref = float(np.median(env[a:b]))
            g[a:b] = np.clip(ref / env[a:b], 0.5, 2.0)
        g = uniform_filter1d(g, int(0.02 * SR), mode='nearest')
        return (y * g).astype(np.float32)


class InstrumentRenderer(Renderer):
    _sets: dict = {}

    @classmethod
    def sample_set(cls, timbre: str, source: str):
        key = (timbre, source)
        if key not in cls._sets:
            from ..instruments import BY_ID

            src = next((s for s in BY_ID[timbre].available_sources() if s.id == source), None)
            if src is None:
                raise ValueError(f'sample source {source!r} not available for {timbre!r}')
            with _no_root_cache_write():
                cls._sets[key] = src.load()
        return cls._sets[key]

    def raw(self) -> np.ndarray:
        from ..instruments import BY_ID
        from ..sampler import MonoSampler

        t = self.spec.timbre
        perf = self.performance(vel=80.0)
        for pn, n in zip(perf.notes, self.notes):
            pn.contour = self.contour.for_note(n)  # sampler.py's optional per-note pitch hook (fractional MIDI)
        sset = self.sample_set(t['timbre'], t['source'])
        style = BY_ID[t['timbre']].sampler
        if not style.percussive:
            # a copy's sound ends at its note-offs: short releases, not a hall's worth of tail
            style = dataclasses.replace(style, release=(0.03, 0.05))
        y, _ = MonoSampler(sset, style, random.Random(self.seed), SR).render(perf)
        return y


@contextmanager
def _no_root_cache_write():
    """RootCalibrator.calibrate saves work/root-cache.json as a side effect; a copy must not."""
    from ..samples import RootCalibrator

    saved = RootCalibrator.__dict__['save']
    RootCalibrator.save = classmethod(lambda cls: None)
    try:
        yield
    finally:
        RootCalibrator.save = saved


RENDERERS = {'whistle': WhistleRenderer, 'voice': VoiceRenderer, 'instrument': InstrumentRenderer}


def render(spec: Spec, orig: Analysis | None) -> np.ndarray:
    return RENDERERS[spec.timbre['kind']](spec, orig).render()
