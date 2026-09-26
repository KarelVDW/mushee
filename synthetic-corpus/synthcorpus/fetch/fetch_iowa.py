"""University of Iowa Musical Instrument Samples (MIS) -> normalised single-note sample sets.

Source: https://theremin.music.uiowa.edu/MIS.html -- "may be downloaded and used for any
projects, without restrictions". Output: `assets/samples/iowa/<timbre>/` with `zones.json` +
`notes/*.wav` (mono, native 44.1 kHz or 96k->48 kHz, 24-bit PCM), see assets/samples/FORMAT.md.

Which recordings:
  * strings (violin, viola, cello, double bass): the Dec 2011 - May 2012 re-recordings
    (`MIS<inst>2012.html`, 3 x Earthworks QTC40), their `.mono.aif` renders. Arco only, plus
    double-bass pizz.
  * winds, brass, guitar: the original anechoic recordings, pp / mf / ff. The site's
    "post-2012" wind/brass pages are *not* new recordings: they are ff-only re-edits of these
    same takes (normalised to -0.4 dB, denoised, mid/side fake stereo), which would destroy the
    relative dynamics, so they are not used.

Most MIS files are chromatic runs ("Oboe.ff.C4B4.aiff"). Each file is sliced into notes by
energy (silence gaps + re-attacks) and pitch (a stable semitone change splits a region). Every
note's root is measured: SwiftF0 (pYIN outside SwiftF0's G1-C7 band, or when SwiftF0 flickers)
gives the coarse pitch over the steady part, a narrow-band YIN refines it, and a harmonic-series
check resolves octave disagreements with the file name. `nominal` is the note's place in the
run (dynamic-programming alignment of the measured roots to the named range). Notes with
unstable/unclear pitch, fragments (tails, sympathetic ringing), and notes outside the file's
labelled range after octave analysis are rejected; every decision is recorded per source file
in zones.json["files"]. Site defects handled: mislinked / unlinked / 404 files (probed by name),
bare root-relative links, and the viola-2012 mono renders whose header says 44.1 kHz for
unresampled 96 kHz data (detected from the pitches, re-read at 96 kHz). All output gets a
sub-sonic high-pass (building rumble reaches -20 dBFS below 30 Hz in the 2012 sessions).

    cd synthetic-corpus && PYTHONPATH=. uv run python -m synthcorpus.fetch.fetch_iowa \
        [timbre ...] [--force] [--tmp DIR] [--qa]
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf
from numpy.lib.stride_tricks import sliding_window_view
from scipy.signal import butter, medfilt, resample_poly, sosfilt, welch

BASE = 'https://theremin.music.uiowa.edu/'
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'assets' / 'samples' / 'iowa'
MIN_FREE_GB = 12.0
DYNS = ('pp', 'mf', 'ff')


class Pitch:
    NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
    PC = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}

    @classmethod
    def parse(cls, s: str) -> int:
        m = re.fullmatch(r'([A-G])([b#]?)(\d)', s)
        acc = {'b': -1, '#': 1, '': 0}[m.group(2)]
        return 12 * (int(m.group(3)) + 1) + cls.PC[m.group(1)] + acc

    @classmethod
    def name(cls, midi: int) -> str:
        return f'{cls.NAMES[midi % 12]}{midi // 12 - 1}'

    @staticmethod
    def hz(midi: float) -> float:
        return float(440.0 * 2 ** ((midi - 69) / 12))


@dataclass
class Instrument:
    timbre: str
    page: str  # instrument page, relative to BASE
    keep: str  # regex over the linked file name
    lo: int  # plausible sounding MIDI range (sanity bound only)
    hi: int
    strings: dict[str, str] = field(default_factory=dict)  # 'sulG' -> open-string pitch
    plucked: bool = False
    vib: bool = False  # library default articulation carries vibrato (wider pitch tolerance)

    def is_plucked(self, art: str) -> bool:
        return self.plucked or art == 'pizz'


VIOLIN_STR = {'sulG': 'G3', 'sulD': 'D4', 'sulA': 'A4', 'sulE': 'E5'}
VIOLA_STR = {'sulC': 'C3', 'sulG': 'G3', 'sulD': 'D4', 'sulA': 'A4'}
CELLO_STR = {'sulC': 'C2', 'sulG': 'G2', 'sulD': 'D3', 'sulA': 'A3'}
BASS_STR = {'sulC': 'C1', 'sulE': 'E1', 'sulA': 'A1', 'sulD': 'D2', 'sulG': 'G2'}
GUITAR_STR = {'sulE': 'E2', 'sulA': 'A2', 'sulD': 'D3', 'sulG': 'G3', 'sulB': 'B3', 'sul_E': 'E4'}

INSTRUMENTS = [
    Instrument('violin', 'MISviolin2012.html', r'^Violin\.arco\..*\.mono\.aif$', 55, 105, VIOLIN_STR, vib=True),
    Instrument('viola', 'MISviola2012.html', r'^Viola\.arco\..*\.mono\.aif$', 48, 96, VIOLA_STR, vib=True),
    Instrument('cello', 'MIScello2012.html', r'^Cello\.arco\..*\.mono\.aif$', 36, 86, CELLO_STR, vib=True),
    Instrument('contrabass', 'MISdoublebass2012.html', r'^Bass\.(arco|pizz)\..*\.mono\.aif$', 24, 72, BASS_STR, vib=True),
    Instrument('flute', 'MISflute.html', r'^Flute\.(vib|nonvib)\.(pp|mf|ff)\..*\.aiff?$', 58, 100),
    Instrument('alto-flute', 'MISaltoflute.html', r'^AltoFlute\.(pp|mf|ff)\..*\.aiff?$', 53, 94, vib=True),
    Instrument('oboe', 'MISoboe.html', r'^Oboe\.(pp|mf|ff)\..*\.aiff?$', 57, 95, vib=True),
    Instrument('clarinet', 'MISBbclarinet.html', r'^BbClar\.(pp|mf|ff)\..*\.aiff?$', 49, 98),
    Instrument('bass-clarinet', 'MISbassclarinet.html', r'^BassClarinet\.(pp|mf|ff)\..*\.aiff?$', 33, 86),
    Instrument('bassoon', 'MISbassoon.html', r'^Bassoon\.(pp|mf|ff)\..*\.aiff?$', 33, 78, vib=True),
    Instrument('soprano-sax', 'MISsopranosaxophone.html', r'^SopSax\.(Vib|NoVib)\.(pp|mf|ff)\..*\.aiff?$', 54, 92),
    Instrument('alto-sax', 'MISaltosaxophone.html', r'^AltoSax\.(Vib|NoVib)\.(pp|mf|ff)\..*\.aiff?$', 48, 86),
    Instrument('trumpet', 'MISBbtrumpet.html', r'^Trumpet\.(vib|novib)\.(pp|mf|ff)\..*\.aiff?$', 50, 90),
    Instrument('french-horn', 'MISFrenchhorn.html', r'^Horn\.(pp|mf|ff)\..*\.aiff?$', 29, 81, vib=True),
    Instrument('trombone', 'MIStenortrombone.html', r'^TenorTrombone\.(pp|mf|ff)\..*\.aiff?$', 28, 80, vib=True),
    Instrument('tuba', 'MIStuba.html', r'^Tuba\.(pp|mf|ff)\..*\.aiff?$', 21, 68, vib=True),
    Instrument('guitar', 'MISguitar.html', r'^Guitar\.(pp|mf|ff)\..*\.mono\.aif$', 40, 90, GUITAR_STR, plucked=True),
]


@dataclass
class MisFile:
    """One linked MIS file and what its name claims: articulation, dynamic, string, pitch range."""

    path: str  # site path relative to BASE, as linked
    name: str
    art: str
    dyn: str
    lo: int
    hi: int
    string: str | None = None
    label_note: str = ''

    ART = {'vib': 'vib', 'nonvib': 'nonvib', 'novib': 'nonvib', 'arco': 'sus', 'pizz': 'pizz'}
    RANGE = re.compile(r'([A-G][b#]?\d)([A-G][b#]?\d)?')

    @classmethod
    def parse(cls, path: str, inst: Instrument) -> MisFile | None:
        name = path.rsplit('/', 1)[-1]
        toks = [t.strip() for t in name.split('.')]
        dyn = next((t for t in toks if t in DYNS), None)
        rng = next((m for m in (cls.RANGE.fullmatch(t) for t in toks) if m), None)
        if dyn is None or rng is None:
            return None
        lo = Pitch.parse(rng.group(1))
        hi = Pitch.parse(rng.group(2)) if rng.group(2) else lo
        note = ''
        if hi < lo:  # e.g. "BassClarinet.pp.Db2C2": the upper bound lost an octave
            while hi < lo:
                hi += 12
            note = f'name range {rng.group(0)} read as {Pitch.name(lo)}-{Pitch.name(hi)}'
        art = next((cls.ART[t.lower()] for t in toks if t.lower() in cls.ART), 'sus')
        sul = next((t for t in toks if t.startswith('sul')), None)
        string = inst.strings.get(sul) if sul else None
        return cls(path, name.replace('\t', ''), art, dyn, lo, hi, string, note)

    @property
    def expected(self) -> int:
        return self.hi - self.lo + 1

    def offset(self, midi: int) -> int | None:
        """0 if `midi` fits the labelled range, +-12 if it fits it an octave off; a 1-semitone
        slack for sloppy names is only granted after the exact octave matches (so the C6 at the
        end of a "C5B5" file is an octave error of C5, not a name off by one)."""
        for slack in (0, 1):
            for d in (0, 12, -12, 24, -24):
                if self.lo - slack <= midi - d <= self.hi + slack:
                    return d
        return None


class Site:
    """The MIS web site: instrument pages, file links, HEAD probes and downloads."""

    def __init__(self):
        self._pages: dict[str, str] = {}

    @staticmethod
    def url(path: str) -> str:
        return BASE + urllib.parse.quote(path, safe='/')

    def page(self, page: str) -> str:
        if page not in self._pages:
            out = subprocess.run(['curl', '-sfL', '--retry', '3', '-m', '120', BASE + page], capture_output=True, check=True)
            self._pages[page] = out.stdout.decode('latin-1')
        return self._pages[page]

    def size(self, path: str) -> int | None:
        req = urllib.request.Request(self.url(path), method='HEAD')
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return int(r.headers.get('Content-Length', 0)) or None
        except Exception:
            return None

    def files(self, inst: Instrument) -> tuple[list[MisFile], list[str]]:
        """Linked files for `inst` that exist, plus files the page forgot or mislinked: the same
        name with another dynamic, and the mono twin of every linked stereo file (the double-bass
        page links "Bass.arco.sulD.pp.Bb2C4.mono.aif", a 404; the stereo link says Bb3C4)."""
        keep = re.compile(inst.keep)
        hrefs = [h.replace('\t', '') for h in re.findall(r'href="([^"]+)"', self.page(inst.page), flags=re.I)]
        # "Violin.arco.pp.sulA.C7<TAB>.mono.aif"; "TenorTrombone.pp. E2B2.aiff"
        clean = lambda p: p.rsplit('/', 1)[-1].replace(' ', '')
        links: list[str] = []
        for h in hrefs:
            if keep.search(clean(h)) and h not in links:
                links.append(h)
        cands: list[str] = []
        for p in links + [h.replace('.stereo.', '.mono.') for h in hrefs if '.stereo.' in h]:
            d, _, n = p.rpartition('/')  # some links are bare names at the site root (tenor trombone ff)
            for dyn in DYNS:
                c = re.sub(r'\.(pp|mf|ff)\.', f'.{dyn}.', n, count=1)
                c = f'{d}/{c}' if d else c
                if keep.search(clean(c)) and c not in links and c not in cands:
                    cands.append(c)
        log = []
        sizes: dict[int, str] = {}
        for p in list(links):
            sz = self.size(p)
            if sz is None:
                links.remove(p)
                log.append(f'{clean(p)}: linked from {inst.page} but missing on the server (404)')
            else:
                sizes.setdefault(sz, p)
        for c in cands:
            sz = self.size(c)
            if sz is None or sz in sizes:
                continue
            sizes[sz] = c
            links.append(c)
            log.append(f'{clean(c)}: exists on the server but is not linked from {inst.page}; used')
        files = [f for f in (MisFile.parse(p, inst) for p in links) if f is not None]
        return files, log

    def download(self, path: str, dest: Path) -> Path:
        dest.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(['curl', '-sfL', '--retry', '4', '--retry-delay', '3', '-m', '900', '-o', str(dest), self.url(path)], check=True)
        return dest


@dataclass
class Track:
    """Frame-wise pitch: times [s], fractional MIDI, confidence in [0, 1]."""

    t: np.ndarray
    midi: np.ndarray
    conf: np.ndarray
    thr: float  # confidence above which a frame counts as voiced
    method: str

    SWIFT_LO, SWIFT_HI = 33, 94  # MIDI band where SwiftF0 (46.9-2093.8 Hz) is comfortable
    _swift = None

    @classmethod
    def swift(cls, x: np.ndarray, sr: int, t0: float = 0.0) -> Track:
        from swift_f0 import SwiftF0

        if cls._swift is None:
            cls._swift = SwiftF0()
        r = cls._swift.detect(x, sr)
        midi = librosa.hz_to_midi(np.maximum(r.pitch_hz, 1.0))
        return cls(t0 + np.asarray(r.timestamps), midi, np.asarray(r.confidence), 0.6, 'swiftf0')

    @classmethod
    def pyin(cls, x: np.ndarray, sr: int, lo: float, hi: float, t0: float = 0.0) -> Track:
        fmin = max(Pitch.hz(lo), 18.0)
        fmax = Pitch.hz(hi)
        sr_ds = 8000 if fmax < 1500 else sr
        fmax = min(fmax, 0.45 * sr_ds)
        y = librosa.resample(x, orig_sr=sr, target_sr=sr_ds) if sr_ds != sr else x
        hop = int(round(0.016 * sr_ds))
        fl = int(2 ** np.ceil(np.log2(max(1024, 2.5 * sr_ds / fmin))))
        if len(y) < fl + hop:
            return cls.empty('pyin')
        f0, vf, vp = librosa.pyin(y, fmin=fmin, fmax=fmax, sr=sr_ds, frame_length=fl, hop_length=hop, center=True)
        t = t0 + librosa.times_like(f0, sr=sr_ds, hop_length=hop)
        midi = librosa.hz_to_midi(np.nan_to_num(f0, nan=1.0).clip(1.0))
        # the Viterbi voicing decision counts; the raw voiced probability of brass pedal tones
        # stays near 0.1 even when the f0 path is rock steady
        conf = np.where(vf & np.isfinite(f0), 0.5 + 0.5 * vp, 0.5 * vp)
        edge = ~np.isfinite(f0) | (f0 <= fmin * 1.01) | (f0 >= fmax * 0.99)  # pinned to the search band
        conf[edge] = 0.0
        return cls(t, midi, conf, 0.5, 'pyin')

    @classmethod
    def empty(cls, method: str) -> Track:
        return cls(np.zeros(0), np.zeros(0), np.zeros(0), 0.5, method)

    @classmethod
    def measure(cls, x: np.ndarray, sr: int, f: MisFile, t0: float = 0.0) -> Track:
        """SwiftF0 when the file's range sits in its band, else pYIN over the range +-13 st.
        The input is normalised to -1 dBFS first: SwiftF0's confidence drops on quiet input."""
        pk = float(np.abs(x).max()) if len(x) else 0.0
        if pk > 0:
            x = x * (0.89 / pk)
        if f.lo >= cls.SWIFT_LO and f.hi <= cls.SWIFT_HI:
            return cls.swift(x, sr, t0)
        return cls.pyin(x, sr, f.lo - 13, f.hi + 13, t0)

    @classmethod
    def concat(cls, parts: list[Track]) -> Track:
        if not parts:
            return cls.empty('none')
        return cls(*(np.concatenate([getattr(p, k) for p in parts]) for k in ('t', 'midi', 'conf')),
                   parts[0].thr, parts[0].method)

    def voiced(self, a: float, b: float) -> tuple[np.ndarray, int]:
        sel = (self.t >= a) & (self.t <= b)
        return self.midi[sel & (self.conf >= self.thr)], int(sel.sum())


