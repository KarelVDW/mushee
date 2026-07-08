# Production Readiness Review — 2026-07-05

Consolidated result of a six-dimension audit (security, backend robustness, frontend,
infrastructure/deploy, GDPR/compliance, build+test verification) of the full working tree.

**Verdict: not ready to launch yet.** The codebase is in good shape — all 919 unit tests
pass, both apps type-check and build cleanly, and the security baseline (authz, IDOR,
webhook signatures, input validation) held up under adversarial review — but there is one
active data-loss bug, one "app is unusable on HTTPS" bug, and a set of known operational
gaps (CI, backups, observability).

---

## Blockers

- **B1 — Score-flush cron destroys user data.** `jsonToMusicxml` in
  `apps/api/src/scores/scores.service.ts:137-144` is a stub returning
  `json.raw ?? '<score-partwise></score-partwise>'`; real cached score JSON has no `.raw`
  key. The 10-minute flush cron (`apps/api/src/cron/cron.service.ts:37-72`) writes the
  empty placeholder to storage and deletes the only real copy from `cached_scores`. Every
  score idle 10+ minutes is permanently emptied.
- **B2 — Auth breaks entirely on an HTTPS deploy.** `apps/web/src/proxy.ts:15` reads the
  cookie `better-auth.session_token`, but better-auth renames it to
  `__Secure-better-auth.session_token` under HTTPS; and with web/API on different hosts the
  web middleware never receives the cookie at all (no `crossSubDomainCookies`). Every
  signed-in user gets bounced to `/login` in production.
- **B3 — Database connection can't use TLS.** `apps/api/src/database/data-source.ts` has no
  `ssl` option and no env var to enable one; managed Postgres typically requires it.
  Related split-brain: better-auth + seeder read `POSTGRES_URL` but TypeORM ignores it.
- **B4 — No CI.** No `.github` directory at all; none of the currently-green gates run
  automatically.
- **B5 — No Postgres backup story.** Nothing in `deploy/`, no dump CronJob, no restore
  procedure.
- **B6 — Placeholder legal identity.** "Sheemu Music BV, Voorbeeldstraat 12" and unowned
  `@sheemu.app` mailboxes in `/privacy`, `/terms`, `/contact`, settings page, and
  transactional email bodies (`apps/api/src/mail/mail.service.ts`).

## High priority

Reliability / crash risks:

- **H1 — Unhandled rejection on WS connect can kill the replica.** The `openSession` chain
  at `apps/api/src/recordings/recordings.gateway.ts:88` has no `.catch`; DB error during
  connect → process crash; acquired recording lock never released on that path.
- **H2 — No recording length/byte cap → OOM.** `pipeline/recording-pipeline.ts` retains every encoded
  chunk for the session lifetime; decoder buffer unbounded; unlimited-tier users can
  accumulate ~0.7 GB+/hour until the pod OOMs.
- **H3 — No graceful shutdown.** `enableShutdownHooks()` never called; every rolling update
  kills recordings mid-take.
- **H4 — `/health` checks nothing and k8s probes are `tcpSocket`.** A replica with a dead
  DB connection stays in rotation.

Billing correctness:

- **H5 — Webhooks marked processed before apply.** `billing.service.ts:201-208`; a failed
  apply is never retried (Polar retry swallowed as duplicate) — e.g. a dropped
  `subscription.revoked` leaves a paid tier active. Related: non-atomic subscription
  upsert (PK race), no out-of-order event guard.
- **H6 — Credits meter wall-clock, not audio.** `recording-session.ts:103-136`: a scripted
  client streaming 20× real time pays 30 s of credits for 10 min of transcription; no WS
  ping/pong means a dead peer keeps burning the daily budget.

Security:

- **H7 — `trustProxy` not set.** All clients share one IP bucket behind the ingress;
  brute-force rate limiting on login/signup/OTP is defeated.
- **H8 — Email OTP brute-forceable.** 6-digit OTP, 10-min validity, no per-account attempt
  cap in our code; signup CAPTCHA still open.
- **H9 — Containers run as root, no `securityContext`.** API shells out to ffmpeg on
  untrusted audio.
- **H10 — Base manifests use mutable `:latest` + `IfNotPresent`.** Deployed fixes can
  silently not take effect.
- **H11 — Demo seeder one env var from prod.** No `NODE_ENV=production` refusal; public
  password `mushee-demo`; studio/unlimited demo account.

