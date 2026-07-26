#!/usr/bin/env python3
"""
bench_pitch_models.py — frame-level comparison of candidate f0 models on OUR corpora.

Answers one question: should CREPE-tiny stay the pipeline's frame-level pitch model?
Every number it prints is measured on the clips in this repo — nothing published is
copied in. Driven by `scripts/eval/bench-pitch-models.ts` (which also creates the venv);
runnable standalone too.

  MODELS
    crepe-tiny          marl/crepe capacity=tiny, reference read-out
                        (argmax + weighted mean over +/-4 bins). ONE forward pass is
                        shared with the next variant.
    crepe-tiny-viterbi  same activations, decoded the way the pipeline actually decodes
                        them: banded-Gaussian Viterbi (sigma 12 bins, band 48) then the
                        same local weighted mean — a port of
                        src/recordings/pipeline/providers/pitch-decoder.ts.
    swiftf0             lars76/swift-f0, bundled 398 KB ONNX, reference read-out
                        (the read-out is inside the ONNX graph; no activation map is
                        exposed, so it cannot be given the Viterbi decode).
    harmof0             WX-Wei/HarmoF0, repo checkpoint `mdb-stem-synth.pth`,
                        reference read-out (argmax over 352 bins @25 cents).
    (RMVPE is deliberately absent — weight provenance, see the task report.)

  PYTHON DEPS (nothing is added to package.json)
    crepe-tiny*  -> needs the EXISTING `.venv-crepe` (crepe==0.0.16, tensorflow,
                    resampy). Used read-only, with PYTHONDONTWRITEBYTECODE=1.
    swiftf0      -> `.venv-pitchbench`: swift-f0 (pulls onnxruntime), numpy, scipy
    harmof0      -> `.venv-pitchbench`: torch, numpy, scipy  + a shallow clone of
                    github.com/WX-Wei/HarmoF0 (MIT) at
                    .venv-pitchbench/src/HarmoF0 (its own pip install is broken on
                    py>=3.10 — setup.py imports the removed `imp` module — so the
                    network + checkpoint are loaded straight from the clone and its
                    matplotlib/librosa/torchaudio-importing `pitch_tracker.py` is
                    bypassed).
    Audio I/O is stdlib `wave` + numpy; resampling is scipy.signal.resample_poly.
    No librosa (its dependency solve pins an ancient numba on py3.12).

  METHOD
    Reference f0 per frame is derived from the note annotations: a frame whose centre
    time falls inside [onsetSec, onsetSec+durSec) of a note is voiced at that note's
    MIDI pitch (exactly, i.e. midi*100 cents); every other frame is unvoiced. Frames
    are each model's own native grid (crepe 20 ms as the pipeline runs it, swiftf0
    16 ms, harmof0 10 ms) with correct frame-centre timestamps, so no resampling of
    either contour is needed. `--guard-ms` additionally reports a "core" variant that
    drops frames within N ms of a note edge (label/articulation noise); the headline
    numbers are the untrimmed ones.

    Per (model, dataset, register band): RPA@50c, RCA@50c (octave-invariant),
    octave-error rate (right chroma, wrong octave), gross-error rate, mean |cents|,
    voicing recall / false-alarm at each model's deployed threshold, and CPU seconds
    per second of audio. Register bands are the PROFILE_BANDS boundaries from
    src/recordings/pipeline/profiles/pipeline-profile.ts.

  USAGE
    .venv-crepe/bin/python       scripts/eval/bench_pitch_models.py --models crepe-tiny --tier real   --out /tmp/crepe.json
    .venv-pitchbench/bin/python  scripts/eval/bench_pitch_models.py --models swiftf0    --tier real   --out /tmp/swift.json
    .venv-pitchbench/bin/python  scripts/eval/bench_pitch_models.py --models harmof0    --tier probe  --out /tmp/harmo.json
    python3 scripts/eval/bench_pitch_models.py --aggregate /tmp/*.json     # tables

  Tiers:
    real  -> scripts/fixtures/eval-real/<dataset>/<clip>__real.wav + <clip>.truth.json
    adverse -> the degraded renders that sit next to the real clips
             (__distant-mic / __echoey-room / __street-noise / __wind-outdoor), grouped
             by condition — tests the "the win is robustness" claim on our own audio.
    probe -> scripts/fixtures/eval/<scenario>/<clip>__clean.wav (synthetic, the ONLY
             ground truth in this repo above ~1050 Hz — the real corpus tops out at
             MIDI 84, so the >1900 Hz question cannot be answered on `real` at all).
"""

