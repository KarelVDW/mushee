"""Quality gates for rendered clips.

label fidelity — an independent pitch tracker (SwiftF0, MIT; not the app's
CREPE) must hear every labelled note at its labelled pitch, and must not hear
pitched sound where no note is labelled.
artefacts — clipping, DC, digital silence, clicks at note boundaries.
visual — log-frequency spectrogram with the truth overlaid, for inspection.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from scipy.signal import resample_poly

_DET = None


def _detector():
    global _DET
    if _DET is None:
        from swift_f0 import SwiftF0

        _DET = SwiftF0()
    return _DET


def f0_track(y: np.ndarray, sr: int, fmin: float = 46.875, fmax: float = 2093.75):
    x = y.astype(np.float32)
    x = x / (np.abs(x).max() + 1e-9) * 0.5  # the tracker gates on level
    if sr != 16000:
        g = math.gcd(sr, 16000)
        x = resample_poly(x, 16000 // g, sr // g).astype(np.float32)
    r = _detector().detect(x, 16000, fmin=fmin, fmax=fmax)
    return np.asarray(r.timestamps), np.asarray(r.pitch_hz), np.asarray(r.confidence)


@dataclass
class Fidelity:
    notes: int
    pitch_ok: float  # fraction of notes whose steady f0 is within 50 cents
    octave_err: float
    unvoiced: float  # fraction of notes the tracker didn't hear
    median_abs_cents: float
    phantom_sec: float  # confident pitched time outside any labelled note (+50 ms slack)
    worst: list
    unverifiable: float = 0.0  # fraction of (<100 ms) notes the tracker couldn't judge
    lag_p50_ms: float = 0.0  # labelled onset → first frame at the labelled pitch
    lag_p90_ms: float = 0.0

    def passed(self) -> bool:
        return (
            self.pitch_ok >= 0.95
            and self.octave_err == 0
            and self.phantom_sec < 0.5
            and self.unverifiable <= 0.1
            # the labelled onset must be where the note is heard (tracker latency ≈ 20-30 ms)
            and -15 <= self.lag_p50_ms <= 45
            and self.lag_p90_ms <= 90
        )

    def as_dict(self) -> dict:
        return {k: (round(v, 4) if isinstance(v, float) else v) for k, v in self.__dict__.items()}


def _pyin_note(y: np.ndarray, sr: int, a: float, d: float, midi: int) -> float | None:
    """Second opinion (DSP, model-free): median pYIN f0 over the note's middle, in cents vs target."""
    import librosa

    s0, s1 = int((a + 0.2 * d) * sr), int((a + 0.8 * d) * sr)
    seg = y[s0:s1]
    target = 440 * 2 ** ((midi - 69) / 12)
    if len(seg) < 2048:
        return None
    f0, v, _ = librosa.pyin(seg, fmin=target / 1.6, fmax=min(target * 1.6, sr / 4), sr=sr, frame_length=2048 if target > 150 else 4096)
    f0 = f0[v] if v is not None else f0
    f0 = f0[np.isfinite(f0)]
    if len(f0) < 2:
        return None
    return float(1200 * np.log2(np.median(f0) / target))