Frontend silent failures:

- **H12 — WS failure during recording is completely silent.**
  `RecordingEngine.ts:283-293`: no error surfaced, cursor keeps sweeping, chunks silently
  dropped.
- **H13 — Failed autosave loses edits while toast claims "We'll keep trying".**
  `Score.ts:437-470` clears the dirty set before the request is sent; mutation never
  retries or re-dirties.
- **H14 — Signup OTP-send failure strands the user on a frozen form.**
  `signup/page.tsx:30-36`: on error nothing runs, `loading` stays true forever.

Compliance consistency:

- **H15 — From-address domain mismatch.** Fallback `no-reply@mushee.app` vs everything else
  `sheemu.app`.
- **H16 — "Anonymized" replays vs `posthog.identify(email, name)`.**
  `analytics.ts:76-80` contradicts both the privacy policy and its own doc comment.
- **H17 — Account purge swallows storage/Polar deletion failures.** "Permanent" GDPR
  deletion can orphan MusicXML files and the Polar customer with no retry.
- **H18 — No API observability.** Default console logger, no request logging, no error
  tracking, no metrics.

## Medium / low

- **M1** — Inference services drop in-flight RPCs on SIGTERM; bare `print()` logging.
- **M2** — Cron jobs double-run on both API replicas (no leader election / advisory lock).
- **M3** — Flush lost-update race: cache delete not guarded by staleness threshold
  (`cron.service.ts:50-63`), user edits between read and delete are lost.
- **M4** — `processed_webhook_events` + `recording_usage` grow forever (no prune).
- **M5** — No Ingress/TLS manifests, no PodDisruptionBudgets, no NetworkPolicies;
  unauthenticated plaintext gRPC between pods.
- **M6** — Onboarding hard-blocks users who deny/lack a microphone (step 1 requires
  `granted`; only escape abandons all remaining steps).
- **M7** — Beta-mode flag baked into web build (`NEXT_PUBLIC_BETA_MODE`); ending beta
  requires a rebuild; AuthGate ignores the server's `betaMode` field it already receives.
- **M8** — No `not-found.tsx`; unknown URLs show the unbranded Next default (signed-out →
  bounced to /login).
- **M9** — Mic stream leaks when stop/unmount races `getUserMedia`
  (`RecordingEngine.ts:146-147` early-return while state is still `idle`).
- **M10** — Last ≤100 ms recording chunk always dropped (`stop()` closes WS before
  MediaRecorder's final `dataavailable`).
- **M11** — Purged users' rows linger in the `verification` table (no FK, purge never
  touches it).
- **M12** — `RECORDINGS_DEBUG_DIR` re-enables raw-audio persistence even in production;
  should fail closed.
- **M13** — Privacy policy doesn't disclose session IP/user-agent collection.
- **M14** — 10 eslint errors in `apps/api/src` (auth `any`-safety + 2 type-hygiene).
- **M15** — Pre-session WS frame buffer unbounded while auth resolves
  (`recordings.gateway.ts:73-83`).
- **M16** — Proxy redirect drops the original destination (no `?next=`); public-path
  prefixes match with bare `startsWith` (no segment boundary).
- **M17** — Manifest icon is a single SVG (`sizes: 'any'`); no PNG/maskable fallback, no
  `favicon.ico`.
- **M18** — Unconfigured SendGrid logs full OTP/reset-link email bodies; should hard-fail
  in production.
- **M19** — API runtime image ships the entire build workspace incl. dev deps; env-example
  gaps (`RATE_LIMIT_*`, `MAX_BODY_BYTES`, `RECORDING_DEBOUNCE_MS`, `RECORDINGS_DEBUG_DIR`);
  base images pinned by tag not digest.
- **M20** — Advisory-lock migration runner acquires/releases on a pool (works only because
  `destroy()` closes the session); storage `rclone` calls have no timeout; connection pool
  sizes unpinned (2× default 10 per replica).

## Verified solid (no action needed)

- Authz on every controller, no IDOR, roles not client-writable, webhook signatures over
  raw bytes with replay dedup, parameterized SQL, no path traversal, no committed secrets,
  strict validation, non-wildcard CORS.
- Concurrent-recording lock (atomic Postgres takeover + heartbeat), server-authoritative
  credit deduction, recording cleanup paths, bounded gRPC failure handling, raw audio never
  persisted in production (modulo M12).
