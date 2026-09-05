# Master TODO — roadmap to the beta launch

Consolidated 2026-07-08 from every open item in the old meta docs (`TODO.md`,
`AFTERTHOUGHTS.md`, `PRODUCTION-READINESS.md`, `API-CONCURRENCY.md`, `structure-report.md` —
since merged into [notes.md](notes.md); full text in git history) and the one remaining code
TODO. Ranked by importance toward **opening the closed beta**; items within a phase are ordered.

---

> **2026-09-05 overnight pass (branch `experimental`)** — items 13, 14, 15 (code), 18, 22 and
> the runbook pre-flight rows for error tracking and the inference-outage signal were addressed
> in one autonomous session; new: share links, editor/importer/recording bug fixes from nine
> property suites, API image slimming. The itemised log with verification and the remaining
> config-only steps is [overnight-2026-09-04.md](overnight-2026-09-04.md).

## Phase 1 — must happen before the beta opens (blockers)

1. **Real legal/business values** _(owner input — PR B6)_ — **values done 2026-07-10**:
   pages now name Karel Van De Winkel, trading as Solkey (sole proprietorship, enterprise
   no. 1039.906.118), Capucienenlaan 23, 9300 Aalst; Belgium confirmed as governing law.
   _Update 2026-07-18: rebranded Sheemu → Solkey. The commercial name in the
   KBO/CBE register still says Sheemu — update it (or confirm with the
   accountant that the pages may already carry the new name)._
   Remaining: add `support@`/`privacy@`/`legal@`/`hello@` as Workspace aliases of
   `info@solkey.io` (once solkey.io is added to the Workspace), and have a lawyer
   review both documents (include the stored-recording-audio section rewritten
   2026-07-08).
2. **Production storage bucket (GCS)** _(new since the rclone removal)_
   Create the GCS bucket, enable object versioning, wire workload identity (or a service
   account) for the API, set `STORAGE_DRIVER=gcs` + `GCS_BUCKET` in `Secret/api-secrets`.
   Decide data residency (EU bucket region to match the EU-hosted PostHog/DB posture).
3. **Managed Postgres + backups** _(PR B5 — ops)_
   Provision with TLS (`POSTGRES_SSL=require|verify`), enable PITR/backups, and **rehearse
   one restore** before launch.
4. **Domain topology + one real HTTPS login** _(PR B2 follow-through)_
   `solkey.io` + `api.solkey.io`, set `COOKIE_DOMAIN=.solkey.io`, `WEB_APP_URL`,
   `CORS_ORIGIN`/`TRUSTED_ORIGINS`, `NEXT_PUBLIC_SITE_URL`, `TRUST_PROXY=1`. Smoke-test
   signup → login → editor on the real domains before anything else.
   _Update 2026-07-09: domain decided (sheemu.com; repo-wide sweep off the old
   sheemu.app placeholder done). Superseded 2026-07-18: rebranded to solkey.io,
   repo swept again. Deploy targets decided: web on Vercel, API +
   inference on GKE. The API-side topology values are now committed in
   `deploy/k8s/overlays/production/api-patch.yaml`; the web vars go into the
   Vercel build env (all `NEXT*PUBLIC*_` are build-time baked). Remaining: DNS,
   the Vercel project, and the smoke test itself.\*
5. **Email deliverability**: SendGrid production key, sender domain auth (SPF/DKIM/DMARC),
   real mailboxes receiving. Signup dead-ends at OTP without this.
6. **Polar production setup**: create products, set `POLAR_PRODUCT_<TIER>_<INTERVAL>` ids,
   `POLAR_ACCESS_TOKEN`/`POLAR_WEBHOOK_SECRET`/`POLAR_SERVER`, point the webhook at
   `POST /billing/webhooks/polar`. (During the beta itself checkout is disabled, but the
   webhook path should be live and tested before the switch ever flips.)
7. **Flip and verify the beta flow**: `BETA_MODE=true` + `NEXT_PUBLIC_BETA_MODE=true`,
   `ADMIN_EMAILS` set; walk signup → waitlist → admin approval → recording once on prod.
8. ~~**`apps/api/.env.example` refresh**~~ — **done 2026-07-08** (env-file permission
   rule lifted): `RCLONE_REMOTE` replaced by the `STORAGE_DRIVER`/`GCS_*`/
   `STORAGE_LOCAL_DIR` block, Postgres TLS/pool vars added, and a new
   production-hardening section (`TRUST_PROXY`, `COOKIE_DOMAIN`, `RATE_LIMIT_*`,
   `MAX_BODY_BYTES`, `LOG_FORMAT`, `RECORDING_*` caps) with code-verified defaults.
   The web `.env.example` was already in sync.

