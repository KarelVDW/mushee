"""Compare a synthetic copy with its original: global metrics, a ranked diff list, panels.

Global metrics (copy vs original, both measured by `Analyzer` with the same settings):
- pitch: co-voiced frames (original confident, copy voiced) within 50 c;
- voicing recall / precision: the original's confident frames the copy voices, and the copy's
  voiced frames the original voices;
- onset F1: the original's onset + pitch-change events vs the copy's, ±50 ms;
- explained voiced time: the original's confident frames inside a note (±20 ms).

Diffs (spec vs original evidence, see evidence.py), most severe first: missing-sound,
extra-sound, pitch, extra-onset, unsupported, timing (> 40 ms), offset (> 80 ms before
silence), syllable (sung material: a new syllable inside a held note, a possible same-pitch
split), uncertain-region. Each carries a suggested edit op (`edit --apply D3`).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np

from .analysis import HOP, Analysis, hz_to_midi
from .evidence import SCOOP, Event, Evidence, _runs
from .segment import F0Segmenter
from .spec import Spec, pitch_name

REPORT_SCHEMA = 'resynth-report/1'
MAX_DIFF_LINES = 25
TOL_ONSET = 0.05
TOL_TIMING = 0.04
TOL_OFFSET = 0.08


@dataclass
class Diff:
    type: str
    t0: float
    t1: float
    text: str
    note: str | None = None
    hint: str = ''
    op: dict | list | None = None  # suggested edit op(s), applied by `edit --apply D<k>`
    severity: float = 0.0
    id: str = ''

    def line(self) -> str:
        s = f' {self.id:<4}{(self.note or "-"):<6}{self.t0:6.2f}–{self.t1:<6.2f} {self.type:<16} {self.text}'
        return s + (f'  → {self.hint}' if self.hint else '')


def _events(a: Analysis, seg: F0Segmenter) -> np.ndarray:
    """Onset events used for onset F1: energy onsets (≥ 3 dB sustained rise) ∪ legato pitch arrivals."""
    ev = sorted([float(t) for t, r in zip(a.onsets, a.onset_rise) if r >= 3] + [t for t, _, _ in seg.pitch_events()])
    out: list[float] = []
    for t in ev:
        if not out or t - out[-1] > 0.03:
            out.append(t)
    return np.asarray(out)


def _f1(ref: np.ndarray, est: np.ndarray, tol: float) -> float:
    if not len(ref) and not len(est):
        return 1.0
    if not len(ref) or not len(est):
        return 0.0
    used = np.zeros(len(est), bool)
    hit = 0
    for t in ref:
        d = np.abs(est - t)
        d[used] = np.inf
        j = int(np.argmin(d))
        if d[j] <= tol:
            used[j] = True
            hit += 1
    p, r = hit / len(est), hit / len(ref)
    return 0.0 if hit == 0 else 2 * p * r / (p + r)


def _pad(x: np.ndarray, n: int, fill) -> np.ndarray:
    return x[:n] if len(x) >= n else np.concatenate([x, np.full(n - len(x), fill, dtype=x.dtype)])


class Comparison:
    def __init__(self, spec: Spec, orig: Analysis, copy: Analysis, ev: Evidence | None = None):
        self.spec = spec
        self.orig = orig
        self.copy = copy
        self.ev = ev or Evidence(orig)
        self.notes = sorted(spec.notes, key=lambda n: n.on)

    # ------------------------------------------------------------ global
    def metrics(self) -> dict:
        o, c = self.orig, self.copy
        n = max(o.n, c.n)
        oc, cc = _pad(o.conf, n, 0), _pad(c.conf, n, 0)
        of, cf = _pad(o.f0, n, np.nan), _pad(c.f0, n, np.nan)
        co = (oc == 2) & (cc >= 1)
        pitch = float((np.abs(cf[co] - of[co]) <= 0.5).mean()) if co.any() else 0.0
        conf = oc == 2
        recall = float((cc[conf] >= 1).mean()) if conf.any() else 1.0
        precision = float((oc[cc >= 1] >= 1).mean()) if (cc >= 1).any() else 1.0
        covered = np.zeros(n, bool)
        for nt in self.notes:
            covered[o.span(nt.on - 0.02, nt.off + 0.02)] = True
        explained = float(covered[conf].mean()) if conf.any() else 1.0
        f1 = _f1(_events(o, self.ev.seg), _events(c, F0Segmenter(c)), TOL_ONSET)
        return {'pitch': round(pitch, 4), 'voicingRecall': round(recall, 4), 'voicingPrecision': round(precision, 4), 'onsetF1': round(f1, 4),
                'explained': round(explained, 4), 'notes': len(self.notes), 'durSec': round(o.dur, 3)}

    EXTRA_SOUND_VF = 0.35  # a note the original voices over less than this is an extra sound

    def onset_support(self) -> dict[str, list[Event]]:
        """Per note id: the evidence that counts for its onset, nearest first (empty = unsupported).
        Evidence matching the previous note's onset (its nearest candidate, within TOL_TIMING) cannot
        be this note's onset too; an extra-sound note claims nothing and is left out. The one rule
        for `diffs` and the `note` view."""
        ev, out, claimed = self.ev, {}, None
        for i, n in enumerate(self.notes):
            if ev.voiced_fraction(n) < self.EXTRA_SOUND_VF:
                claimed = None
                continue
            cands = [e for e in ev.onset_candidates(n, self.notes[i - 1] if i else None) if claimed is None or abs(e.t - claimed) > 0.01]
            claimed = cands[0].t if cands and abs(cands[0].t - n.on) <= TOL_TIMING else None
            out[n.id] = cands
        return out

    # ------------------------------------------------------------ diffs
    def diffs(self) -> list[Diff]:
        ev = self.ev
        notes = self.notes
        out: list[Diff] = []
        pitch_flagged: set[str] = set()
        support = self.onset_support()
        for i, n in enumerate(notes):
            prev = notes[i - 1] if i else None
            nxt = notes[i + 1] if i + 1 < len(notes) else None
            vf = ev.voiced_fraction(n)
            if vf < self.EXTRA_SOUND_VF:
                out.append(Diff('extra-sound', n.on, n.off, f'note sounds, orig voiced over {vf:.0%} of it', n.id, f'delete {n.id}?',
                                {'op': 'delete', 'id': n.id}, 2 * n.dur * (1 - vf)))
                continue
            p = ev.note_pitch(n)
            # a note flagged uncertain-pitch within 15 c of the boundary is a decided call (convention 2)
            if p.median is not None and abs(p.median - n.midi) > (0.65 if 'uncertain-pitch' in n.flags else 0.5):
                dev = p.median - n.midi
                tgt = int(round(p.median))
                unc = '' if p.confident else ', trackers unsure'
                out.append(Diff('pitch', n.on, n.off, f'orig {p.median:.1f} vs note {n.midi} ({dev * 100:+.0f} c{unc})', n.id, f'midi {tgt}?',
                                {'op': 'set', 'id': n.id, 'midi': tgt}, n.dur * min(abs(dev), 2.0) + 0.1))
                pitch_flagged.add(n.id)
            for e in ev.inside(n):
                if e.kind == 'pitch':
                    op = [{'op': 'split', 'id': n.id, 'at': round(e.t, 3), 'midi': e.to_midi, 'legato': True}]
                    if e.from_midi != n.midi:
                        op.append({'op': 'set', 'id': n.id, 'midi': e.from_midi})
                    out.append(Diff('extra-onset', e.t, e.t, f'orig pitch change {pitch_name(e.from_midi)}→{pitch_name(e.to_midi)} inside {n.id}', n.id,
                                    f'split at {e.t:.2f}?', op, 0.2))
                elif e.kind == 'attack':
                    gap0 = ev.silence_before(e.t)
                    m1, m2 = ev.median_midi(n.on, gap0, n.midi), ev.median_midi(e.t, min(n.off, e.t + 0.3), n.midi)
                    if gap0 - n.on < 0.05:  # the note itself starts in that silence: its onset is late
                        out.append(Diff('timing', n.on, e.t, f'orig silent until {e.t:.2f} inside {n.id} (its sound starts there)', n.id,
                                        f'on {e.t:.2f}?', {'op': 'set', 'id': n.id, 'on': round(e.t, 3)}, 2 * (e.t - n.on)))
                        continue
                    op = [{'op': 'split', 'id': n.id, 'at': round(e.t, 3), 'midi': m2, 'legato': False}, {'op': 'set', 'id': n.id, 'off': round(gap0, 3), 'midi': m1}]
                    out.append(Diff('extra-onset', gap0, e.t, f'orig silent {gap0:.2f}–{e.t:.2f} inside {n.id}, then a new attack', n.id,
                                    f'end {n.id} at {gap0:.2f}, new note at {e.t:.2f}?', op, 0.3 + (e.t - gap0)))
                else:
                    out.append(Diff('extra-onset', e.t, e.t, f'orig re-articulation inside {n.id} (dip {e.dip:.0f} dB)', n.id,
                                    f'split at {e.t:.2f}?', {'op': 'split', 'id': n.id, 'at': round(e.t, 3)}, 0.1 + 0.02 * min(e.dip, 10)))
            cands = support[n.id]
            if not cands:
                touching = prev is not None and not ev.detached(n, prev)
                hint, op = (f'merge with {prev.id}?', {'op': 'merge', 'ids': [prev.id, n.id]}) if touching else ('', None)
                kind = 're-articulation' if touching and prev.midi == n.midi else 'onset/pitch change'
                weak = ev.weak_syllable(n.on) if touching and prev.midi == n.midi else None
                if weak is not None:  # a sung syllable too weak to count: the agents decide by eye
                    out.append(Diff('unsupported', n.on, n.on, f'no orig re-articulation near {n.on:.2f}, only a weak syllable change {weak.t:.2f} '
                                    f'({weak.strength:.2f})', n.id, f'merge with {prev.id}, unless a new syllable starts there?', op, 0.08))
                else:
                    out.append(Diff('unsupported', n.on, n.on, f'no orig {kind} near {n.on:.2f}', n.id, hint, op, 0.15))
            else:
                best = cands[0]
                dt = best.t - n.on
                if abs(dt) > TOL_TIMING:
                    out.append(Diff('timing', min(n.on, best.t), max(n.on, best.t), f'note {n.on:.2f}, orig {best.label} {best.t:.2f} ({dt * 1000:+.0f} ms)', n.id,
                                    f'on {best.t:.2f}?', {'op': 'set', 'id': n.id, 'on': round(best.t, 3)}, 2 * abs(dt)))
            if nxt is None or nxt.on - n.off >= 0.1:
                end = ev.sound_end(n, nxt)
                if end is not None and abs(end - n.off) > TOL_OFFSET and end - n.on > 0.03:
                    d = end - n.off
                    out.append(Diff('offset', n.off, end, f'note ends {n.off:.2f}, orig sound ends {end:.2f} ({d * 1000:+.0f} ms)', n.id,
                                    f'off {end:.2f}?', {'op': 'set', 'id': n.id, 'off': round(end, 3)}, abs(d)))
        offsets = [d for d in out if d.type == 'offset']
        for t0, t1, med in ev.uncovered(notes):
            if any(d.t0 - 0.03 <= t0 and t1 <= d.t1 + 0.03 for d in offsets):
                continue  # the same sound as a note's late end (reported as offset)
            near = [n for n in notes if (abs(n.off - t0) <= 0.03 and not ev.rearticulated(t0) or abs(n.on - t1) <= 0.03 and not ev.rearticulated(t1))
                    and abs(n.midi - med) <= 0.5]
            if near:
                n = near[0]
                op = {'op': 'set', 'id': n.id, 'off': round(t1, 3)} if abs(n.off - t0) <= 0.03 else {'op': 'set', 'id': n.id, 'on': round(t0, 3)}
                hint = f'extend {n.id}?'
            else:
                op = {'op': 'add', 'on': round(t0, 3), 'off': round(t1, 3), 'midi': int(round(med))}
                hint = f'add {pitch_name(med)}?'
            out.append(Diff('missing-sound', t0, t1, f'orig voiced ~{pitch_name(med)} ({med:.1f}), copy silent', None, hint, op, 2 * (t1 - t0)))
        split_at: dict[str, list[float]] = {}
        for d in out:
            if d.type == 'extra-onset':
                split_at.setdefault(d.note, []).append(d.t0)
        out += self._render_mismatch(pitch_flagged, split_at)
        out += self._syllables(out)
        for t0, t1, what in ev.uncertain(notes):
            out.append(Diff('uncertain-region', t0, t1, what, None, 'judge by eye', None, 0.05 + 0.3 * (t1 - t0)))
        out.sort(key=lambda d: (-d.severity, d.t0))
        for k, d in enumerate(out, 1):
            d.id = f'D{k}'
        return out

    def _syllables(self, found: list[Diff]) -> list[Diff]:
        """Sung material: a strong syllable event inside a note on ONE pitch (the original's median
        pitch over the note's parts before and after it, ≤ 250 ms each, is within 50 c) that
        nothing else splits there — a new syllable on the same pitch, which annotators make a new
        note (truth convention 6). The judge decides by eye (a consonant gap or burst, a formant
        change); the op splits it."""
        ev, o = self.ev, self.orig
        if not ev.syllables:
            return []
        split_at: dict[str, list[float]] = {}
        for d in found:
            if d.type in ('extra-onset', 'extra-sound') and d.note:
                split_at.setdefault(d.note, []).extend((d.t0, d.t1))
        out = []
        for n in self.notes:
            for e in ev.syllables_inside(n, split_at.get(n.id, ())):
                sides = []
                for a, b in ((max(n.on, e.t - 0.25), e.t - 0.03), (e.t + 0.03, min(n.off, e.t + 0.25))):
                    sl = o.span(a, b)
                    f = o.f0[sl][o.conf[sl] >= 1]
                    sides.append(float(np.median(f)) if len(f) else None)
                if None not in sides and abs(sides[0] - sides[1]) >= 0.5:
                    continue  # the pitch moves there: a pitch question, not a same-pitch syllable
                out.append(Diff('syllable', e.t, e.t, f'orig syllable change inside {n.id} (strength {e.strength:.1f}, same pitch)', n.id,
                                f'split at {e.t:.2f} if a new syllable starts?', {'op': 'split', 'id': n.id, 'at': round(e.t, 3)}, 0.05 + 0.04 * min(e.strength, 3.0)))
        return out

    def _render_mismatch(self, skip: set[str], split_at: dict[str, list[float]]) -> list[Diff]:
        """Copy and original disagree in pitch inside a note whose centre is right (≥ 100 ms,
        > 50 c). Where the original HOLDS another pitch there (its 10–90 % range within 1 st, ≥ 75 c
        from the note) that is a note the spec lacks: an extra-onset with a split. Where it moves
        (a slow scoop, a glide, wide vibrato) it is a contour/render limit, reported so it is not
        mistaken for a note error. Spans an extra-onset already splits are not repeated."""
        o, c = self.orig, self.copy
        out = []
        for n in self.notes:
            if n.id in skip:
                continue
            sl = o.span(n.on, n.off)
            if sl.stop > c.n:
                continue
            bad = (o.conf[sl] == 2) & (c.conf[sl] >= 1) & (np.abs(c.f0[sl] - o.f0[sl]) > 0.5)
            for s, e in _runs(bad, 2):
                if (e - s) * HOP < 0.1:
                    continue
                t0, t1 = (sl.start + s) * HOP, (sl.start + e) * HOP
                if any(t0 - 0.1 <= t <= t1 + 0.1 for t in split_at.get(n.id, ())):
                    continue
                of = o.f0[sl][s:e][o.conf[sl][s:e] == 2]
                held = float(np.median(of))
                lo, hi = np.percentile(of, [10, 90])
                edge = t0 - n.on < 0.05 or n.off - t1 < 0.05  # at an end it must outlast a scoop / fall
                if hi - lo <= 1.0 and abs(held - (n.midi + n.cents / 100)) >= 0.75 and (t1 - t0 >= SCOOP or not edge):
                    tgt = int(round(held))
                    at = t1 if t0 - n.on < 0.05 else t0  # a held start: the note proper begins where it ends
                    op = [{'op': 'split', 'id': n.id, 'at': round(at, 3), 'midi': n.midi if at == t1 else tgt, 'legato': True}]
                    if at == t1:
                        op.append({'op': 'set', 'id': n.id, 'midi': tgt})
                    if n.on + 0.02 <= at <= n.off - 0.02:
                        out.append(Diff('extra-onset', t0, t1, f'orig holds {pitch_name(tgt)} ({held:.1f}) {t0:.2f}–{t1:.2f} inside {n.id} {pitch_name(n.midi)}', n.id,
                                        f'split at {at:.2f}?', op, 0.2 + 0.3 * (t1 - t0)))
                        continue
                dev = float(np.nanmedian(c.f0[sl][s:e] - o.f0[sl][s:e]))
                out.append(Diff('pitch', t0, t1, f'copy vs orig {dev * 100:+.0f} c inside {n.id} (orig moving, note centre ok)', n.id,
                                'contour/render, not a note error?', None, 0.3 * (t1 - t0)))
        return out

    # ------------------------------------------------------------ report
    def report(self) -> dict:
        diffs = self.diffs()
        return {'schema': REPORT_SCHEMA, 'dataset': self.spec.dataset, 'clip': self.spec.clip, 'specVersion': self.spec.version, 'metrics': self.metrics(),
                'diffs': [{k: v for k, v in asdict(d).items() if v not in (None, '')} for d in diffs]}


def report_text(rep: dict, header: dict, panel_dir: str | None = None) -> str:
    """The compact report agents read every round (≤ ~60 lines)."""
    m = rep['metrics']
    h = header
    lines = [f'{h["ref"]}  {m["durSec"]:.1f} s  {m["notes"]} notes  spec v{rep["specVersion"]}  round {h.get("round", 1)}  [{h.get("status", "?")}]'
             + ('  (STALE: spec is v%d)' % h['specVersion'] if h.get('specVersion') not in (None, rep['specVersion']) else ''),
             f'GLOBAL pitch {m["pitch"]:.1%} (co-voiced frames ≤50c) · voicing recall {m["voicingRecall"]:.0%} / precision {m["voicingPrecision"]:.0%} ·',
             f'       onset F1 {m["onsetF1"]:.2f} (orig events vs copy, ±50 ms) · explained voiced time {m["explained"]:.0%}']
    diffs = [Diff(**{k: v for k, v in d.items()}) for d in rep['diffs']]
    if not diffs:
        lines.append('DIFFS none')
    else:
        counts = {}
        for d in diffs:
            counts[d.type] = counts.get(d.type, 0) + 1
        lines.append(f'DIFFS {len(diffs)} (most severe first): ' + ', '.join(f'{v} {k}' for k, v in sorted(counts.items(), key=lambda kv: -kv[1])))
        lines += [d.line() for d in diffs[:MAX_DIFF_LINES]]
        if len(diffs) > MAX_DIFF_LINES:
            lines.append(f' +{len(diffs) - MAX_DIFF_LINES} more (report.json)')
    if rep.get('panels'):
        ps = rep['panels']
        first = f'{panel_dir}/{ps[0]["file"]}' if panel_dir else ps[0]['file']
        rest = ', '.join(f'{p["file"]} ({p["t0"]:.1f}–{p["t1"]:.1f} s)' for p in ps[1:])
        lines.append(f'panels: {first} ({ps[0]["t0"]:.1f}–{ps[0]["t1"]:.1f} s)' + (f', {rest}' if rest else ''))
    return '\n'.join(lines)


# ======================================================================== panels


def _save_png(fig, path, quantize: bool = True) -> None:
    """dpi 100, quantised to a 256-colour palette: ~3x smaller, still legible (a zoom keeps its
    exact colours: its small markers would be merged into the spectrogram's palette)."""
    import io

    from PIL import Image

    buf = io.BytesIO()
    fig.savefig(buf, format='png', dpi=100)
    buf.seek(0)
    img = Image.open(buf).convert('RGB')
    if quantize:
        img = img.quantize(colors=256, method=Image.Quantize.MEDIANCUT)
    tmp = path.with_name(path.name + '.tmp')
    img.save(tmp, format='PNG', optimize=True)
    tmp.replace(path)


class Panels:
    """One PNG per ≤ 8 s window: original spectrogram + f0 + note boxes + diff markers, the
    copy's spectrogram + f0 + the same boxes, and both onset envelopes with their events.
    `zoom` draws the same three rows for one short window (≤ 4 s) with a finer time axis and
    the event strengths written next to the markers."""

    WINDOW = 8.0
    STEP = 7.5
    ZOOM_MAX = 4.0

    def __init__(self, spec: Spec, orig: Analysis, copy: Analysis, y_orig16: np.ndarray, y_copy16: np.ndarray, diffs: list[dict], f0_range: tuple[float, float],
                 anchors: list[float] | tuple = ()):
        self.spec, self.orig, self.copy = spec, orig, copy
        self.yo, self.yc = y_orig16, y_copy16
        self.diffs = diffs
        self.anchors = list(anchors)  # human onsets (jacrc syllables), drawn in the onset row
        self.mrange = (float(hz_to_midi(np.array([f0_range[0]]))[0]), float(hz_to_midi(np.array([f0_range[1]]))[0]))
        self.nfft = 1024 if orig.family == 'whistle' else 2048

    def windows(self) -> list[tuple[float, float]]:
        dur = max(self.orig.dur, max((n.off for n in self.spec.notes), default=0.0))
        if dur <= self.WINDOW:
            return [(0.0, dur)]
        out = []
        s = 0.0
        while s < dur - 0.5:
            out.append((s, min(s + self.WINDOW, dur)))
            if s + self.WINDOW >= dur:
                break
            s += self.STEP
        return out

    def save(self, out_dir) -> list[dict]:
        import matplotlib

        matplotlib.use('Agg')
        import matplotlib.pyplot as plt

        out_dir.mkdir(parents=True, exist_ok=True)
        for p in out_dir.glob('p*.png'):
            p.unlink()
        so, sc = self._spec(self.yo), self._spec(self.yc)
        res = []
        for k, (t0, t1) in enumerate(self.windows(), 1):
            fig = self._figure(plt, so, sc, t0, t1)
            name = f'p{k}.png'
            _save_png(fig, out_dir / name)
            plt.close(fig)
            res.append({'file': name, 't0': round(t0, 2), 't1': round(t1, 2)})
        return res

    def zoom(self, path, t0: float, t1: float) -> None:
        """One close-up PNG of [t0, t1] (≤ ZOOM_MAX s); only that stretch is transformed."""
        import matplotlib

        matplotlib.use('Agg')
        import matplotlib.pyplot as plt

        base = max(0, int(t0 / HOP) - self.nfft // 160)  # the STFT's first frame (its window reaches back nfft/2)
        end = int(np.ceil(t1 / HOP)) + self.nfft // 160 + 2
        so, sc = self._spec(self.yo[base * 160 : end * 160]), self._spec(self.yc[base * 160 : end * 160])
        fig = self._figure(plt, so, sc, t0, t1, base=base, zoom=True)
        _save_png(fig, path, quantize=False)
        plt.close(fig)

    def _spec(self, y16: np.ndarray):
        import librosa

        if len(y16) < self.nfft // 2 + 1:
            y16 = np.pad(y16, (0, self.nfft // 2 + 1 - len(y16)))
        return np.abs(librosa.stft(y16, n_fft=self.nfft, hop_length=160, center=True)).astype(np.float32)

    def _logspec(self, S: np.ndarray, f0: int, f1: int, m_lo: float, m_hi: float) -> np.ndarray:
        mids = np.arange(m_lo, m_hi, 0.25)
        fb = 440 * 2 ** ((mids - 69) / 12) * self.nfft / 16000
        i0 = np.clip(np.floor(fb).astype(int), 0, S.shape[0] - 2)
        w = np.clip(fb - i0, 0, 1)[:, None]
        X = S[i0, f0:f1] * (1 - w) + S[i0 + 1, f0:f1] * w
        return 20 * np.log10(X + 1e-7)

    def _range(self, t0: float, t1: float) -> tuple[float, float]:
        o = self.orig
        sl = o.span(t0, t1)
        f = o.f0[sl][o.conf[sl] >= 1]
        ms = [n.midi for n in self.spec.notes if n.off > t0 and n.on < t1]
        vals = list(f) + ms
        if vals:
            lo, hi = float(np.percentile(vals, 1)) - 3, float(np.percentile(vals, 99)) + 3
            lo, hi = min(lo, min(ms, default=lo) - 2), max(hi, max(ms, default=hi) + 2)
        else:
            lo, hi = self.mrange
        lo, hi = max(lo, self.mrange[0] - 2), min(hi, self.mrange[1] + 2)
        if hi - lo < 14:
            c = (hi + lo) / 2
            lo, hi = c - 7, c + 7
        return float(np.floor(lo)), float(np.ceil(hi))

    def _figure(self, plt, so, sc, t0, t1, base: int = 0, zoom: bool = False):
        """`so` / `sc`: STFT magnitudes whose column 0 is analysis frame `base`."""
        from matplotlib import patheffects
        from matplotlib.patches import Rectangle

        stroke = [patheffects.withStroke(linewidth=2.2, foreground='black')]
        m_lo, m_hi = self._range(t0, t1)
        fig, axs = plt.subplots(3, 1, figsize=(16, 10), sharex=True, gridspec_kw={'height_ratios': [4, 4, 1.7 if zoom else 1.5], 'hspace': 0.12})
        f0i, f1i = int(t0 / HOP), int(np.ceil(t1 / HOP)) + 1
        notes = [n for n in sorted(self.spec.notes, key=lambda n: n.on) if n.off > t0 and n.on < t1]
        diffs = [d for d in self.diffs if d['t1'] >= t0 - 0.05 and d['t0'] <= t1 + 0.05]
        label_size = 10 if zoom else 7.5
        for ax, S, a, other, title in ((axs[0], so, self.orig, self.copy, 'ORIGINAL'), (axs[1], sc, self.copy, None, 'COPY')):
            c0 = min(max(0, f0i - base), S.shape[1] - 1)
            img = self._logspec(S, c0, min(f1i - base, S.shape[1]), m_lo, m_hi)
            vmax = float(np.percentile(img, 99.7)) if img.size else 0.0
            ax.imshow(img, origin='lower', aspect='auto', cmap='magma', vmin=vmax - 65, vmax=vmax,
                      extent=((base + c0) * HOP, (base + c0) * HOP + img.shape[1] * HOP, m_lo, m_hi), interpolation='nearest')
            t = a.t
            sel = (t >= t0) & (t <= t1)
            ok, un = sel & (a.conf == 2), sel & (a.conf == 1)
            if other is not None:
                tt = other.t
                cs = (tt >= t0) & (tt <= t1)
                ax.plot(tt[cs], np.where(other.conf[cs] >= 1, other.f0[cs], np.nan), color='#7CFC00', lw=0.7, alpha=0.75, zorder=3)
            ax.scatter(t[un], a.f0[un], s=7, c='#9a9a9a', linewidths=0, zorder=4)
            ax.scatter(t[ok], a.f0[ok], s=7, c='white', linewidths=0, zorder=4)
            for j, n in enumerate(notes):
                dashed = bool(n.flags)
                ax.add_patch(Rectangle((n.on, n.midi - 0.5), n.dur, 1.0, fill=False, edgecolor='#00E5FF', lw=1.3, ls='--' if dashed else '-', zorder=5))
                above = j % 2 == 0 or n.midi + 1.6 >= m_hi
                y = n.midi + 0.65 if above else n.midi - 1.55
                ax.text(max(n.on, t0), y, f'{n.id} {pitch_name(n.midi)}', color='#00E5FF', fontsize=label_size, zorder=6, path_effects=stroke, clip_on=True)
            if a is self.orig:
                rows: list[float] = []  # x of the last label in each row: neighbours stack downwards
                for d in sorted(diffs, key=lambda d: d['t0']):
                    a0, a1 = d['t0'], d['t1']
                    if a1 - a0 < 0.04:  # a point (an onset): a dashed line through the panel
                        ax.axvline(a0, color='#ff3030', lw=1.0, ls='--', alpha=0.8, zorder=2)
                        a0, a1 = a0 - 0.02, a0 + 0.02
                    elif a1 - a0 <= 0.6 and not zoom:
                        ax.axvspan(a0, a1, color='red', alpha=0.2, zorder=2, lw=0)
                    else:  # a whole note: bracket it at the top, leave the spectrogram readable
                        ax.axvspan(a0, a1, ymin=0.9, ymax=1.0, color='red', alpha=0.3, zorder=2, lw=0)
                        for xx in (a0, a1):
                            ax.axvline(xx, color='#ff3030', lw=0.8, ls=':', alpha=0.8, zorder=2)
                    x = max(a0, t0)
                    r = next((i for i, last in enumerate(rows) if x - last >= 0.035 * (t1 - t0)), len(rows))
                    rows[r:r + 1] = [x]
                    ax.text(x, m_hi - 0.9 - 1.1 * (r % 4) * (m_hi - m_lo) / 30, d['id'], color='white', fontsize=8, fontweight='bold', zorder=7,
                            bbox={'facecolor': '#d00000', 'edgecolor': 'none', 'pad': 1.2, 'alpha': 0.9}, clip_on=True)
            self._yaxis(ax, m_lo, m_hi)
            ax.set_ylim(m_lo, m_hi)
            legend = ('white = orig f0 (grey: trackers disagree) · green = copy f0 · cyan = notes (dashed: flagged) · red = diffs'
                      if a is self.orig else 'white = copy f0 · cyan = notes')
            ax.set_title(f'{"ZOOM " if zoom and a is self.orig else ""}{title}  {self.spec.dataset}/{self.spec.clip}  spec v{self.spec.version}   {legend}',
                         fontsize=10 if zoom else 9, loc='left')
        ax = axs[2]
        for a, col, mk, y in ((self.orig, '#0040ff', 'v', 1.12), (self.copy, '#ff7f0e', '^', -0.12)):
            t = a.t
            sel = (t >= t0) & (t <= t1)
            ax.plot(t[sel], np.clip(a.flux[sel], 0, 1.5) / 1.5, color=col, lw=1.2 if zoom else 0.9)
            k = (a.onsets >= t0) & (a.onsets <= t1)
            ax.scatter(a.onsets[k], np.full(int(k.sum()), y), marker=mk, color=col, s=40 if zoom else 22, zorder=4)
            if zoom and a is self.orig:  # each energy event's sustained rise / re-articulation dip (dB)
                for et, r, dp in zip(a.onsets[k], a.onset_rise[k], a.onset_dip[k]):
                    ax.text(et + 0.005, 1.0, f'r{r:.0f} d{dp:.0f}', color='#0040ff', fontsize=8, va='top', clip_on=True)
        syl = (self.orig.syl >= t0) & (self.orig.syl <= t1)
        if syl.any():  # sung syllables (timbre change): filled from the support strength up
            from .evidence import SYL_STRONG

            st = self.orig.syl_strength[syl]
            strong = st >= SYL_STRONG
            ax.scatter(self.orig.syl[syl][strong], np.full(int(strong.sum()), 0.86), marker='D', facecolors='#00c040', edgecolors='black', linewidths=0.6,
                       s=40 if zoom else 26, zorder=5)
            ax.scatter(self.orig.syl[syl][~strong], np.full(int((~strong).sum()), 0.86), marker='D', facecolors='none', edgecolors='#00a030', linewidths=1.2,
                       s=40 if zoom else 26, zorder=5)
            if zoom:
                for et, sv in zip(self.orig.syl[syl], st):
                    ax.text(et + 0.005, 0.72, f's{sv:.2f}', color='#00803c', fontsize=8, va='top', clip_on=True)  # 2 decimals: 1.25 is the strong cut
        for n in notes:
            ax.axvline(n.on, color='#00A5B8', lw=0.8, alpha=0.7, ymin=0.3, ymax=0.7)
        for t in self.anchors:
            if t0 <= t <= t1:
                ax.axvline(t, color='#d000ff', lw=2.2, alpha=0.95, ymin=0.0, ymax=0.3)
        for d in diffs:
            a0, a1 = (d['t0'], d['t1']) if d['t1'] - d['t0'] >= 0.04 else (d['t0'] - 0.02, d['t0'] + 0.02)
            ax.axvspan(a0, a1, color='red', alpha=0.15, lw=0)
        ax.set_ylim(-0.25, 1.25)
        ax.set_yticks([])
        ax.set_title('onset envelope: blue = orig (▼ events' + (', r = rise / d = dip dB' if zoom else '') + ') · orange = copy (▲ events) · teal = note onsets'
                     + (' · green ◆ = orig syllable (timbre) events, hollow = weak' if len(self.orig.syl_nov) else '')
                     + (' · purple = human syllable onsets' if self.anchors else ''), fontsize=10 if zoom else 9, loc='left')
        ax.set_xlim(t0, t1)
        if zoom:
            ax.set_xticks(np.round(np.arange(np.ceil(t0 * 10) / 10, t1 + 1e-6, 0.1), 2), minor=False)
            ax.set_xticks(np.arange(np.ceil(t0 * 50) / 50, t1 + 1e-6, 0.02), minor=True)
            for a_ in axs:
                a_.grid(axis='x', which='major', color='white', alpha=0.25, lw=0.6)
            ax.tick_params(axis='x', labelsize=9)
        else:
            ax.set_xticks(np.arange(np.ceil(t0 * 2) / 2, t1 + 1e-6, 0.5), minor=False)
            ax.set_xticks(np.arange(np.ceil(t0 * 10) / 10, t1 + 1e-6, 0.1), minor=True)
            ax.tick_params(axis='x', labelsize=8)
        ax.set_xlabel('seconds', fontsize=9)
        fig.subplots_adjust(left=0.05, right=0.99, top=0.97, bottom=0.05)
        return fig

    @staticmethod
    def _yaxis(ax, m_lo: float, m_hi: float) -> None:
        span = m_hi - m_lo
        names = (0, 2, 4, 5, 7, 9, 11) if span <= 30 else (0, 7)
        ticks = [m for m in range(int(np.ceil(m_lo)), int(m_hi) + 1) if m % 12 in names]
        ax.set_yticks(ticks)
        ax.set_yticklabels([f'{pitch_name(m)} {440 * 2 ** ((m - 69) / 12):.0f}' for m in ticks], fontsize=7)
        ax.set_yticks(np.arange(np.ceil(m_lo), m_hi + 1e-6, 1.0) - 0.5, minor=True)
        ax.grid(axis='y', which='minor', color='white', alpha=0.08, lw=0.5)
