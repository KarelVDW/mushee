# Overnight session — 2026-09-04 → 05 (branch `experimental`)

Autonomous improvement pass while Karel sleeps. Goal: spend the remaining weekly
budget on launch-relevant improvements; resolve open TODOs; document as I go.
Baseline at start: type-check clean, 1453 unit tests green (notation 884, playback
79, web 257, api 220, admin 13).

Each entry: **what** → **why it matters** → **verification**.

## 1. Generative round-trip suite for the notation model — 2 persistence bugs fixed

- **What:** `packages/notation/tests/model/util/RoundTrip.test.ts` — a seeded
  generator builds random valid scores (all 11 meters, all 17 clefs, keys −7..7
  with modes, dotted values, triplets, ties, mid-bar clef/key changes, tempo
  marks, barlines, every selectable instrument) and asserts three paths give
  the same score back, 150 seeds each: JSON save/load (what the API stores),
  MusicXML export→import (exact, and the importer must not warn about our own
  files), MIDI export→import (sounding events, meters, tempo marks).
- **Bugs it found (fixed in the same commit):**
  1. *Instrument swapped on reload.* `ScoreDeserializer` resolved the instrument
     by General MIDI program before its name; 17 of the 51 selectable
     instruments share a program with an earlier-registered one (bass
     clarinet→clarinet, French horn→horn in C, alto flute→dizi flute,
     violoncello→cello, euphonium→baritone horn, contrabassoon→bassoon, …).
     Since transposition is per instrument, a French-horn score sounded a fifth
     off after every save. Name now decides; program only for foreign files.
  2. *Key mode lost.* A mode-only key change (C major → A minor, same fifths)
     carried into later bars via `lastKey` but was "redundant" for drawing and
     serialization, so the inherited mode vanished on reload. Redundancy checks
     and the serializer's change detection now include the mode.
- **Verification:** notation suite 1338/1338 green, model coverage gate (100%)
  holds, eslint clean. Commit `f44e912`.
- **Known, documented non-losses:** MIDI import keeps at most one tempo mark
  per bar (a mid-bar change in a bar that already had one at its downbeat is
  dropped) and cannot rebuild trailing all-rest bars — inherent to MIDI, the
  test encodes both.

## 2. `/pricing` route (master-todo #18)

- **What:** pricing section extracted to `PricingSection.tsx` (shared with the
  landing page), new `/pricing` route with metadata + canonical, offers +
  FAQPage JSON-LD, an 8-question pricing FAQ (`pricing/faq.ts`, single source
  for page and structured data), closing CTA; footer + landing nav link,
  sitemap entry, middleware allowlist.
- **Why:** a linkable, indexable pricing page is table stakes at launch (ads,
  search, "how much is it?" replies); the landing hides the ladder in beta
  mode and the route inherits that switch, so it is safe to ship now.
- **Verification:** type-check/lint clean, new `e2e/pricing.spec.ts` (2 tests)
  green. Fixed along the way: the mocked e2e suite depended on the developer's
  `.env.development` (beta mode on → landing spec red locally); the Playwright
  web server now pins `NEXT_PUBLIC_BETA_MODE=false`.

## 3. GDPR "Download my data" (master-todo #14)

- **What:** `lib/AccountExport.ts` — `ZipWriter` (stored-entry zip, UTF-8
  names, CRC-32) + `AccountExport` (profile.json, settings.json,
  scores/index.json, every score as `.musicxml` and `.json`, README). Settings →
  Account → "Your data" section; privacy policy names the path.
- **Why:** the policy promises portability; the product offered nothing at
  account level. Client-side build reuses existing endpoints — no API change,
  no server zip pipeline, MusicXML conversion runs on the same exporter the
  editor uses (and the round-trip suite from §1 now guards).
- **Verification:** 6 unit tests (zip verified through the independent
  `MxlArchive` reader + CRC reference vector), settings e2e asserts a real
  download; 12/12 affected e2e green.

## 4. Signup CAPTCHA — Cloudflare Turnstile (master-todo #15, launch blocker)

