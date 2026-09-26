"""Permissive SFZ sample libraries -> normalised single-note sample sets.

Output: `assets/samples/<source>/<timbre>/zones.json` + `notes/*.wav` (see assets/samples/FORMAT.md).

  source          repos                                                   licence
  vsco            sgossner/VSCO-2-CE (branch SFZ)                         CC0-1.0
  vcsl            sgossner/VCSL (branch sfz)                              CC0-1.0
  karoryfer       sfzinstruments/karoryfer.* and karoryfer-bigcat.cello   CC0-1.0
  sfzinstruments  sfzinstruments/aliexpress-erhu, dsmolken.double-bass    CC0-1.0
                  sfzinstruments/MTG.SoloSax                              CC-BY-4.0

Only SFZ text and audio are read from the repos; nothing in them is executed. A repo is
fetched as a blob-less sparse clone: first the SFZ/text files, then exactly the sample files
the wanted regions reference. The clone is deleted once its sets are written.

Per region: the SFZ offset/end is applied, stereo is folded to mono (the channels are
time-aligned first, a spaced pair otherwise comb-filters), 88.2/96 kHz is halved, leading
silence is trimmed to 10 ms before the onset (2 ms fade-in guard), the tail is cut once the
release is 60 dB down (or at the noise floor), and the note is written as 24-bit PCM with no
gain change. Loops (SFZ loop_start/loop_end or the file's own smpl loop) are carried over as
[start, end) frames of the written file, the slice the sampler plays.

The root is measured, never taken from the label: SwiftF0 and pYIN run on the steady part
and must agree; an octave disagreement is settled by the harmonic comb (a real f0 has energy
at its own odd multiples - fundamental, 3rd, 5th - a subharmonic does not), and the chosen f0
must not sit over a sub-octave series (ambiguous: rejected, never auto-lowered). Low notes the
fine pYIN pass cannot hold are refined from the partial peaks, high ones from the spectral peak.
The label (pitch_keycenter - transpose - tune) centres the search band and is then checked:
over 60 cents off every octave of it rejects the region; a whole-octave disagreement fixes
`nominal` from the measurement when it is the SFZ part's own convention (e.g. the piccolo mapped
at written pitch) or when the file name agrees with the measurement (the SFZ key is then the
mislabel); a lone region an octave off its part is rejected as a tracking error.

    cd synthetic-corpus && PYTHONPATH=. uv run python -m synthcorpus.fetch.fetch_sfz_libs \
        --tmp DIR [--only vsco,vcsl/tenor-sax] [--force] [--keep] [--dry] [-j 6]
"""

from __future__ import annotations

import argparse
import json
import math
import posixpath
import re
import shutil
import struct
import subprocess
import sys
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly, welch

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'assets' / 'samples'
MIN_FREE_GB = 12.0
DYN_ORDER = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff']
LADDERS = {1: [''], 2: ['p', 'f'], 3: ['p', 'mf', 'f'], 4: ['p', 'mp', 'mf', 'f'], 5: ['pp', 'p', 'mf', 'f', 'ff']}


class Pitch:
    NAMES = ['C', 'Cs', 'D', 'Eb', 'E', 'F', 'Fs', 'G', 'Ab', 'A', 'Bb', 'B']

    @staticmethod
    def hz(midi: float) -> float:
        return 440.0 * 2 ** ((midi - 69) / 12)

    @staticmethod
    def midi(hz: float) -> float:
        return 69 + 12 * math.log2(hz / 440.0)

    @classmethod
    def name(cls, midi: int) -> str:
        return f'{cls.NAMES[midi % 12]}{midi // 12 - 1}'

    @staticmethod
    def parse(text: str) -> int | None:
        """SFZ key value: a MIDI number or a note name (c4 = 60, c#4 / db4)."""
        text = text.strip()
        if re.fullmatch(r'-?\d+', text):
            return int(text)
        m = re.fullmatch(r'([a-gA-G])([#b]?)(-?\d+)', text)
        if not m:
            return None
        pc = {'c': 0, 'd': 2, 'e': 4, 'f': 5, 'g': 7, 'a': 9, 'b': 11}[m.group(1).lower()]
        pc += {'#': 1, 'b': -1}.get(m.group(2), 0)
        return pc + 12 * (int(m.group(3)) + 1)

    @classmethod
    def from_stem(cls, stem: str) -> int | None:
        """Pitch written in a sample file name ('LLVln_ArcoVib_A3_p', 'd1_looped_f', 'erhu_eb5_sus')."""
        for tok in re.split(r'[_\s\-]+', stem):
            m = re.fullmatch(r'([A-Ga-g])(#|b|s)?(-?\d)', tok)
            if m:
                return cls.parse(m.group(1) + {'s': '#'}.get(m.group(2) or '', m.group(2) or '') + m.group(3))
        return None


# ---------------------------------------------------------------- SFZ


class SfzDocument:
    """SFZ reader: #define/#include, <control>/<global>/<master>/<group>/<region> inheritance."""

    TOKEN = re.compile(r'<(\w+)>|([\w$]+)=((?:(?!\s+[\w$]+=|<).)*)', re.S)

    def __init__(self, path: Path):
        self.path = path
        self.root = path.parent

    def _text(self, path: Path, defines: dict, depth: int = 0) -> str:
        raw = re.sub(r'/\*.*?\*/', ' ', path.read_text(errors='ignore'), flags=re.S)
        out = []
        for line in raw.splitlines():
            line = re.sub(r'//.*', '', line)
            s = line.strip()
            m = re.match(r'#define\s+(\$\w+)\s+(\S.*)', s)
            if m:
                defines[m.group(1)] = m.group(2).strip()
                continue
            m = re.match(r'#include\s+"([^"]+)"', s)
            if m:
                inc = self.root / m.group(1).replace('\\', '/')
                if not inc.exists():
                    inc = path.parent / m.group(1).replace('\\', '/')
                if inc.exists() and depth < 8:
                    out.append(self._text(inc, defines, depth + 1))
                continue
            for k in sorted(defines, key=len, reverse=True):
                line = line.replace(k, defines[k])
            out.append(line)
        return '\n'.join(out)

    def regions(self) -> list[dict]:
        text = self._text(self.path, {})
        ctrl: dict = {}
        glob: dict = {}
        master: dict = {}
        group: dict = {}
        cur: dict | None = None
        level = None
        regions: list[dict] = []

        def close():
            if cur is not None:
                r = {**glob, **master, **group, **cur}
                r['_default_path'] = ctrl.get('default_path', '')
                r['_note_offset'] = int(ctrl.get('note_offset', 0) or 0) + 12 * int(ctrl.get('octave_offset', 0) or 0)
                regions.append(r)

        for tok in self.TOKEN.finditer(text):
            if tok.group(1):
                close()
                cur = None
                level = tok.group(1).lower()
                if level == 'region':
                    cur = {}
                elif level == 'group':
                    group = {}
                elif level == 'master':
                    master, group = {}, {}
                elif level == 'global':
                    glob, master, group = {}, {}, {}
                continue
            k, v = tok.group(2), tok.group(3).strip()
            target = {'region': cur, 'group': group, 'master': master, 'global': glob, 'control': ctrl}.get(level)
            if target is not None:
                target[k] = v
        close()
        for r in regions:
            r['_sample'] = (r['_default_path'] + r['sample']).replace('\\', '/') if r.get('sample') else None
        return regions