8b. ~~**Production deploy layer** _(found missing in the 2026-07-09 pre-deploy audit)_~~ —
**done 2026-07-09** (numbered 8b so the item numbers notes.md references keep pointing
at the same entries): `deploy/k8s/overlays/production` (namespace, Artifact Registry
retags, GKE Ingress + ManagedCertificate + BackendConfig with the /health check and a
2 h WebSocket timeout, workload-identity ServiceAccount, non-secret prod env in
`api-patch.yaml`) with a provisioning runbook in its README;
`.github/workflows/deploy.yml` builds/pushes SHA-tagged images and applies the
overlay (manual dispatch). Also from that audit: `BETTER_AUTH_SECRET` documented +
prod boot guard, prod guard against default Postgres creds, inference containers
non-root (Dockerfiles + securityContexts — re-run `check-inference-parity` on the
rebuilt images before first prod rollout), baseline web security headers (CSP is a
deliberate follow-up: needs nonce plumbing for Next hydration + PostHog replay).
Replace `PROJECT_ID` placeholders (overlay kustomization, service-account.yaml,
deploy.yml) once the GCP project exists.

## Phase 2 — should land in the first beta weeks (safety & confidence)

9. ~~**Error tracking vendor**~~ — **code done 2026-09-05**, PostHog on both sides: web
   already had `instrumentation.ts` (`onRequestError` → `captureException`) plus the route
   and global error boundaries; the API now has `src/telemetry` (`ErrorReporter`,
   `ReportExceptionsFilter` for 5xx/unknown, `uncaughtExceptionMonitor`; overnight log §7).
   Remaining (config): set `POSTHOG_API_KEY` in the API secrets.
10. **Visual QA + full-stack verification of the 2026-07-08 UI changes** — the mocked
    Playwright suite is green on current HEAD (32/32, chromium + webkit, run 2026-07-08
    after the module-cleanup commits) and the full-stack smoke passed after the
    restructure. Eyeballed 2026-09-05 (overnight log §26): editor desktop + phone, Share/Takes popovers, no overflow/console errors; one design note about the cookie banner over the dock. Still to do: waveform bars / octave normalization during a real take, re-run the fullstack smoke
    (`pnpm -F @mushee/web test:e2e:smoke`, needs the live stack per `e2e/README.md`),
    and record one real take end-to-end (checks the streaming GCS archive too).
11. **Recording-archive spot check in prod**: confirm `recordings/<user>/<score>/<id>/`
    objects appear, are playable, and that account deletion removes the prefix (GDPR
    promise in the updated policy).
12. ~~**PNG/maskable icons + favicon.ico** _(PR M17)_~~ — **done 2026-07-08**: rasterized
    from the brand `icon.svg` (sharp): `public/icon-{192,512}.png`, maskable variants on
    the surface color, `app/apple-icon.png`, PNG-encoded `app/favicon.ico` (16/32/48);
    manifest lists all of them. Worth one designer glance at the maskable crop.
13. ~~**N-session recording load test**~~ — **harness done 2026-09-05**:
    `apps/api/scripts/load-test-recording.ts` (`pnpm load:recording`) ramps N sessions and
    reports p95 pass latency + RSS; first local numbers in overnight log §10. Remaining: one
    run against the staging cluster in remote-inference mode before invites scale up.
14. ~~**GDPR data export endpoint**~~ — **done 2026-09-05** (client-side, no API change):
    Settings → Account → "Download my data" zips profile.json, settings.json and every
    score as MusicXML + JSON in the browser (`lib/AccountExport.ts`); the privacy page
    points at it. Recordings audio deliberately excluded (deleted with the account).
