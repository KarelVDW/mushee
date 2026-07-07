"""basic-pitch forward-pass gRPC service.

Replicates `basic_pitch.inference.run_inference` but starting from the raw 22050 Hz
mono PCM the API already decoded (no file round-trip), reusing the library's own
`window_audio_file` + `unwrap_output` so the framing/overlap-trim are byte-for-byte
the library's. Returns the note (`frames`) and `onset` activation matrices [T,88];
`outputToNotesPoly` and note->time mapping stay in the API.

The weights are Spotify's official ICASSP-2022 SavedModel — the same model the
repo's tfjs graph model was converted from. Equivalence to the in-process TF.js
path is enforced by the parity gate before cutover.
"""

import signal
import os
import sys
import threading
from concurrent import futures

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")

import grpc  # noqa: E402
import numpy as np  # noqa: E402
from basic_pitch import ICASSP_2022_MODEL_PATH  # noqa: E402
from basic_pitch.constants import AUDIO_N_SAMPLES, FFT_HOP  # noqa: E402
from basic_pitch.inference import Model, unwrap_output, window_audio_file  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import inference_pb2 as pb  # noqa: E402
import inference_pb2_grpc as pb_grpc  # noqa: E402

PORT = int(os.environ.get("PORT", "50052"))
MAX_WORKERS = int(os.environ.get("GRPC_MAX_WORKERS", "8"))
MAX_MSG = 64 * 1024 * 1024

# Matches run_inference exactly.
N_OVERLAPPING_FRAMES = 30
OVERLAP_LEN = N_OVERLAPPING_FRAMES * FFT_HOP  # 7680
HOP_SIZE = AUDIO_N_SAMPLES - OVERLAP_LEN  # 36164


def _forward(model: Model, samples: np.ndarray):
    """run_inference's body, from raw samples instead of a file path."""
    original_length = samples.shape[0]
    audio = np.concatenate(
        [np.zeros((OVERLAP_LEN // 2,), dtype=np.float32), samples]
    )
    note, onset = [], []
    for window, _ in window_audio_file(audio, HOP_SIZE):
        out = model.predict(np.expand_dims(window, axis=0))
        note.append(out["note"])
        onset.append(out["onset"])
    frames = unwrap_output(np.concatenate(note), original_length, N_OVERLAPPING_FRAMES)
    onsets = unwrap_output(np.concatenate(onset), original_length, N_OVERLAPPING_FRAMES)
    return frames, onsets


class BasicPitchServicer(pb_grpc.BasicPitchInferenceServicer):
    def __init__(self):
        self.model = Model(ICASSP_2022_MODEL_PATH)
        # Warm: run one tiny window so the first real call isn't graph-build slow.
        self._forward(np.zeros((AUDIO_N_SAMPLES,), dtype=np.float32))
        self._lock = threading.Lock()

    def _forward(self, samples):
        return _forward(self.model, samples)

    def Forward(self, request, context):
        samples = np.frombuffer(request.samples, dtype="<f4")
        with self._lock:
            frames, onsets = self._forward(samples)
        frames = np.ascontiguousarray(frames, dtype="<f4")
        onsets = np.ascontiguousarray(onsets, dtype="<f4")
        return pb.BasicPitchForwardResponse(
            frames=frames.tobytes(),
            onsets=onsets.tobytes(),
            num_frames=frames.shape[0],
            num_pitches=frames.shape[1],
        )

    def Health(self, request, context):
        return pb.HealthResponse(ready=True, model="basic-pitch-icassp2022")


def serve():
    server = grpc.server(
        futures.ThreadPoolExecutor(max_workers=MAX_WORKERS),
        options=[
            ("grpc.max_receive_message_length", MAX_MSG),
            ("grpc.max_send_message_length", MAX_MSG),
        ],
    )
    pb_grpc.add_BasicPitchInferenceServicer_to_server(BasicPitchServicer(), server)
    server.add_insecure_port(f"[::]:{PORT}")
    server.start()
    # Drain in-flight RPCs on SIGTERM (k8s pod rotation) instead of
    # dropping them mid-forward-pass; new RPCs are refused immediately.
    signal.signal(signal.SIGTERM, lambda *_: server.stop(grace=10))
    print(f"basic-pitch-inference listening on :{PORT}", flush=True)
    server.wait_for_termination()


if __name__ == "__main__":
    serve()
