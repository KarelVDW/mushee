#!/usr/bin/env bash
# Regenerate the Python gRPC stubs for both inference services on the HOST,
# for running server.py outside Docker. The images don't need this — their
# Dockerfiles generate the same stubs in an isolated `proto` build stage.
#
# grpcio-tools is pinned to the SAME version as the Dockerfiles so host-run
# and containerized services always speak from identical gencode: 1.62.3's
# output predates protobuf's runtime-version guard (5.26+), so it imports
# against both services' TensorFlow-pinned protobuf runtimes.
set -euo pipefail

GRPCIO_TOOLS_VERSION=1.62.3

# Same interpreter range as the service images (3.11/3.12); grpcio-tools
# 1.62.3 ships no wheels for newer Pythons.
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

for app in inference-crepe inference-basic-pitch; do
  out="$repo_root/apps/$app"
  "$venv/bin/python" -m grpc_tools.protoc -I "$here" \
    --python_out="$out" --grpc_python_out="$out" "$here/inference.proto"
  echo "generated $out/inference_pb2{,_grpc}.py"
done

rm -rf "$(dirname "$venv")"