# ---------------------------------------------------------------- recipes


@dataclass
class Part:
    sfz: str  # SFZ program or map inside the repo
    art: str
    keep: str | None = None  # regex the sample path must match
    dyn: str | None = None  # fixed dynamic (else file-name token, else velocity layer)
    variant: str = ''


@dataclass
class Recipe:
    timbre: str
    parts: list[Part]
    notes: str = ''
    plucked: bool = False


@dataclass
class Library:
    source: str  # output directory under assets/samples
    slug: str  # github owner/repo
    branch: str | None
    title: str
    url: str
    licence: str
    recipes: list[Recipe]
    prefix: str  # zones.json name prefix


@dataclass
class Take:
    src: Path
    rel: str  # path inside the repo
    label: int  # library's pitch label: pitch_keycenter - transpose - note_offset
    art: str
    dyn: str = ''
    rr: int = 0
    vel: tuple[int, int] | None = None
    offset: int = 0
    end: int | None = None  # inclusive, source frames
    loop: tuple[int, int] | None = None  # inclusive end, source frames
    loop_mode: str = ''
    volume_db: float = 0.0
    tune_cents: float = 0.0
    file_label: int | None = None
    variant: str = ''
    part: str = ''


class RecipeReader:
    """Recipe parts -> Takes: one per distinct sample slice, sustained attack regions only."""

    DYN_TOKEN = re.compile(r'(?:^|_)(ppp|pp|p|mp|mf|m|f|ff|fff)(?:_|$)')  # lower case only: 'F' is a key

    def __init__(self, repo_dir: Path, index: list[str]):
        self.repo = repo_dir
        self.index = {f.lower(): f for f in index}
        self.unresolved: list[str] = []

    def _resolve(self, sfz: str, sample: str) -> str | None:
        """Repo path of a region's sample. Map files included by a program resolve their samples
        against the program's folder, so the SFZ folder and each parent are tried in turn."""
        base = posixpath.dirname(sfz)
        while True:
            cand = posixpath.normpath(posixpath.join(base, sample))
            hit = self.index.get(cand.lower())
            if hit:
                return hit
            if not base:
                return None
            base = posixpath.dirname(base)

    def takes(self, recipe: Recipe) -> list[Take]:
        out: list[Take] = []
        for part in recipe.parts:
            out += self._part(part)
        return out

    def _part(self, part: Part) -> list[Take]:
        doc = SfzDocument(self.repo / part.sfz)
        keep = re.compile(part.keep, re.I) if part.keep else None
        cands = []
        for r in doc.regions():
            if not r.get('_sample') or r.get('trigger', 'attack') not in ('attack', 'first', 'legato'):
                continue
            if r.get('pitch_keytrack', '100') in ('0', '0.0'):
                continue
            rel = self._resolve(part.sfz, r['_sample'])
            if rel is None:
                self.unresolved.append(f'{part.sfz}: {r["_sample"]}')
                continue
            if keep and not keep.search(rel):
                continue
            p = self.repo / rel
            key = Pitch.parse(r['key']) if 'key' in r else None
            center = Pitch.parse(r['pitch_keycenter']) if 'pitch_keycenter' in r else key
            lo = Pitch.parse(r['lokey']) if 'lokey' in r else key
            hi = Pitch.parse(r['hikey']) if 'hikey' in r else key
            if center is None:
                center = Pitch.from_stem(p.stem)
            if center is None:
                continue
            label = center - int(float(r.get('transpose', 0))) - r['_note_offset']
            loop = None
            ls, le = r.get('loop_start', r.get('loopstart')), r.get('loop_end', r.get('loopend'))
            if ls is not None and le is not None:
                loop = (int(float(ls)), int(float(le)))
            vel = None
            if 'lovel' in r or 'hivel' in r:
                vel = (int(r.get('lovel', 0)), int(r.get('hivel', 127)))
            seq = int(r.get('seq_position', 1)) - 1
            mid = ((lo if lo is not None else center) + (hi if hi is not None else center)) / 2
            cands.append(
                (
                    abs(center - mid) + (0 if lo is None or lo <= center <= hi else 50),
                    seq,
                    Take(
                        src=p,
                        rel=rel,
                        label=label,
                        art=part.art,
                        dyn=part.dyn or '',
                        rr=seq,
                        vel=vel,
                        offset=int(float(r.get('offset', 0))),
                        end=int(float(r['end'])) if r.get('end') not in (None, '', '0', '-1') else None,
                        loop=loop,
                        loop_mode=r.get('loop_mode', r.get('loopmode', '')),
                        volume_db=float(r.get('volume', 0) or 0),
                        tune_cents=float(r.get('tune', 0) or 0),
                        file_label=Pitch.from_stem(p.stem),
                        variant=part.variant,
                        part=part.sfz,
                    ),
                )
            )
        # one take per sample slice: a sample stretched over neighbour keys (or re-used as a
        # fake round robin) is kept once, from the region that plays it closest to its centre
        best: dict[tuple, tuple] = {}
        for c in cands:
            t = c[2]
            k = (t.src, t.offset, t.end)
            if k not in best or c[:2] < best[k][:2]:
                best[k] = c
        takes = [c[2] for c in best.values()]
        seqs = Counter((t.label, t.vel) for t in takes)
        for t in takes:
            if not t.dyn:
                t.dyn = self._dyn_token(t.src.stem)
            if seqs[(t.label, t.vel)] == 1 and not re.search(r'rr\d', t.src.stem, re.I):
                t.rr = 0
            m = re.search(r'rr(\d+)', t.src.stem, re.I)
            if m and t.rr == 0 and int(m.group(1)) > 1:
                t.rr = int(m.group(1)) - 1
        self._velocity_dyns([t for t in takes if not t.dyn])
        return takes

    @classmethod
    def _dyn_token(cls, stem: str) -> str:
        for tok in re.split(r'[_\s\-]+', stem):
            m = cls.DYN_TOKEN.fullmatch('_' + tok + '_')
            if m:
                d = m.group(1)
                return 'mf' if d == 'm' else d
        return ''

    @staticmethod
    def _velocity_dyns(takes: list[Take]):
        """No dynamic in the name: rank each note's velocity layers onto a ladder
        (2 layers -> p/f, 3 -> p/mf/f, ...); a note with a single layer gets none."""
        by_note: dict[int, list[Take]] = defaultdict(list)
        for t in takes:
            if t.vel is not None:
                by_note[t.label].append(t)
        for ts in by_note.values():
            layers = sorted({t.vel[0] for t in ts})
            ladder = LADDERS.get(len(layers))
            if ladder is None:
                idx = np.linspace(1, len(DYN_ORDER) - 2, len(layers)).round().astype(int)
                ladder = [DYN_ORDER[i] for i in idx]
            for t in ts:
                t.dyn = ladder[layers.index(t.vel[0])]


# ---------------------------------------------------------------- audio