- **What:** API installs better-auth's official `captcha` plugin
  (`auth/captcha-config.ts`) on `/sign-up/email` when `TURNSTILE_SECRET_KEY`
  is set; production boot warns when it isn't. Web renders a `Turnstile`
  widget on the signup form when `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is set,
  disables submit until solved, sends the token as `x-captcha-response`,
  remounts the widget after a rejected attempt (tokens are single-use).
  Privacy policy lists Cloudflare as a processor; env examples + production
  secret runbook updated.
- **Why:** the end-of-beta runbook calls this a blocker for the BETA_MODE
  flip: without approval, signup is an open faucet with e-mail sending.
  Scope kept to signup only (sign-in and reset are rate-limited and would
  need the widget on their forms too) — extend `CAPTCHA_ENDPOINTS` with the
  pages if that changes.
- **Remaining for Karel (config only):** create the Turnstile widget
  (managed mode, domain solkey.io), set the two keys, sign up once for real.
- **Verification:** api + web type-check/lint clean; 4 new API unit tests
  (plugin installed/omitted, production warning), 2 web component tests
  (widget lifecycle), auth e2e green with no site key (widget absent).

## 5. Runbook hygiene (end-of-beta launch)

- The runbook still described the pre-relaunch catalogue (Composer $8 /
  Studio $18, four products, beta tier "300 credits = 5 min"). Corrected to
  the 2026-07 relaunch: Songwriter/Studio/Arranger monthly+yearly, three
  minute packs, `order.paid`/`order.refunded` webhooks, pack env vars, beta
  tier 1800 credits (30 min — which, as now noted there, out-gives
  Songwriter, so grandfathering beta users means they never need to pay).
  Checklist rows updated for the CAPTCHA, data export and the error-tracking
  state (web half exists, API half doesn't).

## 6. Inference outage: user signal + credits stop burning (launch-day risk)

- **What:** `RecordingPipeline.setOnHealth` fires on the first failed
  transcription pass and on the next success; `RecordingSession` pauses the
  credit meter while degraded and settles the waived wall-clock/audio time so
  the catch-up never bills it retroactively (hard caps still count raw time);
  the gateway sends a `recording-health {ok}` frame (no internal error text
  crosses the wire); the web engine forwards it and the recorder toasts
  "Transcription is unavailable… not charging for this time" / "back".
- **Why:** both runbooks named this the known product gap: an inference
  outage looked like "I sang it wrong" and burned the daily budget for
  nothing; the launch runbook asked for this before any launch traffic.
- **Verification:** 3 new API session tests with fake timers (per-second
  billing, pause/resume without retro-billing, single client notification,
  post-close reports ignored), 1 web engine test; api+web type-check/lint
  clean. Follow-up idea: a persistent banner instead of a toast for long
  outages.

## 7. API error tracking (runbook pre-flight item)

- **What:** `apps/api/src/telemetry/` — `ErrorReporter` seam (no-op unless
  `POSTHOG_API_KEY`), PostHog-backed implementation via `posthog-node`
  `captureException`, global `ReportExceptionsFilter` (unknown errors + 5xx →
  tracker with method/path/status/user/request id, then Nest's default
  response), `uncaughtExceptionMonitor` crash hook that keeps fail-fast exit.
  Env docs, production secret list, runbook updated.
- **Why:** the web half existed (`capture_exceptions`), the API half didn't;
  the launch runbook lists it as pre-flight. Same PostHog project → one place
  for both halves of an incident. New dependency: `posthog-node`.
- **Remaining for Karel:** `POSTHOG_API_KEY` in `Secret/api-secrets`, enable
  Error tracking in the PostHog project.
- **Verification:** 9 unit tests; API suite 236/236; type-check/lint clean.

## 8. API image hygiene + slimming (DevOps / security)

- **Found:** the production API image shipped the developer's
  `apps/api/.env.development` (real dev keys), the local `storage/` dir
  (14 MB of dev recordings and scores), `src/`, `test/`, `scripts/` — the
  Dockerfile copies `apps/api` wholesale and `.dockerignore` didn't cover
  them. It also carried the whole workspace's dependency store: Next.js +
  two SWC binaries (~370 MB), vitest, happy-dom, mongodb, TypeScript, the
  Nest CLI. Root cause for the web packages: better-auth declares `next`,
  `vitest`, `react`, `mongodb` as *optional* peers and pnpm's
  auto-install-peers resolved them from the workspace into the API's
  production graph (`pnpm why --prod next` showed it).
- **Fixed:** `.dockerignore` excludes `**/.env*` (keeps `.env.example`),
  `apps/api/{storage,test,scripts,coverage}`, test artifacts. Root
  `pnpm.overrides` remove the optional peer edges (`better-auth>next: "-"`,
  `better-auth>vitest`, `*>mongodb`) — lockfile −73 lines, web unaffected
  (it depends on next directly; react/react-dom peers left alone because
  `better-auth/react` needs them). Dockerfile assembles the runtime tree with
  `pnpm deploy --prod` into `/app` (API files + prod deps only, workspace
  proto package copied in). `pnpm prune --prod` was tried first and emptied
  the API's node_modules on a filtered install — documented in the Dockerfile.
- **Verification:** image boots (reaches the DB retry with a proper
  message), modules/proto resolve, no `.env`/storage/next in the image; all
  suites green after the lockfile change (api 236, web 266, notation 1338).
  Size: **1.38 GB → 793 MB** (−43%); local tag `mushee/api:slim` left for inspection.

## 9. Opt-in Spot capacity for inference (cost lever)

- `deploy/k8s/components/spot-inference/` — kustomize Component putting the
  CREPE pods on GKE Spot (nodeSelector + toleration + 25 s grace). Not
  enabled: with the 1-replica production floor a preemption is a 1–3 min
  transcription blip (now user-visible and unbilled thanks to §6); the
  README explains the trade-off and suggests a floor of 2 when enabling.
  Rendered through `kubectl kustomize` against the production overlay.

## 10. N-session recording load test (master-todo #13)

- `apps/api/scripts/load-test-recording.ts` (`pnpm --filter @mushee/api
  load:recording`, env `SESSIONS`, `RAMP_MS`, `AUDIO_SECONDS`,
  `CREPE_INFERENCE_URL`). Real-time-paced fixture streaming, per-session
  first-notes latency, pass p50/p95/max, finalize time; process peak RSS and
  event-loop lag; JSON summary + verdict against the 1 s pass cadence.
  `RecordingPipeline.stats` exposes the timings.
- Local, in-process, 2 sessions: first notes ~3.4 s, pass p50 ~315 ms,
  p95 365 ms, peak RSS 359 MB, loop lag 478 ms (WASM inference blocks the
  loop — production is remote; size pods from a remote-mode run against the
  inference service).
