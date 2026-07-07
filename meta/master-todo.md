# Master TODO — roadmap to the beta launch

Consolidated 2026-07-08 from every open item in `meta/TODO.md` (mostly superseded — Polar
billing, credits, legal pages, CI, sitemap/robots all shipped since), `meta/AFTERTHOUGHTS.md`,
`meta/PRODUCTION-READINESS.md` (open checkboxes B5/B6/M17/M19 + loose ends),
`meta/API-CONCURRENCY.md`, `meta/structure-report.md`, and the one remaining code TODO.
Ranked by importance toward **opening the closed beta**; items within a phase are ordered.

---

## Phase 1 — must happen before the beta opens (blockers)

1. **Real legal/business values** *(owner input — PR B6)*
   Replace the placeholder entity ("Sheemu Music BV", Voorbeeldstraat 12), postal address,
   and mailboxes (`support@` / `privacy@` / `hello@` @sheemu.app) in /privacy, /terms,
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
   `sheemu.app` + `api.sheemu.app`, set `COOKIE_DOMAIN=.sheemu.app`, `WEB_APP_URL`,
   `CORS_ORIGIN`/`TRUSTED_ORIGINS`, `NEXT_PUBLIC_SITE_URL`, `TRUST_PROXY=1`. Smoke-test
   signup → login → editor on the real domains before anything else.
5. **Email deliverability**: SendGrid production key, sender domain auth (SPF/DKIM/DMARC),
   real mailboxes receiving. Signup dead-ends at OTP without this.
6. **Polar production setup**: create products, set `POLAR_PRODUCT_<TIER>_<INTERVAL>` ids,
   `POLAR_ACCESS_TOKEN`/`POLAR_WEBHOOK_SECRET`/`POLAR_SERVER`, point the webhook at
   `POST /billing/webhooks/polar`. (During the beta itself checkout is disabled, but the
   webhook path should be live and tested before the switch ever flips.)
7. **Flip and verify the beta flow**: `BETA_MODE=true` + `NEXT_PUBLIC_BETA_MODE=true`,
   `ADMIN_EMAILS` set; walk signup → waitlist → admin approval → recording once on prod.
8. **`apps/api/.env.example` refresh** *(5 min, blocked for agents — env files are
   permission-protected in sessions)*: remove `RCLONE_REMOTE`, add `STORAGE_DRIVER`,
   `GCS_BUCKET`, `GCS_PROJECT_ID`, `STORAGE_LOCAL_DIR`, plus the hardening vars documented
   in README § Deployment.

## Phase 2 — should land in the first beta weeks (safety & confidence)

9. **Error tracking vendor** *(PR H18 open half)*: pick Sentry (or PostHog error tracking),
   add the DSN hook in `main.ts` + web `instrumentation.ts`. Without it, beta bug reports
   are anecdotes.
10. **Run the full e2e + visual QA of the 2026-07-08 UI changes** — the docked tool dock,
    endless-scroll canvas, waveform bars, and octave normalization shipped verified by unit
    tests only (a running `next dev` held the port lock during that session). Run
    `pnpm -F @mushee/web e2e` + the fullstack smoke, and record one real take end-to-end
    (checks the streaming GCS archive too).
11. **Recording-archive spot check in prod**: confirm `recordings/<user>/<score>/<id>/`
    objects appear, are playable, and that account deletion removes the prefix (GDPR
    promise in the updated policy).
12. **PNG/maskable icons + favicon.ico** *(PR M17)* — needs designed assets; SVG-only
    manifest today.
13. **N-session recording load test** *(API-CONCURRENCY §0)*: extend
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

## Structure / refactor backlog (from meta/structure-report.md — no launch impact)

23. **billing module**: reorganize the 7 loose root files, disambiguate
    `polar-webhooks.ts` vs `polar-webhook.controller.ts`, add service-level webhook tests
    (idempotency + out-of-order) — payment-critical and currently untested at that layer.
24. **recordings module split**: pure transcription pipeline vs Nest transport layer;
    normalize file naming (PascalCase/kebab/camel mix); more unit coverage around
    RecordingSession/gateway.
25. **Editor page decomposition** (`scores/[id]/page.tsx`, ~570 lines) — extract the
    recording flow + TitleInput; same treatment for `onboarding/page.tsx`.
26. **scripts/eval index**: README describing each experiment script; prune superseded ones.
27. **Inference proto stubs**: generate `inference_pb2*.py` at image build from
    `packages/inference-proto/inference.proto` (today: two checked-in copies from
    mismatched protoc versions).
28. **Model weights in git** (~5 MB across `model/`, `model-crepe-tiny/`,
    `crepe_saved_model/`): move to LFS or fetch-at-build; add provenance `SOURCE.md`s.
29. Minor: `src/origin/` naming, compose/k8s env drift (`WEB_APP_URL`/`BETA_MODE` missing in
    compose), `database/demo-*` → scripts, auth/mail service tests, webhook-events table
    pruning is in place — revisit retention when volume is known.

## Deliberately NOT doing (decided, keep it that way unless revisited)

- Stripe migration (TODO.md predates Polar — Polar is live and the merchant of record).
- Advertising features the product doesn't have (tier feature lists were trimmed to truth).
- Re-enabling the local `RECORDINGS_DEBUG_DIR` dump — the storage archiver supersedes it.
