"""Realism measurement: how close do renders sit to REAL recordings of the same thing?

No human listeners overnight, and no training allowed, so realism is measured
against real reference recordings with a pretrained audio model (PANNs Cnn14,
AudioSet, CC-BY-4.0 weights), three ways, per timbre:

- tagger:  the AudioSet probability of the timbre's own class (e.g. "Violin,
           fiddle") on real clips vs on renders — does the model hear the
           instrument as clearly in ours as in real recordings?
- 1-NN:    leave-one-out nearest-neighbour real-vs-synthetic classification
           accuracy in embedding space. 0.5 = the two sets are indistinguishable,
           1.0 = trivially separable. (A statistic, not a trained model.)
- KAD:     kernel (MMD², RBF, bandwidth = median real pairwise distance) distance
           synthetic↔real, reported next to the real↔real split noise floor.

The same numbers for the OLD synthetic corpus (fluidsynth/GM + additive voice,
apps/api/scripts/fixtures/eval) are the baseline the new corpus must beat.
Recording-condition confounds are reduced by comparing like with like: real
studio-ish recordings (URMP, VocalSet...) vs our `room`/`studio` conditions.
"""

from __future__ import annotations

import glob
import json
import random
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parent.parent
FIX = ROOT.parent / 'apps' / 'api' / 'scripts' / 'fixtures'

# timbre → (AudioSet class names that count as "correct", real reference globs)
REFERENCES: dict[str, tuple[list[str], list[str]]] = {
    'violin': (['Violin, fiddle'], ['eval-real/benchmark/urmp-violin/*__real.wav', 'eval-real/context/tinysol-violin/*__real.wav']),
    'viola': (['Violin, fiddle', 'Bowed string instrument'], ['eval-real/benchmark/urmp-viola/*__real.wav', 'eval-real/context/tinysol-viola/*__real.wav']),
    'cello': (['Cello'], ['eval-real/benchmark/urmp-cello/*__real.wav']),
    'contrabass': (['Double bass'], ['eval-real/benchmark/urmp-contrabass/*__real.wav']),
    'flute': (['Flute'], ['eval-real/benchmark/urmp-flute/*__real.wav', 'eval-real/context/tinysol-flute/*__real.wav']),
    'oboe': (['Oboe', 'Wind instrument, woodwind instrument'], ['eval-real/benchmark/urmp-oboe/*__real.wav', 'eval-real/context/tinysol-oboe/*__real.wav']),
    'clarinet': (['Clarinet'], ['eval-real/benchmark/urmp-clarinet/*__real.wav', 'eval-real/context/tinysol-clarinet/*__real.wav']),
    'alto-sax': (['Saxophone'], ['eval-real/benchmark/urmp-saxophone/*__real.wav']),
    'tenor-sax': (['Saxophone'], ['eval-real/benchmark/urmp-saxophone/*__real.wav']),
    'bassoon': (['Bassoon', 'Wind instrument, woodwind instrument'], ['eval-real/benchmark/urmp-bassoon/*__real.wav']),
    'trumpet': (['Trumpet'], ['eval-real/benchmark/urmp-trumpet/*__real.wav']),
    'french-horn': (['French horn'], ['eval-real/benchmark/urmp-french-horn/*__real.wav']),
    'trombone': (['Trombone'], ['eval-real/benchmark/urmp-trombone/*__real.wav']),
    'tuba': (['Brass instrument', 'Tuba'], ['eval-real/benchmark/urmp-tuba/*__real.wav']),
    'guitar': (['Acoustic guitar', 'Guitar'], ['eval-real/benchmark/guitarset-solo/*__real.wav']),
    'voice': (['Singing', 'Female singing', 'Male singing'], ['eval-real/benchmark/vocadito/*__real.wav', 'eval-real/benchmark/n20emv2/*__real.wav',
                                                              'eval-real/benchmark/csd/*__real.wav', 'eval-real/benchmark/hust-solfege/*__real.wav']),
}
# the old synthetic corpus' scenario dirs per timbre (condition 'room-mic' ≈ our 'room')
OLD = {
    'violin': 'violin-high', 'cello': 'cello-low', 'flute': 'flute-high', 'oboe': 'oboe-high', 'clarinet': 'clarinet-mid', 'bassoon': 'bassoon-low',
    'trumpet': 'trumpet-mid', 'trombone': 'trombone-low', 'tuba': 'tuba-verylow', 'voice': 'voice-*',
}


