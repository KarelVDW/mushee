"""Recording chain: where and how the performance was captured.

Real measured room impulse responses, real phone-microphone responses and
real ambient noise (assets/acoustics/manifest.json, built by
fetch/fetch_acoustics.py) turn a dry render into a take recorded in a room on a
device. Stages, in signal order:

  room      convolve with a measured (or simulated domestic) RIR; direct path
            sits at t≈0 so labels stay aligned; the reverberant part is scaled
            to a drawn direct-to-reverberant ratio (mic distance)
  device    phone/laptop mic response (measured IR or parametric MEMS EQ)
  noise     real background bed at a drawn SNR (computed over active frames),
            plus mic self-noise — real recordings are never digitally silent
  level     overall gain to a drawn capture level, optional slow AGC
  codec     the browser's MediaRecorder: WebM/Opus at 128 kbps (Chrome/Firefox)
            or 192 kbps (Safari), or AAC; decoded back to float

Each `Condition` is a distribution over those parameters; `RecordingChain.apply`
draws one setting from it with the clip's RNG and returns the audio plus the
exact parameters used (stored in the clip's sidecar).
"""

from __future__ import annotations

import json
import random
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import butter, fftconvolve, sosfilt

ROOT = Path(__file__).resolve().parent.parent
ACOUSTICS = ROOT / 'assets' / 'acoustics'
FFMPEG = ROOT.parent / 'node_modules/.pnpm/ffmpeg-static@5.3.0/node_modules/ffmpeg-static/ffmpeg'
SR = 48000


@dataclass
class Condition:
    id: str
    label: str
    room: str | None = 'domestic'  # None = dry (close-mic booth)
    drr_db: tuple[float, float] = (4.0, 12.0)
    device: str | None = None  # 'phone' | 'laptop' | None
    noise: str | None = 'home'  # category or None
    snr_db: tuple[float, float] = (30.0, 45.0)
    self_noise_dbfs: tuple[float, float] = (-78.0, -66.0)
    level_dbfs: tuple[float, float] = (-26.0, -16.0)  # active RMS
    agc: float = 0.0  # probability of AGC pumping
    codec: str | None = None  # 'opus128' | 'opus192' | 'aac' | 'opus32'


CONDITIONS: dict[str, Condition] = {
    'studio': Condition('studio', 'Close mic in a treated room', room='studio', drr_db=(10, 18), noise='quiet', snr_db=(50, 65), self_noise_dbfs=(-90, -80)),
    'room': Condition('room', 'Good mic, ordinary room', room='domestic', drr_db=(3, 10), noise='home', snr_db=(35, 50)),
    'home-phone': Condition('home-phone', 'Phone at home, browser recording', room='domestic', drr_db=(0, 8), device='phone', noise='home', snr_db=(22, 38), agc=0.25, codec='opus128'),
    'home-laptop': Condition('home-laptop', 'Laptop mic at home', room='domestic', drr_db=(-3, 5), device='laptop', noise='home', snr_db=(18, 32), agc=0.3, codec='opus128'),
    'noisy-phone': Condition('noisy-phone', 'Phone in a noisy place', room='domestic', drr_db=(0, 8), device='phone', noise='public', snr_db=(8, 18), agc=0.4, codec='opus128'),
}


