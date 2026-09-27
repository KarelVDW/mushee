"""Fetch and normalise assorted free sample libraries into assets/samples/<source>/<timbre>/.

Sources (see each Library class for licence + URL):
  philharmonia  Philharmonia Orchestra sound samples (MP3, internal use)
  sso           Sonatina Symphonic Orchestra 4.0 (CC Sampling Plus 1.0; horn-section sustains CC-BY-SA 3.0)
  freepats      FreePats bagpipe / ocarina / wooden recorder / Spanish classical guitar (CC0)
  salamander    Salamander Grand Piano V3, 6 of 16 velocity layers (CC-BY 3.0)

Every kept note is decoded to mono, trimmed (FORMAT.md), pitch-measured (SwiftF0, pYIN for
the extremes, harmonic-comb octave check) and written as 24-bit PCM WAV. Only data files are
read from the downloaded libraries (SFZ text is parsed, never executed).

    PYTHONPATH=. uv run python -m synthcorpus.fetch.fetch_misc_libs philharmonia|sso|freepats|salamander|all
    PYTHONPATH=. uv run python -m synthcorpus.fetch.fetch_misc_libs probe FILE NOMINAL_MIDI [--decaying]
"""

from __future__ import annotations

import json
import math
import os
import re
import shutil
import subprocess
import sys
import urllib.parse
import urllib.request
import zipfile
from concurrent.futures import ProcessPoolExecutor
from dataclasses import asdict, dataclass, field
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'assets' / 'samples'
TMP = Path(os.environ.get('MISC_TMP', ROOT / 'work' / 'misc-tmp'))  # downloads + extraction; safe to delete
MIN_FREE_GB = 12

NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
PC = {'c': 0, 'd': 2, 'e': 4, 'f': 5, 'g': 7, 'a': 9, 'b': 11}


def midi_hz(m: float) -> float:
    return 440.0 * 2 ** ((m - 69) / 12)


def midi_name(m: int) -> str:
    return f'{NOTE_NAMES[m % 12]}{m // 12 - 1}'


def parse_note(text: str) -> int | None:
    """'A4', 'As2' (Philharmonia sharp), 'C#5', 'a#3', 'Db3' -> MIDI (C4 = 60)."""
    m = re.fullmatch(r'([A-Ga-g])(#|s|b)?(-?\d)', text.strip())
    if not m:
        return None
    pc = PC[m.group(1).lower()] + {'#': 1, 's': 1, 'b': -1}.get(m.group(2) or '', 0)
    return pc + 12 * (int(m.group(3)) + 1)


class Disk:
    @staticmethod
    def free_gb() -> float:
        return shutil.disk_usage('/').free / 1e9

    @classmethod
    def guard(cls) -> None:
        if cls.free_gb() < MIN_FREE_GB:
            raise SystemExit(f'disk guard: only {cls.free_gb():.1f} GB free (< {MIN_FREE_GB}); stopping')


class Downloader:
    @staticmethod
    def get(url: str, dst: Path, size: int | None = None) -> Path:
        if dst.exists() and (size is None or dst.stat().st_size == size):
            return dst
        Disk.guard()
        dst.parent.mkdir(parents=True, exist_ok=True)
        part = dst.with_name(dst.name + '.part')
        subprocess.run(['curl', '-sSL', '--retry', '4', '--fail', '-o', str(part), url], check=True)
        part.rename(dst)
        return dst


# ------------------------------------------------------------------ measurement


@dataclass
class PitchReading:
    ok: bool
    root: float | None = None
    cents: float | None = None  # measured minus nominal pitch class (folded), cents
    octave: int = 0  # measured octave minus labelled octave
    spread: float | None = None  # IQR of per-frame folded cents
    voiced: float | None = None
    tracker: str = ''
    comb: str = ''
    reason: str = ''


