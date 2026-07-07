# WebSocket concurrency — remaining optimizations

Status after the inference split (2026-07): the goal of getting the TF forward
pass off the API event loop is **done** — inference runs in separately scaled
gRPC services, and API replicas share all state via Postgres, so the API scales
horizontally. What remains are per-connection costs that set the practical
ceiling *per pod*. In priority order:

## 0. Measure first — concurrency load test

Nothing currently measures N concurrent recording sessions (the eval harness
guards accuracy; `scripts/eval/bench-streaming.ts` is single-stream). Extend
`scripts/test-recording-ws.ts` into an N-session load test (synthetic audio,
ramp N, watch p95 pass latency + RSS) and baseline the per-pod ceiling before
optimizing. Everything below except §1 is code-reading, not measurement.

## 1. Bounded per-session buffers (memory — the certain one)

Per-session memory grows linearly with recording duration, ~14 MB/min:

- `StreamingDecoder` keeps the full decoded PCM (`ensureCapacity` doubling,
  `AudioDecoder.ts` ~L248) — ~5.3 MB/min at 22.05 kHz.
- `CrepeSession` caches activations for the whole recording
  (`CrepeProvider.ts` ~L156) — ~8.6 MB/min.

The pipeline freezes committed audio and only re-transcribes a trailing window
(`RecordingPipeline.ts`), so both buffers can drop everything behind the
committed watermark (ring buffer / trim). At the 512 Mi pod limit, a few long
unlimited-tier recordings currently OOM a pod.

## 2. Cheap wins

- **Aligned buffer copies instead of per-element JS loops**: decoder ingest
  (`AudioDecoder.ts` ~L242) and `RemoteModelBackend.bytesToF32` do
  `readFloatLE` per float; a `Buffer.copy` into an aligned buffer + a
  `Float32Array` view is a memcpy. `unflatten` in `RemoteModelBackend` also
  builds `number[][]` garbage per pass — keep flat typed arrays if
  `outputToNotesPoly` tolerates row views.
- **Lazy-load TF.js in remote mode**: `createModelBackend` imports
  `LocalModelBackend` (→ `@tensorflow/tfjs`, `@spotify/basic-pitch` model
  loaders) at module scope, so every production pod pays TF.js memory + boot
  time it never uses. Use a dynamic `import()` when no inference URL is set.
- **API HPA + PodDisruptionBudget**: only the inference services have HPAs;
  add one for the `api` Deployment (deploy/k8s/base/api.yaml).

## 3. Event-loop DSP → worker pool

Per windowed pass, still on the main thread: CREPE framing + confidence
reduction + Viterbi/segmentation, basic-pitch `outputToNotesPoly`,
NoteExtractor, MxmlBuilder. Tens of ms per pass → roughly low hundreds of
active recordings per pod before socket latency degrades. Move the
post-forward decode work to a `worker_threads` pool (transferable
ArrayBuffers), leaving the event loop I/O-only. Phase 2 of the same
philosophy as the inference split.

## 4. ffmpeg process per session

Each recording spawns a long-lived ffmpeg child (`StreamingDecoder`). CPU is
off the event loop (good), but at hundreds of sessions that's hundreds of
processes (~10–20 MB each, fds, scheduler load). Options, increasing ambition:

1. Accept it, raise pod limits (fine for the near term).
2. In-process WebM/Opus decode (WASM opus decoder) inside the §3 worker pool.
3. Browser sends PCM from an AudioWorklet — deletes server decode entirely,
   costs ~5× upload bandwidth.

## 5. Postgres write batching

Each active session writes ~2/s: credit tick (1/s, `RecordingSession`), lock
heartbeat (1/5 s, `RecordingLocksService`), debounced full-document JSONB
cache upsert. Fine at hundreds of sessions; at thousands, batch the credit
tick onto the heartbeat cadence (5 credits / 5 s — tradeoff: up to 5 s of
limit overshoot).

## 6. Graceful drain for rolling deploys

No SIGTERM handling: a rolling update kills live recordings (the
`active_recordings` stale-takeover recovers the lock after 20 s, but the
user's recording dies). On SIGTERM: stop accepting new recording sockets,
finalize active sessions (flush + persist), then exit; pair with
`terminationGracePeriodSeconds` sized to the longest acceptable drain. Also
consider real gRPC health probes for the inference services (they expose a
custom `Health` RPC; k8s probes are tcpSocket today).