class SampleFile:
    """Decoded sample + the loop embedded in it (WAV smpl chunk, FLAC riff/vorbis metadata)."""

    def __init__(self, path: Path, tmp: Path):
        self.path = path
        try:
            x, sr = sf.read(str(path), dtype='float32', always_2d=True)
        except Exception:
            tmp.mkdir(parents=True, exist_ok=True)
            out = tmp / f'decode_{abs(hash(str(path)))}.wav'
            subprocess.run(['afconvert', '-f', 'WAVE', '-d', 'LEF32', str(path), str(out)], check=True, capture_output=True)
            x, sr = sf.read(str(out), dtype='float32', always_2d=True)
            out.unlink()
        self.x, self.sr = x, sr

    def embedded_loop(self) -> tuple[int, int] | None:
        suf = self.path.suffix.lower()
        try:
            if suf == '.wav':
                return self._wav_loop()
            if suf == '.flac':
                return self._flac_loop()
        except (OSError, struct.error):
            return None
        return None

    @staticmethod
    def _smpl(d: bytes) -> tuple[int, int] | None:
        if len(d) < 60 or struct.unpack_from('<I', d, 28)[0] < 1:
            return None
        start, end = struct.unpack_from('<2I', d, 44)
        return (start, end) if end > start else None

    def _wav_loop(self):
        with open(self.path, 'rb') as fh:
            head = fh.read(12)
            if head[:4] not in (b'RIFF', b'RF64') or head[8:12] != b'WAVE':
                return None
            while True:
                h = fh.read(8)
                if len(h) < 8:
                    return None
                cid, size = h[:4], struct.unpack('<I', h[4:])[0]
                if cid == b'smpl':
                    return self._smpl(fh.read(size))
                fh.seek(size + (size & 1), 1)

    def _flac_loop(self):
        with open(self.path, 'rb') as fh:
            if fh.read(4) != b'fLaC':
                return None
            comments = {}
            while True:
                h = fh.read(4)
                if len(h) < 4:
                    break
                last, typ, size = h[0] & 0x80, h[0] & 0x7F, int.from_bytes(h[1:], 'big')
                d = fh.read(size)
                if typ == 2 and d[:4] == b'riff':
                    pos = 4
                    while pos + 8 <= len(d):
                        cid, sz = d[pos : pos + 4], struct.unpack_from('<I', d, pos + 4)[0]
                        if cid == b'smpl':
                            return self._smpl(d[pos + 8 : pos + 8 + sz])
                        pos += 8 + sz + (sz & 1)
                elif typ == 4:
                    n = struct.unpack_from('<I', d, 0)[0]
                    pos = 4 + n
                    cnt = struct.unpack_from('<I', d, pos)[0]
                    pos += 4
                    for _ in range(cnt):
                        ln = struct.unpack_from('<I', d, pos)[0]
                        kv = d[pos + 4 : pos + 4 + ln].decode('utf-8', 'ignore')
                        pos += 4 + ln
                        if '=' in kv:
                            k, v = kv.split('=', 1)
                            comments[k.upper()] = v
                if last:
                    break
        try:
            if 'LOOPSTART' in comments and 'LOOPLENGTH' in comments:
                s = int(comments['LOOPSTART'])
                return (s, s + int(comments['LOOPLENGTH']) - 1)
            if 'LOOP_START' in comments and 'LOOP_END' in comments:
                return (int(comments['LOOP_START']), int(comments['LOOP_END']))
        except ValueError:
            return None
        return None


class NoteCutter:
    """Region slice -> trimmed mono note at 44.1/48 kHz, loop in [start, end) output frames."""

    RATES = {44100: (1, 1), 48000: (1, 1), 88200: (1, 2), 96000: (1, 2), 176400: (1, 4), 192000: (1, 4), 22050: (2, 1), 24000: (2, 1)}

    def __init__(self, x: np.ndarray, sr: int):
        self.x, self.sr = x, sr

    @staticmethod
    def fold(x: np.ndarray) -> np.ndarray:
        if x.shape[1] == 1:
            return x[:, 0].copy()
        if x.shape[1] > 2:
            return x.mean(axis=1)
        a, b = x[:, 0], x[:, 1]
        n = len(a)
        if n > 4096:
            e = np.convolve(a * a + b * b, np.ones(2048), 'valid')
            c = int(np.argmax(e)) + 1024
            s = slice(max(0, c - 11025), min(n, c + 11025))
            sa, sb = a[s] - a[s].mean(), b[s] - b[s].mean()
            m = 1 << int(np.ceil(np.log2(2 * len(sa))))
            xc = np.fft.irfft(np.fft.rfft(sa, m) * np.conj(np.fft.rfft(sb, m)), m)
            norm = np.sqrt((sa * sa).sum() * (sb * sb).sum()) + 1e-12
            lim = 150  # ~3 ms
            lags = np.r_[np.arange(0, lim + 1), np.arange(-lim, 0)]
            vals = np.r_[xc[: lim + 1], xc[-lim:]] / norm
            best = int(np.argmax(vals))
            lag, r = int(lags[best]), float(vals[best])
            if lag != 0 and r > 0.5 and r > float(vals[0]) + 0.1:
                # xc[k] = sum a[t+k] b[t]: a lags b by k -> advance a
                if lag > 0:
                    a = np.r_[a[lag:], np.zeros(lag, a.dtype)]
                else:
                    b = np.r_[b[-lag:], np.zeros(-lag, b.dtype)]
        return 0.5 * (a + b)

    def cut(self, take: Take, file_loop: tuple[int, int] | None) -> tuple[np.ndarray, int, tuple[int, int] | None] | str:
        x = self.x
        end = take.end + 1 if take.end is not None else len(x)
        x = x[take.offset : end]
        if len(x) < 64:
            return 'empty slice'
        loop = None
        if take.loop_mode not in ('no_loop', 'one_shot'):
            lp = take.loop or file_loop
            if lp is not None:
                s, e = lp[0] - take.offset, lp[1] + 1 - take.offset
                if 0 <= s < e <= len(x) and e - s > 32:
                    loop = (s, e)
        y = self.fold(x)
        up, down = self.RATES.get(self.sr, (0, 0))
        sr = self.sr
        if up == 0:
            g = math.gcd(self.sr, 48000)
            up, down = 48000 // g, self.sr // g
        if (up, down) != (1, 1):
            y = resample_poly(y, up, down).astype(np.float32)
            sr = self.sr * up // down
            if loop is not None:
                loop = (int(round(loop[0] * up / down)), int(round(loop[1] * up / down)))
        span = Trim.find(y, sr)
        if span is None:
            return 'silent'
        a, b = span
        if loop is not None:
            a, b = min(a, loop[0]), max(b, loop[1])
        y = y[a:b].astype(np.float32).copy()
        g = min(len(y), int(0.002 * sr))
        y[:g] *= (0.5 - 0.5 * np.cos(np.linspace(0, np.pi, g, dtype=np.float32))) if g > 1 else 1
        if loop is not None:
            loop = (loop[0] - a, loop[1] - a)
        return y, sr, loop


