# Project notes — runbooks, decisions, gotchas

Consolidated 2026-07-08 from `AFTERTHOUGHTS.md`, `PRODUCTION-READINESS.md`,
`API-CONCURRENCY.md`, `agent-notes.md`, `structure-report.md`, and the original
`TODO.md` (all deleted; full text in git history). Completed work and historical
bug-fix logs were dropped; what remains is still-true reference material.
**Open work lives in [master-todo.md](master-todo.md), not here.**

---

## 1. Launch configuration runbook

### Polar (billing)

- Create 4 subscription products: Composer $8/mo, $80/yr, Studio $18/mo, $180/yr.
  Entitlements (names, credit budgets) are DB-driven via `subscription_tiers` +
  `GET /plans`; **display** prices/icons live in `apps/web/src/lib/plans.ts` —
  change Polar products, the seed, and plans.ts together.
- API env: `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET`, `POLAR_SERVER`
  (`sandbox` while testing), `POLAR_PRODUCT_<TIER>_<INTERVAL>` ids, `WEB_APP_URL`
  (checkout redirects).
- Webhook endpoint in the Polar dashboard: `<api-url>/billing/webhooks/polar`,
  subscribed to `subscription.*` + `customer.state_changed`.
- Unconfigured Polar degrades gracefully: `/billing/*` answers 503, the UI hides
  paid actions, free/beta tiers keep working.
- Sandbox test before launch: checkout → webhook → tier flips in Settings;
  cancel → resume; plan switch (`POST /billing/change` updates the existing
  subscription with proration — never creates a second one).

### PostHog (analytics / replay / errors)

- EU Cloud project; key in `NEXT_PUBLIC_POSTHOG_KEY`, host defaults to
  `https://eu.i.posthog.com`. Enable Session replay + Error tracking in the
  project settings (client already consent-gates replay and masks all inputs).
- Events are proxied through `/ingest` (`apps/web/next.config.ts`) to dodge ad
  blockers.
- Custom events emitted: `signup_completed`, `onboarding_completed`,
  `recording_started`, `checkout_started`, `plan_change_started`,
  `subscription_cancel_started`, `landing_cta_clicked`.

### Beta mode

- API: `BETA_MODE=true`, `ADMIN_EMAILS=you@domain`; web: `NEXT_PUBLIC_BETA_MODE=true`
  (server's runtime `betaMode` is also trusted, so ending the beta doesn't
  strictly require a web rebuild).
- Flow: signup → `betaStatus='pending'` on the `beta` tier (300 credits = 5 min/day)
  → waitlist email + admin notification → onboarding works while pending →
  `/beta` waiting room (polls 30 s) → approve at `/admin` → approval email →
  room unlocks. Pending users are blocked server-side from `/scores` and from
  opening a recording socket.
- Admin account: sign up with an email in `ADMIN_EMAILS` (role + approval stamped
  at signup, gets the Studio tier since admins test recording a lot). For an
  existing account:
  `UPDATE "user" SET role='admin', "betaStatus"='approved' WHERE email='...';`
- `betaStatus` semantics: stamped `pending` at signup while beta is on; `null`
  means "predates the beta / not applicable" — flipping the flag on later never
  locks out existing accounts, flipping it off un-gates everyone with no data
  changes. Beta users then stay on the `beta` tier until migrated:
  `UPDATE user_subscriptions SET "tierId"='free' WHERE "tierId"='beta';`
- Local dev: `demo@mushee.local` is seeded as admin; demo accounts pre-approved.

### Domain / legal placeholders

- Placeholder identity "Sheemu Music BV, Voorbeeldstraat 12" + unowned
  `support@`/`privacy@`/`hello@`/`legal@sheemu.app` mailboxes appear in
  `/privacy`, `/terms`, `/contact`, settings, and transactional email bodies —
  grep for `Voorbeeldstraat` and the mailboxes when replacing.
- Pick one canonical domain and align everything: `NEXT_PUBLIC_SITE_URL`
  (drives sitemap/robots/OG), the mail from-address, and DNS (SPF/DKIM/DMARC
  for SendGrid). Governing law is set to Belgium in the ToS (guessed).

### Deploy-time musts (code is ready, config is yours)

1. Topology `sheemu.app` + `api.sheemu.app`; `COOKIE_DOMAIN=.sheemu.app`. The
   proxy accepts both `__Secure-` and plain cookie names, but the cookie must
   *reach* it — same parent domain required. Smoke-test one real HTTPS login first.
2. `POSTGRES_SSL=require` (or `verify` + `POSTGRES_SSL_CA`) against managed
   Postgres; enable PITR/backups and rehearse one restore.