class PitchMeter:
    """Median f0 over the steady part, folded onto the label's pitch class; the octave comes
    from the tracker and is cross-checked on the spectrum (odd sub-harmonic series test)."""

    SWIFT_LO, SWIFT_HI = 52.0, 1800.0

    def __init__(self):
        self._swift = None

    def _detector(self):
        if self._swift is None:
            from swift_f0 import SwiftF0

            self._swift = SwiftF0(threads=1, spin=False)
        return self._swift

    @staticmethod
    def envelope(x: np.ndarray, sr: int, win: float = 0.02, hop: float = 0.01) -> tuple[np.ndarray, int]:
        h = max(1, int(hop * sr))
        w = max(h, int(win * sr))
        n = max(1, 1 + (len(x) - w) // h)
        idx = np.arange(w)[None, :] + h * np.arange(n)[:, None]
        idx = np.minimum(idx, len(x) - 1)
        rms = np.sqrt(np.mean(x[idx] ** 2, axis=1) + 1e-20)
        return 20 * np.log10(rms), h

    def steady_window(self, x: np.ndarray, sr: int, decaying: bool) -> tuple[int, int]:
        env, h = self.envelope(x, sr)
        peak = env.max()
        act = np.flatnonzero(env >= peak - (35 if decaying else 20))
        a, b = int(act[0]) * h, int(act[-1]) * h + int(0.02 * sr)
        if decaying:
            return min(len(x), a + int(0.06 * sr)), min(b, a + int(1.5 * sr))
        L = b - a
        s0, s1 = a + max(int(0.08 * sr), int(0.15 * L)), b - int(0.1 * L)
        if s1 - s0 < int(0.1 * sr):
            s0, s1 = a + int(0.03 * sr), b
        if s1 - s0 > int(2.5 * sr):  # middle 2.5 s is plenty
            c = (s0 + s1) // 2
            s0, s1 = c - int(1.25 * sr), c + int(1.25 * sr)
        return s0, min(s1, len(x))

    def track(self, seg: np.ndarray, sr: int, f_nom: float) -> tuple[np.ndarray, int, str]:
        """Confident per-frame f0 (Hz) and the number of frames examined."""
        if self.SWIFT_LO <= f_nom <= self.SWIFT_HI:
            y = seg.astype(np.float32)
            y = y / (np.abs(y).max() + 1e-9) * 0.5
            if sr != 16000:
                g = math.gcd(sr, 16000)
                y = resample_poly(y, 16000 // g, sr // g).astype(np.float32)
            if len(y) < 1024:
                y = np.pad(y, (0, 1024 - len(y)))
            r = self._detector().detect(y, 16000)
            hz, cf = np.asarray(r.pitch_hz), np.asarray(r.confidence)
            good = (cf >= 0.6) & (hz > 0)
            return hz[good], len(hz), 'swiftf0'
        import librosa

        fmin = max(16.0, f_nom / 2.1)
        fmax = min(f_nom * 2.1, sr / 2.3)
        fl = int(min(8192, max(1024, 2 ** math.ceil(math.log2(4.4 * sr / fmin)))))
        y = seg[: int(1.6 * sr)]
        if len(y) < fl + 1:
            y = np.pad(y, (0, fl + 1 - len(y)))
        f0, vflag, vprob = librosa.pyin(y, fmin=fmin, fmax=fmax, sr=sr, frame_length=fl, hop_length=fl // 4, center=False, resolution=0.02)
        good = np.isfinite(f0) & (vprob > 0.25)
        return f0[good], len(f0), 'pyin'

    def harmonic_track(self, seg: np.ndarray, sr: int, f_nom: float, parts: int = 4) -> tuple[np.ndarray, int, str]:
        """Fallback for the deep bass (tracker unvoiced): harmonic-sum f0 search within +-70 cents of
        the label's pitch class, on `parts` sub-windows. Octave is left to the comb check."""
        n = len(seg) // parts
        out = []
        grid = f_nom * 2 ** (np.arange(-70, 71) / 1200)
        for i in range(parts):
            X, df = self.spectrum(seg[i * n : (i + 1) * n], sr)
            A = np.sqrt(X)
            best, bf = -1.0, None
            for f in grid:
                s = 0.0
                for k in range(1, 11):
                    q = k * f
                    if q > 0.45 * sr:
                        break
                    lo, hi = int(q * 0.997 / df), int(math.ceil(q * 1.003 / df))
                    s += A[lo : hi + 1].max() if hi >= lo else 0.0
                if s > best:
                    best, bf = s, f
            if bf is not None:
                out.append(bf)
        return np.asarray(out), parts, 'harmonic-sum'

    # --- harmonic comb octave check
    @staticmethod
    def spectrum(seg: np.ndarray, sr: int) -> tuple[np.ndarray, float]:
        seg = seg[: int(2.0 * sr)]
        n = len(seg)
        nfft = 1 << (int(math.ceil(math.log2(max(n, 256)))) + 1)
        X = np.abs(np.fft.rfft(seg * np.hanning(n), nfft))
        return X, sr / nfft

    @staticmethod
    def _peak(X: np.ndarray, df: float, q: float, tol: float) -> tuple[float, float]:
        """(level dB, prominence dB over the local median) of the strongest bin near q."""
        lo = max(0, min(int(q * (1 - tol) / df), int(q / df) - 2))
        hi = min(len(X) - 1, max(int(math.ceil(q * (1 + tol) / df)), int(q / df) + 2))
        pk = X[lo : hi + 1].max()
        flo = max(0, min(int(q * 0.8 / df), int(q / df) - 10))
        fhi = min(len(X) - 1, max(int(q * 1.2 / df), int(q / df) + 10))
        floor = np.median(X[flo : fhi + 1]) + 1e-12
        return 20 * math.log10(pk + 1e-12), 20 * math.log10((pk + 1e-12) / floor)

    def _present(self, X, df, sr, qs, ref_db, tol) -> tuple[int, int, list]:
        """(hits, examined, levels of the hits) for spectral peaks at the frequencies qs."""
        n = hits = 0
        lv = []
        for q in qs:
            if q < 25 or q > min(0.45 * sr, 14000):
                continue
            lvl, prom = self._peak(X, df, q, tol)
            n += 1
            if prom >= 10 and lvl >= ref_db - 45:
                hits += 1
                lv.append(lvl)
        return hits, n, lv

    def octave_shift(self, seg: np.ndarray, sr: int, f: float, inharmonic: bool) -> tuple[int, str]:
        """Spectral check of the tracker's octave f, by levels of the partial series:
        -1 when the odd sub-harmonic series of f/2 is present and about as loud as f's own
        harmonics (a real lower fundamental, not a sympathetic string or breath noise);
        +1 when f's odd harmonics are >= 20 dB weaker than its even ones (f is a sub-harmonic)."""
        X, df = self.spectrum(seg, sr)
        tol = 0.025 if inharmonic else 0.012
        lim = min(0.45 * sr, 14000)

        def lv(mults):
            qs = [m * f for m in mults if 25 <= m * f <= lim]
            return [self._peak(X, df, q, tol)[0] for q in qs]

        ref = max(lv(range(1, 9)))
        hits, n, _ = self._present(X, df, sr, [f * (j + 0.5) for j in (1, 2, 3, 4)], ref, tol)
        half, whole = lv((1.5, 2.5, 3.5, 4.5)), lv((1, 2, 3, 4))
        d_half = float(np.mean(half) - np.mean(whole)) if half and whole else -99.0
        odd, even = lv((1, 3, 5, 7)), lv((2, 4, 6, 8))
        d_odd = float(np.mean(odd) - np.mean(even)) if len(odd) >= 2 and len(even) >= 2 else 0.0
        log = f'half@{f:.1f}:{hits}/{n}({d_half:+.0f}dB) odd-even:{d_odd:+.0f}dB'
        if n >= 3 and hits >= 3 and d_half >= -15:
            return -1, log
        if d_odd <= -20:
            return 1, log
        return 0, log

    def octave_vote(self, seg: np.ndarray, sr: int, f_nom: float, not_method: str) -> int | None:
        """Independent tracker's majority octave vs the label (second opinion for a relabel)."""
        if not_method != 'swiftf0' and self.SWIFT_LO <= f_nom / 2 and f_nom * 2 <= 2000:
            hz, _, _ = self.track(seg, sr, f_nom)
        else:
            import librosa

            fmin, fmax = max(16.0, f_nom / 2.5), min(f_nom * 2.5, sr / 2.3)
            fl = int(min(8192, max(1024, 2 ** math.ceil(math.log2(4.4 * sr / fmin)))))
            y = seg[: int(1.6 * sr)]
            if len(y) < fl + 1:
                return None
            f0, _, vp = librosa.pyin(y, fmin=fmin, fmax=fmax, sr=sr, frame_length=fl, hop_length=fl // 4, center=False)
            hz = f0[np.isfinite(f0) & (vp > 0.25)]
        if len(hz) < 3:
            return None
        o = np.round(np.log2(hz / f_nom)).astype(int)
        vals, cnt = np.unique(o, return_counts=True)
        return int(vals[np.argmax(cnt)]) if cnt.max() >= 0.6 * len(o) else None

    def measure(self, x: np.ndarray, sr: int, nominal: int, decaying: bool = False, inharmonic: bool = False, vib: bool = False) -> PitchReading:
        f_nom = midi_hz(nominal)
        if len(x) < int(0.08 * sr) or np.abs(x).max() < 1e-5:
            return PitchReading(False, reason='too short / silent')
        s0, s1 = self.steady_window(x, sr, decaying)
        seg = x[s0:s1]
        if len(seg) < int(0.06 * sr):
            return PitchReading(False, reason='no steady part')
        hz, total, trk = self.track(seg, sr, f_nom)
        if trk == 'pyin' and (total == 0 or len(hz) / total < 0.4) and len(seg) >= int(0.3 * sr):
            hz, total, trk = self.harmonic_track(seg, sr, f_nom)
        if total == 0 or len(hz) < 3:
            return PitchReading(False, voiced=0.0, tracker=trk, reason='unvoiced')
        voiced = len(hz) / total
        c = 1200 * np.log2(hz / f_nom)
        fold = (c + 600) % 1200 - 600
        octs = np.round((c - fold) / 1200).astype(int)
        med = float(np.median(fold))
        q1, q3 = np.percentile(fold, [25, 75])
        spread = float(q3 - q1)
        vals, cnt = np.unique(octs, return_counts=True)
        k_trk = int(vals[np.argmax(cnt)])
        base = PitchReading(False, cents=round(med, 1), spread=round(spread, 1), voiced=round(voiced, 3), tracker=trk)
        if voiced < 0.4:
            base.reason = f'voiced {voiced:.2f}'
            return base
        if spread > (90 if vib else 60):
            base.reason = f'unstable pitch (IQR {spread:.0f} c)'
            return base
        if abs(med) > 60:
            base.reason = f'{med:+.0f} c from label'
            return base
        f = f_nom * 2 ** (med / 1200) * 2.0**k_trk
        if trk == 'harmonic-sum':  # the search always returns a maximum: demand real partials there
            X, df = self.spectrum(seg, sr)
            ref = max(self._peak(X, df, k * f, 0.012)[0] for k in range(1, 6) if k * f < 0.45 * sr)
            hits, n, _ = self._present(X, df, sr, [f, 2 * f, 3 * f], ref, 0.012)
            if hits < min(2, n):
                base.reason = f'no clear partials ({hits}/{n})'
                return base
        shift, log = 0, 'short: tracker only'
        if len(seg) >= int(0.12 * sr):
            logs = []
            for _ in range(3):  # the tracker can sit 2 octaves up on a formant partial
                step, lg = self.octave_shift(seg, sr, f * 2.0**shift, inharmonic)
                logs.append(lg)
                shift += step
                if step >= 0:
                    break
            log = ' | '.join(logs)
        k = k_trk + shift
        base.comb = f'trk{k_trk:+d} {log}'
        base.octave = k
        if abs(k) > 1:
            base.reason = f'octave off by {k}'
            return base
        if k != 0:  # a relabel needs enough signal and an independent second opinion
            low = f_nom * 2.0 ** min(k, 0) < 60
            if len(seg) < int((0.4 if low else 0.25) * sr):
                base.reason = f'octave relabel (k={k}) on too short a note'
                return base
            vote = self.octave_vote(seg, sr, f_nom, trk)
            base.comb += f' vote:{vote}'
            if vote == 0 and k_trk == 0:  # both trackers hear the label; the comb alone disagrees
                k = base.octave = 0
            elif vote != k:
                base.reason = f'octave ambiguous (k={k}, vote={vote})'
                return base
        base.ok = True
        base.root = round(nominal + med / 100 + 12 * k, 3)
        return base


# ------------------------------------------------------------------ editing


class NoteEditor:
    """Trim to ~10 ms before the onset and to where the release has decayed below -60 dB (or into
    the noise floor, whichever is higher); 2 ms guard fade at the trimmed start only."""

    @staticmethod
    def trim(x: np.ndarray, sr: int, keep: list | None = None) -> tuple[np.ndarray, int, int]:
        """`keep` = a library sustain loop [start, end] that must survive the trim."""
        env, h = PitchMeter.envelope(x, sr, win=0.004, hop=0.002)
        peak = env.max()
        # noise floor: quietest of the edges / 5th percentile, never above peak-40 dB (a file
        # that is all tone has no silence to measure)
        floor = min(float(np.percentile(env, 5)), float(env[:5].min()), float(env[-25:].min()), peak - 40)
        on_thr = max(peak - 45, floor + 10)
        onset = int(np.argmax(env >= on_thr)) * h
        start = max(0, onset - int(0.01 * sr))
        sm = np.convolve(env, np.ones(5) / 5, mode='same')
        off_thr = max(peak - 60, floor + 3)
        above = np.flatnonzero(sm >= off_thr)
        end = min(len(x), int(above[-1]) * h + int(0.004 * sr)) if len(above) else len(x)
        if keep and 0 <= keep[0] < keep[1] <= len(x):
            start, end = min(start, int(keep[0])), max(end, min(len(x), int(keep[1]) + 1))
        y = x[start:end].copy()
        g = min(len(y), int(0.002 * sr))
        if g > 1:  # also when the library file itself starts on the attack
            y[:g] *= np.linspace(0, 1, g)
        return y, start, end


# ------------------------------------------------------------------ sets


@dataclass
class Take:
    """One source recording (or an aligned sum of several, `mix`) to normalise into one zone."""

    src: str
    nominal: int
    out: str  # file name inside notes/
    art: str = 'sus'
    dyn: str | None = None
    rr: int = 0
    gain_db: float = 0.0
    vel: list | None = None
    loop: list | None = None  # [start, end] frames of the SOURCE file
    decaying: bool = False
    inharmonic: bool = False
    mix: list | None = None  # [(path, gain_db), ...] summed with onsets aligned
    extra: dict = field(default_factory=dict)


class AudioSource:
    @staticmethod
    def load(path: str) -> tuple[np.ndarray, int]:
        try:
            x, sr = sf.read(path, dtype='float64', always_2d=True)
        except Exception:
            tmp = TMP / 'decode' / (re.sub(r'\W+', '_', path)[-120:] + '.wav')
            tmp.parent.mkdir(parents=True, exist_ok=True)
            subprocess.run(['afconvert', '-f', 'WAVE', '-d', 'LEF32', path, str(tmp)], check=True, capture_output=True)
            x, sr = sf.read(str(tmp), dtype='float64', always_2d=True)
            tmp.unlink()
        # MISC_MONO=left keeps one channel: folding a spaced-pair stereo recording to
        # mono comb-filters it, and the notches sweep with vibrato into deep AM
        if x.shape[1] > 1 and os.environ.get('MISC_MONO') == 'left':
            return x[:, 0], sr
        return x.mean(axis=1), sr

    @classmethod
    def for_take(cls, t: Take) -> tuple[np.ndarray, int]:
        if not t.mix:
            x, sr = cls.load(t.src)
            return x * 10 ** (t.gain_db / 20), sr
        parts, sr0 = [], None
        for path, g in t.mix:
            x, sr = cls.load(path)
            if sr0 is None:
                sr0 = sr
            elif sr != sr0:
                gg = math.gcd(sr, sr0)
                x = resample_poly(x, sr0 // gg, sr // gg)
            _, s, _ = NoteEditor.trim(x, sr0)
            parts.append(x[s:] * 10 ** (g / 20))
        n = max(len(p) for p in parts)
        y = np.zeros(n)
        for p in parts:
            y[: len(p)] += p
        return y * 10 ** (t.gain_db / 20), sr0


_METER: PitchMeter | None = None


def _process(args: tuple[Take, str]) -> dict:
    global _METER
    if _METER is None:
        _METER = PitchMeter()
    t, notes_dir = args
    try:
        x, sr = AudioSource.for_take(t)
    except Exception as e:  # noqa: BLE001
        return {'take': asdict(t), 'reject': f'decode failed: {e}'}
    y, start, end = NoteEditor.trim(x, sr, None if t.mix else t.loop)
    r = _METER.measure(y, sr, t.nominal, t.decaying, t.inharmonic, vib=t.art in ('vib', 'trem'))
    res = {'take': asdict(t), 'reading': asdict(r), 'sr': sr, 'peak': float(np.abs(y).max()) if len(y) else 0.0}
    if not r.ok:
        res['reject'] = r.reason
        return res
    if sr not in (44100, 48000):
        g = math.gcd(sr, 48000)
        y = resample_poly(y, 48000 // g, sr // g)
        sr = 48000
    tmp = Path(notes_dir) / (t.out + '.tmp.wav')
    sf.write(str(tmp), y.astype(np.float32), sr, subtype='FLOAT')  # rescaled + converted in finish()
    zone = {'file': f'notes/{t.out}', 'root': r.root, 'nominal': t.nominal}
    if t.dyn:
        zone['dyn'] = t.dyn
    zone['art'] = t.art
    zone['rr'] = t.rr
    loop = None
    if t.loop and not t.mix:
        ls, le = t.loop[0] - start, t.loop[1] - start
        if 0 <= ls < le <= len(y):
            loop = [int(ls), int(le)]
    zone['loop'] = loop
    if t.vel:
        zone['vel'] = t.vel
    zone.update(t.extra)
    res['zone'] = zone
    res['tmp'] = str(tmp)
    return res


class SampleSetBuilder:
    """Collects Takes for one (source, timbre) and writes zones.json + notes/*.wav."""

    def __init__(self, source: str, timbre: str, meta: dict):
        self.source = source
        self.timbre = timbre
        self.meta = meta
        self.takes: list[Take] = []
        self.dir = OUT / source / timbre

    def add(self, t: Take) -> None:
        self.takes.append(t)

    def build(self, workers: int = 8) -> dict:
        Disk.guard()
        notes = self.dir / 'notes'
        if notes.exists():
            shutil.rmtree(notes)
        notes.mkdir(parents=True)
        with ProcessPoolExecutor(max_workers=workers) as ex:
            results = list(ex.map(_process, [(t, str(notes)) for t in self.takes], chunksize=4))
        kept = [r for r in results if 'zone' in r]
        rejected = [r for r in results if 'reject' in r]
        # one common gain for the whole set only if something would clip (keeps relative levels)
        peak = max((r['peak'] for r in kept), default=0.0)
        common = 1.0 if peak <= 0.999 else 0.999 / peak
        # file name + round-robin index follow the MEASURED note (an octave relabel can land on
        # a note that already has takes); the library's own take index orders the rr
        groups: dict[tuple, list] = {}
        for r in kept:
            z = r['zone']
            groups.setdefault((z['art'], z.get('dyn') or 'na', int(round(z['root']))), []).append(r)
        zones = []
        for (art, dyn, note), rs in groups.items():
            rs.sort(key=lambda r: (r['take']['rr'], r['take']['out']))
            for rr, r in enumerate(rs):
                y, sr = sf.read(r['tmp'], dtype='float64')
                Path(r['tmp']).unlink()
                name = f'{art}_{dyn}_{midi_name(note).replace("#", "s")}_rr{rr}.wav'
                sf.write(str(notes / name), y * common, sr, subtype='PCM_24')
                r['zone'].update(file=f'notes/{name}', rr=rr)
                zones.append(r['zone'])
        zones.sort(key=lambda z: (z['art'], z['root'], z.get('dyn', ''), z['rr']))
        relabels = [f"{z.get('orig', Path(z['file']).name)}: label {midi_name(z['nominal'])} -> measured {z['root']:.2f}" for z in zones if abs(z['root'] - z['nominal']) > 6]
        rej = [f"{Path(r['take']['src']).name if not r['take']['mix'] else r['take']['out']}: {r['reject']}" for r in rejected]
        note = self.meta.get('notes', '')
        note += f' Kept {len(zones)}/{len(results)} takes. File names and rr follow the measured note; `nominal` keeps the library label and `orig` the source file.'
        if common != 1.0:
            note += f' Whole set scaled by {20 * math.log10(common):+.2f} dB to avoid clipping (relative levels kept).'
        if relabels:
            note += ' Octave label fixes from measurement: ' + '; '.join(relabels) + '.'
        doc = {
            'name': f'{self.source}-{self.timbre}',
            'timbre': self.timbre,
            **{k: v for k, v in self.meta.items() if k != 'notes'},
            'notes': note.strip(),
            'rejected': rej,
            'zones': zones,
        }
        (self.dir / 'zones.json').write_text(json.dumps(doc, indent=1))
        size = sum(p.stat().st_size for p in notes.glob('*.wav')) / 1e6
        roots = [z['root'] for z in zones if z['art'] not in ('fx', 'rel')] or [0]
        summary = {
            'set': f'{self.source}/{self.timbre}',
            'zones': len(zones),
            'rejected': len(rejected),
            'range': f'{midi_name(int(round(min(roots))))}-{midi_name(int(round(max(roots))))}',
            'dyns': sorted({z.get('dyn') for z in zones if z.get('dyn')}, key=lambda d: DYNS.index(d)),
            'arts': sorted({z['art'] for z in zones}),
            'mb': round(size, 1),
            'relabels': len(relabels),
        }
        print(json.dumps(summary), flush=True)
        return summary


DYNS = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff']


# ------------------------------------------------------------------ SFZ helpers


class SfzText:
    """Expand #include / #define so synthcorpus.samples.SfzLoader can parse a library file."""

    @staticmethod
    def expand(path: Path, base: Path | None = None, defines: dict | None = None) -> str:
        base = base or path.parent
        defines = {} if defines is None else defines
        out = []
        for line in path.read_text(errors='ignore').splitlines():
            m = re.match(r'\s*#define\s+(\$\w+)\s+(\S+)', line)
            if m:
                defines[m.group(1)] = m.group(2)
                continue
            for k, v in sorted(defines.items(), key=lambda kv: -len(kv[0])):
                line = line.replace(k, v)
            m = re.match(r'\s*#include\s+"([^"]+)"', line)
            if m:
                out.append(SfzText.expand(base / m.group(1), base, defines))
                continue
            out.append(line)
        return '\n'.join(out)

    @classmethod
    def regions(cls, path: Path) -> list:
        from synthcorpus.samples import SfzLoader

        flat = path.with_name('_flat_' + path.name)
        flat.write_text(cls.expand(path))
        zones = SfzLoader(flat).load(path.stem).zones
        flat.unlink()
        return zones

    @staticmethod
    def raw_regions(text: str) -> list[dict]:
        """Region opcode dicts (group opcodes merged), for sample names before files exist."""
        text = re.sub(r'//.*', '', text)
        regions, group, cur, level = [], {}, None, None
        for tok in re.finditer(r'<(\w+)>|(\w+)=((?:(?!\s\w+=|<).)*)', text, re.S):
            if tok.group(1):
                if cur is not None:
                    regions.append({**group, **cur})
                    cur = None
                level = tok.group(1)
                if level == 'group':
                    group = {}
                elif level == 'region':
                    cur = {}
                continue
            k, v = tok.group(2), tok.group(3).strip()
            if level == 'region' and cur is not None:
                cur[k] = v
            elif level == 'group':
                group[k] = v
        if cur is not None:
            regions.append({**group, **cur})
        return regions


# ------------------------------------------------------------------ libraries


class PhilharmoniaLibrary:
    URL = 'https://philharmonia-assets.s3-eu-west-1.amazonaws.com/uploads/2020/02/12112005/all-samples.zip'
    META = {
        'source': 'Philharmonia Orchestra sound samples',
        'url': 'https://philharmonia.co.uk/resources/sound-samples/',
        'licence': 'Philharmonia Orchestra free sound samples: free to use in your own work, may not be sold or redistributed as samples (internal use OK)',
    }
    INSTR = {
        'cor anglais': 'english-horn', 'contrabassoon': 'contrabassoon', 'bass clarinet': 'bass-clarinet',
        'saxophone': 'alto-sax',  # measured sounding range D#3-G6 (Db3-Ab5 + altissimo) = Eb alto
        'french horn': 'french-horn', 'trombone': 'trombone', 'tuba': 'tuba',
        'bassoon': 'bassoon', 'oboe': 'oboe', 'clarinet': 'clarinet', 'flute': 'flute', 'double bass': 'double-bass',
        'cello': 'cello', 'viola': 'viola', 'violin': 'violin', 'trumpet': 'trumpet',
    }
    DYN = {'molto-pianissimo': 'ppp', 'pianissimo': 'pp', 'piano': 'p', 'mezzo-piano': 'mp', 'mezzo-forte': 'mf', 'forte': 'f', 'fortissimo': 'ff'}
    ART = {
        'normal': 'sus', 'arco-normal': 'sus', 'non-vibrato': 'nonvib', 'molto-vibrato': 'vib', 'vibrato': 'vib',
        'mute': 'mute', 'con-sord': 'mute', 'pizz-normal': 'pizz', 'arco-tremolo': 'trem',
        'staccato': 'stac', 'staccatissimo': 'stac', 'arco-staccato': 'stac', 'arco-spiccato': 'stac',
    }
    LONG = ['very-long', 'long', '15', '1']
    DUR_ORDER = ['very-long', 'long', '15', '1', '05', '025']

    def __init__(self):
        self.tmp = TMP / 'phil'

    def fetch(self) -> Path:
        x = self.tmp / 'all-samples' / 'x'
        if x.exists() and any(x.iterdir()):
            return x
        z = Downloader.get(self.URL, self.tmp / 'all-samples.zip')
        with zipfile.ZipFile(z) as outer:
            for n in outer.namelist():
                if n.startswith('__MACOSX') or not n.endswith('.zip'):
                    continue
                inst = Path(n).stem
                if inst not in self.INSTR:
                    continue
                inner = self.tmp / Path(n).name
                inner.write_bytes(outer.read(n))
                with zipfile.ZipFile(inner) as zz:
                    for m in zz.namelist():
                        if m.endswith('.mp3') and not m.startswith('__MACOSX'):
                            (x / inst).mkdir(parents=True, exist_ok=True)
                            (x / inst / Path(m).name).write_bytes(zz.read(m))
                inner.unlink()
        z.unlink()
        return x

    def classify(self, fname: str) -> tuple | None:
        parts = fname[:-4].split('_')
        if len(parts) != 5:
            return None
        _, note, dur, dyn, art = parts
        midi = parse_note(note)
        if midi is None or dyn not in self.DYN or dur == 'phrase':
            return None
        a = self.ART.get(art)
        if a is None:
            return None
        if a == 'sus' and dur == '025':
            a = 'stac'
        elif a in ('sus', 'vib', 'nonvib', 'mute', 'trem') and dur not in self.LONG:
            return None
        return midi, self.DYN[dyn], a, dur, art

    def build(self, only: set[str] | None = None) -> list[dict]:
        x = self.fetch()
        out = []
        for inst, timbre in self.INSTR.items():
            if only and timbre not in only:
                continue
            files = sorted((x / inst).glob('*.mp3'))
            groups: dict[tuple, list] = {}
            for p in files:
                c = self.classify(p.name)
                if c is None:
                    continue
                midi, dyn, art, dur, raw_art = c
                groups.setdefault((midi, dyn, art), []).append((self.DUR_ORDER.index(dur), p, dur, raw_art))
            b = SampleSetBuilder('philharmonia', timbre, {
                **self.META,
                'notes': (f'Philharmonia "{inst}" MP3s (44.1 kHz), decoded to mono 24-bit WAV. Kept normal/arco-normal notes with '
                          'duration codes 1/15/long/very-long as sus (rr = takes of different lengths at the measured note, longest first), '
                          'normal 025 + staccato/staccatissimo/spiccato as stac, non-vibrato/molto-vibrato/vibrato as nonvib/vib, '
                          'mute/con-sord as mute, pizz-normal as pizz, arco-tremolo as trem; crescendo/phrase/trill/other takes dropped. '
                          'Zone field "take" = Philharmonia duration code. MP3 = lossy source.'
                          + (' Philharmonia just says "saxophone": the measured sounding range (D#3-G6) is an Eb alto.' if timbre == 'alto-sax' else '')),
            })
            for (midi, dyn, art), lst in groups.items():
                lst.sort(key=lambda e: (e[0], e[1].name))
                for rr, (_, p, dur, raw_art) in enumerate(lst):
                    b.add(Take(str(p), midi, f'{art}_{dyn}_{midi_name(midi).replace("#", "s")}_rr{rr}.wav', art=art, dyn=dyn, rr=rr,
                               decaying=art == 'pizz', extra={'take': dur, 'orig': p.name}))
            out.append(b.build())
        return out


class SonatinaLibrary:
    RAW = 'https://raw.githubusercontent.com/peastman/sso/v4.0/'
    META = {
        'source': 'Sonatina Symphonic Orchestra 4.0 (Mattias Westlund; maintained by Peter Eastman)',
        'url': 'https://github.com/peastman/sso (tag v4.0)',
        'licence': 'Creative Commons Sampling Plus 1.0 (https://creativecommons.org/licenses/sampling+/1.0/)',
    }
    HORN_SUS_LICENCE = 'CC-BY-SA 3.0 (horn-section sustain samples, Mattias Westlund; Samples/Horns/license.txt); staccato samples CC Sampling Plus 1.0'
    BASE = 'Sonatina Symphonic Orchestra'
    SETS = {
        # timbre: [(sfz relative to BASE, art, dyn, gain from group)]
        'trumpet-section': [('Brass - Notation/Trumpets Sustain.sfz', 'sus', None), ('Brass - Notation/Trumpets Staccato.sfz', 'stac', None)],
        'horn-section': [('Brass - Notation/includes/horns-sustain-mp.sfz', 'sus', 'mp'), ('Brass - Notation/includes/horns-sustain-ff.sfz', 'sus', 'ff'),
                         ('Brass - Notation/Horns Staccato.sfz', 'stac', None)],
        'trombone-section': [('Brass - Notation/Trombones Sustain.sfz', 'sus', None), ('Brass - Notation/Trombones Staccato.sfz', 'stac', None)],
        'alto-flute': [('Woodwinds - Notation/Alto Flute Solo Sustain.sfz', 'sus', None)],
        'piccolo': [('Woodwinds - Notation/Piccolo Solo Sustain.sfz', 'sus', None)],
        'english-horn': [('Woodwinds - Notation/Cor Anglais Solo Sustain.sfz', 'sus', None)],
        'contrabassoon': [('Woodwinds - Notation/Contrabassoon Solo Sustain.sfz', 'sus', None)],
        'bass-clarinet': [('Woodwinds - Notation/Bass Clarinet Solo Sustain.sfz', 'sus', None)],
        'clarinet-section': [('Woodwinds - Notation/Clarinets Sustain.sfz', 'sus', None)],
    }
    # "All Brass Sustain" in SSO is a layer of these sections (no separate recording)
    ALL_BRASS = [('Brass - Notation/Trumpets Sustain.sfz', 0.0), ('Brass - Notation/includes/horns-sustain-ff.sfz', 0.0),
                 ('Brass - Notation/Trombones Sustain.sfz', 0.0), ('Brass - Notation/Bass Trombone Solo Sustain.sfz', 0.0),
                 ('Brass - Notation/Tuba Sustain.sfz', 0.0)]
    ALL_BRASS_MASTER_DB = -5.0

    def __init__(self):
        self.tmp = TMP / 'sso'

    def ensure_sfz(self, rel: str) -> Path:
        """Download an SFZ and, recursively, its includes (resolved against the notation folder)."""
        p = self.tmp / self.BASE / rel
        Downloader.get(self.RAW + urllib.parse.quote(f'{self.BASE}/{rel}'), p)
        nd = Path(rel).parts[0]
        for inc in re.findall(r'#include\s+"([^"]+)"', p.read_text(errors='ignore')):
            self.ensure_sfz(f'{nd}/{inc}')
        return p

    _tree: dict | None = None

    def case_fix(self, rel: str) -> tuple[str, int | None]:
        """The SFZs sometimes spell folder names in another case; the git repo is case-sensitive."""
        if self._tree is None:
            with urllib.request.urlopen('https://api.github.com/repos/peastman/sso/git/trees/v4.0?recursive=1') as r:
                t = json.load(r)['tree']
            self._tree = {e['path'].lower(): (e['path'], e.get('size')) for e in t if e['type'] == 'blob'}
        path, size = self._tree[f'{self.BASE}/{rel}'.lower()]
        return path[len(self.BASE) + 1 :], size

    def zones_of(self, rel: str):
        from synthcorpus.samples import SfzLoader

        main = self.ensure_sfz(rel)
        nd_rel = Path(rel).parts[0]
        nd = self.tmp / self.BASE / nd_rel
        text = SfzText.expand(main, base=nd)
        for r in SfzText.raw_regions(text):
            s = r.get('sample', '').replace('\\', '/')
            if s:
                remote, size = self.case_fix(os.path.normpath(os.path.join(nd_rel, s)))
                Downloader.get(self.RAW + urllib.parse.quote(f'{self.BASE}/{remote}'), self.tmp / self.BASE / remote, size)
        flat = nd / ('_flat_' + Path(rel).name)
        flat.write_text(text)
        zs = SfzLoader(flat).load(Path(rel).stem).zones
        flat.unlink()
        return zs

    def build(self, only: set[str] | None = None) -> list[dict]:
        out = []
        for timbre, specs in self.SETS.items():
            if only and timbre not in only:
                continue
            meta = dict(self.META)
            if timbre == 'horn-section':
                meta['licence'] = self.HORN_SUS_LICENCE
            meta['notes'] = ('SSO 4.0 non-looped samples (Samples/), mono-mixed from stereo, 24-bit. The SFZ region volume= '
                             'offsets are baked into the audio (library level balancing). Nominal = SFZ pitch_keycenter '
                             '(incl. transpose); velocity in SSO drives a filter, so single-layer sets carry no dyn.')
            b = SampleSetBuilder('sso', timbre, meta)
            seen = set()
            for rel, art, dyn in specs:
                for z in self.zones_of(rel):
                    if (str(z.source), art) in seen:
                        continue
                    seen.add((str(z.source), art))
                    nom = int(round(z.root))
                    b.add(Take(str(z.source), nom, f'{art}_{dyn or "na"}_{midi_name(nom).replace("#", "s")}_rr{z.rr}.wav', art=art, dyn=dyn,
                               rr=z.rr, gain_db=z.gain_db, extra={'orig': z.source.name}))
            out.append(b.build())
        if not only or 'brass-section-all' in only:
            out.append(self.build_all_brass())
        return out

    def build_all_brass(self) -> dict:
        by_key: dict[int, list] = {}
        for rel, g in self.ALL_BRASS:
            for z in self.zones_of(rel):
                # only exact sample roots join the unison mix (no resampling of any layer)
                if z.key_low <= round(z.root) <= z.key_high:
                    by_key.setdefault(int(round(z.root)), []).append((str(z.source), z.gain_db + g + self.ALL_BRASS_MASTER_DB, Path(rel).stem))
        b = SampleSetBuilder('sso', 'brass-section-all', {
            **self.META,
            'licence': self.META['licence'] + '; horn layer CC-BY-SA 3.0',
            'notes': ('SSO has no separate all-brass recording: "All Brass Sustain.sfz" layers Trumpets, Horns (ff), Trombones, '
                      'Bass Trombone and Tuba sustains. Each zone here is that unison layer rendered offline: every section whose '
                      'sample root equals the key is summed with onsets aligned, SFZ volume offsets + master_volume -5 dB applied, '
                      'no pitch shifting. Zone field "layers" lists the sections.'),
        })
        for key, parts in sorted(by_key.items()):
            if len(parts) < 2:
                continue
            b.add(Take(parts[0][0], key, f'sus_na_{midi_name(key).replace("#", "s")}_rr0.wav', art='sus', mix=[(p, g) for p, g, _ in parts],
                       extra={'layers': [s for _, _, s in parts]}))
        return b.build()


class FreePatsLibrary:
    META = {'licence': 'CC0 1.0 (public domain dedication)'}
    SETS = {
        'bagpipe': ('https://github.com/freepats/bagpipe/releases/download/2026-08-06/Bagpipe-SFZ%2BFLAC-20260806.7z', 'Bagpipe*.sfz',
                    'https://freepats.zenvoid.org/Ethnic/bagpipe.html', 'FreePats Bagpipe in G (Gilles Sadowski, 2020), SFZ+FLAC 2026-08-06'),
        'ocarina': ('https://github.com/freepats/ocarina1/releases/download/2024-10-02/Ocarina-SFZ%2BFLAC-20241002.7z', 'Ocarina*.sfz',
                    'https://freepats.zenvoid.org/Wind/ocarina.html', 'FreePats Ocarina (Xavimart, 2019), SFZ+FLAC 2024-10-02'),
        'recorder': ('https://freepats.zenvoid.org/Wind/Recorder1/Recorder-SFZ%2BFLAC-20201205.7z', 'Recorder-2*.sfz',
                     'https://freepats.zenvoid.org/Wind/recorder.html', 'FreePats wooden "Venus" soprano recorder (Eugene Vlaskin, 2018), SFZ+FLAC 2020-12-05'),
        'classical-guitar': ('https://freepats.zenvoid.org/Guitar/SpanishClassicalGuitar/SpanishClassicalGuitar-SFZ%2BFLAC-20190618.7z', 'Spanish*.sfz',
                             'https://freepats.zenvoid.org/Guitar/acoustic-guitar.html', 'FreePats Spanish classical guitar (2008), SFZ+FLAC 2019-06-18'),
    }

    def __init__(self):
        self.tmp = TMP / 'freepats'

    def fetch(self, timbre: str) -> Path:
        url, pat, _, _ = self.SETS[timbre]
        d = self.tmp / timbre
        if not list(d.rglob(pat)):
            arc = Downloader.get(url, self.tmp / f'{timbre}.7z')
            d.mkdir(parents=True, exist_ok=True)
            subprocess.run(['bsdtar', '-xf', str(arc), '-C', str(d)], check=True)
            arc.unlink()
        return sorted(d.rglob(pat))[0]

    def build(self, only: set[str] | None = None) -> list[dict]:
        out = []
        for timbre, (url, _, page, desc) in self.SETS.items():
            if only and timbre not in only:
                continue
            sfz = self.fetch(timbre)
            b = SampleSetBuilder('freepats', timbre, {
                'source': desc, 'url': f'{page} ({url})', **self.META,
                'notes': ('Decoded from FLAC to mono 24-bit WAV; SFZ region volume= baked in; SFZ sustain loops kept (shifted to the '
                          'trimmed file). Nominal = SFZ pitch_keycenter.'
                          + (' Chanter notes = sus; the two separately recorded drones (G2, G3) = fx.' if timbre == 'bagpipe' else '')
                          + (' Plucked, one-shot (loop null).' if timbre == 'classical-guitar' else '')),
            })
            seen = set()
            for z in SfzText.regions(sfz):
                if z.source in seen:
                    continue
                seen.add(z.source)
                drone = 'drone' in z.source.name
                nom = int(round(z.root)) if not drone else int(re.search(r'G(\d)', z.source.name).group(1)) * 12 + 19
                # SFZ pitch_keycenter is the label; `tune` is the library's own correction, measured anyway
                label = parse_note(z.source.stem.split('_')[0]) if not drone else nom
                nom = label if label is not None else nom
                art = 'fx' if drone else 'sus'
                rr = int(z.source.stem.split('_')[-1][-1]) - 1 if re.search(r'_\d+$', z.source.stem) and not drone else 0
                if timbre == 'bagpipe' and not drone:
                    rr = int(z.source.stem.split('_')[-1]) - 31
                b.add(Take(str(z.source), nom, f'{art}_{midi_name(nom).replace("#", "s")}_rr{rr}.wav', art=art, rr=rr, gain_db=z.gain_db,
                           loop=list(z.loop) if z.loop else None, decaying=timbre == 'classical-guitar', extra={'orig': z.source.name}))
            out.append(b.build())
        return out


class SalamanderLibrary:
    RAW = 'https://raw.githubusercontent.com/sfzinstruments/SalamanderGrandPiano/master/'
    LAYERS = {1: ('pp', [1, 34]), 4: ('p', [35, 46]), 7: ('mp', [47, 64]), 10: ('mf', [65, 88]), 13: ('f', [89, 112]), 16: ('ff', [113, 127])}
    KEYS = [f'{n}{o}' for o in range(0, 9) for n in ('A', 'C', 'D#', 'F#')]
    META = {
        'source': 'Salamander Grand Piano V3 (Alexander Holm; Yamaha C5, 48 kHz/24-bit), via sfzinstruments/SalamanderGrandPiano',
        'url': 'https://archive.org/details/SalamanderGrandPianoV3 (files from https://github.com/sfzinstruments/SalamanderGrandPiano)',
        'licence': 'CC-BY 3.0 (https://creativecommons.org/licenses/by/3.0/) - credit Alexander Holm',
    }

    def __init__(self):
        self.tmp = TMP / 'salamander'

    def build(self, only: set[str] | None = None) -> list[dict]:
        tree = json.load(urllib.request.urlopen('https://api.github.com/repos/sfzinstruments/SalamanderGrandPiano/git/trees/master?recursive=1'))['tree']
        have = {e['path']: e['size'] for e in tree if e['type'] == 'blob'}
        b = SampleSetBuilder('salamander', 'piano', {
            **self.META,
            'notes': ('Natural (not retuned) sustain samples, sampled every minor third A0..C8; velocity layers v1/v4/v7/v10/v13/v16 of 16 '
                      '(dyn pp..ff, `vel` = the union of the SFZ velocity ranges of the neighbouring dropped layers). Stereo AB pair '
                      'mixed to mono, 48 kHz 24-bit, trimmed at -60 dB (one-shot, no loops). Pitch measured on the attack+1.5 s '
                      '(inharmonic comb tolerance).'),
        })
        for key in self.KEYS:
            nom = parse_note(key)
            if nom is None or nom < 21 or nom > 108:
                continue
            for v, (dyn, vel) in self.LAYERS.items():
                rel = f'Samples/{key}v{v}.flac'
                if rel not in have:
                    continue
                p = Downloader.get(self.RAW + urllib.parse.quote(rel), self.tmp / rel, have[rel])
                b.add(Take(str(p), nom, f'sus_{dyn}_{key.replace("#", "s")}_rr0.wav', art='sus', dyn=dyn, vel=vel, decaying=True,
                           inharmonic=True, extra={'orig': Path(rel).name}))
        return [b.build()]


LIBS = {'philharmonia': PhilharmoniaLibrary, 'sso': SonatinaLibrary, 'freepats': FreePatsLibrary, 'salamander': SalamanderLibrary}


def main(argv: list[str]) -> None:
    if argv and argv[0] == 'probe':
        x, sr = AudioSource.load(argv[1])
        y, s, e = NoteEditor.trim(x, sr)
        r = PitchMeter().measure(y, sr, int(argv[2]), '--decaying' in argv, '--inharmonic' in argv)
        print(f'sr={sr} len={len(x) / sr:.2f}s trimmed=[{s / sr:.3f},{e / sr:.3f}]', asdict(r))
        return
    which = argv[0] if argv else 'all'
    only = set(argv[1:]) or None
    names = list(LIBS) if which == 'all' else [which]
    for n in names:
        LIBS[n]().build(only)


if __name__ == '__main__':
    main(sys.argv[1:])
