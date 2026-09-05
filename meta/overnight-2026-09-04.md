# Overnight session — 2026-09-04 → 05 (branch `experimental`)

Autonomous improvement pass while Karel sleeps. Goal: spend the remaining weekly
budget on launch-relevant improvements; resolve open TODOs; document as I go.
Baseline at start: type-check clean, 1453 unit tests green (notation 884, playback
79, web 257, api 220, admin 13).

Each entry: **what** → **why it matters** → **verification**.

> **TL;DR for the morning** (details per numbered item below; everything is
> committed on `experimental`, every suite green at the last run — notation
> 1845 / api 247 / web 388 unit tests, mocked e2e across chromium/webkit/mobile,
> `pnpm build` passes, real-stack verification 11/11):
>
> **Launch blockers & safety**
>
> 1. Signup CAPTCHA (Turnstile) shipped and verified end-to-end with Cloudflare's
>    test keys — needs the two real keys (§4, §17).
> 2. Inference outage → user is told, credits stop metering (§6). API error
>    tracking into PostHog — needs `POSTHOG_API_KEY` (§7).
> 3. Production image no longer ships `.env.development` + dev recordings;
>    1.38 GB → 793 MB (§8). Runbooks corrected (§5).
> 4. Terms/privacy paragraphs for share links (legal text I wrote — please
>    read), admin can revoke a reported link (§18).
>
> **Product**
>
> 5. `/pricing` route with FAQ + structured data (§2); GDPR "Download my data"
>    (§3); "Takes" — replay/delete your recordings, per score in the editor and
>    across scores in Settings (§11, §23); read-only share links `/s/<token>` with
>    playback, export and "Save a copy" (§12).
>
> **Bugs found by new property/fuzz suites (all fixed)**
>
> 6. Instrument swapped on reload for 17 instruments; key mode lost (§1).
> 7. Importer: incomplete tuplet bars stayed short; a garbled duration made it
>    allocate without bound (§16). MIDI cap lowered (a garbled file stalled 14 s).
> 8. Editor: dotting a sixteenth corrupted the bar for good; pasting tuplets
>    left bars short; the last bar could be removed (§19); a meter change could
>    leave an interior bar short (§21).
> 9. **Recording:** a 6/8 (or 2/2) take was cut into bars twice the editor's
>    length, and bars could come out a sixteenth short — the API's bar
>    arithmetic ignored the meter's denominator and rounded per note (§20).
> 10. **Ties:** a tie into a rest or another pitch was drawn and, in playback and
>     MIDI export, held the note through the rest while the neighbour fell silent;
>     ties now bind only the same sounding pitch (§24). Open: minimize-accidentals
>     is not idempotent (§24).
>
> **Also:** load-test harness + first numbers (§10), opt-in Spot inference
> component (§9), marketing launch kit (§13), code-review fixes (§14), analytics
> events for the new surfaces, a shared score brings a new signup back to itself
> (§22). Nine property/fuzz suites now guard the model, importers, editor and
> the recording→editor contract (~1,400 seeded cases).
>
> **Morning (your suggestions):** bulk e-mail answered and built — admin
> **Announcements** page (filtered audience, live count, CSV export, test send,
> confirmed send, sandboxed preview, `**bold**`/`[link](url)` markup) over
> transactional SendGrid; marketing mail goes CSV → SendGrid Marketing
> Campaigns (§25). Burst plan for the last 20 minutes of the week:
> `meta/burst/burst-plan-2026-09-05.md` (prompt at its top).
> Browser QA on the real stack of the editor (desktop + phone), Share/Takes
> popovers, landing, `/pricing` and a live shared page: clean, one design note
> about the cookie banner over the dock (§26).
> Last minutes: three more fuzz suites (announcement markup escaping, CSV
> export, `?next=` redirect) — the last one found and fixed an **open redirect**
> via backslash normalisation (§27).
>
> **Needs you (config, not code):** Turnstile keys, `POSTHOG_API_KEY`, decide
> beta users' fate, run the load test in remote-inference mode, review the
> Docker/lockfile change before the next deploy (runtime moved to `/app` via
> `pnpm deploy`; `posthog-node` added), read the three legal paragraphs (share links ×2, service e-mail in the privacy policy).
>
> **Side note:** the Docker disk filled up during my image builds and crashed
> your local Postgres container; I freed ~63 GB of build cache and untagged
> layers (nothing tagged of yours) and it recovered cleanly (§15).