3. Production `api-secrets` needs real Polar/beta/mail values; README
   § Deployment lists every env var, including the ones still missing from
   `apps/api/.env.example` (env files are permission-protected in agent
   sessions): `POSTGRES_SSL*`, `POSTGRES_POOL_SIZE`, `TRUST_PROXY`,
   `COOKIE_DOMAIN`, `RATE_LIMIT_*`, `MAX_BODY_BYTES`, `RECORDING_MAX_SECONDS`,
   `RECORDING_MAX_ENCODED_BYTES`, `LOG_FORMAT`, `STORAGE_DRIVER`, `GCS_BUCKET`.

---

## 2. Architecture decisions (and why)

- **Native NestJS Polar integration**, not the `@polar-sh/better-auth` plugin:
  the plugin routes webhooks through the better-auth handler, which re-serializes
  JSON bodies and breaks standard-webhooks signature verification. Instead a
  custom body parser in `main.ts` preserves `req.rawBody`; deliveries are deduped
  via `processed_webhook_events` (dedupe + apply in one transaction, so a failed
  apply gets a clean Polar retry); the tier is mirrored into `user_subscriptions`
  from both `subscription.*` events and `customer.state_changed` snapshots.
  Customers are keyed by `externalCustomerId = userId`. Ordering guard: Polar's
  `modified_at` is compared per event and strictly-older snapshots are skipped;
  `customer.state_changed` reconciles unconditionally (authoritative) and resets
  the marker; equal timestamps re-apply (idempotent).
- **DB-driven tiers**: `subscription_tiers` table served through a 60 s in-memory
  cache — tier lookups run once per second per live take and must not hit
  Postgres each tick, yet a production re-tune lands within a minute. Unknown
  tier ids fall back to `free`. Web split: entitlements from `usePlans()`,
  display decoration static in `plans.ts`; the landing page is deliberately
  fully static with fallbacks that should stay roughly in sync with the seed.
- **Credits bill `max(wall-clock, decoded-audio seconds)`** — closes the
  faster-than-real-time streaming exploit without making a stalled decoder free.
  WS ping/pong (30 s) kills dead peers so they stop burning budget.
- **Recording storage**: `StorageProvider` seam (`STORAGE_DRIVER=gcs|local`,
  GCS via Application Default Credentials — no keys in code). Encoded chunks
  stream to storage as they arrive, so memory stays flat. Path scheme:
  `recordings/<userId>/<scoreId>/<recordingId>/audio.<ext>` + `plot.svg`,
  `score.json`, `session.json`. Archiving is best-effort (storage outage logs a
  warning, the recording continues) but account-purge deletion **throws** on
  failure rather than silently orphaning audio; `deleteAllForUser` removes the
  whole `recordings/<userId>/` prefix. The privacy policy was rewritten to match:
  audio IS stored, tied to the account, deleted with it.
- **`Transport` class** (`apps/web/src/lib/Transport.ts`) owns MidiPlayer +
  Ticker + tick units and assembles the tickable set per mode (playback =
  scheduler + cursor ± metronome; recording = engine + metronome). Nothing
  ambient survives between passes — the notes-replay-into-recording bug is
  impossible by construction. `Metronome.syncTo(elapsed)` exists so toggling it
  mid-playback doesn't burst-schedule elapsed clicks.
- **Octave normalization on recording** (chosen over setting the clef from the
  recording — the clef is a deliberate user choice, and whistling sits above any
  comfortable clef anyway): whole-octave shift putting the median incoming pitch
  nearest the staff middle line, decided at the take's first score-update and
  locked for the whole take (emitted measures are frozen server-side). Trade-off:
  a first update with one edge-of-range note can pick a ±1-octave-off shift;
  consistency won. Model behavior: `Pitch.octaveShifted(n)`,
  `Clef.octavesToCenter(pitches)`.
- **Waveform bars** are React elements (`RecordingWaveformStore` via
  `useSyncExternalStore`; RecordingEngine only emits samples), positions resolve
  from the live layout at render time. Bars alternate brand cyan/magenta — a
  documented exception to the no-accents-in-canvas rule (transient,
  export-excluded) in DESIGN.md + design/README.md; worth a designer sanity-check.
- **Editor chrome**: in-flow bottom tool dock chosen over a left vertical rail —
  it keeps the horizontal controls and popovers-open-upward pattern and fixes
  the old overlap by construction. If tool count truly explodes, revisit the rail.
