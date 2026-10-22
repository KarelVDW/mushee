#!/usr/bin/env bash
# Regenerate the Python gRPC stubs for the inference service on the HOST,
# for running server.py outside Docker. The image doesn't need this — its
# Dockerfile generates the same stubs in an isolated `proto` build stage.
#
# grpcio-tools is pinned to the SAME version as the Dockerfile so the host-run
# and containerized service always speak from identical gencode: 1.62.3's
# output predates protobuf's runtime-version guard (5.26+), so it imports
# against the service's TensorFlow-pinned protobuf runtime.
set -euo pipefail

GRPCIO_TOOLS_VERSION=1.62.3

# The service image's interpreter (3.12), or 3.11; grpcio-tools 1.62.3 ships
# no wheels for newer Pythons.
python=""
for candidate in python3.12 python3.11; do
  if command -v "$candidate" >/dev/null; then python="$candidate"; break; fi
done
[[ -n "$python" ]] || { echo "error: python3.12 or python3.11 required" >&2; exit 1; }

here="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$here/../.." && pwd)"

venv="$(mktemp -d)/proto-venv"
"$python" -m venv "$venv"
"$venv/bin/pip" install --quiet --disable-pip-version-check "grpcio-tools==$GRPCIO_TOOLS_VERSION"

out="$repo_root/apps/inference-crepe"
"$venv/bin/python" -m grpc_tools.protoc -I "$here" \
  --python_out="$out" --grpc_python_out="$out" "$here/inference.proto"
echo "generated $out/inference_pb2{,_grpc}.py"

rm -rf "$(dirname "$venv")"