class AssetPool:
    """Index of assets/acoustics/manifest.json, with graceful fallbacks when a category is empty."""

    def __init__(self, root: Path = ACOUSTICS):
        self.root = root
        self.items: list[dict] = []
        mf = root / 'manifest.json'
        if mf.exists():
            data = json.loads(mf.read_text())
            self.items = data if isinstance(data, list) else data.get('files', data.get('items', []))
        self._cache: dict[str, np.ndarray] = {}
        self._bad: set[str] = set()

    def _pick(self, rng: random.Random, pred) -> dict | None:
        c = [it for it in self.items if pred(it) and self.path_of(it) not in self._bad]
        while c:
            it = rng.choice(c)
            try:
                self.load(it)
                return it
            except Exception:
                # unreadable (e.g. still being written by the asset fetcher): never pick it again
                self._bad.add(self.path_of(it))
                c.remove(it)
        return None

    @staticmethod
    def path_of(it: dict) -> str:
        return str(it.get('path') or it.get('file'))

    def load(self, it: dict) -> np.ndarray:
        f = self.path_of(it)
        p = f if f.startswith('/') else str(self.root / f)
        if p not in self._cache:
            x, sr = sf.read(p, dtype='float32', always_2d=True)
            x = x.mean(axis=1)
            if sr != SR:
                import librosa

                x = librosa.resample(x, orig_sr=sr, target_sr=SR)
            self._cache[p] = x
        return self._cache[p]

    @classmethod
    def _kind(cls, it: dict) -> str:
        return str(it.get('kind') or it.get('type') or cls.path_of(it).split('/')[0])

    def room(self, rng: random.Random, which: str) -> dict | None:
        def ok(it):
            if not self._kind(it).startswith('room'):
                return False
            rt = it.get('rt60_s') or it.get('rt60') or 0.4
            if it.get('includes_device'):
                return False  # device colouring baked in: only for the device stage
            if which == 'studio':
                return rt <= 0.35
            return 0.15 <= rt <= 0.8

        return self._pick(rng, ok)

    def device(self, rng: random.Random, which: str) -> dict | None:
        def ok(it):
            if not self._kind(it).startswith('device'):
                return False
            cat = str(it.get('category', '')).lower() + self.path_of(it).lower()
            resp = it.get('response_db') or {}
            band = [v for k, v in resp.items() if 100 <= int(k) <= 8000]
            if band and max(abs(v) for v in band) > 15:
                return False  # implausible measurement (speaker/noise dominated)
            return ('laptop' in cat or 'chromebook' in cat) if which == 'laptop' else ('laptop' not in cat and 'chromebook' not in cat)

        return self._pick(rng, ok)

    def noise(self, rng: random.Random, which: str) -> dict | None:
        home = ('kitchen', 'living', 'wash', 'home', 'office', 'air', 'fan', 'typing', 'vacuum', 'neighbor', 'domestic')
        public = ('cafe', 'caf', 'street', 'traffic', 'square', 'metro', 'station', 'babble', 'restaurant', 'public')

        def ok(it):
            if not self._kind(it).startswith('noise'):
                return False
            cat = (str(it.get('category', '')) + ' ' + self.path_of(it)).lower()
            if which == 'home' or which == 'quiet':
                # a talking neighbour/TV under a home take would add unlabelled pitched
                # sound; speech beds belong to the public (noisy) condition only
                return any(k in cat for k in home) and not it.get('contains_speech')
            return any(k in cat for k in public)

        return self._pick(rng, ok)