from __future__ import annotations

import argparse
import glob
import json
import math
import os
import sys
import time
import wave
from typing import Dict, List, Optional, Tuple

import numpy as np

# .../apps/api/scripts/eval/bench_pitch_models.py -> .../apps/api
REPO_API = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REAL_DIR = os.path.join(REPO_API, "scripts", "fixtures", "eval-real")
PROBE_DIR = os.path.join(REPO_API, "scripts", "fixtures", "eval")

# --- register bands: PROFILE_BANDS maxFreqHz from pipeline-profile.ts -------------
BANDS: List[Tuple[str, float, float]] = [
    ("low", 0.0, 700.0),
    ("mid", 700.0, 1300.0),
    ("high", 1300.0, 1900.0),
    ("very-high", 1900.0, 1e9),
]
TRAJECTORY_MODEL_CEILING_HZ = 1900.0

CENTS_TOL = 50.0
GROSS_TOL = 200.0


def band_of(hz: float) -> str:
    for name, lo, hi in BANDS:
        if lo <= hz < hi:
            return name
    return "very-high"


def hz_to_cents(hz: np.ndarray) -> np.ndarray:
    """Absolute cents with A4 = 6900 (so cents/100 is the MIDI number)."""
    out = np.full(hz.shape, np.nan, dtype=np.float64)
    ok = hz > 0
    out[ok] = 6900.0 + 1200.0 * np.log2(hz[ok] / 440.0)
    return out


# ---------------------------------------------------------------------------------
# audio + truth loading (stdlib wave; every fixture is PCM wav)
# ---------------------------------------------------------------------------------
def read_wav_mono(path: str) -> Tuple[np.ndarray, int]:
    with wave.open(path, "rb") as w:
        sr = w.getframerate()
        ch = w.getnchannels()
        width = w.getsampwidth()
        raw = w.readframes(w.getnframes())
    if width == 2:
        x = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    elif width == 4:
        x = np.frombuffer(raw, dtype="<i4").astype(np.float32) / 2147483648.0
    elif width == 1:
        x = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
    else:
        raise ValueError(f"unsupported sample width {width} in {path}")
    if ch > 1:
        x = x.reshape(-1, ch).mean(axis=1)
    return np.ascontiguousarray(x), sr


