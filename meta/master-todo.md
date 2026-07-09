# Master TODO — roadmap to the beta launch

Consolidated 2026-07-08 from every open item in the old meta docs (`TODO.md`,
`AFTERTHOUGHTS.md`, `PRODUCTION-READINESS.md`, `API-CONCURRENCY.md`, `structure-report.md` —
since merged into [notes.md](notes.md); full text in git history) and the one remaining code
TODO. Ranked by importance toward **opening the closed beta**; items within a phase are ordered.

---

## Phase 1 — must happen before the beta opens (blockers)

1. **Real legal/business values** *(owner input — PR B6)*
   Replace the placeholder entity ("Sheemu Music BV", Voorbeeldstraat 12), postal address,
   and mailboxes (`support@` / `privacy@` / `hello@` @sheemu.com) in /privacy, /terms,
   /contact; confirm Belgium as governing law; have a lawyer review both documents.
   The privacy policy was just rewritten for stored recording audio (2026-07-08) — include
   that section in the review.
2. **Production storage bucket (GCS)** *(new since the rclone removal)*
   Create the GCS bucket, enable object versioning, wire workload identity (or a service
   account) for the API, set `STORAGE_DRIVER=gcs` + `GCS_BUCKET` in `Secret/api-secrets`.
   Decide data residency (EU bucket region to match the EU-hosted PostHog/DB posture).
3. **Managed Postgres + backups** *(PR B5 — ops)*
   Provision with TLS (`POSTGRES_SSL=require|verify`), enable PITR/backups, and **rehearse
   one restore** before launch.
4. **Domain topology + one real HTTPS login** *(PR B2 follow-through)*
   `sheemu.com` + `api.sheemu.com`, set `COOKIE_DOMAIN=.sheemu.com`, `WEB_APP_URL`,
   `CORS_ORIGIN`/`TRUSTED_ORIGINS`, `NEXT_PUBLIC_SITE_URL`, `TRUST_PROXY=1`. Smoke-test
   signup → login → editor on the real domains before anything else.
   *Update 2026-07-09: domain decided (sheemu.com; repo-wide sweep off the old
   sheemu.app placeholder done). Deploy targets decided: web on Vercel, API +
   inference on GKE. The API-side topology values are now committed in
   `deploy/k8s/overlays/production/api-patch.yaml`; the web vars go into the
   Vercel build env (all `NEXT_PUBLIC_*` are build-time baked). Remaining: DNS,
   the Vercel project, and the smoke test itself.*
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

8b. ~~**Production deploy layer** *(found missing in the 2026-07-09 pre-deploy audit)*~~ —
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

9. **Error tracking vendor** *(PR H18 open half)*: pick Sentry (or PostHog error tracking),
   add the DSN hook in `main.ts` + web `instrumentation.ts`. Without it, beta bug reports
   are anecdotes.
10. **Visual QA + full-stack verification of the 2026-07-08 UI changes** — the mocked
    Playwright suite is green on current HEAD (32/32, chromium + webkit, run 2026-07-08
    after the module-cleanup commits) and the full-stack smoke passed after the
    restructure. Still to do: eyeball the docked tool dock / endless-scroll canvas /
    waveform bars / octave normalization in a browser, re-run the fullstack smoke
    (`pnpm -F @mushee/web test:e2e:smoke`, needs the live stack per `e2e/README.md`),
    and record one real take end-to-end (checks the streaming GCS archive too).
11. **Recording-archive spot check in prod**: confirm `recordings/<user>/<score>/<id>/`
    objects appear, are playable, and that account deletion removes the prefix (GDPR
    promise in the updated policy).
12. ~~**PNG/maskable icons + favicon.ico** *(PR M17)*~~ — **done 2026-07-08**: rasterized
    from the brand `icon.svg` (sharp): `public/icon-{192,512}.png`, maskable variants on
    the surface color, `app/apple-icon.png`, PNG-encoded `app/favicon.ico` (16/32/48);
    manifest lists all of them. Worth one designer glance at the maskable crop.
13. **N-session recording load test** *(notes.md §4 has the follow-up backlog)*: extend
    `scripts/test-recording-ws.ts` to ramp N sessions, watch p95 pass latency + RSS,
    and baseline the per-pod ceiling before beta invites scale up.
14. **GDPR data export endpoint** — the privacy policy grants portability; per-score
    MusicXML export exists in the editor, but there is no account-level "download my data".
    Minimum: zip of scores (MusicXML) + profile JSON; recordings audio optional.
15. **Signup CAPTCHA (hCaptcha/Turnstile)** — deferred while beta approval gates abuse;
    becomes real the day the doors open wider.

## Phase 3 — before ending the beta / public launch

16. **Beta-tier migration decision**: when BETA_MODE flips off, do `beta` users keep
    300 credits/day or drop to `free`? (Now a one-row DB tweak in `subscription_tiers`.)
17. **Tax/VAT sanity check with Polar** (merchant of record covers it, but verify EU VAT
    display + invoices once real charges exist).
18. **Dedicated `/pricing` route** (pricing lives only on the landing page today) + per-route
    `metadata`, canonical URLs, JSON-LD, Lighthouse pass.
19. **PDF/MusicXML export polish**: the real MusicXML↔JSON converter is still the one code
    TODO (`scores.service.ts:137`) — round-trip is lossless today, but genuine MusicXML
    *import* and richer export need the converter.
20. **Inference containers non-root** *(PR H9 leftover)* — add users to both Python images,
    re-run `check-inference-parity` + eval gate.
21. **API image slimming** *(PR M19)* and rate-limit Redis store if OTP brute-force pressure
    appears (currently per-replica in-memory, `allowedAttempts: 5` is the real guard).
22. **Recordings product surface** (new possibility now audio is stored): a "my recordings"
    list with playback/delete would both add user value and strengthen the GDPR story.

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