@dataclass
class Note:
    start: int  # samples in the source file
    end: int
    peak_db: float
    root: float | None = None
    coarse: float | None = None
    voiced: float = 0.0
    stable: float = 0.0
    method: str = ''
    a: float = 0.0  # steady part [s] the pitch was measured over
    b: float = 0.0
    flags: list[str] = field(default_factory=list)
    reject: str | None = None
    label: int | None = None  # the semitone this note has in the file's chromatic run
    offrun: bool = False  # sounds an octave away from its place in the run (spectrum-confirmed)

    @property
    def nominal(self) -> int:
        return self.label if self.label is not None else int(round(self.root))


class RunSlicer:
    """Slices one MIS file (a chromatic run of separated notes) and measures each note.

    1. energy regions: RMS envelope (5 ms hop, >= 20 ms / 2.5 periods window) of a high-passed
       copy above max(floor + 8 dB, file peak - 65 dB), gaps < 50 ms closed, regions peaking more
       than 35 dB under the file's loudest note dropped (tails, finger/key noise);
    2. pitch track per region (level-normalised), then regions are cut at re-attacks
       (a >= 15 dB rise within 150 ms; 10 dB for plucked) and at stable 0.6-3.5 semitone pitch
       changes (legato steps of the run; octave jumps are tracker glitches, never cuts);
       contiguous pieces that turn out to be the same note are merged back;
    3. per note: onset = attack start (10 ms pre-roll kept; steady breath/key noise more than
       30 dB down is not part of the attack), end = first 200 ms stretch below
       max(peak - 60 dB, floor + 3 dB) or the next onset; root measured over the steady part;
       notes shorter than 0.4 s (0.2 s plucked) or 20 dB under the run's median are fragments.
    """

    HOP = 0.005
    WIN = 0.020

    def __init__(self, x: np.ndarray, sr: int, f: MisFile, inst: Instrument):
        self.sr, self.f, self.inst = sr, f, inst
        self.plucked = inst.is_plucked(f.art)
        # MIS (esp. the 2012 strings/guitar) carries strong sub-sonic building rumble, up to
        # -20 dBFS below 30 Hz. The output gets a 4th-order high-pass an octave below the
        # instrument's lowest note; detection (envelope + pitch) one ~1.5 octaves below the file.
        self.out = self._highpass(x, sr, float(np.clip(0.5 * Pitch.hz(inst.lo), 15, 40)))
        self.x = self._highpass(x, sr, float(np.clip(0.35 * Pitch.hz(f.lo), 15, 150)))
        self.h = int(round(sr * self.HOP))
        # >= 2.5 periods of the lowest note, or a 30 Hz tuba pedal ripples the envelope by 15 dB
        self.w = int(round(sr * max(self.WIN, 2.5 / Pitch.hz(f.lo - 2))))
        self.starts, self.db = self._envelope(self.x, self.w, self.h)
        self.ft = (self.starts + self.w / 2) / sr
        self.db_smooth = np.convolve(self.db, np.ones(7) / 7, mode='same')  # 35 ms
        nz = self.db[self.db > -140]
        self.floor = float(max(np.percentile(nz, 3), -110)) if len(nz) else -110.0
        self.peak = float(self.db.max())
        self.track = Track.empty('none')
        self.major = 0  # file-level octave offset of the measurement vs the file name
        self.log: list[str] = []

    @staticmethod
    def _highpass(x: np.ndarray, sr: int, cutoff: float) -> np.ndarray:
        return sosfilt(butter(4, cutoff, 'highpass', fs=sr, output='sos'), x).astype(np.float32)

    @staticmethod
    def _envelope(x: np.ndarray, w: int, h: int) -> tuple[np.ndarray, np.ndarray]:
        c = np.concatenate([[0.0], np.cumsum(x.astype(np.float64) ** 2)])
        starts = np.arange(0, max(len(x) - w, 0) + 1, h)
        ms = (c[starts + w] - c[starts]) / w
        return starts, 10 * np.log10(ms + 1e-15)

    # ------------------------------------------------------------ segmentation

    def _energy_regions(self) -> list[tuple[int, int]]:
        thr = max(self.floor + 8, self.peak - 65)
        d = np.diff(np.concatenate([[0], (self.db > thr).astype(np.int8), [0]]))
        merged: list[list[int]] = []
        for a, b in zip(np.nonzero(d == 1)[0], np.nonzero(d == -1)[0]):
            if merged and a - merged[-1][1] < 10:
                merged[-1][1] = int(b)
            else:
                merged.append([int(a), int(b)])
        tops = [float(self.db[a:b].max()) for a, b in merged]
        loud = max(tops) if tops else self.peak
        return [(a, b) for (a, b), t in zip(merged, tops) if b - a >= 20 and t >= loud - 35]

    def _region_track(self, a: int, b: int) -> Track:
        s0 = max(int(self.starts[a]) - int(0.05 * self.sr), 0)
        s1 = min(int(self.starts[b - 1]) + self.w + int(0.05 * self.sr), len(self.x))
        return Track.measure(self.x[s0:s1], self.sr, self.f, s0 / self.sr)

    def _reattacks(self, a: int, b: int) -> list[int]:
        k = 30  # 150 ms look-back
        if b - a < 2 * k:
            return []
        db = self.db[a:b]
        mins = sliding_window_view(db, k).min(axis=1)
        rise = np.full(len(db), -np.inf)
        rise[k:] = db[k:] - mins[: len(db) - k]
        need = 10.0 if self.plucked else 15.0
        top = db.max()
        cuts: list[tuple[int, int]] = []
        for t in np.argsort(-rise):
            if rise[t] < need:
                break
            if t < k or len(db) - t < 20 or db[t : t + 20].max() < top - (20 if self.plucked else 30):
                continue
            if any(abs(t - c) < 40 for c, _ in cuts):
                continue
            cuts.append((int(t), a + t - k + int(np.argmin(db[t - k : t]))))
        return [c for _, c in cuts]

    def _pitch_cuts(self, a: int, b: int) -> list[int]:
        tr = self.track
        sel = np.nonzero((tr.t >= self.ft[a]) & (tr.t <= self.ft[b - 1]) & (tr.conf >= tr.thr))[0]
        if len(sel) < 24:
            return []
        m = medfilt(tr.midi[sel], 5)
        cuts, j, run0 = [], 8, 0
        while j < len(m) - 12:
            ref = np.median(m[max(run0, j - 15) : j])
            nxt = np.median(m[j : j + 12])
            if 0.6 < abs(nxt - ref) < 3.5 and np.all(np.abs(m[j : j + 12] - nxt) < 0.5):
                c = int(np.searchsorted(self.ft, tr.t[sel[j]]))
                lo, hi = max(a, c - 16), min(b - 1, c + 16)
                cuts.append(lo + int(np.argmin(self.db[lo : hi + 1])))
                run0, j = j, j + 12
            else:
                j += 1
        return cuts

    def pieces(self) -> list[list]:
        """[a, b, contiguous-with-previous] frame ranges, one per candidate note."""
        regs = self._energy_regions()
        self.track = Track.concat([self._region_track(a, b) for a, b in regs])
        out: list[list] = []
        for a, b in regs:
            cuts = sorted(set(self._reattacks(a, b)) | set(self._pitch_cuts(a, b)))
            edges = [a]
            for c in cuts:
                if c - edges[-1] >= 20 and b - c >= 20:
                    edges.append(c)
            edges.append(b)
            out += [[edges[i], edges[i + 1], i > 0] for i in range(len(edges) - 1)]
        return out

    # ------------------------------------------------------------ notes

    def notes(self) -> list[Note]:
        pieces = self.pieces()
        notes = self._build(pieces)
        merged = True
        while merged:  # a cut that split one note: glue the pieces back together
            merged = False
            for i in range(1, len(pieces)):
                if pieces[i][2] and self._same_note(notes[i - 1], notes[i]):
                    pieces[i - 1][1] = pieces[i][1]
                    del pieces[i]
                    notes = self._build(pieces)
                    merged = True
                    break
        self._check_labels(notes)
        self._assign_labels(notes)
        self._mark_repeats(notes)
        return notes

    @staticmethod
    def _same_note(p: Note, q: Note) -> bool:
        """q (contiguous after p) continues p: same pitch, or a > 12 dB quieter piece within
        0.75 st (a decay cut by finger / bow noise), or a pitchless sliver."""
        if p.root is not None and q.root is not None:
            d = abs(p.root - q.root)
            return d < 0.5 or (d < 0.75 and q.peak_db < p.peak_db - 12)
        return (p.root is None) != (q.root is None)  # a pitchless sliver next to a note

    def _build(self, pieces: list[list]) -> list[Note]:
        onsets = [self._onset(a, b, pieces[i - 1][1] if i else 0) for i, (a, b, _) in enumerate(pieces)]
        notes = []
        for i, (a, b, _) in enumerate(pieces):
            pk = float(self.db[a:b].max())
            nxt = onsets[i + 1] if i + 1 < len(pieces) else len(self.x)
            n = Note(max(onsets[i] - int(0.010 * self.sr), 0), self._end(a, b, pk, nxt), pk)
            self._measure(n, onsets[i])
            notes.append(n)
        return notes

    def _onset(self, a: int, b: int, prev_b: int) -> int:
        """Attack start: walk back from the body of the note while the envelope stays above the
        onset threshold (plucked: from the peak, 30 dB down, so finger noise before the pluck is
        not a note start), then locate the crossing on a 0.5 ms envelope."""
        db = self.db
        pk = float(db[a:b].max())
        if self.plucked:
            thr = max(self.floor + 8, pk - 30)
            j = a + int(np.argmax(db[a:b]))
        else:
            thr = max(self.floor + 10, pk - 45)
            j = a + int(np.argmax(db[a:b] >= pk - 20))
        sm = self.db_smooth
        while j - 1 >= prev_b and db[j - 1] > thr:
            k = j - 1
            # more than 30 dB down, keep walking back only while the attack is still rising
            # (40 ms earlier >= 1 dB lower): steady breath / key / bow noise before it stays out
            if sm[k] < pk - 30 and not sm[max(k - 8, 0)] < sm[k] - 1.0:
                break
            j = k
        s0 = max(int(self.starts[j]) - int(0.01 * self.sr), int(self.starts[prev_b]) if prev_b else 0)
        s1 = min(int(self.starts[j]) + self.w + int(0.02 * self.sr), len(self.x))
        fw, fh = max(int(0.002 * self.sr), 8), max(int(0.0005 * self.sr), 2)
        st, fdb = self._envelope(self.x[s0:s1], fw, fh)
        above = np.nonzero(fdb > thr)[0]
        return s0 + int(st[above[0]]) if len(above) else int(self.starts[j])

    def _end(self, a: int, b: int, pk: float, next_onset: int) -> int:
        lim = max(pk - 60, self.floor + 3)
        p = a + int(np.argmax(self.db[a:b]))
        k_max = min(int(np.searchsorted(self.starts, next_onset - self.w)), len(self.db))
        below = self.db[p:k_max] < lim
        hold = 40  # 200 ms
        if len(below) >= hold:
            quiet = np.nonzero(sliding_window_view(below, hold).all(axis=1))[0]
            if len(quiet):
                return int(min(self.starts[p + quiet[0]] + self.w, next_onset, len(self.x)))
        return int(min(next_onset, len(self.x)))

    def _steady(self, n: Note, onset: int) -> tuple[float, float]:
        sr = self.sr
        i0 = int(np.searchsorted(self.starts, onset))
        i1 = int(np.searchsorted(self.starts, n.end - self.w))
        db = self.db[i0 : max(i1, i0 + 1)]
        p = i0 + int(np.argmax(db))
        t_on, t_pk = onset / sr, self.ft[min(p, len(self.ft) - 1)]
        if self.plucked:  # measure early, while the partials stand well above the noise
            above = np.nonzero(db > n.peak_db - 20)[0]
            t_end = self.ft[i0 + above[-1]] if len(above) else t_pk + 0.3
            a = t_pk + (0.08 if self.f.art == 'pizz' else 0.05)
            return a, max(min(t_end, t_pk + 1.2), a + 0.15)
        above = np.nonzero(db > n.peak_db - 20)[0]
        t_end = (self.ft[i0 + above[-1]] if len(above) else n.end / sr) - 0.05
        a = t_on + max(0.1, 0.1 * (t_end - t_on))
        if t_end - a < 0.15:
            a, t_end = t_on + 0.05, n.end / sr - 0.05
        return a, t_end

    def _measure(self, n: Note, onset: int):
        a, b = self._steady(n, onset)
        n.a, n.b = a, b
        min_len = 0.2 if self.plucked else 0.4  # MIS notes last 1-8 s; shorter = tail/noise
        if b - a < 0.08 or (n.end - n.start) / self.sr < min_len:
            n.reject = f'too short ({(n.end - n.start) / self.sr:.2f} s)'
            return
        tol = 0.7 if (self.f.art == 'vib' or self.inst.vib) else 0.5
        seg = self.x[int(a * self.sr) : int(b * self.sr)]
        got = self._summarise(self.track, a, b, tol)
        if isinstance(got, str) and self.track.method == 'swiftf0':
            # SwiftF0 sometimes flickers to +25 st garbage or goes quiet: independent second opinion
            alt = self._summarise(Track.pyin(seg / max(float(np.abs(seg).max()), 1e-9), self.sr,
                                             self.f.lo - 13, self.f.hi + 13, a), a, b, tol)
            if not isinstance(alt, str):
                got = alt
                n.flags.append('swiftf0 unsteady, pyin used')
        if isinstance(got, str):
            n.reject = got
            return
        n.coarse, n.voiced, n.stable, n.method, folded = got
        if folded > 0.05:
            n.flags.append(f'{folded:.0%} of pitch frames octave-folded')
        n.root = self._root(n, seg, n.coarse)
        if abs(n.root - round(n.root)) > 0.6:
            n.reject = f'{n.root:.2f} is > 60 cents from any semitone'

    @staticmethod
    def _summarise(tr: Track, a: float, b: float, tol: float) -> tuple | str:
        """(median MIDI, voiced fraction, stable fraction, method, octave-folded fraction) of the
        track over [a, b], or the reason it is not a clean single pitch."""
        v, total = tr.voiced(a, b)
        voiced = len(v) / max(total, 1)
        if len(v) < 5 or voiced < 0.4:
            return f'unvoiced ({len(v)}/{total} frames)'
        # fold frames where the tracker hopped an octave onto the most common octave of the
        # dominant pitch class (a plain median fails when the hops are ~50/50)
        ang = np.angle(np.mean(np.exp(2j * np.pi * v / 12)))
        pc0 = (ang * 12 / (2 * np.pi)) % 12
        octs = np.round((v - pc0) / 12).astype(int)
        m_ref = pc0 + 12 * Counter(octs.tolist()).most_common(1)[0][0]
        folded = v - 12 * np.round((v - m_ref) / 12)
        frac_folded = float(np.mean(np.abs(folded - v) > 6))
        m0 = float(np.median(folded))
        stable = float(np.mean(np.abs(folded - m0) <= tol))
        if stable < 0.7:
            return f'unstable pitch ({stable:.0%} of frames within {tol} st)'
        return m0, voiced, stable, tr.method, frac_folded

    def _root(self, n: Note, seg: np.ndarray, m0: float) -> float:
        """YIN-refined pitch near the coarse estimate m0 (SwiftF0 drifts by up to ~40 cents near
        the top of its band); the coarse value is kept when YIN finds no steady period."""
        n.flags = [x for x in n.flags if not x.startswith('yin')]
        ref = self._refine(seg, m0)
        if ref is None:
            n.flags.append('yin refine failed, tracker pitch kept')
            return m0
        if abs(ref - m0) > 0.3:
            n.flags.append(f'yin {ref:.2f} replaces tracker {m0:.2f}')
        return ref

    def _refine(self, seg: np.ndarray, m0: float) -> float | None:
        mid = len(seg) // 2
        seg = seg[max(0, mid - int(1.5 * self.sr)) : mid + int(1.5 * self.sr)]
        fmin, fmax = Pitch.hz(m0 - 1.5), Pitch.hz(m0 + 1.5)
        fl = int(2 ** np.ceil(np.log2(max(1024, 4 * self.sr / fmin))))
        if len(seg) < fl + fl // 4:
            return None
        f = librosa.yin(seg, fmin=fmin, fmax=fmax, sr=self.sr, frame_length=fl, hop_length=fl // 4, center=False)
        f = f[(f > fmin * 1.02) & (f < fmax * 0.98)]
        if len(f) < 3:
            return None
        m = librosa.hz_to_midi(f)
        q1, med, q3 = np.percentile(m, [25, 50, 75])
        return float(med) if q3 - q1 < 0.6 and abs(med - m0) < 1.0 else None

    def _octave_ok(self, seg: np.ndarray, f0: float, shift: int) -> bool:
        """Does the spectrum allow moving the measured f0 by `shift` (-12: the true fundamental
        is f0/2, the tracker locked onto the 2nd partial; +12: f0 is a sub-octave error)?"""
        nper = int(2 ** np.ceil(np.log2(np.clip(24 * self.sr / f0, 4096, 65536))))  # resolve f0/2
        while nper > len(seg) and nper > 1024:
            nper //= 2
        if len(seg) < nper:
            return False
        fr, P = welch(seg, self.sr, nperseg=nper)
        df = fr[1] - fr[0]

        def band(f: float) -> float:
            if f >= 0.45 * self.sr:
                return 1e-20
            bw = max(2 * df, 0.015 * f)
            sel = (fr >= f - bw) & (fr <= f + bw)
            return float(P[sel].max()) + 1e-20 if sel.any() else 1e-20

        top = max(max(band(k * f0) for k in range(1, 9)), float(P.max()) * 1e-2)
        if shift == -12:
            # a real partial at f0/2 (within 30 dB of the strongest, >= 6 dB proud), or - for a weak /
            # missing fundamental (bass C1 extension) - the odd multiples of f0/2 carry the series
            lo = (fr > 0.35 * f0) & (fr < 0.65 * f0)
            bed = float(np.median(P[lo])) + 1e-20 if lo.any() else 1e-20
            h = band(f0 / 2)
            wide = (fr > 0.35 * f0) & (fr < 3.65 * f0)
            floor = float(np.median(P[wide])) + 1e-20 if wide.any() else 1e-20
            halves = [band((k + 0.5) * f0) for k in (1, 2, 3)]
            whole = sum(band(k * f0) for k in (1, 2, 3, 4))
            series = sum(halves) > 0.02 * whole and sum(v > 10 * floor for v in halves) >= 2
            return (h > top * 1e-3 and h > bed * 4) or series
        odd = sum(band(k * f0) for k in (1, 3, 5, 7))
        even = sum(band(k * f0) for k in (2, 4, 6, 8))
        strong = max(band(2 * f0), band(4 * f0)) > float(P.max()) * 1e-2  # the octave really is a partial
        return strong and odd < 0.1 * even  # f0 and its odd multiples (next to) absent

    def _check_labels(self, notes: list[Note]):
        ok = [n for n in notes if n.reject is None]
        med = float(np.median([n.peak_db for n in ok])) if ok else 0.0
        # tails / sympathetic ringing / key noise split off a note sit far below the run's notes
        # (reference: the median; for sustained runs the upper quartile, fragments drag the median)
        ref = med if self.plucked or not ok else float(np.percentile([n.peak_db for n in ok], 75))
        if ok:
            for n in ok:
                short = not self.plucked and (n.end - n.start) / self.sr < 1.5  # MIS sustains last >= 1.3 s
                if n.peak_db < ref - 20 or (short and n.peak_db < ref - 15):
                    n.reject = f'fragment ({ref - n.peak_db:.0f} dB under the run\'s typical note peak)'
            ok = [n for n in ok if n.reject is None]
        offs = {id(n): self.f.offset(n.nominal) for n in ok}
        votes = Counter(d for d in offs.values() if d is not None)
        major = self.major = 0
        if votes and votes.most_common(1)[0][0] != 0 and votes.most_common(1)[0][1] >= 0.7 * len(ok):
            cand = votes.most_common(1)[0][0]
            # a mislabelled file, or a tracker that is consistently an octave off (bass C1-string
            # notes with no energy at the fundamental)? The spectra decide.
            step = -12 if cand > 0 else 12
            back = [all(self._octave_ok(self.x[int(n.a * self.sr) : int(n.b * self.sr)], Pitch.hz(n.root + k * step), step)
                        for k in range(abs(cand) // 12)) for n in ok if offs[id(n)] == cand]
            if sum(back) < 0.5 * len(back):
                major = self.major = cand
        if major:
            self.log.append(f'file name octave looks wrong: measured notes sit {major:+d} st from the '
                            f'labelled {Pitch.name(self.f.lo)}-{Pitch.name(self.f.hi)}; labels taken from the measurement')
        for n in ok:
            d = offs[id(n)]
            if d is not None and d != major:  # octave disagreement with the file: tracker error?
                seg = self.x[int(n.a * self.sr) : int(n.b * self.sr)]
                shift = major - d
                step = 12 if shift > 0 else -12
                steps = [self._octave_ok(seg, Pitch.hz(n.root + k * step), step) for k in range(abs(shift) // 12)]
                if steps and all(steps):
                    n.root = self._root(n, seg, (n.coarse or n.root) + shift)
                    n.flags.append(f'tracker octave error fixed ({shift:+d} st, spectrum agrees)')
                    d = major
                    if any(x.startswith('yin refine failed') for x in n.flags):
                        n.reject = 'octave-corrected pitch not confirmed by YIN'
                        continue
                elif steps and not steps[0] and self.f.lo - 1 <= round(n.root) - major <= self.f.hi + 1:
                    d = major  # no sub-octave partial: just the sharp top note of the run (e.g. C6 in "C5B5")
                elif steps and not steps[0] and shift < 0 and abs(n.root - round(n.root)) <= 0.35 \
                        and n.stable >= 0.9 and n.peak_db >= med - 10 \
                        and not any(x.startswith(('swiftf0 unsteady', 'yin refine failed')) for x in n.flags):
                    # nothing at all where the run expects the fundamental: the note really sounds an
                    # octave higher (a flageolet); keep it, labelled from the measurement. The other
                    # direction is not trusted: sympathetic open strings fake a lower octave
                    n.offrun = True
                    n.flags.append(f'sounds {-shift:+d} st from its place in the run (spectrum confirms); '
                                   f'label from the measurement')
                    d = major
            if d is None:
                n.reject = f'{n.root:.2f} outside labelled range {Pitch.name(self.f.lo)}-{Pitch.name(self.f.hi)}'
            elif d != major:
                n.reject = f'{n.root:.2f} an octave off the file\'s other notes'
            elif self.f.string and n.root < Pitch.parse(self.f.string) - 0.6:
                n.reject = f'{n.root:.2f} below the open {self.f.string} string'
            elif not self.inst.lo - 1 <= n.root <= self.inst.hi + 1:
                n.reject = f'{n.root:.2f} outside the instrument range'
            elif major:
                n.flags.append(f'label fixed from measurement (file name {major:+d} st off)')

    def _assign_labels(self, notes: list[Note]):
        """nominal = the library's label: align the kept notes (time order) to the ascending
        chromatic run of the file name (+-1 semitone slack) so that every note gets a distinct
        semitone within 0.75 st of its measured root, minimising the total deviation. When no
        such alignment exists (e.g. drifting intonation) nominal falls back to round(root)."""
        ok = [n for n in notes if n.reject is None and not n.offrun]
        if not ok:
            return
        exp = np.arange(self.f.lo - 1, self.f.hi + 2) + self.major
        cost = np.abs(np.array([n.root for n in ok])[:, None] - exp[None, :])
        cost[cost > 0.75] = np.inf
        cost[:, [0, -1]] += 0.3  # the slack semitones outside the name's range only when needed
        best = np.full(cost.shape, np.inf)
        back = np.zeros(cost.shape, dtype=int)
        best[0] = cost[0]
        for i in range(1, len(ok)):
            run, arg = np.inf, -1
            for j in range(len(exp)):
                if j and best[i - 1, j - 1] < run:
                    run, arg = best[i - 1, j - 1], j - 1
                best[i, j] = run + cost[i, j]
                back[i, j] = arg
        j = int(np.argmin(best[-1]))
        if not np.isfinite(best[-1, j]):
            self.log.append('kept notes do not align with an ascending chromatic run; nominal = nearest semitone')
            return
        for i in range(len(ok) - 1, -1, -1):
            ok[i].label = int(exp[j])
            if ok[i].label != int(round(ok[i].root)):
                ok[i].flags.append(f'nominal {Pitch.name(ok[i].label)} from its place in the run (measured {ok[i].root:.2f})')
            j = back[i, j]

    def true_rate(self, notes: list[Note]) -> int | None:
        """A sample rate under which the measured pitches fit the file name's range where they do
        not under the header's rate (a mislabelled header shifts every note by 12*log2(ratio)).
        Only shifts of > 3 st that are not octave multiples are considered: 44.1 vs 48 kHz (1.5 st)
        is indistinguishable from intonation (the MIS alto flute plays its top octave up to 57
        cents sharp) and 22.05 / 88.2 kHz from an octave error of the tracker."""
        roots = np.array([n.root for n in notes if n.root is not None])
        if len(roots) < 3:
            return None

        def fit(shift: float) -> float:
            return float(np.mean([self.f.offset(int(round(v + shift))) == 0 for v in roots]))

        base = fit(0.0)
        def telling(shift: float) -> bool:  # > 3 st, and not an octave multiple (= octave error)
            return abs(shift) > 3 and abs(shift - 12 * round(shift / 12)) > 0.5

        cands = [(fit(12 * np.log2(c / self.sr)), c) for c in (32000, 44100, 48000, 96000)
                 if telling(12 * np.log2(c / self.sr))]
        best = max(cands, default=(0.0, None))
        return best[1] if best[0] >= 0.7 and base <= 0.3 else None

    def _mark_repeats(self, notes: list[Note]):
        """A chromatic run holds each semitone once; two separate notes landing on the same
        semitone are both real recordings (usually drifting intonation), so both are kept."""
        by: dict[int, list[Note]] = defaultdict(list)
        for n in notes:
            if n.reject is None:
                by[n.nominal].append(n)
        for k, group in by.items():
            if len(group) > 1:
                self.log.append(f'{Pitch.name(k)} measured {len(group)}x (' + ', '.join(f'{n.root:.2f}' for n in group) + ')')
                for n in group:
                    n.flags.append('semitone measured twice in this run')


class SetWriter:
    """Accumulates one timbre's zones and writes the normalised set."""

    def __init__(self, inst: Instrument, out: Path):
        self.inst = inst
        self.dir = out / inst.timbre
        self.zones: list[dict] = []
        self.files: list[dict] = []
        self.site_log: list[str] = []
        self._names: Counter = Counter()
        if self.dir.exists():
            shutil.rmtree(self.dir)
        (self.dir / 'notes').mkdir(parents=True)

    @staticmethod
    def _rate(sr: int) -> int:
        return sr if sr in (44100, 48000) else (48000 if sr % 48000 == 0 else 44100)

    def add(self, f: MisFile, x: np.ndarray, sr: int, notes: list[Note]):
        out_sr = self._rate(sr)
        for n in notes:
            if n.reject is not None:
                continue
            y = x[n.start : n.end].astype(np.float64)
            if out_sr != sr:
                g = np.gcd(out_sr, sr)
                y = resample_poly(y, out_sr // g, sr // g)
            guard = min(int(0.002 * out_sr), len(y))
            y[:guard] *= 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, guard))
            y = np.clip(y, -1.0, 1.0 - 2**-23)
            base = f'{f.art}_{f.dyn}_{Pitch.name(n.nominal)}' + (f'_str{f.string}' if f.string else '')
            k = self._names[base]
            self._names[base] += 1
            fname = f'{base}{f"_{k}" if k else ""}.wav'
            sf.write(self.dir / 'notes' / fname, y.astype(np.float32), out_sr, subtype='PCM_24')
            z = {'file': f'notes/{fname}', 'root': round(float(n.root), 3), 'nominal': n.nominal, 'dyn': f.dyn,
                 'art': f.art, 'rr': 0, 'loop': None, 'src': f.name}
            if f.string:
                z['string'] = f.string
            if n.flags:
                z['flags'] = n.flags
            self.zones.append(z)

    def report(self, f: MisFile, notes: list[Note], log: list[str], method: str, sr: int = 1):
        kept = [n for n in notes if n.reject is None]
        self.files.append({
            'src': f.name, 'range': f'{Pitch.name(f.lo)}-{Pitch.name(f.hi)}', 'expected': f.expected,
            'segments': len(notes), 'kept': len(kept), 'pitch': method,
            'kept_notes': [Pitch.name(n.nominal) for n in sorted(kept, key=lambda n: n.root)],
            'rejected': [f'@{n.start / sr:.1f}s: {n.reject}' for n in notes if n.reject is not None],
            'log': ([f.label_note] if f.label_note else []) + log,
        })

    def finish(self):
        groups: dict[tuple, list[dict]] = defaultdict(list)
        for z in self.zones:
            groups[(z['nominal'], z['dyn'], z['art'])].append(z)
        for g in groups.values():
            for i, z in enumerate(sorted(g, key=lambda z: (z.get('string', ''), z['src']))):
                z['rr'] = i
        self.zones.sort(key=lambda z: (z['art'], DYNS.index(z['dyn']), z['root'], z['rr']))
        exp = sum(r['expected'] for r in self.files)
        seg = sum(r['segments'] for r in self.files)
        mislabel = [r['src'] for r in self.files if any('octave looks wrong' in s for s in r['log'])]
        rate = [r['src'] for r in self.files if any(s.startswith('header says') for s in r['log'])]
        offrun = [z['file'] for z in self.zones if any(s.startswith('sounds ') for s in z.get('flags', []))]
        short = [f"{r['src']} ({r['kept']}/{r['expected']})" for r in self.files if r['kept'] < r['expected']]
        text = (f"Sliced from {len(self.files)} MIS files ({exp} notes claimed by the file names, {seg} segments "
                f"found, {len(self.zones)} kept). Chromatic runs split by energy gaps / re-attacks / pitch changes; "
                f"root = median f0 over the steady part (SwiftF0 or pYIN coarse, narrow-band YIN refine); "
                f"nominal = the note's place in the file's chromatic run (measured roots aligned to the named range), "
                f"else the nearest semitone; notes outside the named range after octave analysis are rejected. "
                f"rr = index among zones sharing (nominal, dyn, art), e.g. the same pitch on different strings. "
                f"Level untouched (relative pp/mf/ff preserved); 2 ms start guard only; a 4th-order high-pass at "
                f"{float(np.clip(0.5 * Pitch.hz(self.inst.lo), 15, 40)):.0f} Hz (an octave below the lowest note) removes the "
                f"recordings' sub-sonic building rumble. ")
        if self.inst.page.endswith('2012.html'):
            text += ('Source: the Dec 2011 - May 2012 re-recordings (not the older anechoic string set), their .mono.aif '
                     'renders (16-bit; 96 kHz data resampled to 48 kHz, 44.1 kHz kept). ')
        elif self.inst.timbre == 'guitar':
            text += 'Source: .mono.aif renders (24-bit 96 kHz), resampled to 48 kHz. '
        else:
            text += 'Source: original anechoic recordings (16-bit 44.1 kHz mono); the post-2012 ff-only re-edits were not used. '
        if rate:
            text += (f"{len(rate)} file(s) carry a wrong sample rate in their header (unresampled 96 kHz data labelled "
                     f"44.1 kHz: every note sat 13.47 st low); re-read at the rate that fits the names: {', '.join(rate)}. ")
        if offrun:
            text += (f"Notes that sound an octave away from their place in the run (spectrum-confirmed, e.g. played as "
                     f"flageolet) are kept with the measured label: {', '.join(offrun)}. ")
        if mislabel:
            text += f"Octave-mislabelled source files (labels fixed from the measurement): {', '.join(mislabel)}. "
        if short:
            text += f"Files yielding fewer notes than their name claims (see files[].rejected): {', '.join(short)}. "
        text += ' '.join(self.site_log)
        meta = {
            'name': f'iowa-{self.inst.timbre}', 'timbre': self.inst.timbre,
            'source': 'University of Iowa Musical Instrument Samples', 'url': 'https://theremin.music.uiowa.edu/MIS.html',
            'page': BASE + self.inst.page,
            'licence': 'free for any use (MIS terms: "may be downloaded and used for any projects, without restrictions")',
            'notes': text.strip(), 'zones': self.zones, 'files': self.files,
        }
        (self.dir / 'zones.json').write_text(json.dumps(meta, indent=1))


class IowaFetcher:
    def __init__(self, tmp: Path, out: Path = OUT):
        self.site = Site()
        self.tmp = tmp
        self.out = out

    @staticmethod
    def free_gb() -> float:
        return shutil.disk_usage('/').free / 1e9

    @staticmethod
    def load(path: Path, tmp: Path) -> tuple[np.ndarray, int]:
        try:
            x, sr = sf.read(str(path), dtype='float32', always_2d=True)
        except Exception:
            wav = tmp / (path.stem + '.dec.wav')
            subprocess.run(['afconvert', '-f', 'WAVE', '-d', 'LEF32', str(path), str(wav)], check=True, capture_output=True)
            x, sr = sf.read(str(wav), dtype='float32', always_2d=True)
            wav.unlink()
        return x.mean(axis=1), int(sr)

    def run(self, inst: Instrument, force: bool = False) -> bool:
        if (self.out / inst.timbre / 'zones.json').exists() and not force:
            print(f'[{inst.timbre}] already done, skipping (--force to redo)', flush=True)
            return True
        free = self.free_gb()
        print(f'[{inst.timbre}] free disk {free:.1f} GB', flush=True)
        if free < MIN_FREE_GB:
            print(f'[{inst.timbre}] STOP: free disk below {MIN_FREE_GB} GB', flush=True)
            return False
        files, site_log = self.site.files(inst)
        print(f'[{inst.timbre}] {len(files)} files', *site_log, sep='\n  ', flush=True)
        writer = SetWriter(inst, self.out)
        writer.site_log = site_log
        work = self.tmp / inst.timbre
        work.mkdir(parents=True, exist_ok=True)
        for i, f in enumerate(files):
            if self.free_gb() < MIN_FREE_GB:
                print(f'[{inst.timbre}] STOP mid-instrument: free disk below {MIN_FREE_GB} GB', flush=True)
                return False
            src = work / f.name.replace(' ', '')
            try:
                self.site.download(f.path, src)
            except subprocess.CalledProcessError:
                writer.report(f, [], ['download failed'], '-')
                print(f'  {f.name}: DOWNLOAD FAILED', flush=True)
                continue
            x, sr = self.load(src, work)
            src.unlink()
            sl = RunSlicer(x, sr, f, inst)
            notes = sl.notes()
            true_sr = sl.true_rate(notes)
            if true_sr:  # e.g. the viola-2012 "44.1 kHz" renders hold unresampled 96 kHz data
                msg = (f'header says {sr} Hz but the notes only fit the file name when read at {true_sr} Hz '
                       f'(+{12 * np.log2(true_sr / sr):.2f} st); re-read at {true_sr} Hz')
                sr = true_sr
                sl = RunSlicer(x, sr, f, inst)
                notes = sl.notes()
                sl.log.insert(0, msg)
            writer.add(f, sl.out, sr, notes)
            writer.report(f, notes, sl.log, sl.track.method, sr)
            kept = [n for n in notes if n.reject is None]
            print(f'  [{i + 1}/{len(files)}] {f.name}: {len(kept)}/{f.expected} kept, {len(notes)} segs'
                  + (f' | {"; ".join(sl.log)}' if sl.log else '')
                  + ''.join(f'\n      rej @{n.start / sr:.1f}s: {n.reject}' for n in notes if n.reject), flush=True)
        writer.finish()
        shutil.rmtree(work, ignore_errors=True)
        return True


class QualityReport:
    def __init__(self, out: Path = OUT):
        self.out = out

    def rows(self) -> list[dict]:
        rows = []
        for d in sorted(p for p in self.out.iterdir() if (p / 'zones.json').exists()):
            meta = json.loads((d / 'zones.json').read_text())
            zs = meta['zones']
            roots = np.array([z['root'] for z in zs]) if zs else np.zeros(0)
            size = sum(p.stat().st_size for p in (d / 'notes').glob('*.wav')) / 1e6
            rows.append({
                'timbre': d.name, 'zones': len(zs),
                'range': f'{Pitch.name(int(round(roots.min())))}-{Pitch.name(int(round(roots.max())))}' if len(roots) else '-',
                'min_root': float(roots.min()) if len(roots) else None, 'max_root': float(roots.max()) if len(roots) else None,
                'dyns': ','.join(k for k in DYNS if any(z['dyn'] == k for z in zs)),
                'arts': ','.join(sorted({z['art'] for z in zs})),
                'in30c': float(np.mean(np.abs(roots - np.round(roots)) <= 0.30)) if len(roots) else 0.0,
                'mean_dev_c': float(np.mean(roots - np.round(roots)) * 100) if len(roots) else 0.0,
                'claimed': sum(f['expected'] for f in meta['files']),
                'size_mb': size,
            })
        return rows

    def print(self):
        rows = self.rows()
        print(f"{'timbre':14} {'zones':>5} {'claimed':>7} {'range':>10} {'min':>6} {'max':>6} {'dyns':9} {'arts':16} {'<=30c':>6} {'meanc':>6} {'MB':>7}")
        for r in rows:
            print(f"{r['timbre']:14} {r['zones']:5d} {r['claimed']:7d} {r['range']:>10} {r['min_root']:6.2f} {r['max_root']:6.2f} "
                  f"{r['dyns']:9} {r['arts']:16} {r['in30c']:6.1%} {r['mean_dev_c']:+6.1f} {r['size_mb']:7.1f}")
        print(f"total {sum(r['zones'] for r in rows)} zones, {sum(r['size_mb'] for r in rows):.0f} MB")

    @staticmethod
    def comb_pitch(x: np.ndarray, sr: int, root: float) -> float | None:
        """Independent re-measurement for the cross-check: harmonic-comb maximum (sum of
        interpolated partial magnitudes, 1-cent grid within +-60 cents of `root`) over ~1 s
        after the loudest point. Shares nothing with the SwiftF0/pYIN/YIN chain."""
        f0 = Pitch.hz(root)
        h = int(0.01 * sr)
        n = len(x) // h
        if n < 10:
            return None
        e = (x[: n * h].reshape(n, h) ** 2).mean(1)
        p = int(np.argmax(e)) * h
        seg = x[p + int(0.1 * sr) : p + int(1.6 * sr)]
        nper = int(2 ** np.floor(np.log2(max(len(seg), 2))))
        nper = min(nper, 65536)
        if nper < 2048 or nper < 4 * sr / f0:
            return None
        fr, P = welch(seg, sr, nperseg=nper)
        mag = np.sqrt(P)
        K = max(1, min(12, int(0.45 * sr / (f0 * 1.04)), int(6000 / f0)))
        cands = f0 * 2 ** (np.arange(-60, 61) / 1200)
        score = [np.interp(np.arange(1, K + 1) * c, fr, mag).sum() for c in cands]
        best = float(cands[int(np.argmax(score))])
        return float(librosa.hz_to_midi(best))

    def crosscheck(self, per_timbre: int = 24, seed: int = 0) -> dict[str, dict]:
        rng = np.random.default_rng(seed)
        out = {}
        for d in sorted(p for p in self.out.iterdir() if (p / 'zones.json').exists()):
            zs = json.loads((d / 'zones.json').read_text())['zones']
            pick = rng.choice(len(zs), size=min(per_timbre, len(zs)), replace=False) if zs else []
            diffs, worst = [], []
            for i in pick:
                z = zs[int(i)]
                x, sr = sf.read(str(d / z['file']), dtype='float32')
                c = self.comb_pitch(x, sr, z['root'])
                if c is None:
                    continue
                diffs.append((c - z['root']) * 100)
                if abs(diffs[-1]) > 20:
                    worst.append(f"{z['file']} root {z['root']:.2f} comb {c:.2f}")
            diffs = np.array(diffs)
            out[d.name] = {'n': len(diffs), 'median_abs_c': float(np.median(np.abs(diffs))) if len(diffs) else None,
                           'within20c': float(np.mean(np.abs(diffs) <= 20)) if len(diffs) else None, 'outliers': worst}
            print(f"{d.name:14} crosscheck n={len(diffs):3d}  median |d|={out[d.name]['median_abs_c'] or 0:5.1f} c  "
                  f"within 20c={out[d.name]['within20c'] or 0:6.1%}" + ''.join(f'\n    {w}' for w in worst))
        return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('timbres', nargs='*', help='subset of timbres (default: all)')
    ap.add_argument('--force', action='store_true', help='redo timbres that already have a zones.json')
    ap.add_argument('--tmp', type=Path, default=ROOT / 'work' / 'iowa-tmp', help='download scratch dir (deleted at the end)')
    ap.add_argument('--qa', action='store_true', help='only print the quality report of existing sets')
    args = ap.parse_args(argv)
    if not args.qa:
        want = set(args.timbres)
        unknown = want - {i.timbre for i in INSTRUMENTS}
        if unknown:
            ap.error(f'unknown timbres: {sorted(unknown)}')
        fetcher = IowaFetcher(args.tmp)
        for inst in INSTRUMENTS:
            if want and inst.timbre not in want:
                continue
            if not fetcher.run(inst, args.force):
                break
        shutil.rmtree(args.tmp, ignore_errors=True)
    qa = QualityReport()
    qa.print()
    if args.qa:
        qa.crosscheck()
    return 0


if __name__ == '__main__':
    sys.exit(main())
