#!/usr/bin/env bash
# Fetch PESTO and export it as ONNX into apps/api/model-pesto/.
#
# Usage:
#   apps/api/scripts/fetch-pesto-model.sh [checkpoint]
#
#   checkpoint: name of a checkpoint bundled with the pesto-pitch package.
#               default: mir-1k (the only "general-purpose" weights shipped).
#               see https://github.com/SonyCSLParis/pesto/tree/master/pesto/weights
#
# The script writes:
#   apps/api/model-pesto/model.onnx       — the exported ONNX graph
#   apps/api/model-pesto/metadata.json    — cache_size, num_bins, hop_samples,
#                                           bins_per_semitone, sampling_rate.
#                                           PestoProvider reads this to know
#                                           the streaming cache shape and the
#                                           bin → cents mapping.
#   apps/api/model-pesto/SOURCE.md        — provenance.
#
# Requires: a Python 3.10–3.12 interpreter on PATH (TensorFlow/PyTorch don't
# yet publish wheels for 3.13+). Override with PYTHON=/path/to/python.
#
# A throwaway venv is created at apps/api/.venv-pesto/ on first run and
# reused on subsequent runs (rebuilt if its Python version is incompatible).

set -euo pipefail

CHECKPOINT="${1:-mir-1k_g7}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT_DIR="$API_DIR/model-pesto"
VENV_DIR="$API_DIR/.venv-pesto"

# Match the CREPE pipeline: 16 kHz mono input, ~10 ms hop. PESTO is
# sample-rate-agnostic, but locking to 16 kHz means the AudioDecoder doesn't
# have to resample twice for two providers.
SAMPLING_RATE=16000
CHUNK_SIZE=160 # 160 samples / 16 kHz = 10 ms — matches PESTO's natural step.

# Pick a PyTorch-compatible Python (3.10–3.12). Caller can override.
SUPPORTED_PYTHONS=(python3.12 python3.11 python3.10)
PYTHON_BIN="${PYTHON:-}"
if [ -z "$PYTHON_BIN" ]; then
  for candidate in "${SUPPORTED_PYTHONS[@]}"; do
    if command -v "$candidate" >/dev/null 2>&1; then
      PYTHON_BIN="$candidate"
      break
    fi
  done
fi
if [ -z "$PYTHON_BIN" ] || ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "No PyTorch-compatible Python found. Install python3.10, 3.11, or 3.12" >&2
  echo "(e.g. 'brew install python@3.12') and retry, or pass PYTHON=/path/to/python." >&2
  exit 1
fi

PY_VER="$("$PYTHON_BIN" -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
case "$PY_VER" in
  3.10|3.11|3.12) ;;
  *)
    echo "Python $PY_VER (from $PYTHON_BIN) is not supported." >&2
    echo "PyTorch needs Python 3.10–3.12. Set PYTHON=/path/to/python3.12 and retry." >&2
    exit 1
    ;;
esac

if [ -d "$VENV_DIR" ]; then
  EXISTING_PY_VER="$("$VENV_DIR/bin/python" -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>/dev/null || true)"
  if [ "$EXISTING_PY_VER" != "$PY_VER" ]; then
    echo "Existing venv uses Python ${EXISTING_PY_VER:-?}, recreating with $PY_VER ..."
    rm -rf "$VENV_DIR"
  fi
fi

if [ ! -d "$VENV_DIR" ]; then
  echo "Creating Python $PY_VER venv at $VENV_DIR ..."
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi
# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"

pip install --quiet --upgrade pip
# pesto-pitch pulls in torch + torchaudio. onnx + onnxruntime are for the
# export validator. onnxscript is required by recent torch.onnx.export.
pip install --quiet "pesto-pitch>=2.0" "onnx" "onnxruntime" "onnxscript"

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

# The PyPI package ships only the `pesto/` Python module — the streaming
# ONNX wrapper lives in the repo's `realtime/` directory. Clone shallowly
# to grab it. Stage the realtime files separately so we can run them with
# `pesto` resolving from the pip install (HEAD's pesto/ has post-2.0.1
# changes that don't match the bundled checkpoint).
echo "Cloning SonyCSLParis/pesto (shallow) for the realtime export script ..."
git clone --depth 1 --quiet https://github.com/SonyCSLParis/pesto "$WORK_DIR/pesto-src"

STAGE_DIR="$WORK_DIR/stage"
mkdir -p "$STAGE_DIR/realtime"
cp "$WORK_DIR/pesto-src/realtime/onnx_wrapper.py" "$STAGE_DIR/realtime/"
cp "$WORK_DIR/pesto-src/realtime/export_onnx.py" "$STAGE_DIR/realtime/"
touch "$STAGE_DIR/realtime/__init__.py"

# pesto-pitch v2.0.1 (the released wheel) calls torch.view_as_complex inside
# pesto/data.py — that op has no ONNX equivalent and torch.onnx.export rejects
# it. The repo HEAD has a workaround (PR #38) that rewrites the same forward
# pass without the complex view. The HEAD's model.py / loader.py have other
# state_dict-incompatible changes, so overlay ONLY data.py from HEAD onto the
# installed package; that's enough to make export succeed without breaking
# the released checkpoints.
INSTALLED_PESTO_DIR="$("$VENV_DIR/bin/python" -c 'import pesto, os; print(os.path.dirname(pesto.__file__))')"
cp "$WORK_DIR/pesto-src/pesto/data.py" "$INSTALLED_PESTO_DIR/data.py"

