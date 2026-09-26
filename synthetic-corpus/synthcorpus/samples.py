"""Sample sets: real recorded notes, mapped by pitch / dynamic / articulation.

A `SampleSet` is the renderer's only view of a sample library. Loaders exist
for Apple EXS instruments (classic per-file and the newer consolidated
head+tail layout), SFZ libraries and plain folders of note recordings named by
pitch. Audio is decoded lazily and cached as float32 mono at the library's
native rate.
"""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import soundfile as sf

from .exs import ExsInstrument

WORK = Path(__file__).resolve().parent.parent / 'work'
DECODE_CACHE = WORK / 'decoded'


def decode_audio(path: Path) -> tuple[np.ndarray, int]:
    """Decode any CoreAudio-readable file (aif/caf-aac/wav/flac) to mono float32."""
    try:
        x, sr = sf.read(str(path), dtype='float32', always_2d=True)
    except Exception:
        DECODE_CACHE.mkdir(parents=True, exist_ok=True)
        key = hashlib.sha1(str(path).encode()).hexdigest()[:16]
        out = DECODE_CACHE / f'{key}.wav'
        if not out.exists():
            subprocess.run(['afconvert', '-f', 'WAVE', '-d', 'LEF32', str(path), str(out)], check=True, capture_output=True)
        x, sr = sf.read(str(out), dtype='float32', always_2d=True)
    return x.mean(axis=1), sr


@dataclass
class Zone:
    root: float  # MIDI pitch the recording sounds at (tuning folded in)
    key_low: int
    key_high: int
    vel_low: int
    vel_high: int
    art: str  # 'sus' | 'vib' | 'nonvib' | 'stac' | 'leg' | 'rel' | ...
    source: Path
    start: int = 0
    end: int | None = None
    loop: tuple[int, int] | None = None
    tail: tuple[int, int] | None = None  # consolidated head+tail layout
    tail_gain_db: float = 0.0
    gain_db: float = 0.0
    rr: int = 0
    dyn: str = ''  # dynamic label from the library ('pp','mf','ff', ...) when known
    _cache: dict = field(default_factory=dict, repr=False)

    def contains(self, midi: int, vel: int) -> bool:
        return self.key_low <= midi <= self.key_high and self.vel_low <= vel <= self.vel_high


class AudioStore:
    """Decoded files shared between zones (a consolidated file backs thousands of zones)."""

    _files: dict[Path, tuple[np.ndarray, int]] = {}

    @classmethod
    def get(cls, path: Path) -> tuple[np.ndarray, int]:
        if path not in cls._files:
            cls._files[path] = decode_audio(path)
        return cls._files[path]