def label_fidelity(y: np.ndarray, sr: int, truth: list[dict], conf: float = 0.6, high: bool = False) -> Fidelity:
    fmax = 2093.75
    ts, hz, cf = f0_track(y, sr, fmax=fmax)
    ok = oct_ = unv = short_unv = 0
    errs = []
    worst = []
    covered = np.zeros(len(ts), bool)
    for n in truth:
        a, d = n['onsetSec'], n['durSec']
        covered |= (ts >= a - 0.05) & (ts <= a + d + 0.12)
        # short notes: the whole note is the steady part there is
        w0, w1 = (a + 0.2 * d, a + 0.8 * d) if d >= 0.12 else (a, a + d)
        m = (ts >= w0) & (ts <= w1) & (cf >= conf)
        target = 440 * 2 ** ((n['midi'] - 69) / 12)
        if target > fmax * 0.97:
            ok += 1  # above the verifier's range: can't judge, don't fail
            continue
        c = 1200 * np.log2(np.median(hz[m]) / target) if m.sum() >= 2 else None
        if c is None or abs(c) > 50:
            c2 = _pyin_note(y, sr, a, d, n['midi'])
            if c2 is not None and abs(c2) <= 50:
                c = c2  # the DSP tracker confirms: SwiftF0 was fooled (weak fundamental etc.)
        if c is None:
            if d < 0.1:
                short_unv += 1  # too short to verify, not evidence of a bad render
                continue
            unv += 1
            worst.append((a, n['midi'], 'unvoiced'))
            continue
        if abs(c) <= 50:
            ok += 1
            errs.append(abs(c))
        elif abs(abs(c) - 1200) < 80 or abs(abs(c) - 2400) < 80:
            oct_ += 1
            worst.append((a, n['midi'], f'octave {c:+.0f}c'))
        else:
            worst.append((a, n['midi'], f'{c:+.0f}c'))
    hop = ts[1] - ts[0] if len(ts) > 1 else 0.016
    # a release/reverb tail at the pitch of the note that just ended is not a phantom note
    for n in truth:
        end = n['onsetSec'] + n['durSec']
        f = 440 * 2 ** ((n['midi'] - 69) / 12)
        tail = (ts > end) & (ts <= end + 0.8) & (np.abs(1200 * np.log2(np.maximum(hz, 1) / f)) < 60)
        covered |= tail
    phantom = float(((cf >= 0.95) & ~covered).sum() * hop)
    lags = []
    for i, n in enumerate(truth):
        f = 440 * 2 ** ((n['midi'] - 69) / 12)
        if f > fmax * 0.97:
            continue
        prev = truth[i - 1] if i else None
        if prev and prev['midi'] == n['midi'] and n['onsetSec'] - (prev['onsetSec'] + prev['durSec']) < 0.3:
            continue  # a repeated pitch: the previous note's tail would read as a negative lag
        w = (cf >= 0.7) & (ts >= n['onsetSec'] - 0.15) & (ts <= n['onsetSec'] + n['durSec']) & (np.abs(1200 * np.log2(np.maximum(hz, 1) / f)) < 50)
        if w.any():
            lags.append((ts[w][0] - n['onsetSec']) * 1000)
    N = max(1, len(truth) - short_unv)
    fid = Fidelity(len(truth), ok / N, oct_ / N, unv / N, float(np.median(errs)) if errs else 0.0, phantom, worst[:8])
    fid.unverifiable = short_unv / max(1, len(truth))
    if lags:
        fid.lag_p50_ms, fid.lag_p90_ms = (float(v) for v in np.percentile(lags, [50, 90]))
    return fid


def artefacts(y: np.ndarray, sr: int) -> dict:
    peak = float(np.abs(y).max())
    clip = float((np.abs(y) >= 0.999).mean())
    dc = float(abs(y.mean()))
    d = np.abs(np.diff(y))
    # clicks: sample jumps far above the local derivative scale
    k = 256
    n = len(d) // k
    loc = d[: n * k].reshape(n, k)
    med = np.median(loc, axis=1) + 1e-6
    clicks = int((loc.max(axis=1) > 40 * med + 0.05).sum())
    return {'peak': round(peak, 3), 'clip_frac': clip, 'dc': round(dc, 5), 'click_blocks': clicks}


def spectrogram_png(y: np.ndarray, sr: int, truth: list[dict], path: str, title: str = '', fmax: float = 8000) -> None:
    import matplotlib

    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    import librosa
    import librosa.display

    S = librosa.amplitude_to_db(np.abs(librosa.stft(y, n_fft=4096, hop_length=512)), ref=np.max)
    fig, ax = plt.subplots(2, 1, figsize=(14, 7), sharex=True, gridspec_kw={'height_ratios': [3, 1]})
    librosa.display.specshow(S, sr=sr, hop_length=512, y_axis='log', x_axis='time', ax=ax[0], vmin=-80, vmax=0, cmap='magma')
    ax[0].set_ylim(40, fmax)
    for n in truth:
        f = 440 * 2 ** ((n['midi'] - 69) / 12)
        ax[0].plot([n['onsetSec'], n['onsetSec'] + n['durSec']], [f, f], color='cyan', lw=1.2, alpha=0.8)
    ts, hz, cf = f0_track(y, sr)
    m = cf > 0.85
    ax[0].scatter(ts[m], hz[m], s=1, c='lime')
    ax[0].set_title(title)
    t = np.arange(len(y)) / sr
    ax[1].plot(t[::20], y[::20], lw=0.3)
    for n in truth:
        ax[1].axvline(n['onsetSec'], color='r', lw=0.4)
    fig.tight_layout()
    fig.savefig(path, dpi=80)
    plt.close(fig)