ONNX_PATH="$WORK_DIR/model.onnx"

# We don't run the cloned realtime/export_onnx.py directly because PyTorch's
# new TorchDynamo-based exporter chokes on PESTO's symbolic-shape arithmetic;
# falling back to the legacy tracer (`dynamo=False`) works fine. Inline a
# minimal export instead.
echo "Exporting $CHECKPOINT to ONNX (sr=$SAMPLING_RATE Hz, chunk=$CHUNK_SIZE samples) ..."
python - "$CHECKPOINT" "$SAMPLING_RATE" "$CHUNK_SIZE" "$ONNX_PATH" "$STAGE_DIR" <<'PY'
import sys

sys.path.insert(0, sys.argv[5])

import torch
from pesto import load_model
from realtime.onnx_wrapper import StatelessPESTO

checkpoint, sr, chunk_size, out_path = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
step_size_ms = 1000 * chunk_size / sr
batch_size = 1  # we only use batch=1 in PestoProvider

model = load_model(
    checkpoint, step_size=step_size_ms, sampling_rate=sr,
    streaming=True, max_batch_size=batch_size, mirror=1.0,
)
model.eval()
wrapper = StatelessPESTO(model)
wrapper.eval()

example_audio = torch.randn(batch_size, chunk_size).clip(-1, 1)
example_cache = wrapper.init_cache(batch_size=batch_size, device="cpu")

torch.onnx.export(
    wrapper,
    (example_audio, example_cache),
    out_path,
    input_names=["audio", "cache"],
    output_names=["prediction", "confidence", "volume", "activations", "cache_out"],
    dynamic_axes={
        "audio": {0: "batch_size", 1: "audio_length"},
        "prediction": {0: "batch_size", 1: "time_steps"},
        "confidence": {0: "batch_size", 1: "time_steps"},
        "volume": {0: "batch_size", 1: "time_steps"},
        "activations": {0: "batch_size", 1: "time_steps"},
    },
    dynamo=False,
    opset_version=18,
)
print(f"Exported to {out_path}")
PY

# Introspect the exported model to capture the streaming-cache size and the
# pitch-bin layout. PestoProvider needs both at runtime.
META_PATH="$WORK_DIR/metadata.json"
python - "$ONNX_PATH" "$META_PATH" "$CHECKPOINT" "$SAMPLING_RATE" "$CHUNK_SIZE" "$STAGE_DIR" <<'PY'
import json
import sys

import os
sys.path.insert(0, sys.argv[6])

from pesto import load_model
from realtime.onnx_wrapper import StatelessPESTO

onnx_path, meta_path, checkpoint, sr, chunk_size, _ = sys.argv[1:]
sr = int(sr)
chunk_size = int(chunk_size)
step_size_ms = 1000 * chunk_size / sr

# StatelessPESTO exposes the flat cache size we need to allocate runtime-side.
torch_model = load_model(
    checkpoint, step_size=step_size_ms, sampling_rate=sr,
    streaming=True, max_batch_size=1, mirror=1.0,
)
torch_model.eval()
wrapper = StatelessPESTO(torch_model)

# The output activation dim isn't surfaced as a constant in the ONNX graph
# (only the dynamic time-step axis is named), so read it from the torch model.
bps = torch_model.bins_per_semitone
num_bins = 128 * bps  # PESTO convention: 128 MIDI semitones × bps bins.

meta = {
    "checkpoint": checkpoint,
    "sampling_rate": sr,
    "hop_samples": chunk_size,
    "step_size_ms": step_size_ms,
    "bins_per_semitone": int(bps),
    "num_bins": int(num_bins),
    "cache_size": int(wrapper.cache_size),
}

with open(meta_path, "w") as f:
    json.dump(meta, f, indent=2)
print(json.dumps(meta, indent=2))
PY

mkdir -p "$OUT_DIR"
rm -f "$OUT_DIR/model.onnx" "$OUT_DIR/metadata.json"
mv "$ONNX_PATH" "$OUT_DIR/model.onnx"
mv "$META_PATH" "$OUT_DIR/metadata.json"

cat > "$OUT_DIR/SOURCE.md" <<EOF
# PESTO model provenance

- Checkpoint: **$CHECKPOINT**
- Source: https://github.com/SonyCSLParis/pesto
- Export: streaming ONNX via \`realtime/export_onnx.py\`
- Sampling rate: $SAMPLING_RATE Hz
- Chunk size: $CHUNK_SIZE samples (≈ 10 ms hop)
- Regenerate: \`apps/api/scripts/fetch-pesto-model.sh $CHECKPOINT\`

\`metadata.json\` records the cache layout and pitch-bin parameters that
PestoProvider needs at runtime. Do not edit by hand — re-run the script
above to refresh the model and metadata together.
EOF

echo "Wrote PESTO/$CHECKPOINT model to $OUT_DIR."