@dataclass
class SampleSet:
    name: str
    zones: list[Zone]
    sr: int = 44100
    meta: dict = field(default_factory=dict)

    def audio(self, z: Zone) -> np.ndarray:
        """The zone's playable audio: head (+ crossfaded shared tail), leading silence kept."""
        if 'audio' in z._cache:
            return z._cache['audio']
        x, sr = AudioStore.get(z.source)
        self.sr = sr
        end = z.end if z.end else len(x)
        head = x[z.start : end].copy()
        if z.tail is not None:
            t0, t1 = z.tail
            g = 10 ** (z.tail_gain_db / 20)
            xf = min(int(0.03 * sr), len(head) // 4, t0)
            tail = x[t0 - xf : t1] * g
            fade = np.sin(np.linspace(0, np.pi / 2, xf)) ** 2
            head[-xf:] = head[-xf:] * (1 - fade) + tail[:xf] * fade
            head = np.concatenate([head, tail[xf:]])
        z._cache['audio'] = head.astype(np.float32)
        return z._cache['audio']

    def arts(self) -> set[str]:
        return {z.art for z in self.zones}

    def candidates(self, midi: int, vel: int, art: str) -> list[Zone]:
        arts = [art] + [a for a in ('sus', 'vib', 'nonvib', 'leg') if a != art]
        for a in arts:
            zs = [z for z in self.zones if z.art == a and z.contains(midi, vel)]
            if zs:
                return zs
            zs = [z for z in self.zones if z.art == a and z.key_low <= midi <= z.key_high]
            if zs:
                return sorted(zs, key=lambda z: min(abs(vel - z.vel_low), abs(vel - z.vel_high)))[:4]
        # nothing maps this key: nearest root of any sustained articulation
        pool = [z for z in self.zones if z.art in arts] or self.zones
        best = min(abs(z.root - midi) for z in pool)
        return [z for z in pool if abs(z.root - midi) == best]

    @property
    def key_range(self) -> tuple[int, int]:
        zs = [z for z in self.zones if z.art not in ('rel', 'fx')]
        return min(int(round(z.root)) for z in zs), max(int(round(z.root)) for z in zs)


# ---------------------------------------------------------------- loaders


class ExsLoader:
    """Apple EXS instrument → SampleSet. `art_map` maps group names (regex) to articulation tags."""

    SEARCH_ROOTS = [
        Path('/Library/Application Support/GarageBand/Instrument Library/Sampler/Sampler Files'),
        Path('/Library/Application Support/Logic/EXS Factory Samples'),
    ]

    def __init__(self, exs: Path, pack_root: Path, art_map: list[tuple[str, str]], skip: str | None = None):
        self.exs = exs
        self.pack_root = pack_root
        self.art_map = art_map
        self.skip = re.compile(skip, re.I) if skip else None
        self._index: dict[str, Path] | None = None

    def _find(self, fname: str) -> Path | None:
        if self._index is None:
            self._index = {}
            for root in [self.pack_root, *self.SEARCH_ROOTS]:
                if root.exists():
                    for p in root.rglob('*'):
                        if p.suffix.lower() in ('.aif', '.aiff', '.wav', '.caf'):
                            self._index.setdefault(p.name, p)
        return self._index.get(fname)

    def _art(self, group_name: str) -> str | None:
        for pat, art in self.art_map:
            if re.search(pat, group_name, re.I):
                return art
        return None

    def load(self, name: str) -> SampleSet:
        inst = ExsInstrument.read(self.exs)
        zones: list[Zone] = []
        raw = self.exs.read_bytes()
        tails = self._tails(raw)
        for z in inst.zones:
            g = inst.groups.get(z.group)
            gname = g.name if g else ''
            if self.skip and self.skip.search(gname):
                continue
            art = self._art(gname)
            if art is None:
                continue
            s = inst.samples[z.sample] if z.sample < len(inst.samples) else None
            if s is None:
                continue
            src = self._find(s.file_name)
            if src is None:
                continue
            tail = tails.get(z.index)
            rr = 0
            m = re.search(r'rr(\d)', gname, re.I)
            if m:
                rr = int(m.group(1)) - 1
            loop = (z.loop_start, z.loop_end) if z.loop_on and z.loop_end > z.loop_start else None
            end = z.end if z.end > z.start else None
            zone = Zone(
                root=z.root - z.fine_cents / 100 - z.coarse,
                key_low=z.key_low,
                key_high=z.key_high,
                vel_low=z.vel_low,
                vel_high=z.vel_high,
                art=art,
                source=src,
                start=z.start,
                end=end,
                loop=None,
                gain_db=float(z.volume_db) + (g.volume_db if g else 0),
                rr=rr,
            )
            if tail is not None:
                zone.tail = (tail[0], tail[1])
                zone.tail_gain_db = tail[2]
                # consolidated loops live in "virtual" head+tail coordinates; our own
                # looper finds loop points itself, so they are dropped here.
            elif loop is not None:
                zone.loop = (loop[0] - z.start, loop[1] - z.start)
            zones.append(zone)
        return SampleSet(name, zones, meta={'exs': str(self.exs)})

    @staticmethod
    def _tails(raw: bytes) -> dict[int, tuple[int, int, float]]:
        """Consolidated instruments append head+tail info to each 136-byte zone block."""
        import struct

        out = {}
        pos = 0
        while pos + 84 <= len(raw):
            tf = raw[pos + 3]
            (size,) = struct.unpack_from('<I', raw, pos + 4)
            if tf & 0x80:
                size &= 0x7FFF
            if tf & 0x0F == 1 and size >= 136:
                (idx,) = struct.unpack_from('<I', raw, pos + 8)
                c = raw[pos + 84 : pos + 84 + size]
                t0, t1 = struct.unpack_from('<2I', c, 116)
                (tg,) = struct.unpack_from('<f', c, 132)
                if t1 > t0 > 0:
                    out[idx] = (t0, t1, float(tg) if np.isfinite(tg) and abs(tg) < 40 else 0.0)
            pos += 84 + size
        return out


NOTE_RE = re.compile(r'(?<![A-Za-z])([A-Ga-g])(#|b|s|sharp|flat)?(-?\d)(?!\d)')
PC = {'c': 0, 'd': 2, 'e': 4, 'f': 5, 'g': 7, 'a': 9, 'b': 11}


def note_name_to_midi(text: str) -> int | None:
    m = NOTE_RE.search(text)
    if not m:
        return None
    pc = PC[m.group(1).lower()]
    acc = m.group(2) or ''
    if acc in ('#', 's', 'sharp'):
        pc += 1
    elif acc in ('b', 'flat'):
        pc -= 1
    return pc + 12 * (int(m.group(3)) + 1)


class SfzLoader:
    """Minimal SFZ reader: <group>/<region> opcodes sample, pitch_keycenter,
    lokey/hikey/key, lovel/hivel, loop_start/loop_end, volume, tune, seq_position."""

    def __init__(self, sfz: Path, art: str = 'sus', region_filter=None):
        self.sfz = sfz
        self.art = art
        self.region_filter = region_filter

    def _parse(self) -> list[dict]:
        text = self.sfz.read_text(errors='ignore')
        text = re.sub(r'//.*', '', text)
        regions: list[dict] = []
        ctrl: dict = {}
        glob: dict = {}
        master: dict = {}
        group: dict = {}
        cur: dict | None = None
        level = None
        for tok in re.finditer(r'<(\w+)>|(\w+)=((?:(?!\s\w+=|<).)*)', text, re.S):
            if tok.group(1):
                if cur is not None:
                    regions.append({**glob, **master, **group, **cur})
                    cur = None
                level = tok.group(1)
                if level == 'global':
                    glob = {}
                elif level == 'master':
                    master = {}
                elif level == 'group':
                    group = {}
                elif level == 'control':
                    ctrl = {}
                elif level == 'region':
                    cur = {}
                continue
            k, v = tok.group(2), tok.group(3).strip()
            target = {'region': cur, 'group': group, 'master': master, 'global': glob, 'control': ctrl}.get(level)
            if target is not None:
                target[k] = v
        if cur is not None:
            regions.append({**glob, **master, **group, **cur})
        base = self.sfz.parent / ctrl.get('default_path', '')
        for r in regions:
            r['_path'] = (base / r.get('sample', '').replace('\\', '/')).resolve()
        return regions

    @staticmethod
    def _key(v: str | None) -> int | None:
        if v is None:
            return None
        v = v.strip()
        if re.fullmatch(r'-?\d+', v):
            return int(v)
        return note_name_to_midi(v)

    def load(self, name: str) -> SampleSet:
        zones = []
        for r in self._parse():
            if self.region_filter and not self.region_filter(r):
                continue
            if not r['_path'].exists():
                continue
            key = self._key(r.get('key'))
            center = self._key(r.get('pitch_keycenter')) or key
            lo = self._key(r.get('lokey')) if 'lokey' in r else key
            hi = self._key(r.get('hikey')) if 'hikey' in r else key
            if center is None:
                center = note_name_to_midi(r['_path'].stem)
            if center is None:
                continue
            lo = center if lo is None else lo
            hi = center if hi is None else hi
            tune = float(r.get('tune', 0)) / 100 + float(r.get('transpose', 0))
            loop = None
            if 'loop_start' in r and 'loop_end' in r and r.get('loop_mode', 'loop_continuous') != 'no_loop':
                loop = (int(r['loop_start']), int(r['loop_end']))
            zones.append(
                Zone(
                    root=center - tune,
                    key_low=lo,
                    key_high=hi,
                    vel_low=int(r.get('lovel', 0)),
                    vel_high=int(r.get('hivel', 127)),
                    art=r.get('_art', self.art),
                    source=r['_path'],
                    start=int(r.get('offset', 0)),
                    end=int(r['end']) if 'end' in r else None,
                    loop=loop,
                    gain_db=float(r.get('volume', 0)),
                    rr=int(r.get('seq_position', 1)) - 1,
                )
            )
        return SampleSet(name, zones, meta={'sfz': str(self.sfz)})


class FolderLoader:
    """A folder of single-note recordings whose file names carry pitch (e.g. 'Oboe.mf.A4.aiff')."""

    def __init__(self, folder: Path, pattern: str = '*', art_of=None, dyn_of=None, midi_of=None):
        self.folder = folder
        self.pattern = pattern
        self.art_of = art_of or (lambda p: 'sus')
        self.dyn_of = dyn_of or (lambda p: '')
        self.midi_of = midi_of or (lambda p: note_name_to_midi(p.stem))

    DYN_VEL = {'ppp': (0, 20), 'pp': (0, 35), 'p': (36, 60), 'mp': (50, 75), 'mf': (61, 90), 'f': (91, 110), 'ff': (100, 127), 'fff': (111, 127)}

    def load(self, name: str) -> SampleSet:
        zones = []
        for p in sorted(self.folder.rglob(self.pattern)):
            if p.suffix.lower() not in ('.wav', '.aif', '.aiff', '.flac', '.caf', '.mp3'):
                continue
            art = self.art_of(p)
            midi = self.midi_of(p)
            if art is None or midi is None:
                continue
            dyn = self.dyn_of(p)
            vl, vh = self.DYN_VEL.get(dyn, (0, 127))
            zones.append(Zone(root=float(midi), key_low=midi, key_high=midi, vel_low=vl, vel_high=vh, art=art, source=p, dyn=dyn))
        # widen key ranges so every key between recorded roots maps somewhere
        by_art: dict[str, list[Zone]] = {}
        for z in zones:
            by_art.setdefault(z.art, []).append(z)
        for zs in by_art.values():
            roots = sorted({int(z.root) for z in zs})
            for z in zs:
                i = roots.index(int(z.root))
                lo = roots[i - 1] if i > 0 else int(z.root) - 2
                hi = roots[i + 1] if i + 1 < len(roots) else int(z.root) + 2
                z.key_low = (lo + int(z.root)) // 2 + (1 if i > 0 else 0)
                z.key_high = (int(z.root) + hi) // 2
        return SampleSet(name, zones, meta={'folder': str(self.folder)})


class ZonesJsonLoader:
    """Normalised sample set: `<dir>/zones.json` + mono WAVs (see assets/samples/FORMAT.md)."""

    DYN_VEL = FolderLoader.DYN_VEL

    def __init__(self, folder: Path, arts: set[str] | None = None):
        self.folder = folder
        self.arts = arts

    def load(self, name: str | None = None) -> SampleSet:
        import json

        meta = json.loads((self.folder / 'zones.json').read_text())
        zones = []
        for z in meta['zones']:
            if self.arts and z.get('art', 'sus') not in self.arts:
                continue
            root = float(z.get('root', z.get('nominal')))
            dyn = z.get('dyn', '')
            vl, vh = z.get('vel') or self.DYN_VEL.get(dyn, (0, 127))
            loop = tuple(z['loop']) if z.get('loop') else None
            zones.append(
                Zone(
                    root=root,
                    key_low=int(round(root)),
                    key_high=int(round(root)),
                    vel_low=int(vl),
                    vel_high=int(vh),
                    art=z.get('art', 'sus'),
                    source=self.folder / z['file'],
                    loop=loop,
                    rr=int(z.get('rr', 0)),
                    dyn=dyn,
                )
            )
        # every key between sampled roots maps to its nearest root, per articulation
        by_art: dict[str, list[Zone]] = {}
        for z in zones:
            by_art.setdefault(z.art, []).append(z)
        for zs in by_art.values():
            roots = sorted({int(round(z.root)) for z in zs})
            for z in zs:
                r = int(round(z.root))
                i = roots.index(r)
                z.key_low = (roots[i - 1] + r) // 2 + 1 if i > 0 else r - 3
                z.key_high = (r + roots[i + 1]) // 2 if i + 1 < len(roots) else r + 3
        return SampleSet(name or meta.get('name', self.folder.name), zones, meta=meta)


class RootCalibrator:
    """Measure each zone's sounding pitch (SwiftF0 over the steady middle) and use it as the root.

    Library metadata is not trusted: EXS roots can be off by tuning offsets or
    whole octaves, and several free libraries mislabel files. A measurement is
    adopted when it is confident; results are cached per audio region."""

    CACHE = WORK / 'root-cache.json'
    _db: dict | None = None

    @classmethod
    def _load(cls) -> dict:
        if cls._db is None:
            cls._db = json.loads(cls.CACHE.read_text()) if cls.CACHE.exists() else {}
        return cls._db

    @classmethod
    def save(cls) -> None:
        if cls._db is not None:
            cls.CACHE.parent.mkdir(parents=True, exist_ok=True)
            cls.CACHE.write_text(json.dumps(cls._db))

    @classmethod
    def measure(cls, sset: 'SampleSet', z: Zone) -> tuple[float, float] | None:
        """(median fractional MIDI, IQR in cents) over the steady middle, or None."""
        from .qa import f0_track

        key = f'v2:{z.source}:{z.start}:{z.end}:{z.tail}'
        db = cls._load()
        if key in db:
            return tuple(db[key]) if db[key] else None
        x = sset.audio(z)
        sr = sset.sr
        n = len(x)
        seg = x[int(n * 0.15) : int(n * 0.7)] if n > sr * 0.3 else x
        val = None
        if len(seg) > sr * 0.08:
            ts, hz, cf = f0_track(seg, sr, fmin=30, fmax=2093.75)
            m = cf > 0.8
            if m.sum() >= 5:
                mid = 69 + 12 * np.log2(hz[m] / 440)
                q1, q3 = np.percentile(mid, [25, 75])
                val = (float(np.median(mid)), float((q3 - q1) * 100))
        db[key] = val
        return val

    @classmethod
    def calibrate(cls, sset: 'SampleSet', log=None) -> 'SampleSet':
        """Adopt measured roots; drop zones whose pitch is unstable or unmeasurable;
        rebuild the key map from the measured roots (nearest root per articulation)."""
        keep = []
        fixed = 0
        for z in sset.zones:
            if z.art in ('rel', 'fx'):
                keep.append(z)
                continue
            try:
                m = cls.measure(sset, z)
            except Exception:
                continue  # unreadable sample (corrupt / still being written): drop the zone
            if m is None:
                continue
            med, iqr = m
            if iqr > 60:
                continue
            if abs(med - z.root) > 0.05:
                fixed += 1
            z.root = med
            keep.append(z)
        cls.save()
        by_art: dict[str, list[Zone]] = {}
        for z in keep:
            by_art.setdefault(z.art, []).append(z)
        for zs in by_art.values():
            roots = sorted({int(round(z.root)) for z in zs})
            for z in zs:
                r = int(round(z.root))
                i = roots.index(r)
                z.key_low = (roots[i - 1] + r) // 2 + 1 if i > 0 else r - 3
                z.key_high = (r + roots[i + 1]) // 2 if i + 1 < len(roots) else r + 3
        if log:
            log(f'{sset.name}: kept {len(keep)}/{len(sset.zones)} zones, re-rooted {fixed}')
        sset.zones = keep
        return sset
