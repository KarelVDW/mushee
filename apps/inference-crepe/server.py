"""CREPE forward-pass gRPC service.

Runs ONLY the model forward pass: `Predict(frames[N,1024]) -> activations[N,360]`.
Framing (normalizeFrame), the activation cache, Viterbi and segmentation stay in
the API, so this service is a thin, stateless tensor->tensor function. Weights are
the exact tfjs layers model the API shipped, loaded via the tensorflowjs Python
loader, so outputs match the in-process TF.js path (verified bit-for-bit).
"""

import os
import sys
import threading
from concurrent import futures

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")

import grpc  # noqa: E402
import numpy as np  # noqa: E402
import tensorflow as tf  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import inference_pb2 as pb  # noqa: E402
import inference_pb2_grpc as pb_grpc  # noqa: E402

MODEL_DIR = os.environ.get("CREPE_MODEL_DIR", "/models/crepe-tiny")
PORT = int(os.environ.get("PORT", "50051"))
MAX_WORKERS = int(os.environ.get("GRPC_MAX_WORKERS", "8"))
MAX_MSG = 64 * 1024 * 1024


def _load_model():
    # Plain TF SavedModel (pre-converted from the tfjs layers weights on the host;
    # bit-identical, verified). Avoids tensorflowjs at runtime — its dep closure
    # (jax/TFDF) has no linux/arm64 resolution.
    loaded = tf.saved_model.load(MODEL_DIR)
    infer = loaded.signatures["serving_default"]
    infer(tf.zeros((1, 1024), dtype=tf.float32))  # warm
    return loaded, infer


class CrepeServicer(pb_grpc.CrepeInferenceServicer):
    def __init__(self):
        # Keep `loaded` referenced so the graph isn't GC'd; call via `infer`.
        self._loaded, self._infer = _load_model()
        # TF inference is CPU-bound here; serialize to avoid cross-thread Keras
        # state issues. Concurrency comes from running multiple replicas (HPA).
        self._lock = threading.Lock()

    def Predict(self, request, context):
        bc = request.batch_count
        fs = request.frame_size
        x = np.frombuffer(request.frames, dtype="<f4").reshape(bc, fs)
        with self._lock:
            out = self._infer(tf.constant(x))
            y = out["output_0"].numpy()
        y = np.ascontiguousarray(y, dtype="<f4")
        return pb.CrepePredictResponse(
            activations=y.tobytes(), batch_count=bc, num_bins=y.shape[1]
        )

    def Health(self, request, context):
        return pb.HealthResponse(ready=True, model="crepe-tiny")


def serve():
    server = grpc.server(
        futures.ThreadPoolExecutor(max_workers=MAX_WORKERS),
        options=[
            ("grpc.max_receive_message_length", MAX_MSG),
            ("grpc.max_send_message_length", MAX_MSG),
        ],
    )
    pb_grpc.add_CrepeInferenceServicer_to_server(CrepeServicer(), server)
    server.add_insecure_port(f"[::]:{PORT}")
    server.start()
    print(f"crepe-inference listening on :{PORT} (model={MODEL_DIR})", flush=True)
    server.wait_for_termination()


if __name__ == "__main__":
    serve()
