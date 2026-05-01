#!/usr/bin/env bash
# Fetch the official CREPE model and convert it to TF.js layers format,
# writing into apps/api/model-crepe-<capacity>/ (the directory CrepeProvider
# reads when PITCH_PROVIDER=crepe-<capacity>).
#
# Usage:
#   apps/api/scripts/fetch-crepe-model.sh [capacity]
#
#   capacity: tiny | small | medium | large | full   (default: full)
#
# The capacity is the standard CREPE size knob from marl/crepe:
#   tiny   ~ 0.5 MB   fastest, lowest accuracy
#   small  ~ 2 MB
#   medium ~ 7 MB
#   large  ~ 30 MB
#   full   ~ 89 MB    slowest, highest accuracy
#
# Requires: a Python 3.10–3.12 interpreter on PATH. TensorFlow does not yet
# publish wheels for 3.13+, so the script will refuse to use a newer
# interpreter even if `python3` resolves to one. Override with PYTHON=...
# to point at a specific binary.
#
# A throwaway venv is created at apps/api/.venv-crepe/ on first run and
# reused on subsequent runs (rebuilt automatically if its Python version
# is incompatible).

set -euo pipefail

CAPACITY="${1:-full}"
case "$CAPACITY" in
  tiny|small|medium|large|full) ;;
  *)
    echo "Unknown CREPE capacity: $CAPACITY (expected tiny|small|medium|large|full)" >&2
    exit 1
    ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT_DIR="$API_DIR/model-crepe-$CAPACITY"
VENV_DIR="$API_DIR/.venv-crepe"

# Pick a TensorFlow-compatible Python (3.10–3.12). Caller can override.
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
  echo "No TensorFlow-compatible Python found. Install python3.10, 3.11, or 3.12" >&2
  echo "(e.g. 'brew install python@3.12') and retry, or pass PYTHON=/path/to/python." >&2
  exit 1
fi

# Reject 3.13+ even when explicitly pointed at one — wheels don't exist.
PY_VER="$("$PYTHON_BIN" -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
case "$PY_VER" in
  3.10|3.11|3.12) ;;
  *)
    echo "Python $PY_VER (from $PYTHON_BIN) is not supported." >&2
    echo "TensorFlow needs Python 3.10–3.12. Set PYTHON=/path/to/python3.12 and retry." >&2
    exit 1
    ;;
esac

# Recreate the venv if it was built with a now-incompatible Python.
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
# crepe's setup.py imports `pkg_resources`, which recent setuptools releases
# no longer ship. Pin setuptools to a version that still bundles it, and
# disable build isolation so the crepe build sees this venv's setuptools.
pip install --quiet "setuptools<80" "wheel"
pip install --quiet --no-build-isolation "crepe>=0.0.16"
pip install --quiet "tensorflowjs>=4.22,<5"
# tensorflowjs 4.22 pulls in tensorflow_decision_forests 1.12, which is built
# against protobuf 6.31 gencode. Tensorflow itself declares protobuf<6, but
# the converter runs fine with 6.x — protobuf 5.x crashes on import. Force
# the runtime to satisfy TFDF's gencode.
pip install --quiet "protobuf>=6.31,<7"

# Keras 3 (TF 2.19's default) emits layer configs with `batch_shape`, but the
# Node-side tfjs-layers 4.22 only understands Keras 2's `batch_input_shape`,
# so models built with default Keras 3 fail to load with
#   "An InputLayer should be passed either a batchInputShape or an inputShape".
# Force tf-keras (the Keras 2 compat shim, already pulled in by tensorflowjs)
# for both the model build and the converter.
export TF_USE_LEGACY_KERAS=1

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT
H5_PATH="$WORK_DIR/crepe-$CAPACITY.h5"

echo "Building CREPE/$CAPACITY model and saving to $H5_PATH ..."
python - "$CAPACITY" "$H5_PATH" <<'PY'
import sys
from crepe.core import build_and_load_model
capacity, out = sys.argv[1], sys.argv[2]
model = build_and_load_model(capacity)
model.save(out)
PY

# Convert into a staging dir first; only swap into the real OUT_DIR if the
# conversion succeeds, so a failure mid-run can't leave us with no model.
STAGE_DIR="$WORK_DIR/out"
mkdir -p "$STAGE_DIR"

echo "Converting to tfjs_layers_model in $STAGE_DIR ..."
tensorflowjs_converter \
  --input_format=keras \
  --output_format=tfjs_layers_model \
  "$H5_PATH" "$STAGE_DIR"

mkdir -p "$OUT_DIR"
find "$OUT_DIR" -maxdepth 1 \( -name 'group*-shard*' -o -name 'model.json' \) -delete
cp "$STAGE_DIR"/* "$OUT_DIR/"

cat > "$OUT_DIR/SOURCE.md" <<EOF
# CREPE model provenance

- Capacity: **$CAPACITY**
- Source: https://github.com/marl/crepe — \`crepe.core.build_and_load_model("$CAPACITY")\`
- Regenerate: \`apps/api/scripts/fetch-crepe-model.sh $CAPACITY\`

Do not edit these files by hand. Re-run the script above to refresh them, then
commit the new \`model.json\`, weight shards, and this file together.
EOF

echo "Done. Wrote CREPE/$CAPACITY model to $OUT_DIR."
