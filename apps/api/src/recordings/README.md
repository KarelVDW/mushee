# Recordings module

Turns live microphone audio into notated music on a score. The module is split
into two layers with a deliberate boundary between them.

## Root: NestJS transport + persistence

- `recordings.gateway.ts` — WebSocket gateway that receives audio chunks and
  streams score updates back to the client.
- `recordings.service.ts` — wires sessions together: resolves a pipeline
  profile, builds the pipeline, and enforces credits and locks.
- `recording-credits.service.ts` / `recording-locks.service.ts` — daily credit
  accounting (per subscription tier) and the one-recording-per-user lock.
- `recording-session.ts` — bridges one live session to the pipeline and
  persists results via the TypeORM `Recording` repository.
- `recording-archiver.ts` — archives raw session audio through the
  `StorageService`.
- `entities/` — TypeORM entities (registered in `database/data-source.ts`).

## `pipeline/`: pure audio → notes DSP

A dependency-injection-free transcription pipeline (its only NestJS import is
the `Logger` from `@nestjs/common`): decode (ffmpeg) → pitch inference →
note extraction / onset detection → MusicXML measures.

- `providers/` — pitch-model backends behind the `ModelBackend` seam: local
  TF.js (WASM) inference or remote Python gRPC services, plus the
  CREPE providers (at-pitch and octave-down) and decoders.
- `profiles/` — register-based pipeline configuration (provider choice,
  frequency windows, instrument ranges) resolved per recording.

The adaptive profile (band, provider, gates, voice routing) is locked from the
first ≥1.2 s of _pitched_ audio — a silent or spoken lead-in defers the lock (up
to `RECORDING_DETECT_MAX_WAIT_SEC`, 8 s) and a take that still locked the blind
fallback is re-resolved over the whole take on the final pass.

The pipeline is tuned and regression-gated by the eval harness in
`scripts/eval` (see `scripts/eval/README.md`; the product benchmark and its
committed results live in `scripts/eval/benchmarks/`), which imports it directly.
