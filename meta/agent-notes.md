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

## Task 4 — waveform bars as animated React elements

- RecordingEngine no longer paints SVG: it emits `WaveformSample`s (timeMs,
  measureIndex, beat, amp 0..1) via `onSample`. A `RecordingWaveformStore`
  (useSyncExternalStore) holds the bars; the `RecordingWaveform` component inside the
  score SVG subscribes directly, so 30Hz samples re-render only that layer.
- Positions resolve at render time from the live layout — bars stay glued to their
  beat when rows reflow as measures fill.
- **Brand colors**: bars alternate loud cyan `#00DBE9` / magenta `#FF2079` at 0.55
  opacity, stable per-bar via a sequence number (array-index parity would flicker as
  bars are removed). This contradicts the old sanctuary rule (no accents in canvas);
  per the explicit request I carved a documented exception into DESIGN.md +
  design/README.md (transient, export-excluded). Worth a designer sanity-check.
- Animations (globals.css): enter = 200ms scaleY grow-in; idle = 1.4s gentle sway;
  exit = grow to full staff height (per-bar `--waveform-burst` factor) then fade,
  as the user suggested. `transform-box: fill-box` makes scaleY center on each bar.
- **Removal trigger**: on each `score-update`, after replacing a measure's notes, bars
  in that measure with beat < end-of-last-non-rest-note animate out. On take end
  (state → idle) all remaining bars exit together; a new take resets the store.
- Caveat: if CSS animations never run (e.g. forced-reduced-motion setups), exiting
  bars rely on `onAnimationEnd` and could linger until the next take resets them —
  accepted as negligible.

## Task 5 — recorded notes with extreme ledger lines

Investigated the two requested options:

**(a) Set the clef from the recording** — the backend already detects the register
(adaptive profile lock) and could emit a clef, or the frontend could infer one from
the incoming range. Rejected because: the clef is a deliberate user/instrument choice
(a trumpet part stays in treble no matter how low you hum the idea); the backend's
MxmlBuilder has no clef concept, and mid-take clef changes would fight the editor's
clef controls; and it doesn't even solve the common case — whistling sits 1–2 octaves
above *any* comfortable clef, so you'd still get ledger lines after a clef swap.

**(b) Normalize the recording's octave to the current clef** — chosen. Octave error is
inherent to how people capture ideas (whistling +1/+2 octaves, humming an octave low);
users think in the staff they're looking at. The shift is whole octaves only, so the
notation stays lossless in pitch-class/spelling; the sung contour is preserved exactly.

Implementation: written-pitch space (server already applies chromaticTranspose), on the
frontend where the clef is known. New model behavior (OO per house rules):
`Pitch.octaveShifted(n)` and `Clef.octavesToCenter(pitches)` — the whole-octave shift
that puts the *median* incoming pitch nearest the staff's middle line (line 3; one
octave = 3.5 lines). The shift is decided at the take's FIRST score-update (from its
pitched notes' median) and locked for the whole take — emitted measures are frozen
server-side, so re-deciding later would leave earlier measures at a different octave.
Trade-off: a first update with a single edge-of-range note can pick a ±1-octave-off
shift; consistency was judged more important than a perfect late decision.

## Task 6 — database-driven tiers

- New `subscription_tiers` table (id, name, dailyRecordingCredits, sortOrder, sellable),
  seeded by migration 1783641600000 with the four previously hard-coded tiers. The old
  static `SubscriptionTier` class is gone; the entity replaces it, and
  `SubscriptionsService` serves the catalogue from a 60s in-memory cache (tier lookups
  run once per second per live take — they must not hit Postgres each tick, yet a
  production re-tune still lands within a minute). Unknown/legacy tier ids still fall
  back to `free`.
- Public `GET /plans` exposes id/name/dailyRecordingCredits/sellable (same info as the
  pricing page — no auth).
- Web split: **entitlements** (names, budgets, which tiers exist) come from `usePlans()`;
  **display decoration** (icons, taglines, display prices, marketing feature lines)
  stays static in lib/plans.ts keyed by id. Onboarding, ChangePlanDialog, and the
  recording-limit dialog now iterate the API's sellable tiers (static list bridges the
  pre-fetch moment). The landing page stays fully static per the task ("valid for the
  landing page"), with `dailyRecordingSeconds` fallbacks that should be kept roughly in
  sync with the seed.
- Known limit: a brand-new tier added only in the DB will show up in pickers with the
  free tier's *display* decoration (icon/prices) until plans.ts learns about it — real
  prices live in Polar config, which is code/env anyway. Documented in plans.ts header.

## Task 7 — structure evaluation

- Full details in [structure-report.md](structure-report.md). Three parallel surveys
  (API / web / root+deploy) ran as subagents inheriting this session's Fable model.
- Judgment calls: `ARCHITECTURE.md`, `DESIGN.md`, `design/`, `e2e/README.md` stay
  colocated (living reference docs, not dev-to-dev communication); status/audit/handoff
  docs moved to meta/. `verify-recording-integration.mjs` kept (documented verification
  path) despite looking orphaned. `design/assets/icons/{file,globe,window}.svg` are
  starter-SVG duplicates but live inside the protected design system — left alone.
- No module graded *very messy*, so per the brief only small safe fixes were applied
  (health module folder, dead files); billing/recordings/editor-page refactors are
  ranked in the report + master-todo instead.

## Task 8 — master-todo

- meta/master-todo.md consolidates all open work into a phased beta-launch roadmap.
  meta/TODO.md is now historical (most items shipped; Stripe items superseded by Polar).

## End-of-run verification status

- Every commit verified with type-check + full unit suites (API 49, web 919, model
  coverage gate green). The Playwright e2e suites could NOT run in this session — the
  user's `next dev` on :3200 holds Next's dev lock the whole time. **Run
  `pnpm -F @mushee/web test:e2e` (and the fullstack smoke) before deploying** — the
  editor-layout and waveform changes touch surfaces those suites pin.