def resample_to(x: np.ndarray, sr: int, target: int) -> np.ndarray:
    if sr == target:
        return x
    from math import gcd

    from scipy.signal import resample_poly

    g = gcd(sr, target)
    return resample_poly(x, target // g, sr // g).astype(np.float32)


def load_truth(path: str) -> List[Tuple[float, float, int]]:
    with open(path) as f:
        j = json.load(f)
    return [(float(n["onsetSec"]), float(n["durSec"]), int(n["midi"])) for n in j["notes"]]


# The 588-clip real corpus as documented in scripts/eval/README.md (Findings log). Pinned by name
# because other experiments drop extra dataset dirs into eval-real/ (e.g. n20emv2),
# and a model measured on a different clip set is not comparable.
CANON_REAL = ("annotated-vocalset", "guitarset-solo", "mir-qbsh", "vocadito")


def is_canonical(tier: str, ds: str) -> bool:
    if tier != "real":
        return True
    return ds in CANON_REAL or ds.startswith("urmp-")


# Adverse conditions already rendered next to every real clip by degrade-real.ts.
# Used by tier=adverse to test the "the win is robustness, not clean accuracy" claim
# on our own audio. Grouped BY CONDITION (the dataset column becomes the condition).
DEGRADATIONS = ("real", "distant-mic", "echoey-room", "street-noise", "wind-outdoor")
ADVERSE_DATASETS = ("annotated-vocalset", "vocadito", "guitarset-solo")


def clips_for_adverse(limit: int) -> List[dict]:
    out: List[dict] = []
    for ds in ADVERSE_DATASETS:
        truths = sorted(glob.glob(os.path.join(REAL_DIR, ds, "*.truth.json")))[: limit or 8]
        for cond in DEGRADATIONS:
            for truth in truths:
                clip = os.path.basename(truth)[: -len(".truth.json")]
                wav = os.path.join(REAL_DIR, ds, f"{clip}__{cond}.wav")
                if os.path.exists(wav):
                    out.append({"dataset": cond, "clip": f"{ds}/{clip}", "wav": wav, "truth": truth})
    return out


def clips_for_tier(tier: str, datasets: Optional[List[str]], limit: int) -> List[dict]:
    if tier == "adverse":
        return clips_for_adverse(limit)
    root, suffix = (REAL_DIR, "__real.wav") if tier == "real" else (PROBE_DIR, "__clean.wav")
    out: List[dict] = []
    for truth in sorted(glob.glob(os.path.join(root, "*", "*.truth.json"))):
        ds = os.path.basename(os.path.dirname(truth))
        if datasets and ds not in datasets:
            continue
        if not datasets and not is_canonical(tier, ds):
            continue
        clip = os.path.basename(truth)[: -len(".truth.json")]
        wav = os.path.join(os.path.dirname(truth), clip + suffix)
        if not os.path.exists(wav):
            continue
        out.append({"dataset": ds, "clip": clip, "wav": wav, "truth": truth})
    out.sort(key=lambda c: (c["dataset"], c["clip"]))
    if limit:
        by_ds: Dict[str, int] = {}
        keep = []
        for c in out:
            n = by_ds.get(c["dataset"], 0)
            if n < limit:
                keep.append(c)
                by_ds[c["dataset"]] = n + 1
        out = keep
    return out


# ---------------------------------------------------------------------------------
# reference contour on a model's own frame grid
# ---------------------------------------------------------------------------------
def reference_cents(times: np.ndarray, notes: List[Tuple[float, float, int]], guard_s: float):
    """
    -> (ref_cents, voiced_mask, core_mask)
    A frame is voiced at note pitch iff its centre time lies inside the note span.
    `core_mask` additionally excludes frames within `guard_s` of a note edge.
    """
    ref = np.full(times.shape, np.nan)
    core = np.zeros(times.shape, dtype=bool)
    for onset, dur, midi in notes:
        end = onset + dur
        sel = (times >= onset) & (times < end)
        ref[sel] = midi * 100.0
        if dur > 2 * guard_s:
            core |= (times >= onset + guard_s) & (times < end - guard_s)
    voiced = ~np.isnan(ref)
    return ref, voiced, core & voiced


def score_clip(
    times: np.ndarray,
    est_hz: np.ndarray,
    est_voiced: np.ndarray,
    notes: List[Tuple[float, float, int]],
    guard_s: float,
) -> dict:
    ref, voiced, core = reference_cents(times, notes, guard_s)
    est_cents = hz_to_cents(np.asarray(est_hz, dtype=np.float64))
    have = ~np.isnan(est_cents)

    err = np.full(times.shape, np.nan)
    err[voiced & have] = est_cents[voiced & have] - ref[voiced & have]
    abs_err = np.abs(err)
    # octave-folded error: distance to the nearest ref +/- k octaves
    folded = np.abs(((err + 600.0) % 1200.0) - 600.0)

    rpa = abs_err <= CENTS_TOL
    rca = folded <= CENTS_TOL
    octerr = rca & ~rpa
    gross = have & voiced & ~rca & (abs_err > GROSS_TOL)

    ref_hz = np.full(times.shape, np.nan)
    ref_hz[voiced] = 440.0 * np.power(2.0, (ref[voiced] - 6900.0) / 1200.0)

    out: Dict[str, dict] = {}
    for variant, mask in (("all", voiced), ("core", core)):
        per_band: Dict[str, dict] = {}
        for name, lo, hi in BANDS:
            sel = mask & (ref_hz >= lo) & (ref_hz < hi)
            n = int(sel.sum())
            if n == 0:
                continue
            per_band[name] = {
                "n": n,
                "rpa": int((rpa & sel).sum()),
                "rca": int((rca & sel).sum()),
                "oct": int((octerr & sel).sum()),
                "gross": int((gross & sel).sum()),
                "absSum": float(np.nansum(abs_err[sel & have])),
                "absN": int((sel & have).sum()),
                "gatedRpa": int((rpa & sel & est_voiced).sum()),
                "estVoiced": int((sel & est_voiced).sum()),
            }
        out[variant] = per_band

    unvoiced = ~voiced
    out["voicing"] = {
        "refVoiced": int(voiced.sum()),
        "refUnvoiced": int(unvoiced.sum()),
        "falseAlarm": int((unvoiced & est_voiced).sum()),
    }
    return out


# ---------------------------------------------------------------------------------
# models
# ---------------------------------------------------------------------------------
CREPE_SR = 16000
CREPE_BINS = 360
CREPE_CENTS_OFFSET = 1997.3794084376191
CREPE_CENTS_RANGE = 7180.0
CREPE_HOP_MS = 20  # HOP_SIZE 320 @16 kHz — what crepe-provider.ts runs
CREPE_CONF_THRESHOLD = 0.5  # SEGMENT_OPTS.confidenceThreshold
VITERBI_SIGMA_BINS = 12
VITERBI_BAND_BINS = 48
LOCAL_AVG_HALF_WIDTH = 4


def crepe_cent_map() -> np.ndarray:
    crepe_cents = CREPE_CENTS_OFFSET + CREPE_CENTS_RANGE * np.arange(CREPE_BINS) / (CREPE_BINS - 1)
    # crepe cents are referenced to 10 Hz; shift to A4 = 6900
    return crepe_cents + 6900.0 + 1200.0 * math.log2(10.0 / 440.0)


def local_cents_from_path(act: np.ndarray, path: np.ndarray, cent_map: np.ndarray) -> np.ndarray:
    """Port of localCentsFromPath (pitch-decoder.ts)."""
    frames = act.shape[0]
    out = np.empty(frames)
    for t in range(frames):
        c = int(path[t])
        lo = max(0, c - LOCAL_AVG_HALF_WIDTH)
        hi = min(CREPE_BINS - 1, c + LOCAL_AVG_HALF_WIDTH)
        w = act[t, lo : hi + 1]
        s = w.sum()
        out[t] = float((w * cent_map[lo : hi + 1]).sum() / s) if s > 0 else cent_map[c]
    return out


def viterbi_path(act: np.ndarray) -> np.ndarray:
    """Port of viterbi() (pitch-decoder.ts): banded Gaussian transitions, no jump floor."""
    frames, bins = act.shape
    band = VITERBI_BAND_BINS
    d = np.arange(-band, band + 1)
    log_trans = -(d.astype(np.float64) ** 2) / (2.0 * VITERBI_SIGMA_BINS**2)
    log_act = np.log(act.astype(np.float64) + 1e-15)

    log_prob = log_trans_prev = log_act[0].copy()
    psi = np.empty((frames, bins), dtype=np.int32)
    idx = np.arange(bins)
    for t in range(1, frames):
        # for each current bin, best over prev bins within +/-band
        best = np.full(bins, -np.inf)
        arg = np.zeros(bins, dtype=np.int32)
        for k, off in enumerate(d):
            prev_idx = idx - off  # bPrev = bCur - off
            valid = (prev_idx >= 0) & (prev_idx < bins)
            cand = np.full(bins, -np.inf)
            cand[valid] = log_trans_prev[prev_idx[valid]] + log_trans[k]
            upd = cand > best
            best[upd] = cand[upd]
            arg[upd] = prev_idx[upd]
        log_prob = best + log_act[t]
        psi[t] = arg
        log_trans_prev = log_prob

    path = np.empty(frames, dtype=np.int32)
    path[frames - 1] = int(np.argmax(log_prob))
    for t in range(frames - 2, -1, -1):
        path[t] = psi[t + 1][path[t + 1]]
    return path


def run_crepe(x: np.ndarray, sr: int, variants: List[str]) -> Tuple[Dict[str, tuple], float, float]:
    import crepe.core as cc

    audio16 = resample_to(x, sr, CREPE_SR)
    t0, w0 = time.process_time(), time.perf_counter()
    act = cc.get_activation(audio16, CREPE_SR, model_capacity="tiny", center=True,
                            step_size=CREPE_HOP_MS, verbose=0)
    cpu_fwd, wall_fwd = time.process_time() - t0, time.perf_counter() - w0

    cent_map = crepe_cent_map()
    conf = act.max(axis=1)
    times = np.arange(act.shape[0]) * (CREPE_HOP_MS / 1000.0)
    out: Dict[str, tuple] = {}
    cpu: Dict[str, float] = {}
    if "crepe-tiny" in variants:
        t0, w0 = time.process_time(), time.perf_counter()
        cents = local_cents_from_path(act, act.argmax(axis=1), cent_map)
        hz = 10.0 * np.power(2.0, (cents - (6900.0 + 1200.0 * math.log2(10.0 / 440.0))) / 1200.0)
        out["crepe-tiny"] = (times, hz, conf > CREPE_CONF_THRESHOLD)
        cpu["crepe-tiny"] = cpu_fwd + (time.process_time() - t0)
    if "crepe-tiny-viterbi" in variants:
        t0 = time.process_time()
        cents = local_cents_from_path(act, viterbi_path(act), cent_map)
        hz = 10.0 * np.power(2.0, (cents - (6900.0 + 1200.0 * math.log2(10.0 / 440.0))) / 1200.0)
        out["crepe-tiny-viterbi"] = (times, hz, conf > CREPE_CONF_THRESHOLD)
        cpu["crepe-tiny-viterbi"] = cpu_fwd + (time.process_time() - t0)
    return out, cpu, wall_fwd


_SWIFT = None
SWIFT_CONF_THRESHOLD = 0.9  # swift_f0 DEFAULT_CONFIDENCE_THRESHOLD


def run_swiftf0(x: np.ndarray, sr: int) -> Tuple[np.ndarray, np.ndarray, np.ndarray, float, float]:
    global _SWIFT
    from swift_f0 import SwiftF0

    if _SWIFT is None:
        _SWIFT = SwiftF0()  # session is already pinned to 1 intra/inter-op thread
    audio16 = resample_to(x, sr, 16000)
    t0, w0 = time.process_time(), time.perf_counter()
    res = _SWIFT.detect_from_array(audio16, 16000)
    cpu, wall = time.process_time() - t0, time.perf_counter() - w0
    return res.timestamps, res.pitch_hz, res.voicing, cpu, wall


_HARMO = None
HARMO_SR = 16000
HARMO_HOP = int(os.environ.get("HARMOF0_HOP", "160"))  # 10 ms — the repo default
HARMO_FRAME = 1024
HARMO_FMIN = 27.5
HARMO_BPO = 48
HARMO_CONF_THRESHOLD = 0.6  # onehot_to_hz default threshold


def _load_harmof0():
    """Import HarmoF0's network straight from the clone (bypasses its heavy __init__)."""
    import types

    import torch

    repo = os.environ.get(
        "HARMOF0_REPO", os.path.join(REPO_API, ".venv-pitchbench", "src", "HarmoF0")
    )
    pkg_dir = os.path.join(repo, "harmof0")
    if not os.path.isdir(pkg_dir):
        raise SystemExit(
            f"HarmoF0 clone not found at {repo}. "
            "git clone --depth 1 https://github.com/WX-Wei/HarmoF0.git "
            f"{repo}"
        )
    pkg = types.ModuleType("harmof0")
    pkg.__path__ = [pkg_dir]
    sys.modules["harmof0"] = pkg
    # layers.py is numpy-1.x era code (`np.int`); restore the removed aliases.
    for alias, builtin in (("int", int), ("float", float), ("bool", bool)):
        if not hasattr(np, alias):
            setattr(np, alias, builtin)
    from harmof0.network import HarmoF0  # type: ignore

    net = HarmoF0()
    ckpt = os.path.join(pkg_dir, "checkpoints", "mdb-stem-synth.pth")
    net.load_state_dict(torch.load(ckpt, map_location="cpu"))
    net.eval()
    torch.set_num_threads(1)
    return net, ckpt


def run_harmof0(x: np.ndarray, sr: int) -> Tuple[np.ndarray, np.ndarray, np.ndarray, float, float]:
    global _HARMO
    import torch

    if _HARMO is None:
        _HARMO = _load_harmof0()
    net, _ = _HARMO
    audio16 = resample_to(x, sr, HARMO_SR)
    n_frames = int((len(audio16) - HARMO_FRAME) // HARMO_HOP) + 1
    if n_frames <= 0:
        return np.zeros(0), np.zeros(0), np.zeros(0, bool), 0.0, 0.0
    frames = np.lib.stride_tricks.as_strided(
        audio16,
        shape=(n_frames, HARMO_FRAME),
        strides=(audio16.strides[0] * HARMO_HOP, audio16.strides[0]),
    ).copy()
    t0, w0 = time.process_time(), time.perf_counter()
    acts = []
    step = 500
    with torch.no_grad():
        for b in range(0, n_frames, step):
            chunk = torch.from_numpy(frames[b : b + step])[None, :, :]
            onehot, _ = net(chunk)
            acts.append(onehot.squeeze(0).numpy())
    cpu, wall = time.process_time() - t0, time.perf_counter() - w0
    act = np.concatenate(acts, axis=0)  # [T, 352]
    idx = act.argmax(axis=1)
    conf = act.max(axis=1)
    hz = HARMO_FMIN * np.power(2.0, idx / HARMO_BPO)
    # frame centres (the repo's own `times` omits the half-frame offset)
    times = (np.arange(n_frames) * HARMO_HOP + HARMO_FRAME / 2.0) / HARMO_SR
    return times, hz, conf > HARMO_CONF_THRESHOLD, cpu, wall


# ---------------------------------------------------------------------------------
# measure
# ---------------------------------------------------------------------------------
def measure(models: List[str], tier: str, datasets, limit: int, guard_ms: float, out_path: str):
    clips = clips_for_tier(tier, datasets, limit)
    print(f"[bench] {len(clips)} clips, tier={tier}, models={models}", file=sys.stderr)
    guard_s = guard_ms / 1000.0
    results = {m: {"model": m, "tier": tier, "guardMs": guard_ms, "clips": []} for m in models}

    for i, c in enumerate(clips):
        x, sr = read_wav_mono(c["wav"])
        notes = load_truth(c["truth"])
        dur = len(x) / sr

        per_model: Dict[str, tuple] = {}
        cpu: Dict[str, float] = {}
        wall: Dict[str, float] = {}
        crepe_variants = [m for m in models if m.startswith("crepe-tiny")]
        if crepe_variants:
            got, cpus, w = run_crepe(x, sr, crepe_variants)
            per_model.update(got)
            cpu.update(cpus)
            for m in crepe_variants:
                wall[m] = w
        if "swiftf0" in models:
            t, hz, v, cp, wl = run_swiftf0(x, sr)
            per_model["swiftf0"] = (t, hz, v)
            cpu["swiftf0"], wall["swiftf0"] = cp, wl
        if "harmof0" in models:
            t, hz, v, cp, wl = run_harmof0(x, sr)
            per_model["harmof0"] = (t, hz, v)
            cpu["harmof0"], wall["harmof0"] = cp, wl

        for m, (times, hz, voiced) in per_model.items():
            rec = score_clip(times, hz, np.asarray(voiced, dtype=bool), notes, guard_s)
            rec.update(
                dataset=c["dataset"], clip=c["clip"], durSec=dur, frames=int(len(times)),
                cpuSec=cpu[m], wallSec=wall[m],
            )
            results[m]["clips"].append(rec)

        if (i + 1) % 25 == 0 or i + 1 == len(clips):
            print(f"[bench] {i + 1}/{len(clips)}", file=sys.stderr, flush=True)

    with open(out_path, "w") as f:
        json.dump(list(results.values()), f)
    print(f"[bench] wrote {out_path}", file=sys.stderr)


# ---------------------------------------------------------------------------------
# aggregate + tables
# ---------------------------------------------------------------------------------
def _acc(dst: dict, src: dict):
    for k, v in src.items():
        dst[k] = dst.get(k, 0) + v


def aggregate(paths: List[str], variant: str = "all") -> None:
    runs = []
    for p in paths:
        with open(p) as f:
            runs.extend(json.load(f))

    for run in runs:
        model, tier = run["model"], run["tier"]
        by_ds: Dict[str, Dict[str, dict]] = {}
        by_band: Dict[str, dict] = {}
        voi: Dict[str, dict] = {}
        cpu_tot = wall_tot = dur_tot = 0.0
        clips = [c for c in run["clips"] if is_canonical(tier, c["dataset"])]
        run["clips"] = clips
        for c in clips:
            cpu_tot += c["cpuSec"]
            wall_tot += c["wallSec"]
            dur_tot += c["durSec"]
            for band, m in c[variant].items():
                _acc(by_ds.setdefault(c["dataset"], {}).setdefault("ALL", {}), m)
                _acc(by_ds[c["dataset"]].setdefault(band, {}), m)
                _acc(by_band.setdefault(band, {}), m)
                _acc(by_band.setdefault("ALL", {}), m)
            _acc(voi.setdefault(c["dataset"], {}), c["voicing"])
            _acc(voi.setdefault("ALL", {}), c["voicing"])

        print(f"\n## {model}  (tier={tier}, variant={variant}, {len(run['clips'])} clips, "
              f"{dur_tot:.0f}s audio)")
        print(f"CPU {cpu_tot / dur_tot:.4f} s/s audio   wall(fwd) {wall_tot / dur_tot:.4f} s/s")
        print("\n| dataset | frames | RPA@50c | RCA@50c | octave err | gross err | "
              "mean |cents| | gated RPA | voicing recall | voicing FA |")
        print("|---|---|---|---|---|---|---|---|---|---|")
        for ds in sorted(by_ds) + ["ALL"]:
            m = by_ds[ds]["ALL"] if ds != "ALL" else by_band["ALL"]
            v = voi.get(ds, {})
            n = m["n"]
            rv = max(1, v.get("refVoiced", 1))
            ru = max(1, v.get("refUnvoiced", 1))
            print(f"| {ds} | {n} | {m['rpa'] / n:.3f} | {m['rca'] / n:.3f} | "
                  f"{m['oct'] / n:.3f} | {m['gross'] / n:.3f} | "
                  f"{m['absSum'] / max(1, m['absN']):.1f} | {m['gatedRpa'] / n:.3f} | "
                  f"{m['estVoiced'] / n:.3f} | {v.get('falseAlarm', 0) / ru:.3f} |")
        print("\n| register band | frames | RPA@50c | RCA@50c | octave err | mean |cents| |")
        print("|---|---|---|---|---|---|")
        for band, _lo, _hi in BANDS:
            if band not in by_band:
                continue
            m = by_band[band]
            n = m["n"]
            print(f"| {band} | {n} | {m['rpa'] / n:.3f} | {m['rca'] / n:.3f} | "
                  f"{m['oct'] / n:.3f} | {m['absSum'] / max(1, m['absN']):.1f} |")


def cross_table(paths: List[str], variant: str = "all") -> None:
    """One table: rows = dataset (urmp-* also folded into a urmp-ALL row) + register
    band, columns = model. Cell = `RPA / octave-error`. This is the comparison table."""
    runs = []
    for p in paths:
        with open(p) as f:
            runs.extend(json.load(f))
    models: List[str] = []
    cells: Dict[str, Dict[str, dict]] = {}
    cost: Dict[str, Tuple[float, float, float]] = {}
    for run in runs:
        m, tier = run["model"], run["tier"]
        if m not in models:
            models.append(m)
        cpu = wall = dur = 0.0
        for c in run["clips"]:
            if not is_canonical(tier, c["dataset"]):
                continue
            cpu += c["cpuSec"]
            wall += c["wallSec"]
            dur += c["durSec"]
            keys = [c["dataset"], "ALL"]
            if c["dataset"].startswith("urmp-"):
                keys.append("urmp-ALL")
            for band, met in c[variant].items():
                keys.append(f"band:{band}")
            for k in keys:
                for band, met in c[variant].items():
                    if k.startswith("band:") and k != f"band:{band}":
                        continue
                    _acc(cells.setdefault(k, {}).setdefault(m, {}), met)
        cost[m] = (cpu / max(dur, 1e-9), wall / max(dur, 1e-9), dur)

    def cell(k: str, m: str) -> str:
        d = cells.get(k, {}).get(m)
        if not d or d["n"] == 0:
            return "—"
        return f"{d['rpa'] / d['n']:.3f} / {d['oct'] / d['n']:.3f}"

    order = [k for k in sorted(cells) if not k.startswith("band:") and k != "ALL"]
    order += ["ALL"] + [f"band:{b}" for b, _l, _h in BANDS if f"band:{b}" in cells]
    print(f"\n### RPA@50c / octave-error   (variant={variant})")
    # frames differ per model (hops differ: 20 / 16 / 10 ms) — show the largest.
    print("| row | frames(max) | " + " | ".join(models) + " |")
    print("|---" * (2 + len(models)) + "|")
    for k in order:
        n = max((cells[k].get(m, {}).get("n", 0) for m in models), default=0)
        print(f"| {k} | {n} | " + " | ".join(cell(k, m) for m in models) + " |")
    print("\n| model | CPU s per s audio | wall s per s audio | audio s |")
    print("|---|---|---|---|")
    for m in models:
        c = cost[m]
        print(f"| {m} | {c[0]:.4f} | {c[1]:.4f} | {c[2]:.0f} |")


def ceiling_sweep(models: List[str]) -> None:
    """
    Synthetic ceiling probe: a 1 s pure sine and a 1 s band-limited sawtooth at each
    frequency, straight into each model. Nothing about our corpus can be blamed for
    the result, so it isolates each model's *usable* top frequency from its
    *nominal* output range. Prints the median estimate over the middle half.
    """
    sr = 16000
    t = np.arange(sr) / sr
    freqs = [220, 440, 880, 1046.5, 1174.7, 1318.5, 1480, 1760, 1975.5, 2093.7, 2637, 3136, 3729]
    print("\n## usable-ceiling probe (median estimated Hz; 'x2/x0.5' = octave error)")
    print("| true Hz | " + " | ".join(f"{m} sine | {m} saw" for m in models) + " |")
    print("|---" * (1 + 2 * len(models)) + "|")
    for f0 in freqs:
        sine = (0.5 * np.sin(2 * np.pi * f0 * t)).astype(np.float32)
        saw = np.zeros_like(t)
        k = 1
        while f0 * k < 7500:
            saw += np.sin(2 * np.pi * f0 * k * t) / k
            k += 1
        saw = (0.3 * saw).astype(np.float32)
        cells = []
        for m in models:
            for sig in (sine, saw):
                if m.startswith("crepe-tiny"):
                    got, _, _ = run_crepe(sig, sr, [m])
                    hz = got[m][1]
                elif m == "swiftf0":
                    _, hz, _, _, _ = run_swiftf0(sig, sr)
                else:
                    _, hz, _, _, _ = run_harmof0(sig, sr)
                mid = hz[len(hz) // 4 : 3 * len(hz) // 4]
                est = float(np.median(mid)) if len(mid) else float("nan")
                ratio = est / f0 if f0 else 0.0
                tag = ""
                for r, name in ((0.5, " x0.5"), (0.25, " x0.25"), (2.0, " x2")):
                    if abs(ratio - r) < 0.03:
                        tag = name
                cells.append(f"{est:.0f}{tag}")
        print(f"| {f0:.0f} | " + " | ".join(cells) + " |")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", default="", help="comma list: crepe-tiny,crepe-tiny-viterbi,swiftf0,harmof0")
    ap.add_argument("--tier", default="real", choices=["real", "probe", "adverse"])
    ap.add_argument("--datasets", default="")
    ap.add_argument("--limit", type=int, default=0, help="max clips per dataset")
    ap.add_argument("--guard-ms", type=float, default=30.0)
    ap.add_argument("--out", default="")
    ap.add_argument("--aggregate", nargs="*", default=None)
    ap.add_argument("--variant", default="all", choices=["all", "core"])
    ap.add_argument("--cross", nargs="*", default=None,
                    help="cross-model table from result JSONs")
    ap.add_argument("--ceiling-sweep", action="store_true",
                    help="synthetic sine/saw ceiling probe for --models (no corpus)")
    args = ap.parse_args()

    if args.aggregate:
        aggregate(args.aggregate, args.variant)
        return
    if args.cross:
        cross_table(args.cross, args.variant)
        return
    if args.ceiling_sweep:
        ceiling_sweep([m for m in args.models.split(",") if m])
        return
    if not args.models or not args.out:
        ap.error("--models and --out are required unless --aggregate is given")
    measure(
        [m for m in args.models.split(",") if m],
        args.tier,
        [d for d in args.datasets.split(",") if d],
        args.limit,
        args.guard_ms,
        args.out,
    )


if __name__ == "__main__":
    main()
