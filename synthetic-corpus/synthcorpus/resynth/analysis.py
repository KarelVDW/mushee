"""Deterministic analysis of one recording: the original and its synthetic copy are measured
identically, so every difference the compare step reports is a difference in the audio.

Per 10 ms frame (centred at k·10 ms):
- two independent f0 trackers. Voice/instruments: SwiftF0 (16 kHz) + pYIN. Whistling: a
  sinusoidal FFT-peak tracker at the native rate (`SineTracker`, the method of
  apps/api/scripts/eval/lib/sineTrack.ts) + pYIN up to 5 kHz — SwiftF0 tops out at
  2.1 kHz and gives low confidence on a near-pure tone;
- their consensus: confident (2) where both are voiced within 50 c, uncertain (1) where
  only one is voiced or they disagree (the primary tracker's value is kept), else 0;
- RMS level (dB), a superflux onset envelope and backtracked onset events, each with the
  energy rise and the re-articulation dip around it;
- sung material only: a timbre-novelty envelope and its syllable events (`SyllableTracker`),
  where the spectral envelope changes while the voice carries on (a new sung syllable on the
  same pitch shows no energy dip and no pitch change, only a consonant or a vowel change).

No CREPE and no apps/api code: the truth must not lean towards the system under test.
"""

from __future__ import annotations

import json
import math
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import soundfile as sf

from .datasets import REPO

HOP = 0.01
SR_A = 16000  # analysis rate for SwiftF0, onsets, RMS, panels
FFMPEG = REPO / 'node_modules/.pnpm/ffmpeg-static@5.3.0/node_modules/ffmpeg-static/ffmpeg'


