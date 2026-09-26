"""Real (and simulated) acoustics for "someone recording themselves at home on a phone/laptop".

Output: `assets/acoustics/`
  rooms/<set>/*.wav    mono 48 kHz float32 room impulse responses. Pre-delay removed: the
                       direct-path peak (first sample >= 0.2 x max, refined to the largest sample in
                       the next 0.5 ms) sits at sample PEAK_AT (24 = 0.5 ms) so rendered audio stays
                       time-aligned with labels; scaled so that peak = +1.0 (polarity normalised);
                       tail cut where the decay meets the measurement noise floor (Lundeby-style
                       line/noise crossing) with a 20 ms cosine fade.
  devices/*.wav        mono 48 kHz float32 microphone/device responses, minimum phase (cepstral
                       folding of the measured magnitude), 1024 taps, 0 dB (1/3-octave mean) at 1 kHz.
  noise/<set>/*.wav    mono 48 kHz float32 background beds of 20-60 s, RMS-normalised to -30 dBFS,
                       screened with PANNs CNN14 (AudioSet) for music/singing/beeps/alarms (a recording
                       with music in >= half its beds is dropped whole) plus a DSP count of stable
                       narrowband events (squeaks/beeps; > 20/min without speech -> dropped).
  manifest.json        every file: set, licence, source URL, category, per-kind metrics
                       (rooms: T20/T30 in the 500 Hz/1 kHz/2 kHz octaves, rt60, DRR with direct =
                       +-2.5 ms around the peak, source distance when the dataset states it).

Sources (licence as published by the dataset; see SETS):
  rooms   air-binaural, air-phone (Aachen AIR 1.4, MIT) - ace-single/-chromebook/-mobile (ACE,
          CC-BY-4.0) - motus (CC-BY-4.0, one em32 capsule) - dechorate (CC-BY-4.0) - surir
          (CC-BY-4.0) - pra-domestic (simulated with pyroomacoustics)
  devices poliphone (CC-BY-4.0, 20 smartphones) - ace-derived (Chromebook laptop-mic response
          estimated from ACE direct paths vs the ACE omni reference)
  noise   demand (CC-BY-4.0, one channel per environment) - ms-snsd (MIT) - ace-noise (CC-BY-4.0)

Every step fetches only what it needs (HTTP range reads into remote zips, streamed tar
extraction) into a temp dir and refuses to download when the disk has < MIN_FREE_GB free.

    cd synthetic-corpus && PYTHONPATH=. uv run --with h5py python -m synthcorpus.fetch.fetch_acoustics \
        [step ...] [--tmp DIR] [--air-dir DIR]
    steps: air ace motus dechorate surir pra poliphone ace-devices demand snsd ace-noise manifest
    (default: all). `h5py` is only needed for dechorate/surir (HDF5 / SOFA).
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy import ndimage, signal

from synthcorpus.remotezip import open_remote_zip

FS = 48000
PEAK_AT = 24  # direct-path peak position in every room IR (0.5 ms)
MIN_FREE_GB = 12.0
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'assets' / 'acoustics'

ZENODO = 'https://zenodo.org/api/records/{rec}/files/{key}/content'
AIR_PAGE = 'https://www.iks.rwth-aachen.de/forschung/tools-downloads/databases/aachen-impulse-response-database/'
AIR_ZIP = 'https://www.iks.rwth-aachen.de/fileadmin/user_upload/downloads/forschung/tools-downloads/air_database_release_1_4.zip'
SNSD_TREE = 'https://api.github.com/repos/microsoft/MS-SNSD/git/trees/master?recursive=1'
SNSD_RAW = 'https://raw.githubusercontent.com/microsoft/MS-SNSD/master/'

SETS: dict[str, dict] = {
    'air-binaural': dict(
        kind='room', licence='MIT', source_url=AIR_PAGE,
        citation='Jeub, Schaefer, Vary: "A Binaural Room Impulse Response Database for the Evaluation of '
        'Dereverberation Algorithms", DSP 2009 (AIR v1.4)',
        notes='Only the measurements WITHOUT the dummy head (head=0: two free-field omni mics 17 cm apart) '
        'so no HRTF colouring. booth / office / meeting both channels; lecture only the two nearest distances.'),
    'air-phone': dict(
        kind='room', licence='MIT', source_url=AIR_PAGE,
        citation='Jeub, Schaefer, Krueger, Nelke, Beaugeant, Vary: "Do We Need Dereverberation for '
        'Hand-Held Telephony?", ICA 2010 (AIR v1.4 mock-up phone measurements)',
        notes='HATS mouth simulator -> mock-up phone (mic channel 1). Includes mouth radiation + mock-up '
        'device, i.e. NOT a clean room IR. hhp = hand-held position (phone at the ear, mic a few cm from '
        'the mouth), hfrp = hands-free reference position (phone in front of the talker). The three '
        'variants per room/position are the 3 measurement series of the wav release. Stairway and '
        'corridor rooms (RT60 1.6-2.1 s) left out.',
        includes_device=True),
    'ace-single': dict(
        kind='room', licence='CC-BY-4.0', source_url='https://zenodo.org/records/6257551',
        citation='Eaton, Gaubitch, Moore, Naylor: "Estimation of room acoustic parameters: The ACE '
        'Challenge", IEEE/ACM TASLP 2016',
        notes='Single omni reference mic. 7 rooms x 2 mic positions (1 = short, 2 = long distance).'),
    'ace-chromebook': dict(
        kind='room', licence='CC-BY-4.0', source_url='https://zenodo.org/records/6257551',
        citation='ACE corpus (Eaton et al. 2016)',
        notes='Chromebook Pixel laptop built-in mic (channel 1 of 2) on the room furniture: room + laptop '
        'mic response + table reflection in one IR.', includes_device=True),
    'ace-mobile': dict(
        kind='room', licence='CC-BY-4.0', source_url='https://zenodo.org/records/6257551',
        citation='ACE corpus (Eaton et al. 2016)',
        notes='3-mic mobile-phone-sized mock-up array (omni capsules, no phone body: its response relative '
        'to ACE Single is flat within +-1 dB), channel 1, 119 cm above the floor. Same rooms/positions as '
        'ace-single, different mic location.'),
    'motus': dict(
        kind='room', licence='CC-BY-4.0', source_url='https://zenodo.org/records/4923187',
        citation='Goetz, Kerimovs, Falcon Perez, Pulkki, Schlecht: "Motus: A dataset of higher-order '
        'Ambisonic room impulse responses ...", I3DA 2021',
        notes='Living-room-like 4.9 x 4.0 x 2.95 m room, 830 furniture configurations. One em32 capsule '
        '(the one with the strongest direct path = facing the source) of the raw capsule signals; sources '
        '1-3 only (source 4 faces away from the array).'),
    'dechorate': dict(
        kind='room', licence='CC-BY-4.0', source_url='https://zenodo.org/records/5562386',
        citation='Di Carlo, Tandeitnik, Foy, Bertin, Deleforge, Gannot: "dEchorate: a calibrated room '
        'impulse response dataset for echo-aware signal processing", EURASIP JASMP 2021',
        notes='5.7 x 6.0 x 2.4 m acoustic lab, walls switchable absorbent/reflective (wall_config digits: '
        'floor, ceiling, west, south, east, north; 1 = reflective, 0 = absorbent, 2 = diffusing). '
        'Processed RIRs are 20000 samples (0.42 s) long; EDC is already < -49 dB there. Directional '
        'loudspeakers only; source/array pairs picked once in the fully absorbent room: first strong '
        'arrival = geometric TOA and DRR >= 2 dB (loudspeaker facing the array), <= 2.3 m; the pairs '
        'rotate over the 11 wall configurations.'),
    'surir': dict(
        kind='room', licence='CC-BY-4.0', source_url='https://zenodo.org/records/21494888',
        citation='Lawrence, Walther, Habets, Peters: "SuRIR: A Dataset of Successively Measured Room '
        'Impulse Responses for Localizing Silent Humans", Forum Acusticum 2026',
        notes='Two furnished living rooms (A 62.6 m3, B), mannequin reference condition, 5 s sweeps. Only '
        'loudspeaker -> the far array (the other array sits on the loudspeaker itself), and only facing '
        'loudspeaker/array combinations (DRR >= -6 dB; the other direction gives -10..-16 dB). The SOFA '
        '"License" attribute is sofar\'s default placeholder; the Zenodo record licence (CC-BY-4.0) governs.'),
    'pra-domestic': dict(
        kind='room', licence='generated (pyroomacoustics, MIT)', source_url='https://github.com/LCAV/pyroomacoustics',
        citation='Scheibler, Bezzam, Dokmanic: "Pyroomacoustics", ICASSP 2018',
        notes='Shoebox image-source simulation, frequency-flat wall absorption from inverse Sabine, air '
        'absorption on, randomised image positions (use_rand_ism, 5 cm) against sweeping echoes. Seeded.',
        simulated=True),
    'poliphone': dict(
        kind='device', licence='CC-BY-4.0', source_url='https://zenodo.org/records/13903412',
        citation='Salvi et al., "POLIPHONE: A Dataset for Smartphone Model Identification from Audio '
        'Recordings", IEEE Access 2024',
        notes='POLIPHONE IRs_devices/*.npy (3000 taps @ 44.1 kHz, peak centred) -> 48 kHz, windowed around '
        'the peak, minimum phase from the magnitude, 1024 taps, 0 dB at 1 kHz. Above 22 kHz the source '
        'has no information (floor -60 dB).'),
    'ace-derived': dict(
        kind='device', licence='CC-BY-4.0', source_url='https://zenodo.org/records/6257551',
        citation='ACE corpus (Eaton et al. 2016)',
        notes='ESTIMATED Chromebook Pixel laptop-mic response: log-mean over the 14 ACE room/positions of |direct-path '
        'spectrum of the device mic| / |direct-path spectrum of the ACE Single omni at the same '
        'room/position| (2.5 ms half-Hann windows), 1/3-octave smoothed, min phase. The loudspeaker '
        'cancels; table reflections and position differences do not fully, so treat as a coarse EQ.'),
    'demand': dict(
        kind='noise', licence='CC-BY-4.0', source_url='https://zenodo.org/records/1227121',
        citation='Thiemann, Ito, Vincent: "The Diverse Environments Multi-channel Acoustic Noise Database '
        '(DEMAND)", ICA 2013',
        notes='48 kHz release, channel ch01 of the 16-mic array only, 5 min per environment cut into 60 s beds.'),
    'ms-snsd': dict(
        kind='noise', licence='MIT', source_url='https://github.com/microsoft/MS-SNSD',
        citation='Reddy et al., "A Scalable Noisy Speech Dataset and Online Subjective Test Framework", '
        'Interspeech 2019',
        notes='16 kHz sources upsampled to 48 kHz (bandwidth_hz = 8000). Categories that are DEMAND copies '
        'are skipped (DEMAND is taken at 48 kHz instead); AirportAnnouncements (PA chimes) and SqueakyChair '
        '(pitched squeals) skipped; byte-identical duplicate files across categories skipped. At most '
        '2 beds per file and 8 per category.'),
    'ace-noise': dict(
        kind='noise', licence='CC-BY-4.0', source_url='https://zenodo.org/records/6257551',
        citation='ACE corpus (Eaton et al. 2016)',
        notes='ACE Single-mic "Ambient" (room noise, HVAC, building) and "Fan" (fan running in the room) '
        'recordings, mic position 1, first two minutes.'),
}


# --------------------------------------------------------------------------------------------
# infrastructure


class Disk:
    @staticmethod
    def check(what: str) -> None:
        free = shutil.disk_usage('/').free / 1e9
        if free < MIN_FREE_GB:
            raise SystemExit(f'refusing to fetch {what}: only {free:.1f} GB free (< {MIN_FREE_GB} GB)')


class Http:
    @staticmethod
    def get(url: str, retries: int = 4) -> bytes:
        for attempt in range(retries):
            try:
                req = urllib.request.Request(url, headers={'User-Agent': 'synthcorpus-fetch/1.0'})
                with urllib.request.urlopen(req, timeout=120) as r:
                    return r.read()
            except Exception as e:  # noqa: BLE001 - network flakiness, retried
                if attempt == retries - 1:
                    raise
                print(f'  retry {url}: {e}', file=sys.stderr)
                time.sleep(2 + 3 * attempt)
        raise AssertionError

    @staticmethod
    def download(url: str, dest: Path) -> Path:
        if dest.exists() and dest.stat().st_size > 0:
            return dest
        Disk.check(url)
        dest.parent.mkdir(parents=True, exist_ok=True)
        part = dest.with_suffix(dest.suffix + '.part')
        subprocess.run(['curl', '-sSL', '--retry', '4', '-o', str(part), url], check=True)
        part.rename(dest)
        return dest

    @staticmethod
    def stream_tar_members(url: str, dest: Path, pattern: re.Pattern) -> None:
        """Stream a (bz2) tarball and extract only members whose name matches `pattern`."""
        Disk.check(url)
        req = urllib.request.Request(url, headers={'User-Agent': 'synthcorpus-fetch/1.0'})
        with urllib.request.urlopen(req, timeout=300) as r, tarfile.open(fileobj=r, mode='r|*') as tar:
            for m in tar:
                if m.isfile() and pattern.search(m.name):
                    tar.extract(m, dest, filter='data')


class Audio:
    @staticmethod
    def to_fs(x: np.ndarray, fs: int, target: int = FS) -> np.ndarray:
        x = np.asarray(x, dtype=np.float64)
        if fs == target:
            return x
        g = np.gcd(int(fs), int(target))
        return signal.resample_poly(x, target // g, int(fs) // g, axis=0)

    @staticmethod
    def read(src, channel: int | None = 0) -> tuple[np.ndarray, int]:
        x, fs = sf.read(src, dtype='float64', always_2d=True)
        return (x[:, channel] if channel is not None else x), fs

    @staticmethod
    def write(path: Path, x: np.ndarray) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        sf.write(path, np.asarray(x, dtype=np.float32), FS, subtype='FLOAT')

    @staticmethod
    def db(x: float) -> float:
        return float(10 * np.log10(max(x, 1e-30)))


# --------------------------------------------------------------------------------------------
# room impulse responses


class RoomIR:
    """A conditioned room IR: direct peak at PEAK_AT, peak = +1, tail cut at the noise floor."""

    DIRECT_HALF_S = 0.0025
    FADE_OUT_S = 0.02
    MAX_LEN_S = 2.0
    BANDS = (500, 1000, 2000)

    def __init__(self, h: np.ndarray, noise_floor_found: bool, raw_peak_index: int):
        self.h = h
        self.noise_floor_found = noise_floor_found
        self.raw_peak_index = raw_peak_index

    # -- conditioning ------------------------------------------------------------------------

    @staticmethod
    def direct_peak(h: np.ndarray, rel: float = 0.2, span_s: float = 0.0005) -> int:
        """Direct path = the largest sample within 0.5 ms after the first sample reaching `rel` (-14 dB) of
        the global maximum. Earliest-first so that a later reflection of similar strength (a table
        under a laptop, a second lobe of a band-limited pulse) is not taken for the direct sound."""
        a = np.abs(h)
        i0 = int(np.argmax(a >= rel * a.max()))
        return i0 + int(np.argmax(a[i0:i0 + max(1, int(span_s * FS))]))

    @classmethod
    def from_measurement(cls, raw: np.ndarray, fs: int) -> 'RoomIR':
        h = Audio.to_fs(raw, fs)
        h = h - np.median(h)  # kill DC offsets some capsule/interface chains leave
        p = cls.direct_peak(h)
        start = p - PEAK_AT
        y = h[start:] if start >= 0 else np.concatenate([np.zeros(-start), h])
        y = y / y[PEAK_AT]  # (no fade-in: an FIR may start with a non-zero tap, a taper would dent the pulse)
        end, found = cls._tail_end(y)
        y = y[:end].copy()
        n = min(int(cls.FADE_OUT_S * FS), len(y) // 4)
        y[-n:] *= np.cos(0.5 * np.pi * np.arange(n) / n) ** 2
        return cls(y, found, p)

    @classmethod
    def _tail_end(cls, y: np.ndarray) -> tuple[int, bool]:
        """Sample where the decay line meets the noise floor (Lundeby-style, one pass). If the tail
        is still decaying at the end (no noise floor in the data) keep everything."""
        blk = int(0.01 * FS)
        n = len(y) // blk
        max_len = min(len(y), int(cls.MAX_LEN_S * FS))
        if n < 12:
            return max_len, False
        e = (y[: n * blk] ** 2).reshape(n, blk).mean(1)
        L = 10 * np.log10(e + 1e-30)
        t = (np.arange(n) + 0.5) * blk / FS
        usable = n - max(2, n // 20)  # ignore the last 5%: datasets often fade/window their IR ends
        last = max(4, usable // 10)
        a, b = np.median(L[usable - 3 * last: usable - 2 * last]), np.median(L[usable - last: usable])
        tail_slope = (b - a) / (2 * last * blk / FS)  # robust dB/s over the last 30% of the usable IR
        if tail_slope < -30:  # still decaying at >= 30 dB/s -> no noise floor reached
            return max_len, False
        noise = 10 * np.log10(e[usable - last: usable].mean() + 1e-30)
        i1 = int(np.argmax(L <= L.max() - 5))
        rel = np.nonzero(L[i1:] <= noise + 10)[0]
        if len(rel) == 0:
            return max_len, False
        i2 = i1 + int(rel[0])
        if i2 - i1 >= 3:
            slope, icpt = np.polyfit(t[i1:i2], L[i1:i2], 1)
            t_cross = (noise - icpt) / slope if slope < 0 else t[i2]
        else:
            t_cross = t[i2]
        end = int(np.clip(t_cross * FS, 0.05 * FS, max_len))
        return end, True

    # -- metrics -----------------------------------------------------------------------------

    @staticmethod
    def _decay_time(edc_db: np.ndarray, lo: float, hi: float) -> float | None:
        i_lo = np.nonzero(edc_db <= lo)[0]
        i_hi = np.nonzero(edc_db <= hi)[0]
        if len(i_lo) == 0 or len(i_hi) == 0 or i_hi[0] - i_lo[0] < 10:
            return None
        a, b = i_lo[0], i_hi[0]
        slope = np.polyfit(np.arange(a, b) / FS, edc_db[a:b], 1)[0]
        return float(-60.0 / slope) if slope < 0 else None

    def band_decay(self) -> dict:
        out = {}
        y = self.h[PEAK_AT:]
        for fc in self.BANDS:
            sos = signal.butter(3, [fc / np.sqrt(2), fc * np.sqrt(2)], 'bandpass', fs=FS, output='sos')
            b = signal.sosfilt(sos, y[::-1])[::-1]  # time-reversed filtering (short-RT friendly)
            edc = np.cumsum((b ** 2)[::-1])[::-1]
            edc_db = 10 * np.log10(edc / edc[0] + 1e-30)
            out[fc] = dict(t20=self._decay_time(edc_db, -5, -25), t30=self._decay_time(edc_db, -5, -35),
                           edc_range_db=round(float(-edc_db[-min(len(edc_db), 200)]), 1))
        return out

    def drr_db(self) -> float:
        d = int(self.DIRECT_HALF_S * FS)
        direct = np.sum(self.h[max(0, PEAK_AT - d): PEAK_AT + d + 1] ** 2)
        rev = np.sum(self.h[PEAK_AT + d + 1:] ** 2)
        return round(Audio.db(direct) - Audio.db(rev), 2)

    def metrics(self) -> dict:
        bands = self.band_decay()

        def mean(key):  # over the bands where the decay range allowed a fit
            v = [b[key] for b in bands.values() if b[key] is not None]
            return round(float(np.mean(v)), 3) if v else None

        t20, t30 = mean('t20'), mean('t30')
        return dict(
            rt60_s=t30 if t30 is not None else t20, t20_s=t20, t30_s=t30,
            t30_bands_s={str(k): (None if v['t30'] is None else round(v['t30'], 3)) for k, v in bands.items()},
            t20_bands_s={str(k): (None if v['t20'] is None else round(v['t20'], 3)) for k, v in bands.items()},
            drr_db=self.drr_db(), length_s=round(len(self.h) / FS, 3),
            tail_cut_at_noise_floor=self.noise_floor_found)


# --------------------------------------------------------------------------------------------
# device responses


class DeviceIR:
    N_FFT = 16384
    N_TAPS = 1024
    FLOOR_DB = -60.0

    def __init__(self, h: np.ndarray):
        self.h = h

    @classmethod
    def from_magnitude(cls, mag: np.ndarray) -> 'DeviceIR':
        """Minimum-phase FIR from a one-sided magnitude (N_FFT//2+1 bins), 0 dB at 1 kHz."""
        mag = np.maximum(mag, mag.max() * 10 ** (cls.FLOOR_DB / 20))
        c = np.fft.irfft(np.log(mag), cls.N_FFT)
        w = np.zeros(cls.N_FFT)
        w[0] = 1
        w[1:cls.N_FFT // 2] = 2
        w[cls.N_FFT // 2] = 1
        h = np.fft.irfft(np.exp(np.fft.rfft(c * w)), cls.N_FFT)[: cls.N_TAPS]
        n = 128
        h[-n:] *= np.cos(0.5 * np.pi * np.arange(n) / n) ** 2
        dev = cls(h)
        return cls(h / 10 ** (dev.band_db(1000) / 20))

    @classmethod
    def from_measurement(cls, raw: np.ndarray, fs: int) -> 'DeviceIR':
        h = Audio.to_fs(raw, fs)
        p = int(np.argmax(np.abs(h)))
        pre, post = 256, 1024
        seg = h[max(0, p - pre): p + post]
        win = signal.windows.tukey(len(seg), 0.25)
        return cls.from_magnitude(np.abs(np.fft.rfft(seg * win, cls.N_FFT)))

    def band_db(self, fc: float, frac: float = 3.0) -> float:
        f = np.fft.rfftfreq(self.N_FFT, 1 / FS)
        p = np.abs(np.fft.rfft(self.h, self.N_FFT)) ** 2
        sel = (f >= fc * 2 ** (-0.5 / frac)) & (f <= fc * 2 ** (0.5 / frac))
        return Audio.db(p[sel].mean())

    def broadband_gain_db(self, lo: float = 100.0, hi: float = 10000.0) -> float:
        """Power gain for pink noise band-limited to lo..hi (renderers can undo it when the 1 kHz
        reference sits in a notch)."""
        f = np.fft.rfftfreq(self.N_FFT, 1 / FS)
        p = np.abs(np.fft.rfft(self.h, self.N_FFT)) ** 2
        sel = (f >= lo) & (f <= hi)
        return round(Audio.db(np.sum(p[sel] / f[sel]) / np.sum(1 / f[sel])), 1)

    def metrics(self) -> dict:
        freqs = (100, 200, 500, 1000, 2000, 4000, 8000, 12000, 16000, 20000)
        third = [self.band_db(f) for f in (200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500,
                                          3150, 4000, 5000, 6300, 8000)]
        span = round(max(third) - min(third), 1)
        return dict(taps=len(self.h), minimum_phase=True, peak_index=int(np.argmax(np.abs(self.h))),
                    response_db={str(f): round(self.band_db(f), 1) for f in freqs},
                    broadband_gain_db=self.broadband_gain_db(), span_200_8k_db=span, extreme=bool(span > 30))


def smooth_fractional_octave(f: np.ndarray, p: np.ndarray, frac: float = 3.0) -> np.ndarray:
    """1/frac-octave power smoothing of a spectrum sampled at f."""
    out = np.empty_like(p)
    for i, fi in enumerate(f):
        if fi <= 0:
            out[i] = p[i]
            continue
        sel = (f >= fi * 2 ** (-0.5 / frac)) & (f <= fi * 2 ** (0.5 / frac))
        out[i] = p[sel].mean()
    return out


# --------------------------------------------------------------------------------------------
# noise beds


class NoiseScreen:
    """PANNs CNN14 (AudioSet tagger, pretrained checkpoint) + a DSP tonal-event counter."""

    MUSIC_WORDS = ('music', 'singing', 'song', 'choir', 'chant', 'humming', 'whistling', 'guitar', 'piano',
                   'keyboard (musical)', 'drum', 'orchestra', 'violin', 'brass instrument', 'string',
                   'saxophone', 'trumpet', 'flute', 'harmonica', 'accordion', 'organ', 'synthesizer',
                   'musical', 'rapping', 'beatboxing', 'yodeling', 'jingle', 'bell', 'chime', 'glockenspiel',
                   'marimba', 'vibraphone', 'tuning fork', 'singing bowl', 'harp', 'cello', 'ukulele',
                   'banjo', 'mandolin', 'sitar', 'zither', 'bagpipes', 'didgeridoo', 'theremin', 'scratching',
                   'mallet', 'cymbal', 'tabla', 'gong', 'tambourine', 'rattle (instrument)', 'maraca', 'lullaby')
    BEEP_LABELS = ('Beep, bleep', 'Sine wave', 'Dial tone', 'Busy signal', 'Telephone dialing, DTMF',
                   'Ringtone', 'Telephone bell ringing', 'Buzzer', 'Alarm', 'Alarm clock',
                   'Smoke detector, smoke alarm', 'Fire alarm', 'Siren', 'Civil defense siren',
                   'Reversing beeps', 'Air horn, truck horn', 'Foghorn', 'Whistle', 'Kettle whistle',
                   'Steam whistle', 'Microwave oven', 'Doorbell', 'Ding-dong', 'Ding', 'Clang',
                   'Electronic tuner', 'Chirp tone', 'Pulse', 'Tone',
                   'Bird vocalization, bird call, bird song', 'Chirp, tweet', 'Canary')  # pitched chirps
    NOT_MUSIC = ('jingle, tinkle', 'speech synthesizer', 'bellow', 'belly laugh',
                 'bird vocalization, bird call, bird song')
    MUSIC_MAX = 0.10  # "drop any clip with music": PANNs' Music baseline on plain noise is 0.03-0.07
    BEEP_MAX = 0.25
    TONAL_MAX_PER_MIN = 20.0  # plain DEMAND/ACE beds give 0-3

    def __init__(self):
        import torch  # noqa: F401 - panns needs it
        from panns_inference import AudioTagging, labels

        self.tagger = AudioTagging(checkpoint_path=None, device='cpu')
        self.labels = list(labels)
        low = [lab.lower() for lab in self.labels]
        self.music_idx = [i for i, lab in enumerate(low)
                          if any(w in lab for w in self.MUSIC_WORDS) and lab not in self.NOT_MUSIC]
        self.beep_idx = [i for i, lab in enumerate(self.labels) if lab in self.BEEP_LABELS]
        self.speech_idx = [i for i, lab in enumerate(self.labels) if lab in (
            'Speech', 'Conversation', 'Babbling', 'Male speech, man speaking', 'Female speech, woman speaking',
            'Child speech, kid speaking', 'Chatter', 'Crowd', 'Hubbub, speech noise, speech babble',
            'Television', 'Radio')]

    def tag(self, x48: np.ndarray) -> np.ndarray:
        x = Audio.to_fs(x48, FS, 32000).astype(np.float32)
        win = 10 * 32000
        starts = list(range(0, max(1, len(x) - win + 1), win))
        if len(x) > win and starts[-1] + win < len(x):
            starts.append(len(x) - win)  # cover the tail
        batch = np.stack([np.pad(x[s:s + win], (0, max(0, win - len(x[s:s + win])))) for s in starts])
        probs = []
        for i in range(0, len(batch), 8):
            clip, _ = self.tagger.inference(batch[i:i + 8])
            probs.append(clip)
        return np.concatenate(probs)  # windows x 527

    @staticmethod
    def tonal_events(x48: np.ndarray) -> float:
        """Onset count per minute of stable narrowband peaks (>= 25 dB above the local spectral
        median, 80 ms - 3 s long, 150 Hz - 5 kHz): beeps/tones/ringing, not steady hum."""
        f, _, Z = signal.stft(x48, FS, nperseg=4096, noverlap=3072)
        mag = 20 * np.log10(np.abs(Z) + 1e-12)
        base = ndimage.median_filter(mag, size=(41, 1), mode='nearest')
        prom = mag - base
        band = (f >= 150) & (f <= 5000)
        tonal = (prom > 25) & band[:, None]
        tonal = ndimage.binary_dilation(tonal, structure=np.ones((3, 1)))
        lab, n = ndimage.label(tonal, structure=np.array([[0, 0, 0], [1, 1, 1], [0, 0, 0]]))
        if n == 0:
            return 0.0
        objs = ndimage.find_objects(lab)
        hop_s = 1024 / FS
        onsets = sorted(o[1].start for o in objs if 0.08 <= (o[1].stop - o[1].start) * hop_s <= 3.0)
        events = 0
        last = -10
        for o in onsets:
            if o - last > 2:
                events += 1
            last = o
        return round(events / (len(x48) / FS / 60), 2)

    def screen(self, x48: np.ndarray) -> dict:
        p = self.tag(x48)
        mx = p.max(0)
        music = float(mx[self.music_idx].max())
        beep = float(mx[self.beep_idx].max())
        speech = float(mx[self.speech_idx].max())
        top = np.argsort(-p.mean(0))[:5]
        m_top = self.labels[self.music_idx[int(np.argmax(mx[self.music_idx]))]]
        b_top = self.labels[self.beep_idx[int(np.argmax(mx[self.beep_idx]))]]
        tonal = self.tonal_events(x48)
        reasons = []
        if music > self.MUSIC_MAX:
            reasons.append(f'music:{m_top}={music:.2f}')
        if beep > self.BEEP_MAX:
            reasons.append(f'beep:{b_top}={beep:.2f}')
        if tonal > self.TONAL_MAX_PER_MIN and speech < 0.5:  # voiced speech makes these too; squeaks/beeps
            reasons.append(f'tonal events {tonal:.0f}/min without speech')
        return dict(panns_music_max=round(music, 3), panns_music_label=m_top, panns_beep_max=round(beep, 3),
                    panns_beep_label=b_top, panns_speech_max=round(speech, 3),
                    panns_top=[self.labels[i] for i in top], tonal_events_per_min=tonal,
                    contains_speech=bool(speech > 0.5), rejected=bool(reasons), reject_reasons=reasons)


class NoiseBed:
    TARGET_RMS_DBFS = -30.0
    MIN_S, MAX_S = 20.0, 60.0

    @classmethod
    def split(cls, x: np.ndarray, max_beds: int | None = None) -> list[tuple[float, np.ndarray]]:
        """Consecutive <= 60 s pieces; a remainder >= 20 s is its own bed. Returns (start_s, bed)."""
        n_max, n_min = int(cls.MAX_S * FS), int(cls.MIN_S * FS)
        out = []
        for s in range(0, len(x), n_max):
            seg = x[s:s + n_max]
            if len(seg) >= n_min:
                out.append((s / FS, seg))
            if max_beds and len(out) >= max_beds:
                break
        return out

    @classmethod
    def condition(cls, x: np.ndarray) -> tuple[np.ndarray, float]:
        x = x - x.mean()
        sos = signal.butter(2, 20, 'highpass', fs=FS, output='sos')
        x = signal.sosfilt(sos, x)
        n = int(0.05 * FS)  # 50 ms fades so beds can be looped / cut without clicks
        x[:n] *= np.sin(0.5 * np.pi * np.arange(n) / n) ** 2
        x[-n:] *= np.cos(0.5 * np.pi * np.arange(n) / n) ** 2
        rms = Audio.db(np.mean(x ** 2))  # 10 log10(power) == 20 log10(rms)
        return x * 10 ** ((cls.TARGET_RMS_DBFS - rms) / 20), rms


# --------------------------------------------------------------------------------------------
# steps


@dataclass
class Ctx:
    tmp: Path
    air_dir: Path | None
    screen: NoiseScreen | None = None

    def screener(self) -> NoiseScreen:
        if self.screen is None:
            self.screen = NoiseScreen()
        return self.screen


class Manifest:
    PATH = OUT / 'manifest.json'

    def __init__(self):
        self.data = json.loads(self.PATH.read_text()) if self.PATH.exists() else {}
        self.data.setdefault('files', [])

    def replace_set(self, set_name: str, entries: list[dict]) -> None:
        import fcntl

        self.PATH.parent.mkdir(parents=True, exist_ok=True)
        lock_path = Path(tempfile.gettempdir()) / 'synthcorpus-acoustics-manifest.lock'
        with open(lock_path, 'w') as lock:  # steps may run in parallel processes
            fcntl.flock(lock, fcntl.LOCK_EX)
            self.__init__()
            self.data['files'] = [e for e in self.data['files'] if e['set'] != set_name] + entries
            self.save()

    def save(self) -> None:
        present = sorted({e['set'] for e in self.data['files']})
        self.data.update(
            version=1, fs=FS, room_peak_at_sample=PEAK_AT,
            conventions=dict(
                rooms='mono float32 48 kHz; direct-path peak at sample 24 (0.5 ms) = +1.0; tail cut at noise floor '
                      '+ 20 ms fade. rt60_s = mean T30 over the 500/1000/2000 Hz octaves (T20 when T30 not '
                      'measurable); drr_db uses +-2.5 ms around the peak as direct part. includes_device = the IR '
                      'was captured through a phone/laptop mic, so do not stack a device IR on top.',
                devices='mono float32 48 kHz minimum phase, 1024 taps, 1/3-octave level at 1 kHz = 0 dB.',
                noise='mono float32 48 kHz, 20-60 s, RMS -30 dBFS (orig_rms_dbfs = level before), 50 ms fades; '
                      'bandwidth_hz = upper limit of the source recording.'),
            sets={k: v for k, v in SETS.items() if k in present},
            counts={k: sum(1 for e in self.data['files'] if e['set'] == k) for k in present})
        self.data['files'].sort(key=lambda e: e['path'])
        self.PATH.parent.mkdir(parents=True, exist_ok=True)
        self.PATH.write_text(json.dumps(self.data, indent=1))


class RoomSetWriter:
    def __init__(self, set_name: str):
        self.set = set_name
        self.dir = OUT / 'rooms' / set_name
        if self.dir.exists():
            shutil.rmtree(self.dir)
        self.dir.mkdir(parents=True)
        self.entries: list[dict] = []

    def add(self, name: str, raw: np.ndarray, fs: int, category: str, **meta) -> None:
        ir = RoomIR.from_measurement(raw, fs)
        path = self.dir / f'{name}.wav'
        Audio.write(path, ir.h)
        info = SETS[self.set]
        self.entries.append(dict(
            path=str(path.relative_to(OUT)), kind='room', set=self.set, licence=info['licence'],
            source_url=info['source_url'], category=category,
            includes_device=bool(info.get('includes_device')), simulated=bool(info.get('simulated')),
            **ir.metrics(), **{k: v for k, v in meta.items() if v is not None}))

    def commit(self) -> None:
        Manifest().replace_set(self.set, self.entries)
        rts = [e['rt60_s'] for e in self.entries if e['rt60_s']]
        print(f'  {self.set}: {len(self.entries)} IRs, rt60 {min(rts):.2f}-{max(rts):.2f} s, '
              f'DRR {min(e["drr_db"] for e in self.entries):.1f}..{max(e["drr_db"] for e in self.entries):.1f} dB')


# -- AIR ---------------------------------------------------------------------------------------


def air_root(ctx: Ctx) -> Path:
    if ctx.air_dir and (ctx.air_dir / 'readme.txt').exists():
        root = ctx.air_dir
    else:
        root = ctx.tmp / 'air' / 'AIR_1_4'
        if not (root / 'readme.txt').exists():
            z = Http.download(AIR_ZIP, ctx.tmp / 'air' / 'air_1_4.zip')
            with zipfile.ZipFile(z) as zf:
                zf.extractall(ctx.tmp / 'air')
            z.unlink()
    if not (root / 'wav').exists():
        with zipfile.ZipFile(root / 'AIR_wav_files.zip') as zf:
            zf.extractall(root)
    return root


def step_air(ctx: Ctx) -> None:
    import scipy.io as sio

    root = air_root(ctx)
    w = RoomSetWriter('air-binaural')
    cat = dict(booth='booth', office='office', meeting='meeting', lecture='lecture')
    for room in ('booth', 'office', 'meeting', 'lecture'):
        for f in sorted(root.glob(f'air_binaural_{room}_*_0_*.mat')):
            ch, head, idx = (int(v) for v in f.stem.split('_')[-3:])
            if head != 0 or (room == 'lecture' and (ch != 0 or idx > 2)):
                continue
            m = sio.loadmat(f)
            info = m['air_info']
            dist_cm = float(info['distance'][0][0].ravel()[0])
            fs = int(info['fs'][0][0].ravel()[0])
            w.add(f'{room}_d{idx}_ch{ch}', m['h_air'].ravel(), fs, cat[room],
                  room=room, source_distance_m=round(dist_cm / 100, 2), mic_channel=ch, dummy_head=False,
                  source_file=f.name)
    w.commit()

    w = RoomSetWriter('air-phone')
    pcat = dict(bathroom='domestic', kitchen='domestic', office1='office', meeting='meeting',
                lecture1='lecture', lecture2='lecture')
    for f in sorted((root / 'wav').glob('air_phone_*_1.wav')):
        m = re.match(r'air_phone_(\w+?)_(hhp|hfrp)_(\d)_1$', f.stem)
        if not m or m.group(1).startswith('stairway'):  # stairwells: not a place people record music
            continue
        room, pos, var = m.group(1).replace('lecutre', 'lecture'), m.group(2), int(m.group(3))
        x, fs = Audio.read(f)
        w.add(f'{room}_{pos}_{var}', x, fs, pcat.get(room, 'other'), room=room, phone_position=pos,
              measurement_series=var, mic_channel=1, source='HATS mouth simulator', source_file=f.name)
    w.commit()


# -- ACE ---------------------------------------------------------------------------------------

ACE_ROOMS = dict(Office_1=('502', 'office'), Office_2=('803', 'office'), Meeting_Room_1=('503', 'meeting'),
                 Meeting_Room_2=('611', 'meeting'), Lecture_Room_1=('508', 'lecture'),
                 Lecture_Room_2=('403a', 'lecture'), Building_Lobby=('EE_lobby', 'lobby'))
ACE_ARCHIVES = dict(Single='ACE_Corpus_RIRN_Single.tbz2', Chromebook='ACE_Corpus_RIRN_Chromebook.tbz2',
                    Mobile='ACE_Corpus_RIRN_Mobile.tbz2')


def ace_root(ctx: Ctx, config: str, with_noise: bool = False) -> Path:
    root = ctx.tmp / 'ace'
    marker = root / f'.{config}.done'
    if not marker.exists():
        pat = r'_RIR\.wav$' if not with_noise else r'(_RIR|_Noise_Ambient|_Noise_Fan)\.wav$'
        print(f'  streaming ACE {config} ...')
        Http.stream_tar_members(ZENODO.format(rec=6257551, key=ACE_ARCHIVES[config]), root, re.compile(pat))
        marker.touch()
    return root / config


def ace_rir(ctx: Ctx, config: str, room: str, pos: int) -> tuple[np.ndarray, int] | None:
    rid = ACE_ROOMS[room][0]
    f = ace_root(ctx, config, with_noise=config == 'Single') / room / str(pos) / f'{config}_{rid}_{pos}_RIR.wav'
    if not f.exists():
        return None
    x, fs = Audio.read(f, channel=None)
    return x, fs


def step_ace(ctx: Ctx) -> None:
    for config, set_name in (('Single', 'ace-single'), ('Chromebook', 'ace-chromebook'), ('Mobile', 'ace-mobile')):
        w = RoomSetWriter(set_name)
        for room, (rid, cat) in ACE_ROOMS.items():
            for pos in (1, 2):
                got = ace_rir(ctx, config, room, pos)
                if got is None:
                    print(f'  missing ACE {config} {room} {pos}')
                    continue
                x, fs = got
                w.add(f'{room.lower()}_{pos}', x[:, 0], fs, cat, room=room, ace_room_id=rid, mic_position=pos,
                      distance_class='short' if pos == 1 else 'long', mic_channel=1, n_device_channels=x.shape[1])
        w.commit()


def step_ace_devices(ctx: Ctx) -> None:
    """Device responses of the ACE laptop / phone-array mics relative to the ACE omni reference."""
    half = int(0.0025 * FS)
    nfft = DeviceIR.N_FFT
    f = np.fft.rfftfreq(nfft, 1 / FS)

    def direct_power(x: np.ndarray, fs: int) -> np.ndarray:
        h = Audio.to_fs(x, fs)
        p = RoomIR.direct_peak(h)
        seg = h[max(0, p - half): p + half]
        seg = seg * signal.windows.tukey(len(seg), 0.5)
        return np.abs(np.fft.rfft(seg, nfft)) ** 2

    out = OUT / 'devices'
    out.mkdir(parents=True, exist_ok=True)
    entries = []
    # (the ACE 'Mobile' mock-up array comes out flat within +-1 dB against Single: no device to model)
    for config, name in (('Chromebook', 'ace_chromebook_pixel_laptop'),):
        ratios = []
        for room in ACE_ROOMS:
            for pos in (1, 2):
                ref, dev = ace_rir(ctx, 'Single', room, pos), ace_rir(ctx, config, room, pos)
                if ref is None or dev is None:
                    continue
                pr = smooth_fractional_octave(f, direct_power(ref[0][:, 0], ref[1]), 3)
                pd = smooth_fractional_octave(f, direct_power(dev[0][:, 0], dev[1]), 3)
                ratios.append(pd / np.maximum(pr, pr.max() * 1e-8))
        mag = np.sqrt(np.exp(np.mean(np.log(np.maximum(np.array(ratios), 1e-12)), axis=0)))
        mag[f > 20000] = mag[np.searchsorted(f, 20000)] * np.exp(-(f[f > 20000] - 20000) / 1500)
        mag[f < 50] = mag[np.searchsorted(f, 50)]
        dev_ir = DeviceIR.from_magnitude(mag)
        path = out / f'{name}.wav'
        Audio.write(path, dev_ir.h)
        info = SETS['ace-derived']
        entries.append(dict(path=str(path.relative_to(OUT)), kind='device', set='ace-derived',
                            licence=info['licence'], source_url=info['source_url'],
                            category='laptop' if config == 'Chromebook' else 'phone',
                            device=config, n_positions_averaged=len(ratios), estimated=True, **dev_ir.metrics()))
    Manifest().replace_set('ace-derived', entries)
    print(f'  ace-derived: {len(entries)} device responses')


# -- Motus -------------------------------------------------------------------------------------

MOTUS_BEST = ('0020', '0166', '0171', '0178', '0212', '0769')


def step_motus(ctx: Ctx, n_extra: int = 42) -> None:
    Disk.check('motus')
    best = open_remote_zip(ZENODO.format(rec=4923187, key='best_of.zip'))
    raw = open_remote_zip(ZENODO.format(rec=4923187, key='raw_rirs.zip'))
    meta_zip = open_remote_zip(ZENODO.format(rec=4923187, key='metadata.zip'))
    meta_names = {Path(n).name: n for n in meta_zip.namelist()}
    all_ids = sorted({n.split('_')[0] for n in raw.namelist() if n.endswith('_raw_rirs.wav')})
    extra = [i for i in np.array(all_ids)[np.linspace(0, len(all_ids) - 1, n_extra + 8).round().astype(int)]
             if i not in MOTUS_BEST][:n_extra]
    jobs = [(cid, s, best, f'raw_rirs/{cid}_{s}_raw_rirs.wav', f'metadata/JSON/{cid}_metadata.json', True)
            for cid in MOTUS_BEST for s in (1, 2, 3)]
    jobs += [(cid, 1 + k % 3, raw, f'{cid}_{1 + k % 3}_raw_rirs.wav', None, False) for k, cid in enumerate(extra)]
    w = RoomSetWriter('motus')
    for cid, s, zf, member, meta_member, is_best in jobs:
        x, fs = sf.read(io.BytesIO(zf.read(member)), dtype='float64', always_2d=True)
        cap = int(np.argmax(np.abs(x).max(0)))  # strongest direct path = the capsule facing the source
        if meta_member is None:
            meta_member = meta_names.get(f'{cid}_metadata.json')
        dist, n_obj, vol = None, None, None
        try:
            md = json.loads((best if is_best else meta_zip).read(meta_member))
            dist = round(float(np.linalg.norm(np.subtract(md[f'src{s}']['position'], md['rcv']['position']))), 3)
            n_obj = int(sum(o.get('quantity', 1) for o in md['room']['objects'] if o.get('type') != 'emptyroom'))
            vol = round(float(md['room']['volume']), 2)
        except Exception as e:  # noqa: BLE001 - metadata is nice-to-have
            print(f'  motus {cid}: no metadata ({e})')
        w.add(f'{cid}_src{s}', x[:, cap], fs, 'domestic', configuration=cid, source_index=s, em32_capsule=cap + 1,
              source_distance_m=dist, furniture_objects=n_obj, room_volume_m3=vol, best_of=is_best)
    w.commit()


# -- dEchorate ---------------------------------------------------------------------------------

DECHORATE_MICS = np.array([
    [0.85771319, 0.89503133, 0.94167901, 1.00232099, 1.09561634, 0.81689747, 0.80321666, 0.78611565,
     0.76388435, 0.72968233, 2.18273871, 2.21808934, 2.26227762, 2.31972238, 2.40809895, 3.34254184,
     3.36391593, 3.39063355, 3.42536645, 3.47880169, 3.77147839, 3.74389361, 3.70941264, 3.66458736,
     3.59562541, 3.12959949, 3.09740374, 3.05715905, 3.00484095, 2.92435157],
    [3.90990039, 3.92430026, 3.9423001, 3.9656999, 4.00169958, 2.24411235, 2.20652464, 2.15954001,
     2.09845999, 2.00449073, 1.7263214, 1.70760421, 1.68420772, 1.65379228, 1.6069993, 2.35745543,
     2.3912659, 2.43352899, 2.48847101, 2.57299719, 3.96471105, 3.93574418, 3.89953559, 3.85246441,
     3.78004723, 3.37230619, 3.39604294, 3.42571389, 3.46428611, 3.523628],
    [1.039] * 5 + [0.98] * 5 + [1.163] * 5 + [1.31] * 5 + [0.91] * 5 + [1.46] * 5])
DECHORATE_SRC_DIR = np.array([[1.991, 1.523, 4.287, 4.619, 1.523, 4.447],
                              [4.498, 0.883, 2.069, 3.669, 0.723, 2.069],
                              [1.424, 1.044, 1.074, 1.504, 1.184, 1.214]])


def step_dechorate(ctx: Ctx, per_config: int = 5, max_dist: float = 2.3, min_dry_drr: float = 2.0) -> None:
    import h5py

    path = Http.download(ZENODO.format(rec=5562386, key='dechorate_rir_processed.hdf5'),
                         ctx.tmp / 'dechorate' / 'dechorate_rir_processed.hdf5')
    c = 331.3 + 0.606 * 24  # the dataset's own speed of sound (24 degC)
    w = RoomSetWriter('dechorate')
    with h5py.File(path, 'r') as fh:
        # Pairs are chosen once, in the fully absorbent room ('000000'): the first strong arrival must
        # match the geometric TOA and the DRR there must be >= min_dry_drr. A directional loudspeaker
        # pointing away from the array fails the DRR test (dry room, weak direct path) - singers face
        # their phone, so those pairs are left out.
        dry = fh['000000'][()]
        pairs = []
        for mic in range(30):
            for s in range(6):
                d = float(np.linalg.norm(DECHORATE_MICS[:, mic] - DECHORATE_SRC_DIR[:, s]))
                if d > max_dist:
                    continue
                h = Audio.to_fs(dry[:, mic, s], FS)
                if abs(RoomIR.direct_peak(h) - d / c * FS) > 12:
                    continue
                if RoomIR.from_measurement(h, FS).drr_db() < min_dry_drr:
                    continue
                pairs.append((d, mic // 5, mic, s))
        by_array_src: dict[tuple[int, int], tuple] = {}
        for d, arr, mic, s in pairs:  # one mic per (array, source): the array centre if it qualifies
            key = (arr, s)
            if key not in by_array_src or abs(mic % 5 - 2) < abs(by_array_src[key][2] % 5 - 2):
                by_array_src[key] = (d, arr, mic, s)
        pairs = sorted(by_array_src.values())
        print(f'  dechorate: {len(pairs)} facing source/array pairs <= {max_dist} m: '
              f'{[(round(p[0], 2), p[1], p[3]) for p in pairs]}')
        for k_cfg, cfg in enumerate(sorted(fh.keys())):
            x = fh[cfg][()]  # samples x 30 mics x 7 sources
            chosen = pairs
            if len(pairs) > per_config:  # rotate through the pairs so every pair appears in several rooms
                chosen = [pairs[(k_cfg * per_config + i) % len(pairs)] for i in range(per_config)]
            for d, arr, mic, s in chosen:
                w.add(f'{cfg}_arr{arr}_mic{mic}_src{s}', x[:, mic, s], FS, 'lab', wall_config=cfg, array=arr,
                      mic_index=mic, source_index=s, source_distance_m=round(d, 3))
    w.commit()
    shutil.rmtree(ctx.tmp / 'dechorate', ignore_errors=True)


# -- SuRIR -------------------------------------------------------------------------------------


def step_surir(ctx: Ctx, per_measurement: int = 2) -> None:
    import h5py

    w = RoomSetWriter('surir')
    for room in ('RoomA', 'RoomB'):
        key = f'{room}_Mannequin_Sweep5s.sofa'
        path = Http.download(ZENODO.format(rec=21494888, key=key), ctx.tmp / 'surir' / key)
        with h5py.File(path, 'r') as fh:
            ir = fh['Data.IR']
            fs = int(fh['Data.SamplingRate'][0])
            src = fh['SourcePosition'][()]
            lis = fh['ListenerPosition'][()]
            rcv = fh['ReceiverPosition'][()][:, :, 0]
            desc = fh.attrs.get('RoomDescription', b'')
            seen = set()
            k = 0
            for m in range(ir.shape[0]):
                tag = (tuple(np.round(src[m], 2)), tuple(np.round(lis[m], 2)))
                if tag in seen:  # 4 successive repetitions per configuration: keep the first
                    continue
                seen.add(tag)
                d_all = np.linalg.norm(rcv - src[m], axis=1)
                far = [r for r in range(len(rcv)) if d_all[r] > 1.0]  # the other array
                # a loudspeaker facing away from the far array (DRR < -6 dB at ~1.8 m in a ~0.4-0.7 s room)
                # is not what a singer facing their phone produces: keep facing pairs only
                ok = [r for r in far if RoomIR.from_measurement(ir[m, r, :], fs).drr_db() >= -6.0]
                for j in range(min(per_measurement, len(ok))):
                    r = ok[(k + j) % len(ok)]
                    w.add(f'{room}_m{m:02d}_mic{r}', ir[m, r, :], fs, 'domestic', room=room,
                          room_description=desc.decode() if isinstance(desc, bytes) else str(desc),
                          measurement=m, receiver=r, source_distance_m=round(float(d_all[r]), 3),
                          mannequin_position=[round(float(v), 2) for v in lis[m]])
                k += 1
        path.unlink()
    w.commit()


# -- pyroomacoustics ---------------------------------------------------------------------------


def step_pra(ctx: Ctx, n: int = 150, seed: int = 20260926) -> None:
    import pyroomacoustics as pra

    rng = np.random.default_rng(seed)
    w = RoomSetWriter('pra-domestic')
    made = 0
    while made < n:
        dim = np.array([rng.uniform(3.0, 6.0), rng.uniform(3.0, 5.0), rng.uniform(2.5, 2.8)])
        rt60 = rng.uniform(0.2, 0.6)
        try:
            e_abs, max_order = pra.inverse_sabine(rt60, dim)
        except ValueError:
            continue
        margin = 0.4
        mic = np.array([rng.uniform(margin, dim[0] - margin), rng.uniform(margin, dim[1] - margin),
                        rng.uniform(0.7, 1.6)])
        dist = rng.uniform(0.3, 2.0)
        for _ in range(100):
            az, el = rng.uniform(0, 2 * np.pi), rng.uniform(-0.35, 0.5)
            src = mic + dist * np.array([np.cos(el) * np.cos(az), np.cos(el) * np.sin(az), np.sin(el)])
            if np.all(src > margin) and np.all(src < dim - margin) and 0.8 <= src[2] <= 1.9:
                break
        else:
            continue
        room = pra.ShoeBox(dim, fs=FS, materials=pra.Material(e_abs), max_order=min(max_order, 120),
                           air_absorption=True, use_rand_ism=True, max_rand_disp=0.05)
        room.add_source(src)
        room.add_microphone(mic)
        room.compute_rir()
        h = np.asarray(room.rir[0][0], dtype=np.float64)
        w.add(f'pra_{made:03d}', h, FS, 'domestic', room_dim_m=[round(float(v), 2) for v in dim],
              target_rt60_s=round(float(rt60), 3), wall_energy_absorption=round(float(e_abs), 4),
              max_order=int(min(max_order, 120)), source_distance_m=round(float(dist), 3),
              source_pos_m=[round(float(v), 2) for v in src], mic_pos_m=[round(float(v), 2) for v in mic])
        made += 1
    w.commit()


# -- devices -----------------------------------------------------------------------------------


def step_poliphone(ctx: Ctx) -> None:
    z = open_remote_zip(ZENODO.format(rec=13903412, key='POLIPHONE.zip'))
    names = sorted(n for n in z.namelist() if re.search(r'IRs_devices/IR_.*\.npy$', n))
    out = OUT / 'devices'
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob('poliphone_*.wav'):
        old.unlink()
    entries = []
    info = SETS['poliphone']
    for n in names:
        h = np.load(io.BytesIO(z.read(n)))
        dev = DeviceIR.from_measurement(h.ravel(), 44100)
        model = Path(n).stem.removeprefix('IR_')
        path = out / f'poliphone_{model}.wav'
        Audio.write(path, dev.h)
        entries.append(dict(path=str(path.relative_to(OUT)), kind='device', set='poliphone',
                            licence=info['licence'], source_url=info['source_url'], category='phone',
                            device=model, brand=model.split('_')[0], source_fs=44100, bandwidth_hz=22050,
                            source_file=n, **dev.metrics()))
    Manifest().replace_set('poliphone', entries)
    print(f'  poliphone: {len(entries)} phones')


# -- noise -------------------------------------------------------------------------------------


class NoiseSetWriter:
    def __init__(self, ctx: Ctx, set_name: str):
        self.ctx = ctx
        self.set = set_name
        self.dir = OUT / 'noise' / set_name
        if self.dir.exists():
            shutil.rmtree(self.dir)
        self.dir.mkdir(parents=True)
        self.entries: list[dict] = []
        self.rejected: list[dict] = []
        self.digests: dict[str, str] = {}

    def add_recording(self, stem: str, x: np.ndarray, fs: int, category: str, max_beds: int | None = None,
                      **meta) -> int:
        """Cut, condition and screen one recording. Music is judged per recording too: when at least
        half of its beds show music, the rest almost certainly carries it below the detector's
        threshold (a radio/TV/PA in the background), so the whole recording is dropped."""
        digest = hashlib.sha1(np.round(np.asarray(x[: 10 * fs]) * 32767).astype(np.int16).tobytes()).hexdigest()
        if digest in self.digests:  # MS-SNSD ships some files twice under different categories
            print(f'    skip {stem}: duplicate of {self.digests[digest]}')
            self.rejected.append(dict(name=stem, reasons=[f'duplicate of {self.digests[digest]}']))
            return 0
        self.digests[digest] = stem
        x48 = Audio.to_fs(x, fs)
        beds = []
        for start_s, seg in NoiseBed.split(x48, max_beds):
            bed, rms = NoiseBed.condition(seg.copy())
            name = f'{stem}_{int(start_s):03d}'
            if rms < -85:
                self.rejected.append(dict(name=name, reasons=['digital silence']))
                continue
            beds.append((name, start_s, bed, rms, self.ctx.screener().screen(bed)))
        n_music = sum(any(r.startswith('music:') for r in b[4]['reject_reasons']) for b in beds)
        if beds and n_music * 2 >= len(beds):
            for b in beds:
                if not b[4]['rejected']:
                    b[4]['rejected'] = True
                    b[4]['reject_reasons'].append(f'recording-level: music in {n_music}/{len(beds)} beds')
        kept = 0
        info = SETS[self.set]
        for name, start_s, bed, rms, scr in beds:
            if scr['rejected']:
                self.rejected.append(dict(name=name, reasons=scr['reject_reasons']))
                print(f'    reject {name}: {scr["reject_reasons"]}')
                continue
            path = self.dir / f'{name}.wav'
            Audio.write(path, bed)
            self.entries.append(dict(
                path=str(path.relative_to(OUT)), kind='noise', set=self.set, licence=info['licence'],
                source_url=info['source_url'], category=category, duration_s=round(len(bed) / FS, 2),
                source_offset_s=round(start_s, 2), source_fs=int(fs), bandwidth_hz=int(min(fs, FS) // 2),
                orig_rms_dbfs=round(rms, 1), **{k: v for k, v in scr.items() if k not in ('rejected', 'reject_reasons')},
                **meta))
            kept += 1
        return kept

    def commit(self) -> None:
        Manifest().replace_set(self.set, self.entries)
        (self.dir / '_rejected.json').write_text(json.dumps(self.rejected, indent=1))
        mins = sum(e['duration_s'] for e in self.entries) / 60
        print(f'  {self.set}: {len(self.entries)} beds ({mins:.1f} min), {len(self.rejected)} rejected')


DEMAND_ENVS = dict(DKITCHEN='home', DLIVING='home', DWASHING='home', OOFFICE='office', OMEETING='office',
                   OHALLWAY='office', PCAFETER='cafe', PRESTO='cafe', SCAFE='cafe', STRAFFIC='street',
                   SPSQUARE='street')


def step_demand(ctx: Ctx) -> None:
    w = NoiseSetWriter(ctx, 'demand')
    for env, cat in DEMAND_ENVS.items():
        Disk.check(f'DEMAND {env}')
        z = open_remote_zip(ZENODO.format(rec=1227121, key=f'{env}_48k.zip'))
        x, fs = Audio.read(io.BytesIO(z.read(f'{env}/ch01.wav')))
        n = w.add_recording(env.lower(), x, fs, cat, environment=env, channel='ch01')
        print(f'    {env}: {n} beds')
    w.commit()


# SqueakyChair is left out: pitched squeals (PANNs tags half of the files as music/synth/alarm)
SNSD_CATS = dict(AirConditioner='home', VacuumCleaner='home', WasherDryer='home', Munching='home',
                 Neighbor='home', NeighborSpeaking='home', ShuttingDoor='home',
                 Typing='office', CopyMachine='office', Babble='cafe')
SNSD_GROUP = dict(Neighbor='NeighborSpeaking')


def snsd_listing(ctx: Ctx) -> list[str]:
    cache = ctx.tmp / 'snsd_tree.json'
    if not cache.exists():
        try:
            cache.write_bytes(Http.get(SNSD_TREE))
            json.loads(cache.read_text())
        except Exception:  # noqa: BLE001 - unauthenticated API hiccups: fall back to the gh CLI
            cache.write_text(subprocess.run(['gh', 'api', SNSD_TREE.removeprefix('https://api.github.com/')],
                                            check=True, capture_output=True, text=True).stdout)
    return [t['path'] for t in json.loads(cache.read_text())['tree'] if t['path'].endswith('.wav')]


def step_snsd(ctx: Ctx, max_beds_per_cat: int = 8) -> None:
    w = NoiseSetWriter(ctx, 'ms-snsd')
    by_cat: dict[str, list[str]] = {}
    for p in snsd_listing(ctx):
        m = re.match(r'noise_(train|test)/([A-Za-z]+?)_?\d+\.wav$', p)
        if m and m.group(2) in SNSD_CATS:
            by_cat.setdefault(SNSD_GROUP.get(m.group(2), m.group(2)), []).append(p)
    for cat, paths in sorted(by_cat.items()):
        # alternate train/test files so both halves are represented, cap beds per category
        paths = sorted(paths, key=lambda p: (int(re.search(r'(\d+)\.wav$', p).group(1)), p))
        kept = 0
        for p in paths:
            if kept >= max_beds_per_cat:
                break
            Disk.check(p)
            x, fs = Audio.read(io.BytesIO(Http.get(SNSD_RAW + p)))
            if len(x) / fs < NoiseBed.MIN_S:
                continue
            stem = re.sub(r'\W+', '_', Path(p).stem.lower()) + ('_t' if p.startswith('noise_test') else '')
            kept += w.add_recording(stem, x, fs, SNSD_CATS.get(cat, 'home'), max_beds=min(2, max_beds_per_cat - kept),
                                    snsd_category=cat, source_file=p)
        print(f'    {cat}: {kept} beds')
    w.commit()


def step_ace_noise(ctx: Ctx) -> None:
    w = NoiseSetWriter(ctx, 'ace-noise')
    root = ace_root(ctx, 'Single', with_noise=True)
    for room, (rid, cat) in ACE_ROOMS.items():
        for kind in ('Ambient', 'Fan'):
            f = root / room / '1' / f'Single_{rid}_1_Noise_{kind}.wav'
            if not f.exists():
                print(f'  missing {f}')
                continue
            x, fs = Audio.read(f)
            category = 'office' if cat in ('office', 'meeting', 'lecture') else 'public'
            if kind == 'Fan' and cat != 'lobby':
                category = 'home'  # a fan running in a closed room: the bed a bedroom/living room has too
            w.add_recording(f'{room.lower()}_{kind.lower()}', x, fs, category, max_beds=2, room=room,
                            noise_type=kind.lower())
    w.commit()


STEPS = dict(air=step_air, ace=step_ace, motus=step_motus, dechorate=step_dechorate, surir=step_surir,
             pra=step_pra, poliphone=step_poliphone, **{'ace-devices': step_ace_devices}, demand=step_demand,
             snsd=step_snsd, **{'ace-noise': step_ace_noise}, manifest=lambda ctx: Manifest().save())


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('steps', nargs='*', default=list(STEPS), choices=list(STEPS))
    ap.add_argument('--tmp', type=Path, default=Path(os.environ.get(
        'ACOUSTICS_TMP', Path(tempfile.gettempdir()) / 'synthcorpus-acoustics')))
    ap.add_argument('--air-dir', type=Path, default=os.environ.get('ACOUSTICS_AIR_DIR'),
                    help='an already extracted AIR_1_4 directory (skips the download)')
    args = ap.parse_args()
    args.tmp.mkdir(parents=True, exist_ok=True)
    ctx = Ctx(tmp=args.tmp, air_dir=Path(args.air_dir) if args.air_dir else None)
    for s in args.steps:
        t = time.time()
        print(f'== {s}')
        STEPS[s](ctx)
        print(f'   ({time.time() - t:.0f} s)')


if __name__ == '__main__':
    main()
