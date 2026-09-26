"""Expressive monophonic sampler.

Plays a `Performance` through a `SampleSet` the way a skilled programmer of
sample libraries would, and the way stock samplers (fluidsynth/GM) do not:

- legato: a connected note does not retrigger an attack; the new sample is
  entered past its attack transient and equal-power crossfaded against the
  previous note (optionally with a short portamento through the interval),
- detached/staccato notes use the sample's own attack (or a staccato
  articulation when the library has one), round-robin rotated,
- dynamics pick the velocity layer and are continued with gain plus a
  brightness tilt, including within-note swells,
- pitch is exact per note (+ performer intonation), with delayed-onset
  vibrato added only when the samples are non-vibrato but the player wouldn't be,
- sustains longer than the recording are extended with a period-aligned
  crossfade loop found in the stable part of the tone,
- releases are instrument-shaped (a breathed/bowed tail vs a damped string).

Ground truth is emitted alongside: onset = when the note becomes the sounding
pitch (legato: the crossfade midpoint), offset = note-off.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass

import numpy as np
from scipy.signal import butter, sosfilt, sosfiltfilt

from .performance import Performance, PerformedNote
from .samples import SampleSet, Zone


@dataclass
class ZoneInfo:
    trim: int  # first frame of sound (leading silence removed)
    attack_end: int  # frames after trim where the attack transient is over
    sustain_rms: float
    loop: tuple[int, int] | None  # (start, end) relative to trim
    peak: float
    speak: int = 0  # frames after trim until the note SPEAKS (envelope within 10 dB of its level)


@dataclass
class SamplerStyle:
    release: tuple[float, float] = (0.08, 0.15)  # seconds, exponential tau range
    legato_xfade: tuple[float, float] = (0.04, 0.08)
    legato_entry: tuple[float, float] = (0.08, 0.16)  # seconds into the new sample
    dyn_tilt: float = 0.5  # brightness change per full dynamic range
    percussive: bool = False  # plucked/struck: natural decay, no loops
    damp_tau: tuple[float, float] = (0.06, 0.15)


class ZoneAnalyzer:
    _cache: dict[int, ZoneInfo] = {}

    @classmethod
    def info(cls, sset: SampleSet, z: Zone, percussive: bool) -> ZoneInfo:
        key = id(z)
        if key in cls._cache:
            return cls._cache[key]
        x = sset.audio(z)
        sr = sset.sr
        hop = max(1, sr // 200)
        n = len(x) // hop
        env = np.sqrt(np.mean(x[: n * hop].reshape(n, hop) ** 2, axis=1) + 1e-12) if n > 0 else np.array([1e-6])
        peak = float(env.max())
        above = np.nonzero(env > peak * 10 ** (-40 / 20))[0]
        trim_f = int(above[0]) if len(above) else 0
        trim = max(0, trim_f * hop - int(0.004 * sr))
        # attack end: first frame after the peak-rise where the envelope settles within 3 dB of the local sustain
        seg = env[trim_f:]
        if len(seg) > 20:
            ref = np.median(seg[: min(len(seg), 200)][10:]) if len(seg) > 30 else seg.max()
            reach = np.nonzero(seg > ref * 0.7)[0]
            att = int(reach[0]) if len(reach) else 10
            att = max(att, int(0.06 * 200))
        else:
            att = 10
        attack_end = min(len(x) - trim - 1, att * hop)
        # loudness reference: the 95th percentile of 5-ms frame RMS over the sounding part.
        # A post-attack median collapses for staccato/short takes and blew their gain up.
        body = env[trim_f:]
        body = body[body > peak * 10 ** (-30 / 20)]
        sustain_rms = float(np.percentile(body, 95)) if len(body) else peak
        # when the note speaks: breathy / bowed samples carry air or bow noise before
        # the tone; players time the tone, not the noise, to the beat
        speak_f = np.nonzero(env[trim_f:] >= sustain_rms * 10 ** (-10 / 20))[0]
        speak = int(speak_f[0]) * hop - (trim - trim_f * hop) if len(speak_f) else 0
        # ...and when its PITCH settles: samples that slide/scoop into the note (erhu,
        # some bowed/brass takes) reach the target pitch well after the energy does
        if not percussive:
            try:
                from .qa import f0_track

                head = x[trim : trim + int(0.45 * sr)]
                ts, hz, cf = f0_track(head, sr)
                ok = (cf > 0.7) & (np.abs(1200 * np.log2(np.maximum(hz, 1) / (440 * 2 ** ((z.root - 69) / 12)))) < 50)
                run = np.convolve(ok.astype(int), np.ones(3, int), 'valid') == 3
                if run.any():
                    pitch_on = int((ts[int(np.argmax(run))] - 0.02) * sr)
                    speak = max(speak, pitch_on)
            except Exception:
                pass
        speak = int(np.clip(speak, 0, int(0.25 * sr)))
        loop = None
        if not percussive:
            if z.loop is not None:
                lo, hi = z.loop[0] - trim, z.loop[1] - trim
                if lo > attack_end and hi - lo > int(0.05 * sr) and z.loop[1] <= len(x):
                    loop = (lo, hi)
            if loop is None:
                loop = cls._find_loop(x[trim:], sr, attack_end)
        zi = ZoneInfo(trim, attack_end, sustain_rms, loop, peak, speak)
        cls._cache[key] = zi
        return zi

    @staticmethod
    def _find_loop(x: np.ndarray, sr: int, attack_end: int) -> tuple[int, int] | None:
        """Period-aligned loop in the steadiest 60 % of the tone after the attack."""
        n = len(x)
        a0 = max(attack_end + int(0.1 * sr), int(n * 0.25))
        a1 = int(n * 0.85)
        if a1 - a0 < int(0.4 * sr):
            # short recording: settle for a shorter loop right after the attack
            a0 = attack_end + int(0.03 * sr)
            a1 = int(n * 0.8)
            if a1 - a0 < int(0.12 * sr):
                return None
        mid = x[a0:a1]
        # fundamental period by autocorrelation on a 100 ms window
        w = mid[: int(0.1 * sr)]
        ac = np.correlate(w, w, 'full')[len(w) - 1 :]
        lo, hi = int(sr / 2200), int(sr / 25)
        if hi >= len(ac):
            return None
        per = lo + int(np.argmax(ac[lo:hi]))
        length = min(max(int(0.35 * sr), (a1 - a0) // 2), a1 - a0 - per)
        if length < 3 * per:
            return None
        length = (length // per) * per
        start = a0
        # refine end to the best-matching sample within one period
        tgt = x[start : start + per]
        best, bi = -1e9, start + length
        for k in range(start + length - per, min(n - per, start + length + per)):
            c = float(np.dot(tgt, x[k : k + per]))
            if c > best:
                best, bi = c, k
        return (start, bi)


def _cubic(x: np.ndarray, pos: np.ndarray) -> np.ndarray:
    i = np.floor(pos).astype(np.int64)
    f = (pos - i).astype(np.float32)
    n = len(x)
    xm1 = x[np.clip(i - 1, 0, n - 1)]
    x0 = x[np.clip(i, 0, n - 1)]
    x1 = x[np.clip(i + 1, 0, n - 1)]
    x2 = x[np.clip(i + 2, 0, n - 1)]
    c1 = 0.5 * (x1 - xm1)
    c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2
    c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1)
    return ((c3 * f + c2) * f + c1) * f + x0


class MonoSampler:
    def __init__(self, sset: SampleSet, style: SamplerStyle, rng: random.Random, sr_out: int = 48000, add_vibrato: bool = False,
                 breaths: list[tuple[np.ndarray, int]] | None = None):
        self.s = sset
        self.style = style
        self.rng = rng
        self.sr = sr_out
        self.add_vibrato = add_vibrato
        self.breaths = breaths or []
        self._rr: dict[tuple, int] = {}
        self._refs: dict[tuple, float] = {}
        self._last: dict[int, Zone] = {}
        self._xf: dict[int, float] = {}
        vels = sorted({(z.vel_low + z.vel_high) / 2 for z in sset.zones})
        self.multi_dyn = len(vels) > 1

    # -------------------------------------------------------------- zones
    def _pick(self, note: PerformedNote, art: str) -> Zone:
        cands = self.s.candidates(note.midi, int(note.vel), art)
        best = min(abs(z.root - note.midi) for z in cands)
        cands = [z for z in cands if abs(z.root - note.midi) - best < 0.51]
        # prefer recordings long enough to carry the note without looping
        need = (note.offset - note.onset + 0.15) * self.s.sr * 2 ** ((note.midi - best) / 12)
        long_ = [z for z in cands if len(self.s.audio(z)) >= need]
        if long_:
            cands = long_
        elif len(cands) > 1:
            cands = sorted(cands, key=lambda z: -len(self.s.audio(z)))[:2]
        key = (note.midi, art, int(note.vel) // 16)
        k = self._rr.get(key, self.rng.randrange(len(cands)))
        self._rr[key] = k + 1
        z = cands[k % len(cands)]
        if z is self._last.get(note.midi) and len(cands) == 1:
            # no round robin here: borrow the neighbouring semitone's take (shifted into
            # place) so a repeated note never replays identical audio
            alt = [c for c in self.s.candidates(note.midi + self.rng.choice((-1, 1)), int(note.vel), art) if abs(c.root - note.midi) <= 1.6 and c is not z]
            if alt:
                z = self.rng.choice(alt)
        self._last[note.midi] = z
        return z

    def _extended(self, z: Zone, zi: ZoneInfo, need: int) -> np.ndarray:
        """Source frames from the trim point on, loop-extended to at least `need` frames."""
        x = self.s.audio(z)[zi.trim :]
        if len(x) >= need or zi.loop is None:
            if len(x) < need:
                x = np.concatenate([x, np.zeros(need - len(x), np.float32)])
            return x
        lo, hi = zi.loop
        seg = x[lo:hi]
        xf = min(int(0.03 * self.s.sr), len(seg) // 3)
        fade = np.sin(np.linspace(0, np.pi / 2, xf, dtype=np.float32)) ** 2
        out = [x[:hi]]
        total = hi
        while total < need:
            # crossfade the loop start into the tail of what we have
            prev = out[-1]
            head = seg[:xf] * fade + prev[-xf:] * (1 - fade)
            out[-1] = prev[:-xf]
            out.append(np.concatenate([head, seg[xf:]]))
            total += len(seg) - xf
        return np.concatenate(out)

    # -------------------------------------------------------------- note
    def _render_note(self, note: PerformedNote, prev: PerformedNote | None, next_legato: bool) -> tuple[int, np.ndarray, float]:
        st = self.style
        rng = self.rng
        sr_in = self.s.sr
        art = 'sus'
        arts = self.s.arts()
        short = (note.offset - note.onset) < 0.18 and not note.legato_in
        if (note.staccato or short) and 'stac' in arts:
            art = 'stac'
        elif note.vibrato_depth > 0 and 'vib' in arts:
            art = 'vib'
        elif note.vibrato_depth > 0 and 'nonvib' in arts and 'sus' not in arts:
            art = 'nonvib'  # we add the vibrato ourselves
        elif note.vibrato_depth == 0 and 'nonvib' in arts:
            art = 'nonvib'
        elif 'sus' not in arts and 'nonvib' in arts:
            art = 'nonvib'
        z = self._pick(note, art)
        zi = ZoneAnalyzer.info(self.s, z, st.percussive)
        xf = self._xf.get(id(note), 0.0) if note.legato_in else 0.0
        rel_tau = rng.uniform(*(st.damp_tau if st.percussive else st.release))
        rel_len = 0.0 if next_legato else rel_tau * 5
        # a detached note starts its sample early by the sample's speaking time, so the
        # TONE lands on the performed onset (the truth); legato entries skip the attack
        skips_attack = short and art != 'stac' and not st.percussive and zi.attack_end > int(0.03 * sr_in)
        lead = 0.0 if note.legato_in else zi.speak / sr_in * (0.3 if skips_attack else 1.0)
        t0 = note.onset - xf / 2 - lead
        t1 = note.offset + (0.0 if not next_legato else 0.0)
        dur = (t1 - t0) + rel_len + (0.06 if next_legato else 0.0)
        n_out = int(dur * self.sr) + 1
        t = np.arange(n_out, dtype=np.float64) / self.sr
        # pitch trajectory (cents relative to target)
        cents = np.full(n_out, note.cents, dtype=np.float64)
        if note.glide_in > 0 and prev is not None:
            g = note.glide_in
            d = (prev.midi - note.midi) * 100.0
            k = np.clip(t / g, 0, 1)
            cents += d * (1 - (3 * k**2 - 2 * k**3))
        # synthetic vibrato only on samples recorded WITHOUT it: 'sus'/'normal' takes of
        # strings, flutes, oboes and saxes already carry the player's own vibrato
        use_vib = note.vibrato_depth > 0 and (self.add_vibrato or z.art == 'nonvib')
        if use_vib:
            ramp = np.clip((t - note.vibrato_delay) / 0.35, 0, 1)
            rate = note.vibrato_rate * (1 + 0.04 * np.sin(2 * np.pi * 0.7 * t + rng.uniform(0, 6.28)))
            phase = 2 * np.pi * np.cumsum(rate) / self.sr + rng.uniform(0, 6.28)
            cents += note.vibrato_depth * ramp * np.sin(phase)
        ratio = 2 ** ((note.midi - z.root) / 12) * (sr_in / self.sr)
        inc = ratio * 2 ** (cents / 1200.0)
        if note.legato_in:
            start = zi.attack_end + int(rng.uniform(*st.legato_entry) * sr_in)
        elif short and art != 'stac' and not st.percussive and zi.attack_end > int(0.03 * sr_in):
            # fast passage on a slow-speaking sample: enter part-way through its attack
            start = int(min(zi.attack_end, 0.08 * sr_in) * rng.uniform(0.4, 0.7))
        else:
            start = 0
        pos = start + np.cumsum(inc) - inc[0]
        src = self._extended(z, zi, int(pos[-1]) + 4)
        y = _cubic(src, pos).astype(np.float32)
        # gain / dynamics
        mid_vel = (z.vel_low + z.vel_high) / 2
        dv = (note.vel - (mid_vel if self.multi_dyn else 80)) / 127.0
        ref = self._ref_rms(z, st.percussive)
        gain = 10 ** ((24 if not self.multi_dyn else 10) * dv / 20) * (0.1 / max(ref, 1e-4))
        env = np.ones(n_out, dtype=np.float32) * gain
        if note.swell:
            k = np.clip((t - xf) / max(1e-3, t1 - t0), 0, 1)
            env *= 10 ** (note.swell * 6 * (k - 0.3) / 20)
        if not st.percussive and (t1 - t0) > 0.4:
            # a held note is never perfectly steady: slow ±~1 dB breath/bow-pressure wander
            g = np.random.default_rng(rng.randrange(1 << 30))
            ctrl = g.normal(size=int((t1 - t0) * 4) + 3)
            wander = np.interp(t, np.linspace(0, t[-1], len(ctrl)), ctrl)
            env *= (10 ** (0.9 * wander / 20)).astype(np.float32)
        # brightness tilt with dynamics (continuous timbre change)
        if st.dyn_tilt and abs(dv) > 0.02:
            sos = butter(2, 2000 / (self.sr / 2), 'low', output='sos')
            lp = sosfilt(sos, y).astype(np.float32)
            b = 10 ** (st.dyn_tilt * dv)
            y = lp + b * (y - lp)
        # fades
        if note.legato_in and xf > 0:
            nf = int(xf * self.sr)
            env[:nf] *= np.sin(np.linspace(0, np.pi / 2, nf)) ** 1
        elif start > 0:
            nf = int(0.008 * self.sr)
            env[:nf] *= np.linspace(0, 1, nf)
        else:
            nf = int(0.002 * self.sr)
            env[:nf] *= np.linspace(0, 1, nf)
        off_i = int((t1 - t0) * self.sr)
        if next_legato:
            # hold through the next note's crossfade (it fades us with a cosine)
            pass
        else:
            tail = np.arange(n_out - off_i) / self.sr
            env[off_i:] *= np.exp(-tail / rel_tau)
        y *= env
        return int(round(t0 * self.sr)), y, xf

    def _ref_rms(self, z: Zone, percussive: bool) -> float:
        """Loudest layer's sustain level at this pitch/articulation: keeps soft layers soft."""
        key = (round(z.root), z.art)
        if key not in self._refs:
            sib = [s for s in self.s.zones if (round(s.root), s.art) == key]
            self._refs[key] = max(ZoneAnalyzer.info(self.s, s, percussive).sustain_rms for s in sib)
        return self._refs[key]

    def render(self, perf: Performance) -> tuple[np.ndarray, list[dict]]:
        # crossfade no longer than a fifth of the shorter of the two notes it joins
        self._xf = {}
        for a, b in zip(perf.notes, perf.notes[1:]):
            if b.legato_in:
                cap = 0.2 * min(a.offset - a.onset, b.offset - b.onset)
                self._xf[id(b)] = max(0.008, min(self.rng.uniform(*self.style.legato_xfade), cap))
        total = int((perf.duration + 2.0) * self.sr)
        out = np.zeros(total, dtype=np.float32)
        truth = []
        notes = perf.notes
        for i, n in enumerate(notes):
            prev = notes[i - 1] if i > 0 else None
            nxt = notes[i + 1] if i + 1 < len(notes) else None
            next_legato = bool(nxt and nxt.legato_in)
            s0, y, xf = self._render_note(n, prev, next_legato)
            if next_legato:
                # fade this note out across the next note's crossfade window
                xf_next = self._xf[id(nxt)]
                fo_start = int((nxt.onset - xf_next / 2) * self.sr) - s0
                fo_len = int(xf_next * self.sr)
                if 0 < fo_start < len(y):
                    seg = min(fo_len, len(y) - fo_start)
                    y[fo_start : fo_start + seg] *= np.cos(np.linspace(0, np.pi / 2, fo_len))[:seg]
                    y[fo_start + seg :] = 0
            elif nxt is not None:
                # monophonic choke: a player stops the old note when the next one starts,
                # so its release tail must not sound over the new attack
                cut = int(nxt.onset * self.sr) - s0
                fl = int((0.06 if self.style.percussive else 0.025) * self.sr)
                if 0 < cut < len(y):
                    seg = min(fl, len(y) - cut)
                    y[cut : cut + seg] *= np.linspace(1, 0, fl)[:seg]
                    y[cut + seg :] = 0
            e = min(total, s0 + len(y))
            if s0 < 0:
                y = y[-s0:]
                s0 = 0
            out[s0:e] += y[: e - s0]
            truth.append({'onsetSec': round(n.onset, 4), 'durSec': round(n.offset - n.onset, 4), 'midi': int(n.midi)})
        if self.breaths and perf.breaths:
            self._add_breaths(out, perf)
        end = int((notes[-1].offset + 1.2) * self.sr)
        return out[:end], truth

    def _add_breaths(self, out: np.ndarray, perf: Performance) -> None:
        """Audible inhales (real human breaths) where the performer breathes."""
        rng = self.rng
        ref = float(np.sqrt(np.mean(out[out != 0] ** 2))) if np.any(out) else 0.05
        for t in perf.breaths:
            nxt = min((n.onset for n in perf.notes if n.onset > t), default=None)
            if nxt is None or rng.random() > 0.8:
                continue
            room = nxt - t - 0.02
            if room < 0.12:
                continue
            bx, bsr = rng.choice(self.breaths)
            L = int(min(len(bx) / bsr, room, rng.uniform(0.25, 0.6)) * self.sr)
            src = np.interp(np.linspace(0, len(bx) * (L / self.sr) * bsr / len(bx) - 1, L), np.arange(len(bx)), bx) if L > 0 else bx[:0]
            if not len(src):
                continue
            fade = np.minimum(1, np.linspace(0, 5, L)) * np.minimum(1, np.linspace(5, 0, L))
            gain = ref * 10 ** (rng.uniform(-34, -24) / 20) / (np.sqrt(np.mean(src**2)) + 1e-9)
            a = int((nxt - 0.03) * self.sr) - L
            if a >= 0:
                out[a : a + L] += (src * fade * gain).astype(np.float32)