class NoiseMatcher:
    """Background noise + SNR measured from the REAL references, re-applied to renders,
    so the comparison is about the instrument and the playing, not the mic/room floor."""

    def __init__(self, real_files: list[str], sr: int = 32000):
        import librosa

        self.noises: list[np.ndarray] = []
        self.snrs: list[float] = []
        for f in real_files:
            y, fsr = sf.read(f, dtype='float32', always_2d=True)
            y = librosa.resample(y.mean(axis=1), orig_sr=fsr, target_sr=sr)
            hop = sr // 50
            n = len(y) // hop
            if n < 20:
                continue
            fr = np.sqrt(np.mean(y[: n * hop].reshape(n, hop) ** 2, axis=1) + 1e-12)
            q = np.argsort(fr)
            quiet = np.sort(q[: max(5, n // 10)])
            nz = np.concatenate([y[i * hop : (i + 1) * hop] for i in quiet])
            act = fr[fr > np.percentile(fr, 60)]
            self.noises.append(nz)
            self.snrs.append(float(20 * np.log10(np.sqrt(np.mean(act**2)) / (np.sqrt(np.mean(nz**2)) + 1e-12))))

    def apply(self, y: np.ndarray, rng: np.random.Generator) -> np.ndarray:
        if not self.noises:
            return y
        k = rng.integers(len(self.noises))
        nz = self.noises[k]
        nz = np.tile(nz, int(np.ceil(len(y) / len(nz))))[: len(y)]
        hop = 32000 // 50
        n = len(y) // hop
        fr = np.sqrt(np.mean(y[: n * hop].reshape(n, hop) ** 2, axis=1) + 1e-12)
        act = fr[fr > np.percentile(fr, 60)]
        a = np.sqrt(np.mean(act**2))
        g = a / (np.sqrt(np.mean(nz**2)) + 1e-12) / 10 ** (self.snrs[k] / 20)
        return y + g * nz


class Embedder:
    def __init__(self):
        from panns_inference import AudioTagging, labels

        self.at = AudioTagging(checkpoint_path=None, device='cpu')
        self.labels = labels

    def windows(self, path: str, win: float = 4.0, hop: float = 2.0, noise: 'NoiseMatcher | None' = None, rng=None):
        """(class probs, embedding) per window of the sounding part of a clip."""
        import librosa

        y, sr = sf.read(path, dtype='float32', always_2d=True)
        y = librosa.resample(y.mean(axis=1), orig_sr=sr, target_sr=32000)
        if noise is not None:
            y = noise.apply(y, rng)
        nz = np.nonzero(np.abs(y) > np.abs(y).max() * 0.05)[0]
        if not len(nz):
            return []
        y = y[nz[0] : nz[-1]]
        W, H = int(win * 32000), int(hop * 32000)
        out = []
        for s0 in range(0, max(1, len(y) - W + 1), H):
            seg = y[s0 : s0 + W]
            if len(seg) < W // 2:
                break
            seg = seg / (np.sqrt(np.mean(seg**2)) + 1e-9) * 0.05
            cw, emb = self.at.inference(seg[None, :])
            out.append((cw[0], emb[0]))
        return out

    def __call__(self, path: str, seconds: float = 10.0) -> tuple[np.ndarray, np.ndarray]:
        import librosa

        y, sr = sf.read(path, dtype='float32', always_2d=True)
        y = y.mean(axis=1)
        y = librosa.resample(y, orig_sr=sr, target_sr=32000)
        # skip leading silence, take up to `seconds`
        nz = np.nonzero(np.abs(y) > np.abs(y).max() * 0.02)[0]
        s0 = int(nz[0]) if len(nz) else 0
        y = y[s0 : s0 + int(seconds * 32000)]
        y = y / (np.sqrt(np.mean(y**2)) + 1e-9) * 0.05
        cw, emb = self.at.inference(y[None, :])
        return cw[0], emb[0]


def kad(x: np.ndarray, y: np.ndarray, bw: float) -> float:
    """Unbiased MMD² with an RBF kernel (×100, as in KAD)."""

    def k(a, b):
        d = ((a[:, None, :] - b[None, :, :]) ** 2).sum(-1)
        return np.exp(-d / (2 * bw**2))

    m, n = len(x), len(y)
    kxx, kyy, kxy = k(x, x), k(y, y), k(x, y)
    sxx = (kxx.sum() - np.trace(kxx)) / (m * (m - 1))
    syy = (kyy.sum() - np.trace(kyy)) / (n * (n - 1))
    return float(100 * (sxx + syy - 2 * kxy.mean()))


def one_nn(real: np.ndarray, syn: np.ndarray) -> float:
    """Leave-one-out 1-NN two-sample accuracy on a balanced subset (0.5 = indistinguishable)."""
    n = min(len(real), len(syn))
    rng = np.random.default_rng(0)
    r = real[rng.choice(len(real), n, replace=False)]
    s = syn[rng.choice(len(syn), n, replace=False)]
    X = np.concatenate([r, s])
    lab = np.array([0] * n + [1] * n)
    X = X / (np.linalg.norm(X, axis=1, keepdims=True) + 1e-9)
    D = 1 - X @ X.T
    np.fill_diagonal(D, np.inf)
    return float((lab[np.argmin(D, axis=1)] == lab).mean())


@dataclass
class TimbreRealism:
    timbre: str
    n_real: int
    n_new: int
    n_old: int
    p_real: float
    p_new: float
    p_old: float
    nn_new: float
    nn_old: float
    kad_new: float
    kad_old: float
    kad_floor: float


def evaluate_matched(timbres: list[str], new_cond: str = 'dry', old_cond: str = 'clean', max_clips: int = 30, log=print, match: bool = True) -> list[TimbreRealism]:
    """Noise-matched, windowed comparison (the headline realism test)."""
    emb = Embedder()
    out = []
    for t in timbres:
        cls_names, globs = REFERENCES['voice' if t.startswith('voice') else t]
        idx = [emb.labels.index(c) for c in cls_names if c in emb.labels]
        real_files = sorted(f for g in globs for f in glob.glob(str(FIX / g)))
        random.Random(0).shuffle(real_files)
        real_files = real_files[:max_clips]
        group = 'voices' if t.startswith('voice') else 'instruments'
        sub = t.split('voice-')[-1] if t.startswith('voice') else t
        new_files = sorted(glob.glob(str(ROOT / 'out' / group / ('*' if t == 'voice' else sub) / f'*__{new_cond}.wav')))
        random.Random(1).shuffle(new_files)
        new_files = new_files[:max_clips]
        old_key = OLD.get('voice' if t.startswith('voice') else t)
        old_files = sorted(glob.glob(str(FIX / 'eval' / old_key / f'*__{old_cond}.wav')))[:max_clips] if old_key else []
        nm = NoiseMatcher(real_files)
        rng = np.random.default_rng(0)

        def run(files, match):
            ps, es = [], []
            for f in files:
                for cw, e in emb.windows(f, noise=nm if match else None, rng=rng):
                    ps.append(float(cw[idx].max()) if idx else 0.0)
                    es.append(e)
            return np.array(ps), (np.array(es) if es else np.zeros((0, 2048)))

        pr, er = run(real_files, False)
        pn, en = run(new_files, match)
        po, eo = run(old_files, match)
        if len(er) < 6 or len(en) < 4:
            log(f'{t}: not enough windows (real {len(er)}, new {len(en)})')
            continue
        d = ((er[:, None] - er[None]) ** 2).sum(-1) ** 0.5
        bw = float(np.median(d[np.triu_indices(len(er), 1)]))
        perm = np.random.default_rng(2).permutation(len(er))
        half = len(er) // 2
        floor = kad(er[perm[:half]], er[perm[half:]], bw)
        r = TimbreRealism(
            t, len(er), len(en), len(eo), float(pr.mean()), float(pn.mean()), float(po.mean()) if len(po) else float('nan'),
            one_nn(er, en), one_nn(er, eo) if len(eo) >= 2 else float('nan'),
            kad(er, en, bw), kad(er, eo, bw) if len(eo) >= 2 else float('nan'), floor,
        )
        out.append(r)
        log(f'{t:14s} P(class) real {r.p_real:.2f} new {r.p_new:.2f} old {r.p_old:.2f} | 1-NN new {r.nn_new:.2f} old {r.nn_old:.2f} | '
            f'KAD new {r.kad_new:.2f} old {r.kad_old:.2f} floor {r.kad_floor:.2f}  (windows real {r.n_real}, new {r.n_new}, old {r.n_old})')
    return out


def evaluate_windows(timbres: list[str], new_cond: str = 'room', old_cond: str = 'room-mic', max_clips: int = 30, log=print) -> list[TimbreRealism]:
    """Like `evaluate_matched`, but each set keeps its own recording chain (for recorded conditions)."""
    return evaluate_matched(timbres, new_cond, old_cond, max_clips, log, match=False)


def evaluate(timbres: list[str], new_cond: str = 'room', old_cond: str = 'room-mic', max_real: int = 40, log=print) -> list[TimbreRealism]:
    emb = Embedder()
    out = []
    for t in timbres:
        cls_names, globs = REFERENCES['voice' if t.startswith('voice') else t]
        idx = [emb.labels.index(c) for c in cls_names if c in emb.labels]
        real_files = sorted(f for g in globs for f in glob.glob(str(FIX / g)))
        random.Random(0).shuffle(real_files)
        real_files = real_files[:max_real]
        group = 'voices' if t.startswith('voice') else 'instruments'
        sub = t.split('voice-')[-1] if t.startswith('voice') else t
        new_files = sorted(glob.glob(str(ROOT / 'out' / group / ('*' if t == 'voice' else sub) / f'*__{new_cond}.wav')))[:max_real]
        old_key = OLD.get('voice' if t.startswith('voice') else t)
        old_files = sorted(glob.glob(str(FIX / 'eval' / old_key / f'*__{old_cond}.wav')))[:max_real] if old_key else []

        def run(files):
            ps, es = [], []
            for f in files:
                cw, e = emb(f)
                ps.append(float(cw[idx].max()) if idx else 0.0)
                es.append(e)
            return np.array(ps), (np.array(es) if es else np.zeros((0, 2048)))

        pr, er = run(real_files)
        pn, en = run(new_files)
        po, eo = run(old_files)
        if len(er) < 4 or len(en) < 2:
            log(f'{t}: not enough clips (real {len(er)}, new {len(en)})')
            continue
        d = ((er[:, None] - er[None]) ** 2).sum(-1) ** 0.5
        bw = float(np.median(d[np.triu_indices(len(er), 1)]))
        half = len(er) // 2
        floor = kad(er[:half], er[half:], bw)
        r = TimbreRealism(
            t, len(er), len(en), len(eo), float(pr.mean()), float(pn.mean()), float(po.mean()) if len(po) else float('nan'),
            one_nn(er, en), one_nn(er, eo) if len(eo) >= 2 else float('nan'),
            kad(er, en, bw), kad(er, eo, bw) if len(eo) >= 2 else float('nan'), floor,
        )
        out.append(r)
        log(f'{t:12s} P(class) real {r.p_real:.2f} new {r.p_new:.2f} old {r.p_old:.2f} | 1-NN new {r.nn_new:.2f} old {r.nn_old:.2f} | '
            f'KAD new {r.kad_new:.2f} old {r.kad_old:.2f} floor {r.kad_floor:.2f}  (n real {r.n_real}, new {r.n_new}, old {r.n_old})')
    return out


def markdown(rows: list[TimbreRealism], title: str) -> str:
    out = [f'#### {title}', '', '| timbre | P(class) real | P(class) new | P(class) old | KAD new | KAD old | real↔real floor | windows real/new/old |',
           '| --- | --- | --- | --- | --- | --- | --- | --- |']
    f = lambda x: '—' if x != x else f'{x:.2f}'
    for r in rows:
        out.append(f'| {r.timbre} | {f(r.p_real)} | **{f(r.p_new)}** | {f(r.p_old)} | **{f(r.kad_new)}** | {f(r.kad_old)} | {f(r.kad_floor)} | {r.n_real}/{r.n_new}/{r.n_old} |')
    return '\n'.join(out)


if __name__ == '__main__':
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument('timbres', nargs='?', default=','.join(REFERENCES))
    ap.add_argument('--new-cond', default='room')
    ap.add_argument('--old-cond', default='room-mic')
    ap.add_argument('--matched', action='store_true', help='add the real references\' noise floor to both synthetic sets')
    a = ap.parse_args()
    ts = a.timbres.split(',')
    if a.matched:
        res = evaluate_matched(ts, new_cond=a.new_cond, old_cond=a.old_cond)
    else:
        res = evaluate_windows(ts, new_cond=a.new_cond, old_cond=a.old_cond)
    tag = f'{a.new_cond}-vs-{a.old_cond}{"-matched" if a.matched else ""}'
    (ROOT / 'work' / f'realism-{tag}.json').write_text(json.dumps([r.__dict__ for r in res], indent=1))
    (ROOT / 'work' / f'realism-{tag}.md').write_text(markdown(res, f'new `{a.new_cond}` vs old `{a.old_cond}`{" (noise-matched)" if a.matched else ""}'))
