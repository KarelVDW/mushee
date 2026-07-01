# basic-pitch forward-pass service. CPU image; Python 3.11 (a transitive build
# dep breaks on 3.12). The ICASSP-2022 SavedModel ships inside the pip package,
# so there's no model to COPY. Build context is the repo root (needs the proto).

# Generate gRPC stubs in an isolated stage: grpcio-tools' protobuf pin conflicts
# with TensorFlow's, so it must never share the runtime env. Pinned to a version
# whose gencode predates protobuf's runtime-version guard (5.26+), so the stubs
# import against TensorFlow's older protobuf runtime (5.29) without a VersionError.
FROM python:3.11-slim AS proto
RUN pip install --no-cache-dir grpcio-tools==1.62.3
COPY packages/inference-proto/inference.proto /proto/inference.proto
RUN mkdir -p /gen && python -m grpc_tools.protoc -I /proto --python_out=/gen --grpc_python_out=/gen /proto/inference.proto

FROM python:3.11-slim AS base

WORKDIR /app

# libsndfile1 + ffmpeg: librosa/resampy audio I/O; libgomp1: TensorFlow OpenMP.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libsndfile1 ffmpeg libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY apps/inference-basic-pitch/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY --from=proto /gen/inference_pb2.py /gen/inference_pb2_grpc.py ./
COPY apps/inference-basic-pitch/server.py .

ENV PORT=50052 \
    TF_CPP_MIN_LOG_LEVEL=3
EXPOSE 50052
CMD ["python", "server.py"]
