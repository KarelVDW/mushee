"""Reader for Apple EXS24 / Sampler instrument files (.exs).

Layout follows the reverse-engineered description in git-moss/ConvertWithMoss
(format/exs/EXS24Block|Zone|Group|Sample.java). Only what the renderer needs is
decoded: zones (key/velocity map, sample region, loop), groups (round-robin /
articulation selection) and sample references (file name, rate).
"""

from __future__ import annotations

import struct
from dataclasses import dataclass, field
from pathlib import Path

BLOCK_HEADER = 84


@dataclass
class ExsZone:
    index: int
    name: str
    root: int
    fine_cents: int
    coarse: int
    pan: int
    volume_db: int
    key_low: int
    key_high: int
    vel_low: int
    vel_high: int
    start: int
    end: int
    loop_on: bool
    loop_start: int
    loop_end: int
    loop_xfade_ms: int
    pitched: bool
    oneshot: bool
    group: int
    sample: int


@dataclass
class ExsGroup:
    index: int
    name: str
    volume_db: int
    min_vel: int
    max_vel: int
    release_trigger: bool
    round_robin_pos: int | None = None
    enable_by_type: int | None = None
    enable_by_articulation: int | None = None
    enable_by_control: tuple[int, int, int] | None = None
    start_note: int | None = None
    end_note: int | None = None


@dataclass
class ExsSample:
    index: int
    name: str
    wave_start: int
    length: int
    rate: int
    channels: int
    path: str
    file_name: str


@dataclass
class ExsInstrument:
    path: Path
    zones: list[ExsZone] = field(default_factory=list)
    groups: dict[int, ExsGroup] = field(default_factory=dict)
    samples: list[ExsSample] = field(default_factory=list)

    @classmethod
    def read(cls, path: Path) -> ExsInstrument:
        data = path.read_bytes()
        inst = cls(path=path)
        pos = 0
        n_samples = 0
        while pos + BLOCK_HEADER <= len(data):
            big = data[pos] == 0
            e = '>' if big else '<'
            type_and_flags = data[pos + 3]
            btype = type_and_flags & 0x0F
            (size,) = struct.unpack_from(e + 'I', data, pos + 4)
            if type_and_flags & 0x80:
                size &= 0x7FFF
            (index,) = struct.unpack_from(e + 'I', data, pos + 8)
            name = data[pos + 20 : pos + 84].split(b'\0', 1)[0].decode('latin-1')
            c = data[pos + BLOCK_HEADER : pos + BLOCK_HEADER + size]
            if btype == 1:
                inst.zones.append(cls._zone(c, e, index, name))
            elif btype == 2:
                inst.groups[len(inst.groups)] = cls._group(c, e, len(inst.groups), name)
            elif btype == 3:
                inst.samples.append(cls._sample(c, e, n_samples, name))
                n_samples += 1
            pos += BLOCK_HEADER + size
        return inst

    @staticmethod
    def _signed(b: int) -> int:
        return b - 256 if b > 127 else b

    @classmethod
    def _zone(cls, c: bytes, e: str, index: int, name: str) -> ExsZone:
        opts = c[0]
        start, end, ls, le, lx = struct.unpack_from(e + '5I', c, 12)
        loop_opts = c[33]
        coarse = cls._signed(c[80]) if len(c) > 80 else 0
        group, sample = struct.unpack_from(e + '2I', c, 88) if len(c) >= 96 else (0, 0)
        vel_on = bool(opts & 8)
        return ExsZone(
            index=index,
            name=name,
            root=c[1],
            fine_cents=cls._signed(c[2]),
            coarse=coarse,
            pan=cls._signed(c[3]),
            volume_db=cls._signed(c[4]),
            key_low=c[6],
            key_high=c[7],
            vel_low=c[9] if vel_on else 0,
            vel_high=c[10] if vel_on else 127,
            start=start,
            end=end,
            loop_on=bool(loop_opts & 1),
            loop_start=ls,
            loop_end=le,
            loop_xfade_ms=lx,
            pitched=not bool(opts & 2),
            oneshot=bool(opts & 1),
            group=group,
            sample=sample,
        )

    @classmethod
    def _group(cls, c: bytes, e: str, index: int, name: str) -> ExsGroup:
        g = ExsGroup(
            index=index,
            name=name,
            volume_db=cls._signed(c[0]),
            min_vel=c[5],
            max_vel=c[6],
            release_trigger=False,
        )
        # offsets per EXS24Group.read (ConvertWithMoss)
        if len(c) > 73:
            g.release_trigger = c[73] > 0
        if len(c) >= 92:
            (rr,) = struct.unpack_from(e + 'i', c, 80)
            g.round_robin_pos = rr
            g.enable_by_type = c[84]
            g.enable_by_control = (c[85], c[86], c[87])
            g.start_note = c[88]
            g.end_note = c[89]
            g.enable_by_articulation = c[91]
        return g

    @staticmethod
    def _sample(c: bytes, e: str, index: int, name: str) -> ExsSample:
        wave_start, length, rate, _bits, ch, _ch2 = struct.unpack_from(e + '6I', c, 0)
        path = c[80:336].split(b'\0', 1)[0].decode('latin-1') if len(c) >= 336 else ''
        fname = c[336:592].split(b'\0', 1)[0].decode('latin-1') if len(c) >= 592 else name
        return ExsSample(index, name, wave_start, length, rate, ch, path, fname or name)


def relocate_samples(src: Path, dst: Path, sample_dir: Path) -> None:
    """Write a copy of an .exs whose sample blocks point at `sample_dir`.

    AUSampler resolves samples by the absolute folder stored in each sample
    block (offset 80, 256 bytes); extracted content lives elsewhere, so the
    folder is rewritten in place.
    """
    data = bytearray(src.read_bytes())
    pos = 0
    enc = str(sample_dir).encode('utf-8')
    assert len(enc) < 256, sample_dir
    while pos + BLOCK_HEADER <= len(data):
        e = '>' if data[pos] == 0 else '<'
        tf = data[pos + 3]
        (size,) = struct.unpack_from(e + 'I', data, pos + 4)
        if tf & 0x80:
            size &= 0x7FFF
        if tf & 0x0F == 3:
            off = pos + BLOCK_HEADER + 80
            data[off : off + 256] = enc + b'\0' * (256 - len(enc))
        pos += BLOCK_HEADER + size
    dst.write_bytes(bytes(data))