class RecordingChain:
    def __init__(self, pool: AssetPool | None = None):
        self.pool = pool or AssetPool()

    # ------------------------------------------------------------ stages
    @staticmethod
    def _shape_rir(h: np.ndarray, drr_db: float) -> np.ndarray:
        """Scale the reverberant part so direct/reverb energy ratio = drr_db."""
        pk = int(np.argmax(np.abs(h[: SR // 10]))) if len(h) > 10 else 0
        w = int(0.0025 * SR)
        d0, d1 = max(0, pk - w), pk + w
        direct = h.copy()
        direct[:d0] = 0
        direct[d1:] = 0
        rev = h - direct
        ed, er = float(np.sum(direct**2)) + 1e-12, float(np.sum(rev**2)) + 1e-12
        g = np.sqrt(ed / er / 10 ** (drr_db / 10))
        out = direct + g * rev
        # align direct path to sample 0 (labels are relative to the dry render)
        return out[pk:] / (np.abs(out[pk]) + 1e-9)

    @staticmethod
    def _parametric_device(y: np.ndarray, rng: random.Random, kind: str) -> tuple[np.ndarray, dict]:
        hp = rng.uniform(90, 220) if kind == 'phone' else rng.uniform(120, 300)
        lp = rng.uniform(9000, 16000) if kind == 'phone' else rng.uniform(7000, 12000)
        sos = butter(2, [hp / (SR / 2), lp / (SR / 2)], 'band', output='sos')
        out = sosfilt(sos, y)
        # presence lift typical of MEMS capsules
        pk = rng.uniform(3000, 7000)
        gain = rng.uniform(0, 6)
        sos2 = butter(1, [pk / 1.5 / (SR / 2), pk * 1.5 / (SR / 2)], 'band', output='sos')
        out = out + (10 ** (gain / 20) - 1) * sosfilt(sos2, out)
        return out.astype(np.float32), {'device': f'parametric-{kind}', 'hp': round(hp), 'lp': round(lp), 'presence_db': round(gain, 1)}

    @staticmethod
    def _active_rms(y: np.ndarray) -> float:
        hop = SR // 50
        n = len(y) // hop
        fr = np.sqrt(np.mean(y[: n * hop].reshape(n, hop) ** 2, axis=1) + 1e-12)
        thr = fr.max() * 10 ** (-30 / 20)
        act = fr[fr > thr]
        return float(np.sqrt(np.mean(act**2))) if len(act) else float(fr.mean())

    def _codec(self, y: np.ndarray, kind: str) -> np.ndarray:
        with tempfile.TemporaryDirectory() as td:
            src, enc, dec = Path(td) / 'in.wav', Path(td) / 'enc', Path(td) / 'out.wav'
            sf.write(src, np.clip(y, -1, 1), SR, subtype='PCM_16')
            if kind.startswith('opus'):
                br = kind[4:] + 'k'
                enc = enc.with_suffix('.webm')
                cmd = [str(FFMPEG), '-y', '-loglevel', 'error', '-i', str(src), '-c:a', 'libopus', '-b:a', br, '-application', 'audio', '-frame_duration', '20', '-ac', '1', str(enc)]
            else:
                enc = enc.with_suffix('.m4a')
                cmd = [str(FFMPEG), '-y', '-loglevel', 'error', '-i', str(src), '-c:a', 'aac', '-b:a', '160k', '-ac', '1', str(enc)]
            subprocess.run(cmd, check=True)
            subprocess.run([str(FFMPEG), '-y', '-loglevel', 'error', '-i', str(enc), '-ar', str(SR), '-ac', '1', '-c:a', 'pcm_f32le', str(dec)], check=True)
            out, _ = sf.read(dec, dtype='float32')
        n = len(y)
        return out[:n] if len(out) >= n else np.concatenate([out, np.zeros(n - len(out), np.float32)])

    # ------------------------------------------------------------ main
    def apply(self, dry: np.ndarray, cond: Condition, rng: random.Random) -> tuple[np.ndarray, dict]:
        meta: dict = {'condition': cond.id}
        y = dry.astype(np.float32)
        # room
        if cond.room:
            it = self.pool.room(rng, cond.room)
            drr = rng.uniform(*cond.drr_db)
            if it is not None:
                h = self._shape_rir(self.pool.load(it), drr)
                meta['room'] = {'file': self.pool.path_of(it), 'rt60': it.get('rt60_s') or it.get('rt60'), 'drr_db': round(drr, 1)}
            else:
                h = self._synthetic_rir(rng, drr)
                meta['room'] = {'file': 'synthetic-exp', 'drr_db': round(drr, 1)}
            y = fftconvolve(y, h)[: len(y) + int(0.8 * SR)].astype(np.float32)
        # device
        if cond.device:
            it = self.pool.device(rng, cond.device)
            if it is not None:
                h = self.pool.load(it)
                h = h / (np.abs(h).max() + 1e-9)
                pk = int(np.argmax(np.abs(h)))
                y = fftconvolve(y, h[pk:])[: len(y)].astype(np.float32)
                meta['device'] = self.pool.path_of(it)
            else:
                y, dm = self._parametric_device(y, rng, cond.device)
                meta.update(dm)
        # level
        target = 10 ** (rng.uniform(*cond.level_dbfs) / 20)
        y *= target / (self._active_rms(y) + 1e-9)
        # noise
        if cond.noise:
            it = self.pool.noise(rng, cond.noise)
            snr = rng.uniform(*cond.snr_db)
            if it is not None:
                nz = self.pool.load(it)
                if len(nz) < len(y):
                    reps = int(np.ceil(len(y) / len(nz)))
                    nz = np.tile(nz, reps)
                s = rng.randrange(0, len(nz) - len(y) + 1)
                nz = nz[s : s + len(y)].copy()
                meta['noise'] = {'file': self.pool.path_of(it), 'snr_db': round(snr, 1)}
            else:
                nz = self._pink(len(y), rng)
                meta['noise'] = {'file': 'pink', 'snr_db': round(snr, 1)}
            nz *= self._active_rms(y) / (np.sqrt(np.mean(nz**2)) + 1e-12) / 10 ** (snr / 20)
            y = y + nz.astype(np.float32)
        sn = 10 ** (rng.uniform(*cond.self_noise_dbfs) / 20)
        y = y + np.asarray(np.random.default_rng(rng.randrange(1 << 30)).normal(0, sn, len(y)), np.float32)
        # AGC: slow gain riding (attack ~0.3 s, release ~1.5 s) toward a target level
        if cond.agc and rng.random() < cond.agc:
            y = self._agc(y, rng)
            meta['agc'] = True
        peak = float(np.abs(y).max())
        if peak > 0.99:
            y *= 0.99 / peak
        if cond.codec:
            y = self._codec(y, cond.codec)
            meta['codec'] = cond.codec
        return y.astype(np.float32), meta

    @staticmethod
    def _pink(n: int, rng: random.Random) -> np.ndarray:
        g = np.random.default_rng(rng.randrange(1 << 30))
        X = np.fft.rfft(g.normal(size=n))
        f = np.arange(len(X))
        X[1:] /= np.sqrt(f[1:])
        return np.fft.irfft(X, n).astype(np.float32)

    @staticmethod
    def _synthetic_rir(rng: random.Random, drr_db: float) -> np.ndarray:
        rt60 = rng.uniform(0.25, 0.5)
        n = int(rt60 * 1.2 * SR)
        t = np.arange(n) / SR
        g = np.random.default_rng(rng.randrange(1 << 30))
        tail = g.normal(size=n) * np.exp(-6.9 * t / rt60)
        tail[: int(0.004 * SR)] = 0
        sos = butter(1, 6000 / (SR / 2), 'low', output='sos')
        tail = sosfilt(sos, tail)
        h = np.zeros(n)
        h[0] = 1.0
        er = np.sum(tail**2)
        tail *= np.sqrt(1 / er / 10 ** (drr_db / 10))
        return (h + tail).astype(np.float32)

    @staticmethod
    def _agc(y: np.ndarray, rng: random.Random) -> np.ndarray:
        hop = SR // 100
        n = len(y) // hop
        fr = np.sqrt(np.mean(y[: n * hop].reshape(n, hop) ** 2, axis=1) + 1e-10)
        target = np.median(fr[fr > fr.max() * 0.03]) if np.any(fr > fr.max() * 0.03) else fr.mean()
        g = np.ones(n)
        cur = 1.0
        a_up, a_dn = np.exp(-1 / (1.5 * 100)), np.exp(-1 / (0.3 * 100))
        maxg = 10 ** (rng.uniform(6, 14) / 20)
        for i in range(n):
            want = np.clip(target / fr[i], 1 / maxg, maxg) if fr[i] > target * 0.05 else cur
            a = a_dn if want < cur else a_up
            cur = a * cur + (1 - a) * want
            g[i] = cur
        gs = np.interp(np.arange(len(y)), np.arange(n) * hop + hop / 2, g)
        return (y * gs).astype(np.float32)