- **Consent design**: one `analytics` category (PostHog bundles analytics,
  replay, error tracking — one purpose), versioned via `CONSENT_VERSION` so
  changing what you track re-prompts everyone. PostHog initializes opted-out
  with in-memory persistence (nothing stored pre-consent); withdrawal calls
  `posthog.reset()`. Server-side error reports run on legitimate interest.
  PostHog `identify` sends the account id only — policy says "pseudonymous".
- **Landing honesty**: one plan catalogue (three divergent copies consolidated),
  feature lists trimmed to what the backend enforces (recording time), fabricated
  testimonials removed. The hero is a hand-built animation
  (`apps/web/src/app/HeroDemo.tsx`); to use real footage, record the editor,
  export `.mp4`/`.webm` into `apps/web/public/`, and swap `<HeroDemo />` for a
  `<video autoPlay muted loop playsInline>`.
- **Mail fails fast**: missing `SENDGRID_API_KEY` aborts boot in production
  (signups dead-end at OTP otherwise). A deliberately mail-less prod environment
  would need an escape hatch. On OTP-send failure at signup, the flow proceeds to
  onboarding (which can re-send) — the account already exists at that point.
- **Logging**: Nest 11 built-in JSON `ConsoleLogger` + Fastify pino request logs
  (zero new deps); `LOG_FORMAT` overrides. `main.ts` (API) and
  `instrumentation.ts` (web) are the hook points for an error-tracking vendor.
- **subscriptions vs billing modules**: complementary — subscriptions owns the
  data model + catalogue, billing owns the Polar integration and writes through
  `SubscriptionsService`; `polar/subscription-state.ts` lives in billing because
  it speaks Polar.
- **Deliberate keeps**: model weights in git (~5 MB, `SOURCE.md` provenance;
  LFS only if the repo needs slimming); plain non-DI modules (`beta-config.ts`,
  postgres-ssl helper) where config must be readable outside the Nest container;
  Nest wiring intentionally not unit-tested (logic layers are; the recording
  pipeline is eval-gated per `apps/api/scripts/eval/README.md`);
  `fixtures/test.webm` is a used binary fixture.

---

## 3. Known quirks & gotchas

- **Session cookie cache is 5 min** — `session.user.role`/`betaStatus` can lag.
  Never use them for enforcement; every gate that matters reads fresh DB state
  (`/beta/status`, `BetaApprovalGuard`, recording gateway).
- **`RecordingSession` cap is wall-clock via the meter tick** — a socket that
  never sends audio is closed by the WS keepalive, not the cap. Fine, but know it.
- **Editor `handleRecordToggle`**: if `cursorEl` is missing it bails *after*
  inserting the count-off measure. Cosmetic and rare (ref exists once the score
  renders); deliberately left alone.
- **A tier added only in the DB** shows the free tier's display decoration
  (icon/prices) in pickers until `plans.ts` learns about it (documented in the
  plans.ts header).
- **Waveform exit animation** relies on `onAnimationEnd`; under forced
  reduced-motion setups exiting bars can linger until the next take resets the
  store. Accepted as negligible.
- **CI** (`.github/workflows/ci.yml`) was authored but is unexercised until it
  runs on GitHub — expect small path/cache wrinkles on the first run. The e2e
  job installs chromium + webkit; delete it initially if you want a faster gate.
- **Rate limiting is per-replica in-memory** — effective cluster-wide limit is
  `max × replicas` and resets on restart. With `TRUST_PROXY` the keys are
  correct, and OTP is capped at `allowedAttempts: 5` in better-auth, which is
  the real guard; Redis store only if brute-force pressure shows in logs.
- **`verify:recording-integration` paces audio at real time** on purpose — the
  server bills `max(wall-clock, decoded-audio)`, so a faster-than-real-time
  stream "over-bills" by design.
- Playwright e2e needs the dev server stopped: `next dev` holds Next 16's
  single-instance dev lock (suites run on alt ports 3100/3300 but the lock is
  per app dir).

---

## 4. Per-pod concurrency backlog

Technical detail behind master-todo item 13 (the N-session load test — measure
first, everything below except §1 came from code-reading, not measurement).
The inference split already moved the TF forward pass off the API event loop;
API replicas share state via Postgres and scale horizontally. What remains sets
the practical per-pod ceiling, in priority order:

