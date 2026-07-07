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

## Task 2 — editor layout (endless-scroll canvas + tool dock rework)

- **Canvas**: removed the scroll area's vertical padding (`pt-6 pb-32`) so the manuscript
  canvas runs edge-to-edge between header and dock and `min-h-full` keeps it at least
  viewport-height — the paper now reads as one endless scroll with no visible bottom edge.
- **Dock**: considered a left vertical tool rail (scales best for many future tools, à la
  MuseScore palettes) vs. an in-flow bottom bar. Chose the **in-flow bottom bar**: it keeps
  every existing horizontal control component and the popovers-open-upward pattern, fixes
  the overlap *by construction* (it's part of the flex column, not floating), and absorbs
  button growth by wrapping into additional rows. A side rail would be a bigger visual
  departure I didn't want to make without the designer in the loop — if tool count truly
  explodes, revisit the rail; noted in master-todo.
- DESIGN.md and design/README.md updated (they prescribed the floating dock; per standing
  feedback those docs must stay authoritative, so the rulebook changed with the code).
- e2e invariants kept: `role=group[name="Note tools"]`, `role=group[name="Note duration"]`.
- e2e suite could NOT be run in this session: the user's `next dev` (port 3200) holds
  Next's dev lock, and a second dev instance of the same app dir refuses to boot.
  Verified by type-check + full unit suite instead; run `pnpm -F @mushee/web e2e` once
  the dev server is stopped.

## Task 3 — transport restructure + replay-during-recording bug

- **Root cause of the bug**: all four tick units (ScoreScheduler, Metronome,
  CursorManager, RecordingEngine) were added to ONE shared Ticker at page mount and
  never scoped per mode. Starting a recording called `ticker.play()`, which reset and
  ran the scheduler too — still holding `score`/`startNote` from the last playback —
  so existing notes replayed into the take.
- **Fix**: new `Transport` class (src/lib/Transport.ts) owns MidiPlayer + Ticker + the
  three units and assembles the tickables per mode: playback = scheduler + cursor
  (+ metronome when toggled), recording = engine + metronome (always clicks).
  `Ticker.play(tickables, onFinish)` now takes the pass's set explicitly — nothing
  ambient survives between passes, so the bug is impossible by construction.
- Secondary races fixed: (a) `Transport.record` bails after the mic prompt if stop()
  ran meanwhile (no zombie clock/metronome pass); (b) the note-preview effect no longer
  calls stopAll on selection *clear* — the recording flow deselects as it starts, and
  the old unconditional stop could kill the take it was setting up (timing-dependent).
- Metronome gained `syncTo(elapsed)` so toggling it on mid-playback doesn't
  burst-schedule every elapsed click (previous latent bug).
- RecordingEngine internals untouched (its 46-test suite still pins mic/WS behavior);
  the messiness addressed was the coordination layer. Waveform React-ification is
  task 4's follow-up.
