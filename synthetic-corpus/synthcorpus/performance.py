"""Performer model: score phrase → timed, shaped performance.

Turns a `Phrase` (quarter-length notation with slurs/staccato/accents) into
`PerformedNote`s the renderers play, with the habits real players have:
phrase-level rubato and final ritardando, correlated timing drift plus
per-note jitter, articulation-dependent note lengths (legato / tongued or
bowed detaché / staccato), dynamics shaped by phrase arch, metre and pitch
height, per-note intonation error for non-fixed-pitch instruments, breaths for
wind players and singers (taken at rests, or stolen from a note when a phrase
outlasts the breath), and vibrato parameters where the sample set lacks it.

Every number here is a distribution, drawn per clip from a seeded RNG, so a
corpus is reproducible but no two clips share a groove.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field

from .melody import Phrase


@dataclass
class PerformedNote:
    onset: float  # seconds
    offset: float  # seconds (note-off / start of release; truth offset)
    midi: int
    vel: float  # 1..127
    legato_in: bool = False  # connected to previous note (no new attack)
    staccato: bool = False
    accent: bool = False
    cents: float = 0.0  # static intonation offset
    vibrato_rate: float = 0.0
    vibrato_depth: float = 0.0  # cents, peak
    vibrato_delay: float = 0.25
    glide_in: float = 0.0  # seconds of portamento from previous pitch
    swell: float = 0.0  # within-note dynamic change (-1..1): >0 crescendo, <0 decay
    breath_after: bool = False


@dataclass
class PlayerProfile:
    """How a family of instruments is played; drawn ranges are (lo, hi)."""

    family: str  # 'bowed' | 'wind' | 'brass' | 'reed' | 'pluck' | 'keys' | 'voice' | 'freereed' | 'pipes'
    legato_default: float = 0.5  # P(connect unslurred adjacent notes)
    detache_gap: tuple[float, float] = (0.03, 0.08)
    staccato_frac: tuple[float, float] = (0.35, 0.55)
    intonation_sd: float = 0.0  # cents
    vibrato: bool = False  # add vibrato in the renderer
    vibrato_rate: tuple[float, float] = (5.0, 6.5)
    vibrato_depth: tuple[float, float] = (10.0, 30.0)
    breath_capacity: tuple[float, float] | None = None  # seconds of continuous playing
    breath_time: tuple[float, float] = (0.25, 0.45)
    glide_prob: float = 0.0
    glide_time: tuple[float, float] = (0.04, 0.10)
    fixed_pitch: bool = False
    sustain_limit: float | None = None  # plucked/struck notes decay; offsets capped here


@dataclass
class Skill:
    name: str
    jitter_ms: float
    drift_ms: float
    rubato: float
    vel_noise: float
    intonation_mult: float


SKILLS = {
    'pro': Skill('pro', 7.0, 12.0, 0.06, 4.0, 0.7),
    'good': Skill('good', 12.0, 20.0, 0.08, 6.0, 1.0),
    'amateur': Skill('amateur', 22.0, 35.0, 0.10, 9.0, 1.6),
}


@dataclass
class Performance:
    notes: list[PerformedNote]
    qpm: float
    skill: str
    dynamic: str
    duration: float
    breaths: list[float] = field(default_factory=list)  # breath start times
    meta: dict = field(default_factory=dict)


class Performer:
    def __init__(self, profile: PlayerProfile, rng: random.Random):
        self.p = profile
        self.rng = rng

    # ------------------------------------------------------------ timing
    def _time_map(self, phrase: Phrase, qpm: float, skill: Skill):
        """Quarter position → seconds, with an arch-shaped tempo and a final ritardando."""
        L = phrase.length_q
        beat = 60.0 / qpm
        a = self.rng.uniform(-0.5, 1.0) * skill.rubato  # mid-phrase push (+) or broadening (-)
        rit = self.rng.uniform(0.08, 0.30)
        rit_len = min(L * 0.25, self.rng.uniform(1.0, 3.0))
        steps = max(64, int(L * 16))
        ts = [0.0]
        for k in range(steps):
            q = (k + 0.5) / steps * L
            r = 1.0 + a * math.sin(math.pi * q / L)
            if q > L - rit_len:
                r *= 1.0 - rit * ((q - (L - rit_len)) / rit_len) ** 1.5
            ts.append(ts[-1] + (L / steps) * beat / max(r, 0.5))

        def at(q: float) -> float:
            x = max(0.0, min(L, q)) / L * steps
            i = min(int(x), steps - 1)
            return ts[i] + (ts[i + 1] - ts[i]) * (x - i)

        return at

    # ------------------------------------------------------------ main
    def perform(self, phrase: Phrase, qpm: float, skill_name: str, dynamic: str, lead_in: float = 0.5, tempo: str = 'metronome') -> Performance:
        """`tempo='metronome'`: the take is played along the app's click — recording starts
        on the count-in downbeat, the tempo is the score's, and only human timing error
        (jitter, drift, a slight anticipation of the click) moves notes off the grid.
        `tempo='free'`: phrase-arch rubato and a final ritardando, no click."""
        rng = self.rng
        p = self.p
        skill = SKILLS[skill_name]
        if tempo == 'metronome':
            beat = 60.0 / qpm
            anticipation = rng.gauss(-0.012, 0.012)  # players lead a click by ~10-20 ms
            at = lambda q: q * beat + anticipation  # noqa: E731
        else:
            at = self._time_map(phrase, qpm, skill)
        base_vel = {'p': 48, 'mp': 62, 'mf': 76, 'f': 94, 'ff': 108}[dynamic]
        notes_s = phrase.notes
        L = phrase.length_q
        mean_midi = sum(n.midi for n in notes_s) / len(notes_s)
        peak_q = rng.uniform(0.45, 0.75) * L
        arch = rng.uniform(6, 16)
        meter_num = int(phrase.meter.split('/')[0]) if '/' in phrase.meter else 4
        beats_per_bar = meter_num if phrase.meter.endswith('/4') else max(1, meter_num / 2 if meter_num % 3 else meter_num / 3 * 1.5)
        drift = 0.0
        out: list[PerformedNote] = []
        legato_bias = p.legato_default + rng.uniform(-0.2, 0.2)
        for i, n in enumerate(notes_s):
            drift = 0.8 * drift + rng.gauss(0, skill.drift_ms / 1000 * 0.6)
            onset = lead_in + at(n.onset) + drift + rng.gauss(0, skill.jitter_ms / 1000)
            end_q = n.onset + n.dur
            nxt = notes_s[i + 1] if i + 1 < len(notes_s) else None
            gap_to_next = (nxt.onset - end_q) if nxt else None
            written_end = lead_in + at(end_q) + drift
            # --- articulation
            slurred_to_next = nxt is not None and n.in_slur and not n.slur_end and gap_to_next is not None and gap_to_next < 1e-6
            connected = False
            if nxt is not None and gap_to_next is not None and gap_to_next < 1e-6 and not n.staccato and nxt.midi != n.midi:
                connected = slurred_to_next or rng.random() < legato_bias
            if n.staccato:
                off = onset + max(0.1, (written_end - onset) * rng.uniform(*p.staccato_frac))
            elif connected:
                off = written_end  # meets the next onset; renderer crossfades
            elif gap_to_next is not None and gap_to_next < 1e-6:
                off = written_end - rng.uniform(*p.detache_gap)
            else:
                off = written_end - rng.uniform(0.0, 0.05)
            if n.fermata:
                off += (off - onset) * rng.uniform(0.2, 0.5)
            if p.sustain_limit:
                off = min(off, onset + p.sustain_limit)
            off = max(off, onset + 0.06)
            # --- dynamics
            q = n.onset
            v = base_vel + arch * math.exp(-((q - peak_q) / (0.45 * L)) ** 2) - arch * 0.5
            beat_pos = (q % beats_per_bar) if beats_per_bar else 0
            if abs(beat_pos) < 1e-6:
                v += 4
            if n.accent:
                v += 14
            if p.family in ('wind', 'brass', 'voice', 'reed', 'bowed'):
                v += 0.6 * (n.midi - mean_midi)
            v += rng.gauss(0, skill.vel_noise)
            v = max(20, min(125, v))
            cents = 0.0 if p.fixed_pitch else max(-35.0, min(35.0, rng.gauss(0, p.intonation_sd * skill.intonation_mult)))
            pn = PerformedNote(onset=onset, offset=off, midi=n.midi, vel=v, staccato=n.staccato, accent=n.accent, cents=cents)
            if p.vibrato and not n.staccato:
                pn.vibrato_rate = rng.uniform(*p.vibrato_rate)
                pn.vibrato_depth = rng.uniform(*p.vibrato_depth)
                pn.vibrato_delay = rng.uniform(0.12, 0.35)
            dur = off - onset
            if dur > 1.2 and p.family in ('wind', 'brass', 'voice', 'bowed', 'reed'):
                pn.swell = rng.choice([-1, 1]) * rng.uniform(0.2, 0.6)
            if out and out[-1].offset >= onset - 1e-3 and out[-1].midi != n.midi and self._connected_prev(out[-1], pn):
                pn.legato_in = True
                if p.glide_prob and rng.random() < p.glide_prob * (1.0 if abs(pn.midi - out[-1].midi) > 2 else 0.4):
                    # a slide lands early: never more than a quarter of the note
                    pn.glide_in = min(rng.uniform(*p.glide_time), 0.25 * (off - onset))
            out.append(pn)
        # legato: previous note's offset exactly meets this onset
        for a, b in zip(out, out[1:]):
            if b.legato_in:
                a.offset = b.onset
        breaths = self._breaths(out, phrase) if p.breath_capacity else []
        duration = out[-1].offset + 1.0
        return Performance(out, qpm, skill_name, dynamic, duration, breaths, meta={'tempo': tempo})

    @staticmethod
    def _connected_prev(prev: PerformedNote, cur: PerformedNote) -> bool:
        return abs(prev.offset - cur.onset) < 0.02 or prev.offset > cur.onset

    def _breaths(self, notes: list[PerformedNote], phrase: Phrase) -> list[float]:
        """Wind players and singers breathe: at rests if they come, else steal time."""
        rng = self.rng
        cap = rng.uniform(*self.p.breath_capacity)
        breaths = [max(0.0, notes[0].onset - rng.uniform(0.35, 0.6))]
        since = 0.0
        last_on = notes[0].onset
        for i in range(1, len(notes)):
            prev, cur = notes[i - 1], notes[i]
            gap = cur.onset - prev.offset
            since = cur.onset - last_on
            if gap > 0.35:
                breaths.append(prev.offset + 0.05)
                last_on = cur.onset
                continue
            if since > cap and prev.offset - prev.onset > 0.3:
                bt = rng.uniform(*self.p.breath_time)
                prev.offset = max(prev.onset + 0.15, cur.onset - bt)
                if cur.legato_in:
                    cur.legato_in = False
                    cur.glide_in = 0.0
                prev.breath_after = True
                breaths.append(prev.offset + 0.02)
                last_on = cur.onset
        return breaths
