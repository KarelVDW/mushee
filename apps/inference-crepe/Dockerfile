# CREPE forward-pass service. CPU image; build context is the repo root (needs
# the proto + the model dir). For GPU, swap the base for a CUDA TF image and add
# a GPU nodeSelector in k8s — the server code is unchanged.

# Generate gRPC stubs in an isolated stage: grpcio-tools' protobuf pin conflicts
# with TensorFlow's, so it must never share the runtime env. Pinned to a version
# whose gencode predates protobuf's runtime-version guard (5.26+), so the stubs
# import against TensorFlow's older protobuf runtime (5.29) without a VersionError.
FROM python:3.12-slim AS proto
RUN pip install --no-cache-dir grpcio-tools==1.62.3
COPY packages/inference-proto/inference.proto /proto/inference.proto
RUN mkdir -p /gen && python -m grpc_tools.protoc -I /proto --python_out=/gen --grpc_python_out=/gen /proto/inference.proto

FROM python:3.12-slim AS base

WORKDIR /app

# libgomp1: TensorFlow's OpenMP runtime.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY apps/inference-crepe/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY --from=proto /gen/inference_pb2.py /gen/inference_pb2_grpc.py ./
COPY apps/inference-crepe/server.py .
# Plain-TF SavedModel, pre-converted on the host from the exact tfjs layers
# weights the API shipped (bit-identical; see the convert step in git history).
COPY apps/inference-crepe/crepe_saved_model /models/crepe-tiny

ENV CREPE_MODEL_DIR=/models/crepe-tiny \
    PORT=50051 \
    TF_CPP_MIN_LOG_LEVEL=3
EXPOSE 50051
CMD ["python", "server.py"]