- Consent-first PostHog verified clean pre-opt-in; cookie table accurate; deletion flow
  matches the 7-day promise; no card data touches the app; transactional-only email.
- Frontend: typed query hooks everywhere, error boundaries, billing UI fully wired, SEO
  basics present, a11y fundamentals in place.
- Verification: lockfile in sync, type-check clean, 34/34 API + 885/885 web tests, coverage
  gate passing, both builds clean. (Mocked e2e blocked only by the live `next dev` holding
  Next 16's single-instance dev lock.)

---

## Checklist

### Blockers
- [x] B1 — Fix score-flush data loss (stubbed `jsonToMusicxml` + cache delete) — round-trip is now lossless: score JSON persists verbatim, raw MusicXML wraps untouched
- [x] B2 — Fix auth cookie name/topology for HTTPS production — proxy accepts both `__Secure-`/plain cookie names; better-auth gets `COOKIE_DOMAIN`-driven cross-subdomain cookies (deploy must set it, see notes)
- [x] B3 — Postgres TLS (`POSTGRES_SSL=require|verify` + `POSTGRES_SSL_CA`) + `POSTGRES_URL` honored by TypeORM (split-brain closed); shared helper also drives better-auth's pool
- [x] B4 — CI added (`.github/workflows/ci.yml`): scoped lint, type-check, both test suites incl. coverage gate, builds, mocked e2e job
- [ ] B5 — Postgres backup strategy — **ops action** (managed-DB PITR + tested restore); documented in README § Deployment, nothing in-repo can do this
- [ ] B6 — Replace placeholder legal entity/address/emails — **needs real values from you** (entity, postal address, owned mailboxes, governing-law sign-off)

### High
- [x] H1 — `.catch` + lock release on WS `openSession` chain (no more process-killing unhandled rejection)
- [x] H2 — Recording caps: `RECORDING_MAX_SECONDS` (1 h) + `RECORDING_MAX_ENCODED_BYTES` (128 MB); encoded chunks dropped once the streaming decoder owns them (debug builds still retain)
- [x] H3 — Graceful shutdown: `enableShutdownHooks()` + gateway drains all recording sessions on SIGTERM; `terminationGracePeriodSeconds: 60`
- [x] H4 — `/health` pings the DB (503 on failure); k8s probes switched to `httpGet`
- [x] H5 — Webhook dedupe + apply now one transaction (failed apply → Polar retry gets a clean attempt); atomic `ON CONFLICT` subscription upsert; out-of-order guard via new `lastPolarEventAt` column (migration `1783382400000`)
- [x] H6 — Credits bill `max(wall-clock, decoded-audio seconds)`; WS ping/pong keepalive (30 s) kills dead peers
- [x] H7 — `TRUST_PROXY` env (bool/hops/CIDR list); set to `1` in the base k8s manifest
- [x] H8 — Email OTP capped at 5 attempts (`allowedAttempts`); signup CAPTCHA still open (ops/product item — beta approval gates abuse meanwhile)
- [x] H9 — API container runs as `node` + full `securityContext` in k8s; **inference containers still root** (see notes)
- [x] H10 — Base manifests now `imagePullPolicy: Always` + retag instructions; local overlay patches back to `IfNotPresent`
- [x] H11 — API refuses to boot with `SEED_DEMO_DATA=true` in production
- [x] H12 — WS failure during recording surfaces a toast and stops the take (`onConnectionLost`, covered by new unit tests)
- [x] H13 — Failed autosaves re-dirty via new `Score.redirty()` (tested) and retry after 10 s
- [x] H14 — Signup proceeds to onboarding even when the OTP send fails (verify step can re-send); no more frozen form
- [x] H15 — From-address fallback aligned to `no-reply@sheemu.app`
- [x] H16 — PostHog `identify` sends the account id only (no email/name); policy wording updated to "pseudonymous"
- [x] H17 — Purge failures now block completion: storage delete throws on real errors (404-tolerant), Polar delete rethrows non-404 — hourly cron retries
- [x] H18 — Structured JSON logs in production (Nest 11 `ConsoleLogger({ json })`) + Fastify pino request logging; `LOG_FORMAT` override. Sentry/error-tracker still open (needs a DSN/vendor choice)

### Medium / low
- [x] M1 — Inference services stop gracefully on SIGTERM (`server.stop(grace=10)`)
- [x] M2 — Cron jobs single-flight across replicas via `pg_try_advisory_lock` on a pinned session
- [x] M3 — Flush cache-delete guarded by `updatedAt <= snapshot` (lost-update race closed)
- [x] M4 — Daily prune of `processed_webhook_events` older than 90 days
- [x] M5 — PDBs for all three deployments + NetworkPolicies restricting inference gRPC to API pods; Ingress/TLS still cluster-specific (README documents the requirement)
- [x] M6 — Onboarding mic step advances on denied too, with honest copy
- [x] M7 — AuthGate now trusts the server's runtime `betaMode` (build flag kept as OR)
- [x] M8 — Branded `not-found.tsx` added
- [x] M9 — Mic-stream leak race fixed (lifecycle token invalidates in-flight `getUserMedia`)
- [x] M10 — Final MediaRecorder chunk flushes before the WS closes (`onstop`-deferred close + 1 s safety net)
- [x] M11 — Account purge sweeps better-auth `verification` rows by email
- [x] M12 — `RECORDINGS_DEBUG_DIR` fails closed in production (cannot re-enable raw-audio persistence)
- [x] M13 — Privacy policy discloses session IP/user-agent; cookie table shows the production cookie name
- [x] M14 — All 10 eslint errors in `apps/api/src` fixed (typed `AuthenticatedRequest`, marker-interface waiver, template-expr)
- [x] M15 — Pre-session WS buffer capped at 8 MB (socket closed past it)
- [x] M16 — Proxy preserves `?next=` (consumed by login, open-redirect-guarded) + segment-boundary public-path matching
- [ ] M17 — PNG/maskable icons + favicon.ico — needs actual image assets generated/designed; SVG-only manifest unchanged
- [x] M18 — Missing `SENDGRID_API_KEY` hard-fails boot in production (no OTP bodies in prod logs)
- [x] M20 — Migration advisory lock pinned to one QueryRunner; rclone calls get 60 s timeouts; `POSTGRES_POOL_SIZE` env
- [ ] M19 — API image slimming (prod-only deps) left undone — riskier build change, see notes; new env vars documented in README (see notes re .env.example)

---

## Working notes (appended as I go)

- Review performed with six parallel subagents; all findings above were verified in source
  by the reviewing agents before being reported.
- I cannot query session usage programmatically from inside the session. I will treat any
  harness usage/rate-limit warning as the 70% stop signal and hold until reset, and I'm
  avoiding further subagent fan-outs (the main token cost) during the fix phase.
- Per instructions: nothing will be committed; all fixes land in the working tree only.

### Fix-phase verification (all run after the changes)

- `pnpm type-check` — clean, both apps.
- `pnpm --filter @mushee/api test` — 34/34 pass.
- `pnpm --filter @mushee/web test:coverage` — 889/889 pass (was 885; +5 new tests for
  `Score.redirty` and the RecordingEngine connection-loss paths, −1 rewritten), coverage
  gate green.
- `pnpm build` — both apps build clean.
- `pnpm exec eslint apps/api/src apps/web/src` — **zero** errors now (was 10).
- `python3 -m py_compile` on both patched inference servers — OK.
- The mocked Playwright e2e suite still can't run while your `next dev` (:3200) holds
  Next 16's single-instance dev lock. Run `pnpm --filter @mushee/web test:e2e` once
  after stopping the dev server — especially since RecordingEngine behavior changed.

### Things you must do at deploy time (code is ready, config is yours)

1. **B2 topology**: pick the production layout (recommended: `sheemu.app` +
   `api.sheemu.app`) and set `COOKIE_DOMAIN=.sheemu.app` on the API. The web middleware
   accepts both the `__Secure-` and plain cookie names, but the cookie still has to
   *reach* it — same parent domain required. Smoke-test one real HTTPS login before
   anything else.
2. **B3**: set `POSTGRES_SSL=require` (or `verify` + `POSTGRES_SSL_CA`) against the
   managed DB.
3. **B5**: enable provider backups/PITR and rehearse a restore once.
4. **B6**: replace the legal placeholders (grep for `Voorbeeldstraat`, `sheemu.app`
   mailboxes) and set up the real mailboxes + SPF/DKIM/DMARC.
5. A new migration (`SubscriptionEventOrdering`) ships in this change set — it runs
   automatically on next API boot.

### Decisions I made without being able to ask

- **B1**: rather than implement MusicXML↔JSON conversion (a large feature), I made the
  storage round-trip lossless: flushed scores persist as serialized JSON; genuine
  MusicXML read from storage still wraps as `{ raw }`. The real converter stays a TODO —
  nothing is lost either way now, and `load()` transparently reads both formats.
- **H6**: chose "bill the max of wall-clock and decoded audio" over pure audio-based
  metering — it closes the faster-than-real-time exploit without making a stalled
  decoder free, and changes nothing for honest clients.
- **H14**: on OTP-send failure the signup flow proceeds to onboarding (which can
  re-send) instead of showing an error on the signup form — the account already exists
  at that point, so "try again" on the form could only ever fail with "email in use".
- **M6**: denied-mic users can now continue onboarding; recording still requests the
  mic later. Copy updated accordingly.
- **H16 vs policy wording**: I both stripped email/name from `identify` *and* reworded
  "anonymized" → "pseudonymous ... linked to your account id" — accurate even with the
  id link. Also: consent withdrawal now calls `posthog.reset()` so persisted `ph_*`
  identifiers are actually removed.
- **Webhook ordering guard** compares Polar's `modified_at` per event and skips strictly
  older snapshots; `customer.state_changed` reconciles unconditionally (authoritative)
  and resets the marker. Equal timestamps re-apply (idempotent) rather than skip.
- **mail.service now throws at boot in production without `SENDGRID_API_KEY`** — I chose
  fail-fast over silent no-mail because signups dead-end at verification without it. If
  you ever want a deliberately mail-less prod environment, that guard needs an escape
  hatch.
- **Structured logging** uses Nest 11's built-in JSON ConsoleLogger + Fastify's pino
  request logs instead of adding `nestjs-pino` — zero new dependencies, same queryable
  output. If you later adopt Sentry, `main.ts` is the hook point.

### Loose ends / ponderings

- **Inference containers still run as root** (H9 done for the API only). Hardening them
  means adding a user to both Python images and re-verifying model-cache paths (numba/
  TF caches often write to `$HOME`). Do it alongside a `check-inference-parity` run —
  I didn't want to change images I can't rebuild-and-eval from here.
- **`.env.example` files are permission-protected in this session** (deny rule on env
  files), so the new vars (`POSTGRES_SSL`, `POSTGRES_SSL_CA`, `POSTGRES_URL` note,
  `POSTGRES_POOL_SIZE`, `TRUST_PROXY`, `COOKIE_DOMAIN`, `RATE_LIMIT_*`, `MAX_BODY_BYTES`,
  `RECORDING_MAX_SECONDS`, `RECORDING_MAX_ENCODED_BYTES`, `LOG_FORMAT`) are documented in
  README § Deployment instead. Worth copying into `apps/api/.env.example` by hand.
- **Rate-limit store is still per-replica in-memory** — with `TRUST_PROXY` the keys are
  now correct, but the effective cluster-wide limit is `max × replicas` and resets on
  restart. A Redis store is the upgrade path if OTP brute-force pressure ever shows up
  in logs; with `allowedAttempts: 5` per code it's no longer the primary defense.
- **`RecordingSession` cap uses wall-clock via the meter tick**, so a session that never
  sends audio (only opens the socket) is closed by the keepalive, not the cap — fine,
  but worth knowing.
- **Editor `handleRecordToggle` still has the pre-existing quirk** (review L7): if
  `cursorEl` is missing it bails *after* inserting the count-off measure. Cosmetic and
  rare (ref is set once the score renders); left alone.
- **Beta-tier migration at launch** (from AFTERTHOUGHTS): when the beta ends, decide
  whether `beta`-tier users keep 5 min/day or get migrated to `free`. Nothing in this
  change set alters that.
- **CI is authored but unexercised** until this lands on GitHub — expect small path/
  cache wrinkles on the first run. The e2e job installs chromium+webkit; if you want a
  faster gate initially, delete the e2e job and keep `checks`.
- **`pruneProcessedWebhookEvents` keeps 90 days** — far beyond Polar's retry window;
  tighten later if the table ever matters.
- Session usage stayed below the 70% threshold for the whole fix phase (no harness
  limit warnings after the overnight reset); no hold was needed.