15. **Signup CAPTCHA (Turnstile)** — **code done 2026-09-05**: better-auth captcha plugin on
    `/sign-up/email` (`auth/captcha-config.ts`), Turnstile widget on the signup form. Remaining
    (config): create the widget in Cloudflare, set `TURNSTILE_SECRET_KEY` (API secret) +
    `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (Vercel). Unset = unprotected, production warns at boot.

## Phase 3 — before ending the beta / public launch

16. **Beta-tier migration decision**: when BETA_MODE flips off, do `beta` users keep
    300 credits/day or drop to `free`? (Now a one-row DB tweak in `subscription_tiers`.)
17. **Tax/VAT sanity check with Polar** (merchant of record covers it, but verify EU VAT
    display + invoices once real charges exist).
18. **Dedicated `/pricing` route** ~~(pricing lives only on the landing page today)~~ +
    per-route `metadata`, canonical URLs, JSON-LD — **done 2026-09-05** (`/pricing` with
    FAQ + FAQPage/offers JSON-LD, sitemap, footer link). Remaining: Lighthouse pass.
19. ~~**PDF/MusicXML export polish**~~ — **largely done 2026-09**: genuine MusicXML and
    MIDI _import_ live in `packages/notation` (`MusicXmlImporter`, `MidiImporter`,
    `DurationSpeller`) and are wired into the web app (`lib/ScoreFileImporter.ts`); the
    `scores.service.ts` converter TODO is gone (stored JSON is persisted verbatim, foreign
    MusicXML wrapped untouched). Both importers are fuzz-guarded since 2026-09-05. Remaining
    (no launch impact): let the API reuse `@mushee/notation` instead of its own MxmlBuilder.
20. ~~**Inference containers non-root**~~ — **done**: `apps/inference-crepe/Dockerfile` runs as
    `app` (uid 1000); the basic-pitch service was deleted 2026-08-22.
21. ~~**API image slimming**~~ — **done 2026-09-05** (`pnpm deploy --prod`, 1.38 GB → 793 MB,
    no `.env*`/dev storage in the image; overnight log §8). Still open, only if OTP brute-force
    pressure appears: a Redis store for the rate limiter (per-replica in-memory today;
    `allowedAttempts: 5` is the real guard).
22. ~~**Recordings product surface**~~ — **done 2026-09-05**: the editor header's "Takes"
    menu lists every recording made into the score (newest first) with replay of the
    archived audio and confirmed deletion (`GET/DELETE /recordings`, `GET /recordings/:id/audio`
    — signed URL or stream, owner-scoped). A cross-score "all my recordings" page can build on
    the same endpoint (`GET /recordings` without `scoreId`).

22c. **Bulk e-mail to users** — **decided + built 2026-09-05**: service announcements from the admin
console (`/announcements`, audience filter, test copy, audit log) over the transactional SendGrid
integration; marketing mail via the page's CSV export into SendGrid Marketing Campaigns. See
notes.md §1 "Bulk e-mail" and the end-of-beta runbook §3.

22b. **Read-only share links** — **shipped 2026-09-05** (new, not previously listed):
`/s/<token>` public page (view, export), Share chip in the editor, `POST/DELETE /scores/:id/share`,
`GET /shared/:token`, migration `ScoreShareToken`. Playback (`useSharedPlayback`) and "Save a copy" landed the same night. Follow-ups if wanted: link
expiry/passwords.

## Structure / refactor backlog (no launch impact)

**Cleared 2026-07-08** — the full backlog was executed in one restructuring pass (every
module now grades clean; see notes.md §5 and git history of `meta/structure-report.md`).
Remaining follow-ups:

23. **Model weights in git** (~5 MB): provenance `SOURCE.md`s are in place; move to
    LFS / fetch-at-build only if the repo ever needs slimming (deliberate keep for now).
24. Webhook-events table pruning is in place — revisit retention when volume is known.
25. More unit coverage around `RecordingSession`/gateway (the pipeline itself is eval-gated).

<details><summary>Done 2026-07-08 (was items 23–29)</summary>

- billing module reorganized (`polar/` lib subfolder; `polar-webhooks.ts` →
  `polar/webhook-verify.ts`) + 22 BillingService tests (checkout guards, webhook
  idempotency/out-of-order/stale-event handling, GDPR delete).
- recordings module split: `pipeline/` (pure DSP) vs Nest transport at root; all
  files kebab-case; module README.
- `scores/[id]/page.tsx` 578→300 lines (TitleInput + useRecording/usePlayback/
  useScoreAutosave hooks); `onboarding/page.tsx` 600→201 lines (data module +
  controls + step components).
- scripts/eval README + pruning (tempo-experiment.ts deleted); eval scripts joined
  tsconfig/eslint coverage and were cleaned up; `eval:generate`/`eval:run`/
  `verify:recording-integration` wired into package.json.
- Inference proto stubs no longer committed — generated at image build (both
  Dockerfiles already did) + `packages/inference-proto/generate-python.sh` for
  host runs; single pinned toolchain.
- Minor batch: `src/origin/` → `components/notation/fonts/`, compose/k8s env drift
  fixed, `database/seed/` subfolder, `auth.ts` → `auth.config.ts`, auth-guard +
  mail service tests, dead Mongo path removed from `test-recording-ws.ts`.

</details>

## Deliberately NOT doing (decided, keep it that way unless revisited)

- Stripe migration (TODO.md predates Polar — Polar is live and the merchant of record).
- Advertising features the product doesn't have (tier feature lists were trimmed to truth).
- Re-enabling the local `RECORDINGS_DEBUG_DIR` dump — the storage archiver supersedes it.