## 1. Generative round-trip suite for the notation model — 2 persistence bugs fixed

- **What:** `packages/notation/tests/model/util/RoundTrip.test.ts` — a seeded
  generator builds random valid scores (all 11 meters, all 17 clefs, keys −7..7
  with modes, dotted values, triplets, ties, mid-bar clef/key changes, tempo
  marks, barlines, every selectable instrument) and asserts three paths give
  the same score back, 150 seeds each: JSON save/load (what the API stores),
  MusicXML export→import (exact, and the importer must not warn about our own
  files), MIDI export→import (sounding events, meters, tempo marks).
- **Bugs it found (fixed in the same commit):**
    1. _Instrument swapped on reload._ `ScoreDeserializer` resolved the instrument
       by General MIDI program before its name; 17 of the 51 selectable
       instruments share a program with an earlier-registered one (bass
       clarinet→clarinet, French horn→horn in C, alto flute→dizi flute,
       violoncello→cello, euphonium→baritone horn, contrabassoon→bassoon, …).
       Since transposition is per instrument, a French-horn score sounded a fifth
       off after every save. Name now decides; program only for foreign files.
    2. _Key mode lost._ A mode-only key change (C major → A minor, same fifths)
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
  `vitest`, `react`, `mongodb` as _optional_ peers and pnpm's
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

## 11. Takes: replay and delete your recordings (master-todo #22)

- **What:** API `RecordingsController` — `GET /recordings?scoreId=` (owner's
  takes, newest first, `hasAudio` flag), `GET /recordings/:id/audio` (302 to a
  signed bucket URL when the backend signs, else streamed with the right
  content type), `DELETE /recordings/:id` (audio folder first, then the row —
  a failed storage delete keeps the row so nothing is orphaned). Web: a
  "Takes" chip in the editor header (next to Export) opens a glass panel with
  date, duration, play/pause (single `Audio` element, cookie rides same-site)
  and an inline two-step delete; the mobile header gets the icon-only chip.
- **Why:** audio has been archived since July with no user-facing way to hear
  or remove it — the privacy policy's "yours, delete any time" had only the
  nuclear option (delete the account). Also simply useful: hear the take you
  just sang against the notation it produced.
- **Verification:** 7 API unit tests (scoping, audio resolution incl. signing
  fallback, delete ordering/failure), editor e2e test (list, disabled play on
  audio-less take, keep/delete flow, toast, Escape) — see the commit for the
  run; api 243 / web 266 unit tests green.

## 12. Read-only share links (`/s/<token>`) — new product feature

- **What:** migration adds a unique nullable `shareToken` to scores. Owner
  endpoints `POST/DELETE /scores/:id/share` (mint once, stable until turned
  off; 96-bit url-safe token); public `GET /shared/:token` (no auth; unknown,
  revoked and malformed tokens all answer 404 alike, malformed ones never hit
  the DB). Editor header gets a "Share" chip: turn link on, copy, turn off.
  New public page `/s/[token]`: title, the engraved score read-only (reflows
  on phones like the editor), the Export menu (PDF/MusicXML/MIDI for the
  recipient), a "Start free / Open library" path; `noindex`, robots
  disallow `/s/`, middleware allowlist.
- **Why:** the ICP doc's trigger moment is literally "can you send me the
  chart?"; until now the only way was exporting a file. A link the recipient
  can open on a phone, hear back (export → their player) and download is the
  natural growth loop for a notation tool, and costs no account.
- **Verification:** 5 API unit tests (mint/idempotence, ownership,
  revoke+re-mint, public payload without owner, 404 parity + DB shielding),
  editor e2e (turn on → link → turn off), shared e2e (renders read-only with
  export + CTA; unknown token explains itself). Web 266 / API suites green.