class Trim:
    @staticmethod
    def find(y: np.ndarray, sr: int) -> tuple[int, int] | None:
        blk = max(1, sr // 1000)
        n = len(y) // blk
        if n < 5:
            return None
        env = np.abs(y[: n * blk]).reshape(n, blk).max(axis=1)
        db = 20 * np.log10(env + 1e-12)
        pk = float(db.max())
        if pk < -90:
            return None
        a = 0
        lead = db[:20]
        if np.median(lead) < pk - 35:
            thr = max(pk - 50, float(np.median(lead)) + 10)
            onset = int(np.argmax(db >= thr))
            a = max(0, (onset - 10) * blk)
        tail = float(np.median(db[-50:]))
        thr_off = pk - 60
        if tail < pk - 40:
            thr_off = max(thr_off, tail + 3)
        above = np.flatnonzero(db >= thr_off)
        b = min(len(y), (int(above[-1]) + 2) * blk)
        return (a, b) if b - a > int(0.03 * sr) else None


# ---------------------------------------------------------------- pitch


class Spectrum:
    """Averaged power spectrum of the steady part, for harmonic-comb octave checks."""

    def __init__(self, seg: np.ndarray, sr: int):
        n = 16384 if sr <= 50000 else 32768
        f, p = welch(seg, sr, window='hann', nperseg=min(n, len(seg)), noverlap=min(n, len(seg)) // 2, nfft=n)
        self.f, self.p, self.sr, self.df = f, p, sr, f[1] - f[0]

    def band(self, hz: float) -> float:
        w = max(0.03 * hz, 1.5 * self.df)
        i0, i1 = np.searchsorted(self.f, [hz - w, hz + w])
        return float(self.p[i0 : i1 + 1].max()) if i1 >= i0 and i0 < len(self.p) else 0.0

    def peak(self, hz: float) -> float | None:
        """Interpolated frequency of the strongest bin within 3 % of hz (log-parabolic)."""
        w = max(0.03 * hz, 2 * self.df)
        i0, i1 = np.searchsorted(self.f, [hz - w, hz + w])
        if i1 - i0 < 3 or i1 >= len(self.p):
            return None
        i = i0 + int(np.argmax(self.p[i0:i1]))
        if i <= 0 or i >= len(self.p) - 1:
            return None
        a, b, c = np.log(self.p[i - 1 : i + 2] + 1e-30)
        d = 0.5 * (a - c) / (a - 2 * b + c) if (a - 2 * b + c) < 0 else 0.0
        return float(self.f[i] + d * self.df)

    def comb(self, f0: float) -> float | None:
        """f0 from the interpolated partial peaks (power-weighted mean of peak_k / k): exact for
        low notes whose fundamental is weak or below the trackers' comfort zone."""
        est, wts = [], []
        for k in range(1, 13):
            if k * f0 > 0.45 * self.sr:
                break
            pk = self.peak(k * f0)
            if pk is not None and abs(pk / (k * f0) - 1) < 0.02:
                est.append(pk / k)
                wts.append(self.band(k * f0))
        if not est:
            return None
        est, wts = np.array(est), np.array(wts)
        ok = wts >= wts.max() * 1e-3
        return float((est[ok] * wts[ok]).sum() / wts[ok].sum())

    def odd_ratio_db(self, h: float) -> float:
        """Energy at the odd multiples of h against the even ones. Low (< -25 dB) means h is not a
        fundamental: nothing sounds at h, 3h, 5h. h itself only counts from 55 Hz up (rumble)."""
        top = 0.45 * self.sr
        odd = [self.band(k * h) for k in (1, 3, 5, 7, 9) if k * h < top and (k > 1 or h >= 55)]
        even = [self.band(k * h) for k in (2, 4, 6, 8, 10) if k * h < top]
        if not odd or not even:
            return -99.0
        return float(10 * np.log10((sum(odd) + 1e-20) / (sum(even) + 1e-20)))

    def sub_octave_db(self, f0: float) -> float:
        """Odd-multiple energy of f0/2: high means an octave-lower series is sounding."""
        return self.odd_ratio_db(f0 / 2)


class PitchMeter:
    CONF = 0.9
    REAL = -25.0  # odd-multiple ratio above this: the candidate's own series is really sounding
    SUB_AMBIG = -14.0  # a sub-octave series this strong under an agreed pitch: ambiguous, reject

    def __init__(self):
        from swift_f0 import SwiftF0

        self.det = SwiftF0(threads=1, spin=False)

    @staticmethod
    def steady(y: np.ndarray, sr: int, art: str, plucked: bool) -> tuple[int, int] | None:
        hop = max(1, int(0.01 * sr))
        n = len(y) // hop
        if n < 4:
            return None
        rms = np.sqrt((y[: n * hop].reshape(n, hop) ** 2).mean(axis=1) + 1e-20)
        db = 20 * np.log10(rms)
        pk = db.max()
        drop = 15 if art == 'stac' else (25 if plucked else 20)
        idx = np.flatnonzero(db >= pk - drop)
        a, b = int(idx[0]), int(idx[-1]) + 1
        skip = 3 if art == 'stac' else (4 if plucked else 8)
        a = a + min(skip, (b - a) // 4)
        if b - a < 4:
            return None
        b = min(b, a + 250)
        return a * hop, b * hop

    def swift(self, seg: np.ndarray, sr: int):
        g = math.gcd(sr, 16000)
        x = resample_poly(seg, 16000 // g, sr // g).astype(np.float32)
        x = x / (np.abs(x).max() + 1e-9) * 0.5
        r = self.det.detect(x, 16000)
        p, c = np.asarray(r.pitch_hz), np.asarray(r.confidence)
        sel = (c >= self.CONF) & (p > 0)
        if sel.sum() < max(3, 0.3 * len(p)):
            return None, None
        return float(np.median(p[sel])), p[sel]

    @staticmethod
    def pyin(seg: np.ndarray, sr: int, lo: float, hi: float, res: float = 0.1):
        import librosa

        lo, hi = max(lo, 20.0), min(hi, 0.45 * sr)
        if hi <= lo * 1.05:
            return None, None
        frame = int(2 ** math.ceil(math.log2(max(2048, 2.2 * sr / lo))))
        frame = min(frame, 16384)
        x = seg if len(seg) >= frame else np.r_[seg, np.zeros(frame - len(seg), seg.dtype)]
        try:
            # the fine pass spans ~2 semitones: a slow max transition keeps the band wider than a step
            f0, vf, _ = librosa.pyin(x, fmin=lo, fmax=hi, sr=sr, frame_length=frame, hop_length=max(256, frame // 8), resolution=res, max_transition_rate=35.92 if res >= 0.1 else 3.0)
        except librosa.util.exceptions.ParameterError:
            return None, None
        ok = vf & np.isfinite(f0)
        if ok.sum() < max(2, 0.3 * len(f0)):
            return None, None
        return float(np.median(f0[ok])), f0[ok]

    def measure(self, y: np.ndarray, sr: int, label_hz: float, art: str, plucked: bool) -> dict:
        win = self.steady(y, sr, art, plucked)
        if win is None:
            return {'why': 'too short'}
        seg = y[win[0] : win[1]].astype(np.float64)
        spec = Spectrum(seg, sr)
        fs, strack = self.swift(seg, sr)
        centre = fs or label_hz
        fp, _ = self.pyin(seg, sr, centre / 2.1, centre * 2.1)
        how = ''
        if fs and fp:
            d = 1200 * math.log2(fp / fs)
            k = round(d / 1200)
            if abs(d) <= 50:
                c, how = fs, 'swift=pyin'
            elif k != 0 and abs(d - 1200 * k) <= 60:
                # one tracker an octave (or two) off: step down from the higher proposal while the
                # octave below has its own odd series (fundamental, 3rd, 5th ...) sounding
                lo_f, hi_f = min(fs, fp), max(fs, fp)
                c = hi_f
                while c / 2 >= lo_f * 0.97 and spec.odd_ratio_db(c / 2) > self.REAL:
                    c /= 2
                how = 'octave-split:' + ('lower' if c < hi_f * 0.75 else 'upper')
            else:
                return {'why': f'trackers disagree ({d:+.0f} cents)'}
        elif fs or fp:
            c, how = (fs, 'swift') if fs else (fp, 'pyin')
        else:
            return {'why': 'unvoiced'}
        while spec.odd_ratio_db(c) < self.REAL and 2 * c < 0.45 * sr:
            c, how = 2 * c, how + '+up'  # nothing at c, 3c, 5c: c is a subharmonic
        sub = spec.sub_octave_db(c)
        if sub > self.SUB_AMBIG:
            return {'why': f'ambiguous octave (sub-octave series {sub:.0f} dB)'}
        if how == 'swift=pyin' or (how.startswith('octave-split') and fs is not None and abs(1200 * math.log2(c / fs)) < 50):
            track = strack[np.abs(1200 * np.log2(strack / c)) < 100]
        else:
            f, track = self.pyin(seg, sr, c / 1.07, c * 1.07, res=0.01)
            if f is None:
                f = spec.comb(c)
                if f is None:
                    return {'why': 'refinement failed (no clear partials)'}
                track, how = np.array([f]), how + '+comb'
            pk = spec.peak(f) if f > 1000 else None
            if pk is not None and abs(1200 * math.log2(pk / f)) < 30:
                # pYIN reads a few cents sharp at short periods; the spectral peak is exact
                track = track * (pk / float(np.median(track)))
        spread = vib = None
        if len(track) > 3:
            cents = 1200 * np.log2(track / np.median(track))
            spread = float(np.subtract(*np.percentile(cents, [75, 25])))
            t = np.arange(len(cents))
            vib = float(2 * math.sqrt(2) * (cents - np.polyval(np.polyfit(t, cents, 1), t)).std())
        return {'root': Pitch.midi(float(np.median(track))), 'how': how, 'spread': spread, 'vib': vib, 'sub_db': sub}


_METER: PitchMeter | None = None


def _job(job: dict) -> dict:
    """Worker: cut, measure and write one region (provisional file name)."""
    global _METER
    if _METER is None:
        _METER = PitchMeter()
    take: Take = job['take']
    try:
        sfile = SampleFile(take.src, Path(job['tmp']))
    except Exception as e:  # unreadable audio
        return {'why': f'decode failed: {e}'}
    res = NoteCutter(sfile.x, sfile.sr).cut(take, sfile.embedded_loop())
    if isinstance(res, str):
        return {'why': res}
    y, sr, loop = res
    if len(y) < int(0.05 * sr):
        return {'why': 'shorter than 50 ms'}
    peak = float(np.abs(y).max())
    m = _METER.measure(y, sr, Pitch.hz(take.label - take.tune_cents / 100), take.art, job['plucked'])
    if 'root' not in m:
        return m
    out = Path(job['out'])
    out.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(out), y, sr, subtype='PCM_24')
    m.update(sr=sr, frames=len(y), loop=list(loop) if loop else None, peak_db=20 * math.log10(peak + 1e-12), in_sr=sfile.sr, in_ch=sfile.x.shape[1])
    return m


# ---------------------------------------------------------------- repo + sets


class Repo:
    """Blob-less sparse clone: SFZ/text first, then exactly the sample files asked for."""

    TEXT = ['*.sfz', '*.txt', '*.md', '*.xml', 'LICENSE*', 'license*']

    def __init__(self, lib: Library, tmp: Path):
        self.lib = lib
        self.dir = tmp / lib.slug.split('/')[-1]

    def _git(self, *args, stdin: str | None = None):
        subprocess.run(['git', '-C', str(self.dir), *args], check=True, input=stdin, text=True, capture_output=True)

    def text(self):
        if not (self.dir / '.git').exists():
            self.dir.parent.mkdir(parents=True, exist_ok=True)
            cmd = ['git', 'clone', '-q', '--filter=blob:none', '--no-checkout', '--depth', '1']
            if self.lib.branch:
                cmd += ['-b', self.lib.branch]
            subprocess.run([*cmd, f'https://github.com/{self.lib.slug}.git', str(self.dir)], check=True, capture_output=True)
        self._git('sparse-checkout', 'init', '--no-cone')
        self._git('sparse-checkout', 'set', '--no-cone', '--stdin', stdin='\n'.join(self.TEXT) + '\n')
        self._git('checkout', '-q')

    def index(self) -> list[str]:
        out = subprocess.run(['git', '-C', str(self.dir), 'ls-files', '-z'], check=True, capture_output=True).stdout
        return [f for f in out.decode('utf-8', 'surrogateescape').split('\0') if f]

    def samples(self, rels: list[str]):
        esc = ['/' + re.sub(r'([\[\]*?\\!#])', r'\\\1', r) for r in rels]
        self._git('sparse-checkout', 'set', '--no-cone', '--stdin', stdin='\n'.join(self.TEXT + esc) + '\n')
        self._git('checkout', '-q')

    def remove(self):
        shutil.rmtree(self.dir, ignore_errors=True)


class SetBuilder:
    """Runs a recipe's takes through the workers and writes zones.json."""

    def __init__(self, lib: Library, recipe: Recipe, takes: list[Take], tmp: Path, jobs: int):
        self.lib, self.recipe, self.takes, self.tmp, self.jobs = lib, recipe, takes, tmp, jobs
        self.dir = OUT / lib.source / recipe.timbre

    @staticmethod
    def _label_f(t: Take) -> float:
        """The pitch the library says the sample sounds at: its key minus the SFZ retune."""
        return t.label - t.tune_cents / 100

    def run(self, pool: ProcessPoolExecutor) -> dict:
        stage = self.dir / 'notes' / '_stage'
        if stage.exists():
            shutil.rmtree(stage)
        jobs = [{'take': t, 'out': str(stage / f'{i:05d}.wav'), 'tmp': str(self.tmp), 'plucked': self.recipe.plucked} for i, t in enumerate(self.takes)]
        results = list(pool.map(_job, jobs, chunksize=4))
        zones, rejected, fixes = [], [], Counter()
        name_off = Counter()
        # Octave conventions are per SFZ part: the modal octave between label and measurement,
        # and the modal offset between the file-name pitch and the sounding semitone. A region
        # off the part's octave is kept only when its file name agrees with the measurement (the
        # SFZ key is then the mislabel); otherwise it is far more likely a tracking error.
        part_k: dict[str, Counter] = defaultdict(Counter)
        part_name: dict[str, Counter] = defaultdict(Counter)
        for t, m in zip(self.takes, results):
            if 'root' in m:
                d = m['root'] - self._label_f(t)
                if abs(d - 12 * round(d / 12)) <= 0.6:
                    part_k[t.part][round(d / 12)] += 1
        for t, m in zip(self.takes, results):
            if 'root' in m and t.file_label is not None and part_k[t.part]:
                d = m['root'] - self._label_f(t)
                if round(d / 12) == part_k[t.part].most_common(1)[0][0]:
                    part_name[t.part][int(round(m['root'])) - t.file_label] += 1
        for t, job, m in zip(self.takes, jobs, results):
            if 'root' not in m:
                rejected.append({'src': t.rel, 'why': m['why']})
                continue
            root = m['root']
            label_f = self._label_f(t)
            d = root - label_f
            k = round(d / 12)
            r = d - 12 * k
            nominal = int(round(label_f)) + 12 * k
            if abs(r) > 0.6:
                rejected.append({'src': t.rel, 'why': f'measured {root:.2f} vs label {label_f:.2f} ({d:+.2f} st)'})
                Path(job['out']).unlink(missing_ok=True)
                continue
            mode_k = part_k[t.part].most_common(1)[0][0]
            if k != mode_k:
                name_mode = part_name[t.part].most_common(1)[0][0] if part_name[t.part] else None
                if t.file_label is not None and name_mode is not None and nominal - t.file_label == name_mode:
                    fixes['SFZ key off the part convention, file name + measurement agree (relabelled)'] += 1
                else:
                    rejected.append({'src': t.rel, 'why': f'octave outlier: measured {root:.2f} vs label {t.label} ({k:+d} oct, part convention {mode_k:+d})'})
                    Path(job['out']).unlink(missing_ok=True)
                    continue
            if k != 0:
                fixes[f'label {k:+d} octave(s) fixed from measurement'] += 1
            if abs(root - round(root)) > 0.4:
                fixes['over 40 cents off the semitone (kept)'] += 1
            if t.file_label is not None:
                off = nominal - t.file_label
                if off:
                    name_off[off] += 1
            zones.append((t, job, m, int(nominal)))
        # unique (art, dyn, nominal, variant, rr)
        seen = set()
        for t, job, m, nominal in sorted(zones, key=lambda z: (z[0].art, z[3], z[0].dyn, z[0].variant, z[0].rr)):
            while (t.art, t.dyn, nominal, t.variant, t.rr) in seen:
                t.rr += 1
            seen.add((t.art, t.dyn, nominal, t.variant, t.rr))
        out_zones = []
        for t, job, m, nominal in zones:
            fname = f'{t.art}_{t.dyn or "x"}_{Pitch.name(nominal)}_rr{t.rr}{"_" + t.variant if t.variant else ""}.wav'
            dst = self.dir / 'notes' / fname
            Path(job['out']).replace(dst)
            z = {'file': f'notes/{fname}', 'root': round(m['root'], 3), 'nominal': nominal, 'label': t.label}
            if t.dyn:
                z['dyn'] = t.dyn
            z['art'] = t.art
            z['rr'] = t.rr
            z['loop'] = m['loop']
            if t.vel is not None and t.vel != (0, 127):
                z['vel'] = list(t.vel)
            if t.variant:
                z['variant'] = t.variant
            z['src'] = t.rel
            if t.volume_db:
                z['sfz_volume_db'] = round(t.volume_db, 2)
            rd = lambda v: None if v is None else round(v, 1)  # noqa: E731
            z['qa'] = {'how': m['how'], 'spread_cents': rd(m['spread']), 'vib_cents': rd(m['vib']), 'sub_octave_db': rd(m['sub_db']), 'peak_dbfs': rd(m['peak_db']), 'sr_in': m['in_sr'], 'ch_in': m['in_ch']}
            out_zones.append(z)
        shutil.rmtree(stage, ignore_errors=True)
        out_zones.sort(key=lambda z: (z['art'], z['nominal'], DYN_ORDER.index(z['dyn']) if z.get('dyn') in DYN_ORDER else -1, z.get('variant', ''), z['rr']))
        keep = {z['file'].split('/')[-1] for z in out_zones}
        for p in (self.dir / 'notes').glob('*.wav'):
            if p.name not in keep:
                p.unlink()
        notes = [self.recipe.notes] if self.recipe.notes else []
        notes.append(
            'Converted by synthcorpus/fetch/fetch_sfz_libs.py: one zone per distinct SFZ sample slice '
            '(attack-triggered regions only); stereo folded to mono after time-aligning the channels; '
            'no gain applied (the SFZ per-region volume is kept as sfz_volume_db for reference); '
            'loop = [start, end) frames of this file (end exclusive); root measured (SwiftF0 + pYIN, harmonic-comb octave check).'
        )
        if fixes:
            notes.append('Label checks: ' + '; '.join(f'{v} x {k}' for k, v in sorted(fixes.items())) + '.')
        if name_off:
            notes.append('File-name pitch vs nominal: ' + ', '.join(f'{v} files {k:+d} st' for k, v in sorted(name_off.items())) + ' (file names follow the library\'s own octave convention; nominal/root are the sounding pitch).')
        if rejected:
            notes.append(f'{len(rejected)} regions rejected (see "rejected").')
        doc = {
            'name': f'{self.lib.prefix}-{self.recipe.timbre}',
            'timbre': self.recipe.timbre,
            'source': self.lib.title,
            'url': self.lib.url,
            'licence': self.lib.licence,
            'notes': ' '.join(notes),
            'zones': out_zones,
            'rejected': rejected,
        }
        tmp = self.dir / 'zones.json.tmp'
        tmp.write_text(json.dumps(doc, indent=1))
        tmp.replace(self.dir / 'zones.json')
        return {'zones': len(out_zones), 'rejected': len(rejected), 'fixes': dict(fixes)}


# ---------------------------------------------------------------- catalogue

VSCO_URL = 'https://github.com/sgossner/VSCO-2-CE'
VCSL_URL = 'https://github.com/sgossner/VCSL'
SFZI = 'https://github.com/sfzinstruments/'
VCSL_AERO = 'Aerophones/'

LIBRARIES: list[Library] = [
    Library(
        'vsco', 'sgossner/VSCO-2-CE', 'SFZ', 'VSCO-2 Community Edition (Versilian Studios)', VSCO_URL, 'CC0-1.0', prefix='vsco',
        recipes=[
            Recipe('violin', [Part('SViolinVib.sfz', 'vib'), Part('SViolinSpic.sfz', 'stac')], 'Solo violin (arco vibrato, spiccato as stac).'),
            Recipe('contrabass', [Part('ContrabassSusNV.sfz', 'nonvib'), Part('ContrabassSusVB.sfz', 'vib'), Part('ContrabassSpic.sfz', 'stac')], 'Solo contrabass.'),
            Recipe('flute', [Part('FluteSusNV.sfz', 'nonvib'), Part('FluteSusVib.sfz', 'vib'), Part('FluteStac.sfz', 'stac')]),
            Recipe('piccolo', [Part('PiccoloSus.sfz', 'sus'), Part('PiccoloStac.sfz', 'stac')]),
            Recipe('oboe', [Part('OboeSusNV.sfz', 'nonvib'), Part('OboeSusVib.sfz', 'vib'), Part('OboeStac.sfz', 'stac')]),
            Recipe('clarinet', [Part('ClarinetSus.sfz', 'sus'), Part('ClarinetStac.sfz', 'stac')]),
            Recipe('bassoon', [Part('BassoonSus.sfz', 'sus'), Part('BassoonVib.sfz', 'vib'), Part('BassoonStac.sfz', 'stac')]),
            Recipe('french-horn', [Part('FHornSus.sfz', 'sus'), Part('FHornStac.sfz', 'stac'), Part('FHornMute.sfz', 'mute')]),
            Recipe('trumpet', [Part('TrumpetSus.sfz', 'sus'), Part('TrumpetSusVib.sfz', 'vib'), Part('TrumpetStac.sfz', 'stac'), Part('TrumpetStraightMuteSus.sfz', 'mute')], 'mute = straight mute.'),
            Recipe('trombone', [Part('TromboneSus.sfz', 'sus'), Part('TromboneVib.sfz', 'vib'), Part('TromboneStac.sfz', 'stac')], 'Tenor trombone (VSCO 2); the legacy VSCO 1 "OldTrombone" folder has no SFZ and is not used.'),
            Recipe('tuba', [Part('TubaSus.sfz', 'sus'), Part('TubaStac.sfz', 'stac')]),
        ],
    ),
    Library(
        'vcsl', 'sgossner/VCSL', 'sfz', 'Versilian Community Sample Library (Versilian Studios)', VCSL_URL, 'CC0-1.0', prefix='vcsl',
        recipes=[
            Recipe(f'{v}-recorder', [Part(f'{VCSL_AERO}Edge-blown Aerophones/Baroque {v.title()} Recorder - {s}.sfz', a) for s, a in arts], f'Baroque {v} recorder.')
            for v, arts in [
                ('soprano', [('Sustain', 'sus'), ('Staccato', 'stac')]),
                ('alto', [('Sustain', 'sus'), ('SusVib', 'vib'), ('Staccato', 'stac')]),
                ('tenor', [('Sustain', 'sus'), ('SusVib', 'vib'), ('Staccato', 'stac')]),
                ('bass', [('Sustain', 'sus'), ('SusVib', 'vib'), ('Staccato', 'stac')]),
            ]
        ]
        + [
            Recipe(
                'ocarina',
                [
                    Part(f'{VCSL_AERO}Edge-blown Aerophones/Ocarina, Typical - Sus.sfz', 'sus', variant='typical'),
                    Part(f'{VCSL_AERO}Edge-blown Aerophones/Ocarina, Typical - SusVib.sfz', 'vib', variant='typical'),
                    Part(f'{VCSL_AERO}Edge-blown Aerophones/Ocarina, Small - Sustain.sfz', 'sus', variant='small'),
                    Part(f'{VCSL_AERO}Edge-blown Aerophones/Ocarina, Small - Staccato.sfz', 'stac', variant='small'),
                ],
                'Two ocarinas merged (variant typical / small); release-trigger samples not used.',
            ),
            Recipe(
                'harmonica',
                [
                    Part(f'{VCSL_AERO}Free Aerophones/Harmonica-Hohner-Special20-C - Normal.sfz', 'sus', dyn='mf', variant='C'),
                    Part(f'{VCSL_AERO}Free Aerophones/Harmonica-Hohner-Special20-C - Soft.sfz', 'sus', dyn='p', variant='C'),
                    Part(f'{VCSL_AERO}Free Aerophones/Harmonica-Hohner-Special20-C - Vib.sfz', 'vib', variant='C'),
                    Part(f'{VCSL_AERO}Free Aerophones/Harmonica-Hohner-Special20-F - Normal.sfz', 'sus', dyn='mf', variant='F'),
                    Part(f'{VCSL_AERO}Free Aerophones/Harmonica-Hohner-Special20-F - Accented.sfz', 'sus', dyn='f', variant='F'),
                    Part(f'{VCSL_AERO}Free Aerophones/Harmonica-Hohner-Special20-F - Vib.sfz', 'vib', variant='F'),
                    Part(f'{VCSL_AERO}Free Aerophones/Harmonica-Hohner-Special20-F - Stac.sfz', 'stac', variant='F'),
                ],
                'Hohner Special 20 diatonic harmonicas in C and F merged (variant C / F); Normal = mf, Soft = p, Accented = f; '
                'hand-vibrato and release-trigger samples not used.',
            ),
            Recipe(
                'harmonica-chromatic',
                [
                    Part(f'{VCSL_AERO}Free Aerophones/Harmonica-Hohner-Super64 - Normal.sfz', 'sus', dyn='mf'),
                    Part(f'{VCSL_AERO}Free Aerophones/Harmonica-Hohner-Super64 - Accented.sfz', 'sus', dyn='f'),
                    Part(f'{VCSL_AERO}Free Aerophones/Harmonica-Hohner-Super64 - Vib.sfz', 'vib'),
                ],
                'Hohner Super 64 chromatic harmonica; Normal = mf, Accented = f; release-trigger samples not used.',
            ),
            Recipe(
                'soprano-sax',
                [Part(f'{VCSL_AERO}Reed Aerophones/Saxello - {s}.sfz', a) for s, a in [('Non-Vibrato', 'nonvib'), ('Vibrato', 'vib'), ('Staccato', 'stac')]],
                'Saxello (curved soprano saxophone).',
            ),
            Recipe('tenor-sax', [Part(f'{VCSL_AERO}Reed Aerophones/Tenor Saxophone - {s}.sfz', a) for s, a in [('Non-Vibrato', 'nonvib'), ('Vibrato', 'vib'), ('Staccato', 'stac')]]),
        ],
    ),
    Library(
        'karoryfer', 'sfzinstruments/karoryfer.black-and-blue-basses', None, 'Black And Blue Basses (Karoryfer Samples)', SFZI + 'karoryfer.black-and-blue-basses', 'CC0-1.0', prefix='karoryfer',
        recipes=[
            Recipe(
                'bass-guitar',
                [Part(f'Programs/maps/darkblack_reg_{d}_map.sfz', 'sus') for d in ('p', 'mp', 'mf', 'f')] + [Part('Programs/maps/darkblack_stac_map.sfz', 'stac')],
                '"Dark black" electric bass, fingered plucks (4 dynamics x 4 round robins) + staccato; the second bass ("baby blue") is not used.',
                plucked=True,
            )
        ],
    ),
    Library(
        'karoryfer', 'sfzinstruments/karoryfer-bigcat.cello', None, 'Karoryfer x bigcat cello (Karoryfer Samples / bigcat instruments)', SFZI + 'karoryfer-bigcat.cello', 'CC0-1.0', prefix='karoryfer',
        recipes=[Recipe('cello', [Part('Programs/vc_arco_sus_map.sfz', 'sus', keep=r'Samples/sus/'), Part('Programs/vc_arco_staccato_map.sfz', 'stac', keep=r'Samples/staccato/')], 'Solo cello, down/up bow = rr 0/1 on sustains.')],
    ),
    Library(
        'karoryfer', 'sfzinstruments/karoryfer.bear-sax', None, 'Bear Sax (Karoryfer Samples)', SFZI + 'karoryfer.bear-sax', 'CC0-1.0', prefix='karoryfer',
        recipes=[Recipe('baritone-sax', [Part('Programs/poly/dynfade_map.sfz', 'sus', keep=r'_looped_'), Part('Programs/poly/staccato_map.sfz', 'stac')], '1926 Conn baritone saxophone; sustains are the looped p / f layers.')],
    ),
    Library(
        'karoryfer', 'sfzinstruments/karoryfer.weresax', None, 'Weresax (Karoryfer Samples)', SFZI + 'karoryfer.weresax', 'CC0-1.0', prefix='karoryfer',
        recipes=[Recipe('alto-sax', [Part('Programs/alto_map_piano_condenser.sfz', 'sus', dyn='p'), Part('Programs/alto_map_forte_condenser.sfz', 'sus', dyn='f')], 'Alto saxophone, clean condenser mic only (the overdriven dynamic-mic layer is not used).')],
    ),
    Library(
        'karoryfer', 'sfzinstruments/karoryfer.war-tuba', None, 'War Tuba (Karoryfer Samples)', SFZI + 'karoryfer.war-tuba', 'CC0-1.0', prefix='karoryfer',
        recipes=[Recipe('tuba', [Part('Programs/poly/sustain_cnd.sfz', 'sus'), Part('Programs/poly/staccato_cnd.sfz', 'stac')], 'Tuba, condenser mic only; staccatissimo and fx not used.')],
    ),
    Library(
        'karoryfer', 'sfzinstruments/karoryfer.squidpipes', None, 'Squidpipes (Karoryfer Samples)', SFZI + 'karoryfer.squidpipes', 'CC0-1.0', prefix='karoryfer',
        recipes=[Recipe('bagpipe', [Part('Programs/mappings/long_clean.sfz', 'sus'), Part('Programs/mappings/short_clean.sfz', 'stac')], 'Bagpipe chanter (a squid mantle as the bag), clean long / short notes, no drone.')],
    ),
    Library(
        'sfzinstruments', 'sfzinstruments/aliexpress-erhu', None, 'Aliexpress Erhu (sfzinstruments)', SFZI + 'aliexpress-erhu', 'CC0-1.0', prefix='sfzinstruments',
        recipes=[Recipe('erhu', [Part('Programs/modules/maps/erhu_sus_map.sfz', 'sus'), Part('Programs/modules/maps/erhu_stac_map.sfz', 'stac')], 'Inexpensive erhu, long + short bows; sul tasto not used. The SFZ keys are inconsistent across the map (c6 two octaves off the rest); nominal follows the measurement.')],
    ),
    Library(
        'sfzinstruments', 'sfzinstruments/dsmolken.double-bass', None, 'D. Smolken double bass (1958 Otto Rubner)', SFZI + 'dsmolken.double-bass', 'CC0-1.0', prefix='sfzinstruments',
        recipes=[Recipe('contrabass', [Part('d_smolken_rubner_bass_arco.sfz', 'sus', keep=r'arco/arco_')], 'Solo double bass arco, fifths tuning (CGDA, low C1); down/up bow = rr 0/1; noises not used.')],
    ),
    Library(
        'sfzinstruments', 'sfzinstruments/MTG.SoloSax', None, 'MTG Solo Saxophones (MTG-UPF freesound packs, SFZ by kinwie)', SFZI + 'MTG.SoloSax', 'CC-BY-4.0 (credit: Music Technology Group, Universitat Pompeu Fabra; SFZ by kinwie)', prefix='mtg',
        recipes=[
            Recipe(f'{name}-sax', [Part(f'MTG Solo Saxophones/MTG {name.title()} Sax.sfz', 'sus', keep=rf'/{code}_[pfm]_\d')], f'MTG {name} saxophone, mono 48 kHz; breath/key noises not used.')
            for name, code in [('soprano', 'sop'), ('alto', 'alt'), ('tenor', 'ten'), ('baritone', 'bar')]
        ],
    ),
]


class Converter:
    def __init__(self, tmp: Path, jobs: int, force: bool, keep: bool, dry: bool):
        self.tmp, self.jobs, self.force, self.keep, self.dry = tmp, jobs, force, keep, dry

    @staticmethod
    def free_gb() -> float:
        return shutil.disk_usage('/').free / 1e9

    def run(self, only: list[str] | None) -> list[dict]:
        report = []
        with ProcessPoolExecutor(max_workers=self.jobs) as pool:
            for lib in LIBRARIES:
                recipes = [r for r in lib.recipes if self._wanted(lib, r, only)]
                if not recipes:
                    continue
                if not self.force and not self.dry:
                    recipes = [r for r in recipes if not (OUT / lib.source / r.timbre / 'zones.json').exists()]
                    if not recipes:
                        print(f'{lib.slug}: done already', flush=True)
                        continue
                if self.free_gb() < MIN_FREE_GB:
                    print(f'STOP: only {self.free_gb():.1f} GB free', flush=True)
                    break
                repo = Repo(lib, self.tmp)
                print(f'{lib.slug}: fetching SFZ text', flush=True)
                repo.text()
                reader = RecipeReader(repo.dir, repo.index())
                takes = {r.timbre: reader.takes(r) for r in recipes}
                if reader.unresolved:
                    print(f'  {len(reader.unresolved)} region samples not in the repo, e.g. {reader.unresolved[:3]}', flush=True)
                rels = sorted({t.rel for ts in takes.values() for t in ts})
                print(f'{lib.slug}: {len(rels)} sample files for {", ".join(f"{k} ({len(v)})" for k, v in takes.items())}', flush=True)
                if self.dry:
                    for k, v in takes.items():
                        c = Counter((t.art, t.dyn) for t in v)
                        print(f'  {k}: {dict(c)} labels {min(t.label for t in v)}..{max(t.label for t in v)}')
                    continue
                repo.samples(rels)
                for r in recipes:
                    ts = [t for t in takes[r.timbre] if t.src.exists()]
                    missing = len(takes[r.timbre]) - len(ts)
                    res = SetBuilder(lib, r, ts, self.tmp, self.jobs).run(pool)
                    res.update(source=lib.source, timbre=r.timbre, missing=missing)
                    print(f'  {lib.source}/{r.timbre}: {res}', flush=True)
                    report.append(res)
                if not self.keep:
                    repo.remove()
        return report

    @staticmethod
    def _wanted(lib: Library, r: Recipe, only: list[str] | None) -> bool:
        if not only:
            return True
        keys = {lib.source, f'{lib.source}/{r.timbre}', lib.slug.split('/')[-1]}
        return any(o in keys for o in only)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--tmp', type=Path, default=ROOT / 'work' / 'sfz-tmp', help='clone / scratch directory')
    ap.add_argument('--only', default='', help='comma list of sources, source/timbre or repo names')
    ap.add_argument('-j', '--jobs', type=int, default=6)
    ap.add_argument('--force', action='store_true', help='rebuild sets that already have a zones.json')
    ap.add_argument('--keep', action='store_true', help='keep the clones')
    ap.add_argument('--dry', action='store_true', help='parse SFZ and list takes only')
    a = ap.parse_args(argv)
    only = [s.strip() for s in a.only.split(',') if s.strip()] or None
    Converter(a.tmp, a.jobs, a.force, a.keep, a.dry).run(only)
    return 0


if __name__ == '__main__':
    sys.exit(main())
