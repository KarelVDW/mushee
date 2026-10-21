# Recordings module

Turns live microphone audio into notated music on a score. The module is split
into two layers with a deliberate boundary between them.

## Root: NestJS transport + persistence

- `recordings.gateway.ts` — WebSocket gateway that receives audio chunks and
  streams score updates back to the client. Frames to the client:
  `score-update`, `recording-source`, `recording-health` (transcription
  down/back — the session stops metering credits while it is down),
  `recording-limit`, `recording-capped`, `recording-error`, `recording-complete`.
- `recordings.controller.ts` — the owner's takes over HTTP: list per score,
  replay the archived audio (signed URL or stream), delete one (audio first,
  then the row).
- `recording-sessions.service.ts` — the live-recording engine: owns the pitch
  model registry and profile resolver, and opens one session per take (slot
  lock, credit check, pipeline); the gateway's only service.
- `recordings.service.ts` — the takes behind the controller (list, replay,
  delete) and the account purge.
- `recording-credits.service.ts` / `recording-locks.service.ts` — daily credit
  accounting (per subscription tier) and the one-recording-per-user lock.
- `recording-session.ts` — bridges one live session to the pipeline and
  persists results via the TypeORM `Recording` repository.
- `recording-archiver.ts` — archives raw session audio and the debug bundle
  through the `StorageService`; implements the pipeline's `PipelineArchive`
  port, so the dependency runs root → pipeline only.
- `entities/` — TypeORM entities (registered in `database/data-source.ts`).

## `pipeline/`: audio → notated measures

A dependency-injection-free transcription pipeline (its only NestJS import is
the `Logger` from `@nestjs/common`). It imports nothing from the root: its one
outward dependency is the `PipelineArchive` port, declared in
`recording-pipeline.ts` and implemented by `recording-archiver.ts`.

| Stage              | Files                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decode             | `audio-decoder.ts` — ffmpeg to mono f32 PCM, one-shot and streaming                                                                                                                                                                                                                                                                                                       |
| Profile lock       | `profiles/` — `pitch-scan.ts` and `reverberance.ts` (measurements), `source-classifier.ts` (voice vs instrument, stock YAMNet), `profile-resolver.ts` (routing policy and the detection-decode contract), `pipeline-profile.ts` (bands, overlays, provider names), `instrument-ranges.ts` (score-instrument hints; twin of packages/notation's `Instrument` ids)          |
| Pitch inference    | `providers/` — the `ModelBackend` seam (`local-model-backend.ts` TF.js, `remote-model-backend.ts` gRPC, `create-model-backend.ts` picks one; `composite-model-backend.ts` is the unwired seam for a second model), the CREPE providers (`crepe-provider.ts`, octave-down `crepe-pitchdown-provider.ts`), `crepe-decoding.ts`, `provider-registry.ts`, `pitch-provider.ts` |
| Trajectory → notes | `pitch-track.ts`, `semitone-segmenter.ts` (instruments), `voice-note-decoder.ts` (voice)                                                                                                                                                                                                                                                                                  |
| Cleanup            | `audio-converter.ts` (one pass: provider + shipping cleanup set), `note-extractor.ts`, `onset-detector.ts`                                                                                                                                                                                                                                                                |
| Notation           | `mxml-builder.ts` (bars and metrical duration spelling), `voice-notation.ts` (`TakeSpelling` for sung takes), `mxml.types.ts` (the emitted subset of packages/notation's `model/io/MusicXml.ts`, pinned by `test/recordings/recording-editor-contract.test.ts`)                                                                                                           |
| Orchestration      | `recording-pipeline.ts` (one per session: profile lock, streaming passes, emission, archive)                                                                                                                                                                                                                                                                              |
| Debug              | `recording-debug-renderer.ts` (the archived pitch plot)                                                                                                                                                                                                                                                                                                                   |
| Shared             | `note-event.ts`, `env.ts` (env overrides), `describe-error.ts`                                                                                                                                                                                                                                                                                                            |

Eval-only research code (e.g. `NoteSegmenter`) lives in `scripts/eval/lib`, not here.

The adaptive profile (band, provider, gates, voice routing) is locked from the
first ≥1.2 s of _pitched_ audio — a silent or spoken lead-in defers the lock (up
to `RECORDING_DETECT_MAX_WAIT_SEC`, 8 s) and a take that still locked the blind
fallback is re-resolved over the whole take on the final pass.

The pipeline is tuned and regression-gated by the eval harness in
`scripts/eval` (see `scripts/eval/README.md`; the product benchmark and its
committed results live in `scripts/eval/benchmarks/`), which imports it directly.