def load_audio(path: Path) -> tuple[np.ndarray, int]:
    """Mono float32 at the file's own rate (webm/ogg/mp3 through ffmpeg-static at 48 kHz)."""
    if path.suffix.lower() in ('.wav', '.flac', '.aif', '.aiff'):
        x, sr = sf.read(str(path), dtype='float32', always_2d=True)
        return x.mean(axis=1), int(sr)
    raw = subprocess.run([str(FFMPEG), '-v', 'error', '-i', str(path), '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], check=True, capture_output=True).stdout
    return np.frombuffer(raw, np.float32).copy(), 48000


def resample(y: np.ndarray, sr: int, to: int) -> np.ndarray:
    if sr == to:
        return y.astype(np.float32)
    from scipy.signal import resample_poly  # lazy: scipy.signal costs ~0.5 s of import, the read-only views never resample

    g = math.gcd(sr, to)
    return resample_poly(y, to // g, sr // g).astype(np.float32)


def hz_to_midi(hz: np.ndarray) -> np.ndarray:
    out = np.full(np.shape(hz), np.nan)
    ok = np.isfinite(hz) & (hz > 0)
    out[ok] = 69 + 12 * np.log2(hz[ok] / 440.0)
    return out


def frame_rms_db(y16: np.ndarray, n: int) -> np.ndarray:
    """Centred 32 ms RMS at the 10 ms hop, in dBFS (the level both sides are matched on)."""
    import librosa

    r = librosa.feature.rms(y=y16, frame_length=512, hop_length=160, center=True)[0]
    return _fit(20 * np.log10(r + 1e-9), n, -180.0)


def _true_runs(mask: np.ndarray) -> list[tuple[int, int]]:
    """[start, end) runs of True."""
    d = np.diff(np.concatenate([[0], mask.astype(np.int8), [0]]))
    return list(zip(np.nonzero(d == 1)[0], np.nonzero(d == -1)[0]))


def _fit(a: np.ndarray, n: int, fill: float = np.nan) -> np.ndarray:
    if len(a) >= n:
        return a[:n]
    return np.concatenate([a, np.full(n - len(a), fill, dtype=a.dtype if np.issubdtype(a.dtype, np.floating) else float)])


class SineTracker:
    """Strongest in-band spectral peak per frame, log-parabolic interpolation, tonality gate.

    A whistle is one near-sinusoidal partial 15–30 dB above everything else, so this is a
    reading rather than an estimate. The window is ~43 ms at any sample rate, so the 44.1 kHz
    original and the 24 kHz copy are measured with the same time resolution."""

    def __init__(self, fmin: float, fmax: float, min_tonality: float = 0.35, min_level: float = 0.06):
        self.fmin, self.fmax = fmin, fmax
        self.min_tonality, self.min_level = min_tonality, min_level

    def track(self, y: np.ndarray, sr: int, n: int) -> np.ndarray:
        nfft = 1 << int(math.ceil(math.log2(0.04 * sr)))
        half = nfft // 2
        win = np.hanning(nfft).astype(np.float32)
        centres = np.round(np.arange(n) * HOP * sr).astype(np.int64)
        yp = np.concatenate([np.zeros(half, np.float32), y.astype(np.float32), np.zeros(nfft, np.float32)])
        lo = max(1, int(self.fmin * nfft / sr))
        hi = min(half - 2, int(math.ceil(self.fmax * nfft / sr)))
        midi = np.full(n, np.nan)
        tonal = np.zeros(n)
        rms = np.zeros(n)
        for b0 in range(0, n, 1024):  # blocks bound the frame matrix to ~10 MB
            idx = centres[b0 : b0 + 1024, None] + np.arange(nfft)[None, :]
            fr = yp[idx]
            rms[b0 : b0 + len(fr)] = np.sqrt(np.mean(fr**2, axis=1))
            mag = np.abs(np.fft.rfft(fr * win, axis=1)) ** 2
            band = mag[:, lo : hi + 1]
            pk = lo + np.argmax(band, axis=1)
            rows = np.arange(len(fr))
            lm = np.log(mag[rows, pk - 1] + 1e-20)
            c = np.log(mag[rows, pk] + 1e-20)
            r = np.log(mag[rows, pk + 1] + 1e-20)
            den = lm - 2 * c + r
            delta = np.where(den != 0, 0.5 * (lm - r) / np.where(den != 0, den, 1), 0.0)
            hz = (pk + np.clip(delta, -0.5, 0.5)) * sr / nfft
            total = mag[:, 1 : hi + 2].sum(axis=1)
            tonal[b0 : b0 + len(fr)] = (mag[rows, pk - 1] + mag[rows, pk] + mag[rows, pk + 1]) / np.maximum(total, 1e-20)
            midi[b0 : b0 + len(fr)] = hz_to_midi(hz)
        level = rms / max(float(rms.max()), 1e-9)
        midi[(tonal < self.min_tonality) | (level < self.min_level)] = np.nan
        return midi


class SyllableTracker:
    """Sung syllables as timbre novelty: the distance between the mean MFCCs (c1–c16, a 32 ms
    STFT, 40 mel bands 60–7800 Hz) of the 20 ms before and the 20 ms after each frame. A new
    syllable changes the spectral envelope (a consonant, then a new vowel) while the pitch and,
    often, the level carry on, so it is invisible to the energy and pitch events.

    Events are local maxima (±40 ms, ≥ 50 ms apart) at or above `MIN_STRENGTH`, where the voice
    persists: ≥ 30 ms voiced in the 150 ms before and in the 100 ms after, across an unvoiced gap
    of at most 150 ms (a consonant), not in the noise floor and not a fade-out (the level after
    > 10 dB below the level before: a release changes the timbre too). Strength is the novelty over `SCALE`
    (35); the evidence counts ≥ 1.25 as a syllable (`evidence.SYL_STRONG`).

    Tuned on vocadito (38 clips, both annotators; vocadito_3 / _14 held out) against the
    annotators' boundaries between two same-pitch notes and their held notes that no annotator
    splits (RESYNTH.md, "Syllable evidence"): ≥ 1.25 within ±50 ms finds 38 % of the boundaries
    at 0.13 false events per second of held note (5 % of held notes); ≥ 1.0 within ±60 ms, 63 %
    at 0.46 / s (16 %). Events sit a median 6 ms before the annotated boundary."""

    VERSION = 1  # part of the analyzer config of sung material: bump when the events change
    N_FFT, N_MELS, FMIN, FMAX, N_MFCC, HALF = 512, 40, 60.0, 7800.0, 16, 2
    SCALE = 35.0
    FADE_DB = 10.0  # level 30–100 ms after this far below the level 20–100 ms before: a fade-out
    MIN_STRENGTH = 0.85  # stored (and shown by inspect / zoom); the evidence uses ≥ 1.25 (strong) and 1.0–1.25 (weak)

    def novelty(self, y16: np.ndarray, n: int) -> np.ndarray:
        import librosa

        S = np.abs(librosa.stft(y16, n_fft=self.N_FFT, hop_length=160, center=True)) ** 2
        mel = librosa.feature.melspectrogram(S=S, sr=SR_A, n_mels=self.N_MELS, fmin=self.FMIN, fmax=self.FMAX)
        M = librosa.feature.mfcc(S=librosa.power_to_db(mel), n_mfcc=self.N_MFCC + 1)[1:]
        M = M[:, :n] if M.shape[1] >= n else np.pad(M, ((0, 0), (0, n - M.shape[1])), mode='edge')
        k = self.HALF
        nov = np.zeros(n)
        if n > 2 * k + 1:
            cs = np.cumsum(np.pad(M, ((0, 0), (1, 0))), axis=1)
            t = np.arange(k, n - k)
            nov[t] = np.linalg.norm((cs[:, t + 1 + k] - cs[:, t + 1]) - (cs[:, t] - cs[:, t - k]), axis=0) / k
        return nov / self.SCALE

    def events(self, nov: np.ndarray, voiced: np.ndarray, rms_db: np.ndarray, peak: float) -> tuple[np.ndarray, np.ndarray]:
        import librosa

        n = len(nov)
        if n < 10:
            return np.zeros(0), np.zeros(0)
        times, strengths = [], []
        for p in librosa.util.peak_pick(nov, pre_max=4, post_max=4, pre_avg=1, post_avg=1, delta=0.0, wait=5):
            if nov[p] < self.MIN_STRENGTH or voiced[max(0, p - 15) : p].sum() < 3 or voiced[p + 1 : p + 11].sum() < 3:
                continue  # the voice must carry on (≥ 30 ms voiced in the 150 ms before and the 100 ms after)
            lo, hi = p, p
            while lo > 0 and not voiced[lo]:
                lo -= 1
            while hi < n - 1 and not voiced[hi]:
                hi += 1
            if (hi - lo) * HOP > 0.17 or np.median(rms_db[p : p + 10]) < peak - 35:
                continue  # a phrase break (the attack is evidence there), or the noise floor
            if np.median(rms_db[p + 3 : p + 11]) < np.median(rms_db[max(0, p - 10) : max(1, p - 2)]) - self.FADE_DB:
                continue  # the voice fading out (a note's release changes its timbre too), not a new syllable
            times.append(p * HOP)
            strengths.append(round(float(nov[p]), 3))
        return np.asarray(times), np.asarray(strengths)


@dataclass
class Analysis:
    family: str
    sr: int  # source sample rate
    dur: float
    f0a: np.ndarray  # primary tracker, MIDI (nan = unvoiced)
    f0b: np.ndarray  # pYIN, MIDI
    f0: np.ndarray  # consensus, MIDI
    conf: np.ndarray  # 0 unvoiced / 1 uncertain / 2 confident
    rms_db: np.ndarray
    flux: np.ndarray  # onset envelope, ~1 = a strong onset
    onsets: np.ndarray  # onset event times (backtracked to the energy rise)
    onset_rise: np.ndarray  # dB rise across each event
    onset_dip: np.ndarray  # dB the level dipped below BOTH neighbours (re-articulation evidence)
    level_ref_db: float  # 90th percentile level over voiced frames
    trackers: tuple[str, str] = ('swiftf0', 'pyin')
    meta: dict = field(default_factory=dict)
    # sung material only (else empty): timbre novelty (1.0 = support strength) and its events
    syl_nov: np.ndarray = field(default_factory=lambda: np.zeros(0))
    syl: np.ndarray = field(default_factory=lambda: np.zeros(0))
    syl_strength: np.ndarray = field(default_factory=lambda: np.zeros(0))

    @property
    def n(self) -> int:
        return len(self.f0)

    @property
    def t(self) -> np.ndarray:
        return np.arange(self.n) * HOP

    def frame(self, sec: float) -> int:
        return int(np.clip(round(sec / HOP), 0, max(0, self.n - 1)))

    def span(self, a: float, b: float) -> slice:
        return slice(max(0, int(math.ceil(a / HOP - 1e-6))), max(0, min(self.n, int(math.ceil(b / HOP - 1e-6)))))

    @property
    def voiced(self) -> np.ndarray:
        return self.conf >= 1

    def voicing_starts(self, min_gap: float = 0.06) -> np.ndarray:
        """Times where sound starts after at least `min_gap` of silence."""
        v = self.voiced
        k = int(round(min_gap / HOP))
        rising = np.nonzero(v & ~np.concatenate([[False], v[:-1]]))[0]
        return np.asarray([i * HOP for i in rising if i == 0 or not v[max(0, i - k) : i].any()])

    # ------------------------------------------------------------ cache
    def save(self, path: Path) -> None:
        tmp = path.with_name(path.stem + '.tmp.npz')
        meta = {'family': self.family, 'sr': self.sr, 'dur': self.dur, 'level_ref_db': self.level_ref_db, 'trackers': list(self.trackers), 'meta': self.meta}
        np.savez_compressed(tmp, f0a=self.f0a.astype(np.float32), f0b=self.f0b.astype(np.float32), f0=self.f0.astype(np.float32), conf=self.conf.astype(np.int8),
                            rms_db=self.rms_db.astype(np.float32), flux=self.flux.astype(np.float32), onsets=self.onsets, onset_rise=self.onset_rise,
                            onset_dip=self.onset_dip, syl_nov=self.syl_nov.astype(np.float32), syl=self.syl, syl_strength=self.syl_strength,
                            meta=np.frombuffer(json.dumps(meta).encode(), np.uint8))
        tmp.replace(path)

    @classmethod
    def load(cls, path: Path) -> 'Analysis':
        z = np.load(path)
        m = json.loads(bytes(z['meta']).decode())
        opt = lambda k: z[k].astype(float) if k in z.files else np.zeros(0)  # noqa: E731 (caches without the syllable channel)
        return cls(m['family'], m['sr'], m['dur'], z['f0a'].astype(float), z['f0b'].astype(float), z['f0'].astype(float), z['conf'].astype(np.int8),
                   z['rms_db'].astype(float), z['flux'].astype(float), z['onsets'], z['onset_rise'], z['onset_dip'], m['level_ref_db'], tuple(m['trackers']),
                   m.get('meta', {}), opt('syl_nov'), opt('syl'), opt('syl_strength'))


class Analyzer:
    """One configuration per clip (family + f0 range); used unchanged for original and copy."""

    LEVEL_GATE_DB = {'whistle': -32.0, 'voice': -38.0, 'instrument': -40.0}

    def __init__(self, family: str, f0_range: tuple[float, float], syllables: bool = False):
        self.family = family
        self.fmin, self.fmax = f0_range
        self.syllables = syllables and family == 'voice'

    @classmethod
    def for_clip(cls, cfg, clip: str) -> 'Analyzer':
        """The dataset's analyzer for one clip (sung material adds the syllable channel)."""
        return cls(cfg.family, cfg.f0_range_for(clip), syllables=cfg.material == 'singing')

    VERSION = 2  # bump when the analysis changes: cached orig.npz / synth.npz are recomputed

    def config(self) -> dict:
        c = {'family': self.family, 'f0_range': [self.fmin, self.fmax], 'gate_db': self.LEVEL_GATE_DB[self.family], 'version': self.VERSION}
        if self.syllables:  # its own version: whistle, humming and instrument caches stay valid
            c['syllables'] = SyllableTracker.VERSION
        return c

    def analyse(self, y: np.ndarray, sr: int) -> Analysis:
        import librosa

        y = np.asarray(y, np.float32)
        y16 = resample(y, sr, SR_A)
        n = len(y16) // 160 + 1
        rms_db = frame_rms_db(y16, n)
        if self.family == 'whistle':
            fa = SineTracker(self.fmin, self.fmax).track(y, sr, n)
            yp, spr, fl = resample(y, sr, 24000), 24000, 1024
            trackers = ('sine', 'pyin')
        else:
            fa = self._swift(y16, n)
            yp, spr, fl = y16, SR_A, 1024
            trackers = ('swiftf0', 'pyin')
        fb = self._pyin(yp, spr, fl, n)
        # level gate: bleed, room tail and noise are not the performance
        peak = float(np.percentile(rms_db, 99.5)) if n else -100.0
        quiet = rms_db < peak + self.LEVEL_GATE_DB[self.family]
        fa[quiet] = np.nan
        fb[quiet] = np.nan
        ha, hb = np.isfinite(fa), np.isfinite(fb)
        agree = ha & hb & (np.abs(fa - fb) <= 0.5)
        f0 = np.where(ha, fa, fb)
        conf = np.zeros(n, np.int8)
        conf[ha | hb] = 1
        conf[agree] = 2
        if self.family != 'whistle':
            self._octaves(y16, fa, fb, f0, conf)
        v = conf >= 1
        ref = float(np.percentile(rms_db[v], 90)) if v.sum() >= 5 else peak
        env = librosa.onset.onset_strength(y=y16, sr=SR_A, hop_length=160, lag=2, max_size=3, center=True)
        env = _fit(env, n, 0.0)
        env = np.clip(env / max(float(np.percentile(env, 98)), 1e-6), 0, 3)  # one click must not flatten the rest
        onsets, rise, dip = self._onsets(env, rms_db, peak)
        an = Analysis(self.family, sr, len(y) / sr, fa, fb, f0, conf, rms_db, env, onsets, rise, dip, ref, trackers, {'analyzer': self.config()})
        if self.syllables:
            st = SyllableTracker()
            an.syl_nov = st.novelty(y16, n)
            an.syl, an.syl_strength = st.events(an.syl_nov, conf >= 1, rms_db, peak)
        return an

    OCTAVE_RUN_VOTE = 0.3  # a run is decided when its frame votes lean this far one way
    OCTAVE_UP_RATIO = 0.08  # instruments: agreed frames whose odd harmonics are this weak are an octave up

    @staticmethod
    def _odd_even(S: np.ndarray, idx: np.ndarray, midi: np.ndarray) -> np.ndarray:
        """Energy at harmonics 1, 3, 5 of `midi` over that at 2, 4, 6, per frame in `idx`: small
        means the candidate's period is really half as long (it is an octave too low)."""
        nfft = 2 * (S.shape[0] - 1)
        hz = 440 * 2 ** ((midi - 69) / 12)
        energy = {}
        for h in range(1, 7):
            fh = hz * h
            b0 = np.clip(np.floor(fh * 0.97 * nfft / SR_A).astype(int), 0, S.shape[0] - 1)
            b1 = np.clip(np.ceil(fh * 1.03 * nfft / SR_A).astype(int), 0, S.shape[0] - 1)
            peak = np.array([S[a : b + 1, k].max() for a, b, k in zip(b0, b1, idx)])
            energy[h] = np.where(fh < 0.95 * SR_A / 2, peak, 0.0) ** 2
        return (energy[1] + energy[3] + energy[5]) / (energy[2] + energy[4] + energy[6] + 1e-12)

    def _octaves(self, y16: np.ndarray, fa: np.ndarray, fb: np.ndarray, f0: np.ndarray, conf: np.ndarray) -> None:
        """Octave errors, fixed in place by the spectrum (odd harmonics of the lower candidate).

        Where the trackers are an octave apart: if the lower candidate's odd harmonics are missing,
        the upper one is f0; if they are present, the lower one is. Decided per run of such frames
        (majority of frame votes); a decided run counts as confident. SwiftF0 reads URMP flute an
        octave low for long stretches: without this the evidence says `midi 62?` for a D5.
        Instruments only: where BOTH trackers agree on a held pitch (≥ 60 ms) whose odd harmonics
        are missing (median ratio < 0.08), the held run is moved an octave up (both trackers read some flute notes an octave low; on the
        voice calibration clips such frames are < 1.2 % and scattered, so voices are left alone)."""
        import librosa

        n = len(fa)
        octv = np.isfinite(fa) & np.isfinite(fb) & (np.abs(np.abs(fa - fb) - 12) <= 0.5)
        if not octv.any() and self.family != 'instrument':
            return
        S = np.abs(librosa.stft(y16, n_fft=2048, hop_length=160, center=True))
        inside = np.arange(n) < S.shape[1]
        idx = np.nonzero(octv & inside)[0]
        if len(idx):
            ratio = self._odd_even(S, idx, np.minimum(fa[idx], fb[idx]))
            vote = np.zeros(n)
            vote[idx] = np.where(ratio < 0.1, 1.0, np.where(ratio > 0.4, -1.0, 0.0))
            for s, e in _true_runs(octv):
                v = vote[s:e].mean()
                if abs(v) >= self.OCTAVE_RUN_VOTE:
                    f0[s:e] = np.maximum(fa[s:e], fb[s:e]) if v > 0 else np.minimum(fa[s:e], fb[s:e])
                    conf[s:e] = 2
        if self.family == 'instrument':
            idx = np.nonzero((conf == 2) & inside)[0]
            if len(idx):
                ratio = np.full(n, np.nan)
                ratio[idx] = self._odd_even(S, idx, f0[idx])
                # held runs: confident frames that stay on one pitch; decided as a whole
                held = (conf == 2) & inside
                step = np.abs(np.diff(f0, prepend=np.nan)) >= 0.5
                for s, e in _true_runs(held):
                    cuts = [s] + [k for k in range(s + 1, e) if step[k]] + [e]
                    for a, b in zip(cuts, cuts[1:]):
                        if b - a >= 6 and np.median(ratio[a:b]) < self.OCTAVE_UP_RATIO:
                            f0[a:b] += 12

    def _swift(self, y16: np.ndarray, n: int) -> np.ndarray:
        from ..qa import _detector

        x = y16 / (np.abs(y16).max() + 1e-9) * 0.5  # the tracker gates on level
        r = _detector().detect(x.astype(np.float32), SR_A, fmin=max(46.875, self.fmin), fmax=min(2093.75, self.fmax))
        ts, hz, cf = np.asarray(r.timestamps), np.asarray(r.pitch_hz), np.asarray(r.confidence)
        m = hz_to_midi(np.where(cf >= 0.7, hz, np.nan))
        if not len(ts):
            return np.full(n, np.nan)
        # onto the 10 ms grid: interpolate between voiced neighbours that agree, else nearest
        tg = np.arange(n) * HOP
        j = np.clip(np.searchsorted(ts, tg) - 1, 0, len(ts) - 1)
        k = np.clip(j + 1, 0, len(ts) - 1)
        w = np.clip((tg - ts[j]) / np.maximum(ts[k] - ts[j], 1e-9), 0, 1)
        a, b = m[j], m[k]
        lin = a + (b - a) * w
        near = np.where(w < 0.5, a, b)
        return np.where(np.isfinite(a) & np.isfinite(b) & (np.abs(a - b) < 0.5), lin, near)

    def _pyin(self, y: np.ndarray, sr: int, frame_length: int, n: int) -> np.ndarray:
        import librosa

        fmax = min(self.fmax, sr / 2 * 0.9)
        f0, vf, _ = librosa.pyin(y, fmin=self.fmin, fmax=fmax, sr=sr, frame_length=frame_length, hop_length=sr // 100, resolution=0.2, center=True)
        f0 = np.where(vf, f0, np.nan)
        return _fit(hz_to_midi(f0), n)

    @staticmethod
    def _onsets(env: np.ndarray, rms_db: np.ndarray, peak: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        import librosa

        n = len(env)
        if n < 10:
            return np.zeros(0), np.zeros(0), np.zeros(0)
        pk = librosa.util.peak_pick(env, pre_max=3, post_max=3, pre_avg=10, post_avg=10, delta=0.12, wait=5)
        times, rises, dips = [], [], []
        for k in pk:
            # backtrack to the energy minimum just before the flux peak (≤ 50 ms): the onset
            # convention is the start of the audible attack, not the flux maximum
            a = max(0, k - 5)
            b = a + int(np.argmin(rms_db[a : k + 1]))
            # sustained levels (medians), so a click or a level wobble is not an onset:
            # rise = level held 20–120 ms after vs the minimum at the event; dip = how far the
            # level fell below BOTH the held level before (150–40 ms) and after (a re-articulation)
            post = float(np.median(rms_db[min(n - 1, b + 2) : min(n, b + 12)]))
            if post < peak - 45:
                continue  # an onset in the noise floor
            lo = float(rms_db[max(0, b - 3) : b + 3].min())
            prev = float(np.median(rms_db[max(0, b - 15) : max(1, b - 4)])) if b > 4 else lo
            # the onset is where the level has made a quarter of its rise (in dB) from the minimum:
            # the minimum itself sits ~20–30 ms before where annotators hear the attack (measured
            # on vocadito, URMP and HUST truth; the quarter point is within ~±15 ms of them).
            # Without a real rise from the minimum (< 3 dB) the minimum stays the onset.
            j = b
            if post - rms_db[b] >= 3:
                while j < min(n - 1, b + 12) and rms_db[j] < rms_db[b] + 0.25 * (post - rms_db[b]):
                    j += 1
            times.append(j * HOP)
            rises.append(max(0.0, post - lo))
            dips.append(max(0.0, min(prev, post) - lo))
        return np.asarray(times), np.asarray(rises), np.asarray(dips)
