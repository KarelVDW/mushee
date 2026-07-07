# Agent notes — autonomous TODO run (2026-07-07)

Running as **Claude Fable 5** (`claude-fable-5`). Per instruction, work only proceeds while
this model is doing it; any subagents spawned inherit the same model (no model overrides used).
If that condition can't be met, work stops and this file records where.

This file collects decisions made under uncertainty and other considerations, per task.

## Task 1 — recording audio storage (rclone → provider interface + GCS)

- **Provider selection**: `STORAGE_DRIVER=gcs|local`, defaulting to `gcs` when `GCS_BUCKET`
  is set and `local` otherwise. GCS authenticates via Application Default Credentials
  (workload identity / `GOOGLE_APPLICATION_CREDENTIALS`) — no key handling in code.
  A `LocalStorageProvider` (filesystem) replaces the old "rclone with a plain path"
  trick that docker-compose and the k8s local overlay depended on.
- **Streaming**: encoded audio chunks are forwarded to storage the moment they arrive
  (`RecordingArchiver.appendAudio` → provider write stream, non-resumable GCS upload).
  Memory stays flat; the pipeline no longer retains encoded chunks after the streaming
  decoder is seeded.
- **Path scheme**: `recordings/<userId>/<scoreId>/<recordingId>/audio.<ext>` plus
  `plot.svg`, `score.json`, `session.json` (the debug bundle). `<ext>` sniffed from the
  container magic bytes (added mp4/ftyp for Safari).
- **Local debug dir removed**: the pipeline's dev-only `RECORDINGS_DEBUG_DIR` file dump
  is gone — the archiver now stores the same bundle in storage in every environment,
  and in dev the storage backend is the local filesystem anyway. Eval scripts construct
  pipelines directly and never read the debug dir, so nothing breaks.
- **Failure policy**: archiving is best-effort — a storage outage logs a warning and the
  recording continues. Account purge storage deletion is NOT best-effort (throws), so a
  failed purge is reported as failed rather than silently orphaning audio.
- **GDPR**: `deleteAllForUser` now also deletes `recordings/<userId>/` from storage.
  Privacy policy / terms / landing copy rewritten: audio IS stored, tied to the account,
  used to improve transcription, deleted with the account. The old copy promised
  in-memory-only processing, which task 1 explicitly reverses.
- Added `storagePath` column to `recordings` (migration 1783555200000) so each row
  points at its archive folder.