1. **Bounded per-session buffers** (memory — the certain one). Per-session
   memory grows ~14 MB/min: `StreamingDecoder` keeps all decoded PCM
   (`ensureCapacity` doubling in `pipeline/audio-decoder.ts`, ~5.3 MB/min) and
   `CrepeSession` caches activations for the whole recording
   (`pipeline/providers/crepe-provider.ts`, ~8.6 MB/min). The pipeline freezes
   committed audio and only re-transcribes a trailing window, so both buffers
   can drop everything behind the committed watermark (ring buffer / trim).
   `RECORDING_MAX_SECONDS` (1 h) caps the growth, but 1 h ≈ 840 MB — a few
   long unlimited-tier recordings still OOM a 512 Mi pod.
2. **Cheap wins**: aligned `Buffer.copy` + `Float32Array` views instead of
   per-element `readFloatLE` loops (decoder ingest, `RemoteModelBackend.bytesToF32`;
   `unflatten` also builds `number[][]` garbage per pass — keep flat typed
   arrays if `outputToNotesPoly` tolerates row views). Lazy-`import()`
   `LocalModelBackend` so production pods don't pay TF.js memory/boot they never
   use. Add an HPA for the `api` Deployment — only the inference services have
   HPAs today.
3. **Event-loop DSP → worker pool**: per windowed pass, CREPE framing +
   Viterbi/segmentation, basic-pitch `outputToNotesPoly`, NoteExtractor,
   MxmlBuilder still run on the main thread (tens of ms per pass → roughly low
   hundreds of active recordings per pod before socket latency degrades). Move
   post-forward decode work to `worker_threads` with transferable ArrayBuffers.
4. **ffmpeg process per session** (~10–20 MB each at hundreds of sessions).
   Options by ambition: accept it and raise pod limits; in-process WASM Opus
   decode inside the §3 worker pool; browser sends PCM from an AudioWorklet
   (deletes server decode, ~5× upload bandwidth).
5. **Postgres write batching**: ~2 writes/s per active session (credit tick,
   lock heartbeat, debounced JSONB cache upsert). Fine at hundreds; at
   thousands, batch the credit tick onto the 5 s heartbeat (up to 5 s limit
   overshoot).
6. **Inference gRPC health probes**: the services expose a custom `Health` RPC
   but k8s probes are still `tcpSocket`. (API-side graceful drain is done:
   `enableShutdownHooks`, gateway drains sessions on SIGTERM,
   `terminationGracePeriodSeconds: 60`.)

---

## 5. Audit trail (what was verified, 2026-07)

- **2026-07-05 production-readiness audit** (six dimensions, adversarial): every
  blocker/high/medium was fixed except B5 (backups — ops), B6 (legal values —
  owner), M17 (PNG icons — assets), M19 (image slimming), all tracked in
  master-todo. Full finding list + fix checklist: git history of
  `meta/PRODUCTION-READINESS.md`.
- **Verified solid then** (no action needed): authz on every controller, no
  IDOR, roles not client-writable, webhook signatures over raw bytes with replay
  dedup, parameterized SQL, no path traversal, no committed secrets, strict DTO
  validation, non-wildcard CORS; atomic recording lock takeover + heartbeat,
  server-authoritative credits; consent-first PostHog clean pre-opt-in, deletion
  flow matches the 7-day promise; typed query hooks, error boundaries, billing
  UI wired.
- **2026-07-08 structure pass**: every module grades clean (billing, recordings,
  web pages restructured; repo-wide `eslint .` zero errors incl.
  `apps/api/scripts/**`). Details: git history of `meta/structure-report.md`.
- **End-to-end verification after the pass**: mocked Playwright 32/32
  (chromium + webkit), full-stack smoke 2/2 against a live stack,
  `pnpm verify:recording-integration` all checks passed. API 85 / web 923 unit
  tests, model 100%-coverage gate green, both builds clean. Still open from
  master-todo item 10: visual QA of the new UI and one real recorded take on
  prod infrastructure (streaming GCS archive path).

---

## 6. Old TODO.md items that did not make master-todo

The original go-live TODO predates Polar/beta decisions; most items shipped or
were superseded. These open ones were not carried into master-todo — promote
them there or drop them deliberately:

- Uptime monitoring on `/health` (BetterStack/UptimeRobot); status page once
  there are paying customers.
- Support inbox + help docs (the `support@` mailbox itself is master-todo item 1).
- Admin/support tooling beyond beta approval: look up a user, see/comp credits,
  refund a charge.
- Refund/dunning policy (failed-payment retry, grace period before downgrade);
  trial / free-tier positioning decision.
- DPAs with subprocessors (Polar, hosting, SendGrid, GCS).
- Browser/device support matrix (getUserMedia needs HTTPS; decide on mobile
  recording).
- MIDI export (cheap once MusicXML export is solid); About/Blog/Changelog pages.