- **Also:** a signed-in visitor gets "Save a copy" on the shared page — the
  score lands in their library as an editable score of their own (the plan's
  score cap applies; the server's refusal message is shown).
- **Later the same night:** playback on the shared page after all — a lean `useSharedPlayback` hook over the editor's `Transport.playScore` (stop / play–pause buttons in the header, cursor on the score, always from the top); e2e covers the toggle. Not done: expiring links / passwords — YAGNI until asked.

## 13. Security pass over the new surfaces (manual; the `/security-review` skill needs a remote)

- `GET /shared/:token`: unauthenticated by design; token shape validated
  before any query (`^[A-Za-z0-9_-]{16,64}$`), 96-bit random tokens, 404 parity
  for unknown/revoked/malformed, global per-IP rate limit (120/min) applies,
  payload = title/updatedAt/document only (no owner). Web page is `noindex`,
  robots-disallowed.
- `GET /recordings/:id/audio`, `DELETE /recordings/:id`, `POST/DELETE
/scores/:id/share`: `AuthGuard` + `BetaApprovalGuard`, ownership checked in
  the service (403 for another user's row, 404 for unknown), UUID pipe on ids;
  signed audio URLs expire after 15 min.
- CAPTCHA: verification server-side (better-auth plugin, Cloudflare
  siteverify); `x-captcha-response` passes CORS (Nest reflects requested
  headers). Unset secret → warning, never a silent bypass in production logs.
- Error tracking sends method/path/status/user id/request id — no bodies,
  headers or cookies. Exception messages may contain SQL text (standard).
- Image: `.env*` and dev storage no longer ship (see §8).
- Screens checked at 1280 and 390 px: editor header with the three chips,
  Takes and Share panels, shared page, pricing page.

## 14. Code review of the branch (`/code-review master medium`) and fixes

- Three of eight review angles completed before the session limit cut the
  rest (the skill spawns eight agents — it cost ~20% of a session window; the
  correctness angles did not finish, so the unit/e2e suites remain the
  correctness gate for tonight's work).
- **Acted on:** one `useDismissablePopover` hook replaces the three copied
  Escape/outside-click scaffolds (Export/Share/Takes menus); one
  `downloadBlob`; one `formatRecordingTime` for takes, budget meter and
  limit dialog (they disagreed on rounding); one exported `describeError`
  instead of five private copies; the archiver's container table now drives
  both sniffing and replay content types; public shared loads no longer
  prime the edit cache (anonymous visits caused cache writes + a cron
  rewrite); data export loads 4 documents at a time (150 parallel requests
  would have tripped the 120/min rate limit); PostHog batches (flushAt 20)
  and shuts down within 5 s; shared page derives its score with `useMemo`;
  deleting a take no longer refetches a list it just patched; dead
  `captchaSecretKey` removed; `ScoreDocument` type shared; pricing nav CTA
  copy aligned with the landing nav.
- **Deliberately not done:** persisting the audio object key on the
  Recording row to save a bucket list per replay (needs a migration for a
  per-click cost that is fine at current scale — noted for later); merging
  the load-test harness with `test-recording-ws.ts`; extracting a shared
  marketing nav (three small variants exist; worth doing when a fourth
  appears).

## 15. Real-stack verification (`/verify`, Postgres + API :4200 + web :3250, beta off)

11/11 checks passed against the real API (not the mocked e2e origin):
migration `ScoreShareToken` applied on `db:reset` (column + unique index);
`POST /scores/:id/share` 201 → `/s/<token>` renders the seeded "Twinkle
Twinkle" read-only in a fresh anonymous browser context (no Record button),
MusicXML export downloads from it, `GET /shared/<token>` answers title /
updatedAt / document only; malformed and unknown tokens 404; `DELETE share`
200 → the link shows the not-found state and a later share mints a new token;
`GET /recordings?scoreId=` 200 `[]` with the empty state in the Takes panel
(no takes exist in the seed — the delete path is covered by unit + mocked e2e
only); `GET /recordings/<unknown uuid>/audio` 404, non-uuid 400, without a
session 401; Settings → "Download my data" produced `solkey-export-2026-09-05.zip`
(21 KB, the demo library); `/pricing` shows the three cards, Arranger and the
FAQ. No API warnings or 4xx/5xx besides the intended ones during the run.

Side finding: the Docker disk had filled up during the night's image builds
and crashed the local Postgres container (recovered cleanly after freeing
~63 GB of build cache and dangling images; nothing of yours was removed —
only build cache and untagged layers).

## 16. Layout fuzz + import robustness fuzz — 2 more importer bugs fixed

- **What:** the seeded score generator moved to
  `tests/model/util/scoreGenerator.ts`; two new property suites (150 seeds
  each): `LayoutFuzz` lays out every generated score at 340/600/1000 units
  and walks every coordinate the renderer reads (notes, stems, flags, beams,
  ties, tuplets, keys, clefs, tempos, rows) for finiteness and sane packing;
  `ImportRobustness` mutates our own MusicXML (truncation, dropped or
  duplicated elements, garbage numbers, stripped attributes, reordered
  nodes) and demands either a score whose bars all add up or one of the
  importer's three friendly errors.
- **Found + fixed (MusicXmlImporter):** (1) a bar left with an incomplete
  tuplet group (one triplet note lost) could not be completed with plain
  rests and stayed short — bars are now padded in the tuplet's own space when
  that lands back on the sixteenth grid, else the trailing tuplet note is
  dropped and the bar padded (new user-facing warning); (2) a garbled huge
  `<duration>` or tiny `<divisions>` made the speller allocate rests without
  bound (a vitest worker died of OOM) — notes and forwards over 64 beats are
  dropped with the existing "could not be read" warning. Both a user-upload
  hardening and a client-side DoS fix.
- **Layout engine:** no finding — 150 scores × 3 widths, all finite and
  packed in reading order (the one failure was my test asking for layouts
  of key signatures the renderer never draws).
- **Verification:** notation 1641/1641 with the 100% model coverage gate.

## 17. CAPTCHA verified end-to-end with Cloudflare's test keys

Real stack with `TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA`
(always passes) on the API and the matching test site key on the web:
`POST /api/auth/sign-up/email` without the header → **400 `MISSING_RESPONSE`**;
with a token → 200; sign-in untouched (200). In the browser the widget renders
in the signup form ("Success!" from the test key), the submit button stays
disabled until it passes, the request carries `x-captcha-response`, signup
lands on onboarding. Only the real keys remain (runbook §1).

## 18. Share links: legal wording + admin revoke (launch safety)

- Terms §5 and Privacy §2 now describe share links honestly: private unless
  the owner turns the link on; anyone with the link can view, play back and
  download the score (never the recordings, never the owner's name or
  e-mail); not indexed; off immediately when turned off; we may disable a
  reported link. `LAST_UPDATED` bumped to 5 September 2026 on both pages —
  **please read these two paragraphs; they are legal text I wrote for you.**
- Admin console score page shows the share-link state (`/s/<token>`) with a
  "Turn link off" action → `DELETE /admin/scores/:id/share` (owner-agnostic,
  behind `ADMIN_SECRET`), the support lever for an abuse/DMCA-style report.
  API + admin unit tests cover it.

## 19. Editor fuzz (random edit sequences + undo/redo) — 3 editor bugs fixed

- **What:** `apps/web/tests/app/ScoreManipulatorFuzz.test.ts` — 120 seeds ×
  5–25 random edits through the real `ScoreManipulator` (pitch nudges,
  durations, dots, tuplets, ties, rests, accidentals, remove, delete
  selection, copy/paste, add/remove measure, tempo/clef/key/meter) asserting
  after every step: no bar over-full, none short by a triplet sixteenth or
  more, every note attached; then undo-all == the starting document and
  redo-all == the final one, byte for byte.
- **Found + fixed:** (1) **dotting a sixteenth** left the bar short by a
  thirty-second — permanently, since no rest can fill it. `Score.setDuration`
  now refuses a dotted sixteenth and the Dotted chip is disabled for them.
  (2) **pasting tuplet notes over plain ones** padded the gap in the wrong
  tuplet ratio and left bars short by a sixth or a twelfth. `Score.replace`
  now tries plain, then the pasted notes' ratio, then the replaced notes'
  ratio for an exact fill, and every touched bar settles itself afterwards.
  (3) `removeMeasure()` could remove the last remaining bar (the UI disabled
  the button; the manipulator now refuses too).
- **Model:** the grid-aware bar completion moved onto `Measure.complete()`
  (one implementation for new bars, edits, pastes and imports) and is
  deliberately non-destructive: an inexpressible residue smaller than a
  sixteenth stays rather than a note being dropped — the trade-off the
  existing rebar tests already encoded. The MusicXML importer delegates to it.
- **Also:** MIDI import cap 10,000 → 2,000 bars (a garbled file took 14 s to
  import — the fuzz timed out); popover panels move focus in on open and back
  to the trigger on close; library rows show a link icon on shared scores.
- **Verification:** notation 1845/1845 with the 100% model gate, web 388
  unit tests (fuzz 120/120), import/MIDI/layout fuzz all green.

## 20. Recording → editor contract fuzz — 2 recording bugs fixed; .mxl reader fuzz clean

- **What:** `apps/api/test/recordings/recording-editor-contract.test.ts` feeds
  150 random monophonic takes (ragged real-world timing, every meter the
  recorder offers, all transpositions, voice spelling on/off) through the
  API's `MxmlBuilder` and loads the result with the notation model both as a
  whole document and bar by bar exactly as `useRecording` applies streamed
  `score-update`s. Also `apps/web/tests/lib/MxlArchive.fuzz.test.ts`: 200
  damaged `.mxl` containers — the zip reader never escapes its friendly errors.
- **Found + fixed (MxmlBuilder):** (1) **bar length ignored the meter's
  denominator** — a 6/8 take was cut into bars of six quarter-notes instead
  of three (2/2 into two instead of four), so streamed bars were twice too
  long/short for the editor's bars and spilled; the spelling side already
  used the right length, the bar arithmetic now does too (and the debug plot).
  (2) **bars a sixteenth short**: onsets and releases were spelled after
  independent rounding, leaving cursor drift; boundaries now snap to the
  sixteenth grid before spelling, and a note shorter than half a sixteenth
  keeps one sixteenth instead of vanishing. 4 targeted builder tests.
- **Hygiene:** the notation model imported `getGlyphWidth`/`getYFor…` through
  the React components barrel; nine files now import the two helper modules
  directly, so the model type-checks in a non-JSX consumer (the API's tests).
- **Verification:** api 403 (contract fuzz 150/150), notation 1845, web
  fuzzes green; both type-checks clean.

## 21. Fuzz extension, rebar settle, speller property

- Editor fuzz now 200 seeds × 5–40 edits incl. transpose / minimize
  accidentals / instrument change, respecting the 23-step undo depth. It
  found one more: after a meter change, `MeasureRebar` completed only the
  last bar, so a tuplet cut at an interior barline could leave that bar a
  triplet-sixteenth short although a rest fits — every rebar bar now settles
  (non-destructively). `DurationSpeller` property (300 seeds, 12 meters):
  written values always sum exactly to the span, never fragment absurdly —
  no finding.
- Running totals: notation 2146, api 403, web 588 unit tests, all green.

## 22. Shared score → signup → back to the score

A visitor without an account who opens a shared score and clicks "Start free"
now returns to that score after onboarding (where "Save a copy" waits):
signup carries the safe `?next=` path the login page already understood into
`/onboarding`, and onboarding's finish/skip honour it. One `nextPathFrom` /
`withNext` pair (same-origin absolute paths only) replaces the inline check
in the login page; unit-tested, e2e asserts the CTA destination.

## 23. All your recordings in Settings → Your data

`TakesList` (replay + two-step delete) is now a shared component used by the
editor's Takes panel and a new recordings inventory in Settings → Your data:
the count of archived takes across all scores, expandable into the list with
each take's score title, playable and deletable one by one — the recordings
half of "your data", since the download deliberately leaves audio out.
`GET /recordings` without `scoreId` backs it. Settings e2e covers list +
delete; editor e2e unchanged and green.

## 24. Edit invariants + a tie-semantics fix; one open finding

- **Edit invariants** (`EditInvariants.test.ts`, 150 seeds each): meter
  change there-and-back keeps every sounding event; transpose up-then-down
  keeps every pitch and rhythm and moves each attack by exactly the interval;
  minimizing accidentals never changes what sounds.
- **Found + fixed — dangling ties sounded and drew:** `Score.tiePartner`
  bound a tied note to whatever followed, even a rest or another pitch (easy
  to create: tie a note, then change or rest the next one; the Tie action
  also let you tie into a different pitch). The next note was then treated
  as a continuation — drawn tie into a rest, and in playback and MIDI export
  the first note held through the rest while a different-pitch neighbour
  went **silent**. A tie now binds only to the next note of the same sounding
  pitch (C♯→D♭ included); a stray mark is inert and re-binds if the neighbour
  changes back; explicit imported `stop`s count only with a tying
  predecessor; the Tie action only ties where a tie can bind. Existing tie
  tests were adjusted to same-pitch partners; new tests cover the dangling
  cases, MIDI export and playback.
- **Open finding (not fixed):** `minimizeAccidentals` is not idempotent — the
  key choice ranks candidates on the notes' _current_ spellings, which the
  pass then changes, so a second press can move a key signature again
  (seed 2 of the invariant suite shows a mid-bar key vanishing and a leading
  key 2→0). Sound and bars are untouched either way; the fix (rank on
  sounding pitch classes) touches `AccidentalMinimizer` and deserves a
  deliberate change with its own tests.
- Totals now: notation 2600, playback 79, web 670, api 403 unit tests.

## 25. Bulk e-mail: recommendation + Announcements tool (your morning suggestion)

- **Recommendation:** both, split by intent. _Service announcements_ ("the
  beta ends on …", terms changes, downtime) from a small tool in the admin
  console over our existing transactional SendGrid integration; _marketing_
  mail via a CSV export of the same audience into SendGrid Marketing
  Campaigns, which already has the contact lists, unsubscribe groups,
  templates and stats that marketing mail legally and practically needs.
  SendGrid draws the same line (Email API for transactional/programmatic,
  Marketing Campaigns for bulk marketing) and caps a Mail Send request at
  1,000 personalizations — sources: the personalizations and product docs
  linked in my message.
- **Built:** admin `/announcements` — audience filter (plans, beta status,
  signup window, active-in-N-days, verified only; deletion-requested
  accounts excluded by default) with live count + sample and **Export CSV**;
  subject + plain-text body with `{{name}}`; **Send test** to one address;
  confirmed **Send to N accounts**; history with "Reuse". API:
  `GET /admin/audience`, `GET /admin/audience/export.csv`,
  `POST /admin/announcements` (test or real), `GET /admin/announcements`;
  `MailService.sendAnnouncement` = one personalization per recipient, batches
  of 500, first-name substitution, standard layout + account footer;
  `announcements` audit table (migration). One SQL fragment drives count,
  sample, CSV and send, so the preview is exactly who receives it.
- **Verification:** 10 new API unit tests (filter SQL, CSV quoting, test vs
  real send, empty audience refused, batching 1201 → 500/500/201, rendering,
  first-name safety); real stack: migration applied, count/CSV/test-send/
  validation/401 checked with curl, console page renders and its data calls
  answer 200. The runbook's "email them before they notice" now points here.
- **Borrowed from zeus's e-mail editor (concepts, not code):** a **sandboxed
  iframe preview** of the exact rendered mail (`POST /admin/announcements/
preview`, rendered for a sample recipient "Ada", debounced 400 ms, with a
  plain-text tab), and light inline markup instead of a WYSIWYG dependency:
  `**bold**` and `[label](https://…)` (http/https only; everything else stays
  escaped text; plain-text copy shows "label (url)").
- **Partial-send safety (added after the report):** a SendGrid batch that is
  rejected mid-run no longer aborts the whole request with nothing recorded — the
  worst case for a 5,000-account mail, because a retry would double-send to
  everyone in the earlier batches. The remaining batches still go out, the
  history row records who was reached (`recipientCount`) and who was not
  (`failedCount`, new column via migration), the console shows the failed count
  and the SendGrid error next to the send, and only a run that reached nobody is
  an error (502). The unreached addresses are kept on the row, and the history
  offers **"Resend to N not reached"** (`POST /admin/announcements/:id/retry`):
  a new row with `filters: { retryOf }`, the original list emptied first so a
  double click cannot double-send. Six new unit tests; retry verified on the
  real stack (201 → 400 on the second click → 404 for unknown ids).
- **Seen in a browser (Playwright against API :4200 + a console on :3510):**
  audience count and sample, live preview rendering bold + link + "Hi Ada", the
  history row, no console/HTTP errors. Screenshot sent in chat. Fix from the
  screenshot: markup is now flattened in the **subject** (no stray `**`).
- **Privacy policy** now names "notices about changes to the service or your
  plan" as essential service e-mail (not marketing, no unsubscribe while the
  account exists) and lists service announcements under SendGrid — please read
  that sentence. The console's audience defaults to **verified addresses only**.
- **Not built (deliberately):** unsubscribe management, templates, open/click
  stats — that is Marketing Campaigns' job; the page says so — and no rich
  HTML editor: for service announcements, escaped text + bold + links is the
  safer surface.

## 26. Visual QA of the editor on the real stack (desktop + phone)

- **What:** Playwright against API :4200 + web :3250 (fresh worktree), demo
  account, "Twinkle Twinkle": desktop 1440×900 with the Share and Takes
  popovers open, Pixel 7 phone view. Checked: no console/page errors, no
  horizontal overflow on either viewport, header fits the phone width exactly,
  chips collapse to icons on the phone, both popovers render their empty/intro
  states correctly.
- **Finding (design, not a bug):** with consent still undecided the cookie
  banner (a `.glass-panel`, 85% white + blur per DESIGN.md) sits over the
  bottom tool dock; on the phone the dock chips and the record button show
  through it and the text is busy. Normally the banner is answered on the
  landing/login page first, so the editor rarely shows it — but a first-time
  user who ignores it will see this. Options if you care: an opaque surface
  for the banner only (a DESIGN.md exception), or lifting the banner above the
  dock on editor routes. Left unchanged — DESIGN.md is authoritative.
  Screenshot sent in chat.

- **Public pages, same run:** landing and `/pricing` on a Pixel 7 (no overflow,
  titles right), a live `/s/<token>` page desktop + phone (title, transport,
  download, "Start free"; the tagline under the score; reflow to two systems on
  the phone), `/s/not-a-real-token` shows the "doesn't open anything" state; the
  link was turned off again afterwards (DELETE 200). No page errors beyond the
  expected 404 fetch. "Save a copy" only appears for a signed-in visitor, as
  designed — an anonymous visitor gets "Start free" and returns to the score
  after signup (§22).

## 27. Announcement markup — escaping fuzz (last minutes of the session)

- `apps/api/test/mail/announcement-markup.fuzz.test.ts`: 2,000 seeded paragraphs
  mixing the `**bold**` / `[label](url)` syntax with hostile fragments
  (`<script>`, `javascript:`/`data:` URLs, quote-breakouts, spoofed `<a>`),
  asserting the rendered HTML never contains a tag other than `<strong>` and an
  http(s) `<a>`, and every `href` is http(s) with no quote or angle bracket. A
  whole hostile body rendered through `renderAnnouncement` is checked paragraph
  by paragraph. Green on first real run (two false alarms were my own
  assertions about the plain-text copy, which correctly keeps literal text).
- `apps/api/test/admin/audience-csv.fuzz.test.ts`: 300 seeded audiences with
  names built from quotes, commas, newlines, formula prefixes and unicode; the
  CSV is parsed back with an RFC 4180 reader and every cell must round-trip
  (formula-looking names gain the leading apostrophe), no cell may start with
  `= + - @`. Green.
- **Open redirect fixed (found by a new fuzz in the last minutes):**
  `nextPathFrom` accepted `?next=/\evil.example` — a single leading slash, but
  browsers normalise the backslash to a slash, so the post-login redirect would
  have left our origin. The guard now also lets the platform URL parser decide
  (`new URL(next, dummy).origin` must stay the dummy origin).
  `apps/web/tests/lib/nextPath.fuzz.test.ts` (3,000 seeded values) guards it.
- The burst plan now branches off the tag **`burst-base-2026-09-05`**
  (`04de72e`, verified green) and guards its merge target, per your note.

## Burst plan for the last 20 minutes of the week

`meta/burst/burst-plan-2026-09-05.md` — ten independent, worktree-isolated
agent tasks with hard stops (agents 09:57, orchestrator 09:59), a launch
prompt at the top, and merge rules. Priority order at the bottom.
