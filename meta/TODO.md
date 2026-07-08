# Sheemu Go-Live TODO

## Critical blockers (no revenue / unsafe in prod without these)

### Billing & subscriptions
- [ ] Pick a payment provider (Stripe is the standard fit for SaaS subscriptions)
- [ ] Define the three tiers in code/config (Casual, Intense, Full-timer) with pricing + included credits
- [ ] Stripe Checkout flow for new signups (signup → choose plan → checkout → return)
- [ ] Stripe webhook handler (subscription.created/updated/deleted, invoice.payment_failed)
- [ ] Customer portal link for users to update card / cancel
- [ ] Subscription state on the user (tier, status, current period end, stripe_customer_id, stripe_subscription_id)
- [ ] Tax handling (Stripe Tax / VAT for EU)
- [ ] Currency decision + display

### Credit system
- [ ] User credit balance field + ledger table (debit/credit history for support/auditing)
- [ ] Monthly credit grant on subscription renewal (driven by webhook)
- [ ] Pre-flight credit check before starting a recording
- [ ] Live deduction during recording (per second / per chunk) with server-side authority
- [ ] Auto-stop on exhaustion + WebSocket message → "upgrade" modal in UI
- [ ] "Upgrade your plan" CTA wired to Stripe Checkout (plan switch / proration)
- [ ] Usage display on score list / settings page (X minutes left this month)

### Auth gaps
- [x] Email verification flow (better-auth emailOTP plugin + SendGrid + signup UI)
- [x] Password reset flow (better-auth reset + reset-password page)
- [x] Transactional email provider (SendGrid via mail.service.ts)
- [x] Account deletion (GDPR) — soft delete with 7-day grace period (account module), reactivation prompt at login, hourly purge cron deletes user + all data after the window

## High priority (safety / reliability)

### Database
- [x] Turn off `synchronize: true`, write proper TypeORM migrations — shared data source in `src/database/data-source.ts`, initial migration generated, `pnpm migration:generate/run/revert` scripts
- [x] Migration runner — `migrationsRun: true` runs pending migrations on app boot; deploy pipelines can also call `pnpm migration:run` explicitly
- [ ] Backup strategy for Postgres (managed service or scheduled dumps)
- [x] Decide whether MongoDB is actually needed — it wasn't; score edit cache ported to Postgres `cached_scores` (JSONB), Mongo removed from the stack

### API hardening
- [x] Rate limiting (per-IP + per-user) — `@fastify/rate-limit`, keyed by session token else IP, 120/min (env-tunable), `/health` exempt
- [x] Request body size limits (HTTP bodyLimit 5MB env-tunable; WebSocket `maxPayload` 2MB per frame on recordings gateway)
- [x] Structured input validation (`class-validator` decorators on all DTOs + global ValidationPipe with `whitelist`/`forbidNonWhitelisted`/`transform`)
- [x] Security headers (`@fastify/helmet`)
- [x] Audit AuthGuard coverage on every endpoint — recordings WebSocket now validates better-auth session on connect (closes 1008 if unauthenticated); scores/onboarding already guarded

### Recording pipeline robustness
- [ ] Per-recording timeout / max-length cap (defense in depth on top of credits)
- [ ] Concurrent recording limit per user
- [x] Graceful FFmpeg failure handling (pipeline/audio-decoder.ts — tolerates truncated input, handles exit codes)
- [ ] Decide which model ships in prod (basic-pitch / CREPE / YIN) and pin the choice; remove/feature-flag the others — defaults to basic-pitch via PITCH_PROVIDER env, but all providers still shipped

### Testing
- [ ] Unit tests for the credit ledger (this is where bugs cost money)
- [ ] Unit tests for billing webhook handlers (idempotency!)
- [ ] Integration tests for auth + scores CRUD
- [ ] Integration test for the recording → transcription pipeline (one short canned audio file → expected notes)
- [ ] E2E (Playwright) for the golden path: signup → checkout → create score → record → export
- [ ] Test runners wired into CI

### CI/CD
- [ ] GitHub Actions: lint + typecheck + test on PR
- [x] Build pipeline producing deployable artifacts (Docker images for API + inference services; `docker compose build`)
- [ ] Deploy pipeline (API → Fly/Railway/Render/ECS; web → Vercel)
- [ ] Environment management: dev / staging / prod with separate DBs and Stripe keys
- [x] `.env.example` checked in (apps/api + apps/web)
- [ ] Secrets in a real secret store (Doppler / Vercel env / cloud provider)

## Marketing & SEO
- [x] Actual landing page at `/` (full hero, features, testimonials, pricing teaser, CTA in page.tsx)
- [ ] Pricing page with the three tiers — tiers shown on landing page but no dedicated `/pricing` route
- [ ] Pages: About, Contact, Blog (optional), Changelog (optional)
- [ ] `metadata` per route (title, description, OG, Twitter cards) — only minimal root title/description in layout.tsx
- [ ] `sitemap.xml` (Next.js `app/sitemap.ts`)
- [ ] `robots.txt`
- [ ] Structured data (JSON-LD: SoftwareApplication, FAQPage)
- [ ] OG share image
- [ ] Favicons / PWA manifest — favicon.ico exists, no PWA manifest / apple-touch-icon
- [ ] Canonical URLs
- [ ] Lighthouse pass (perf / a11y / SEO)

## Legal / compliance (blocker for EU launch)
- [ ] Privacy Policy page
- [ ] Terms of Service page
- [x] Cookie consent banner (GDPR) — implemented in page.tsx with localStorage persistence
- [ ] Data export endpoint (user can download their data)
- [ ] Data deletion endpoint (right to be forgotten) — UI dialog exists, no backend endpoint
- [ ] DPA with subprocessors (Stripe, hosting, email provider, S3)
- [ ] Decide on data residency (EU vs US bucket/DB)

## Export
- [ ] MusicXML download wired to a UI button (data exists; needs an export endpoint + button)
- [ ] PDF export — render MusicXML to PDF (Verovio server-side, or OSMD client-side + print)
- [ ] Possibly MIDI export too (cheap once MusicXML is solid)

## Observability
- [ ] Sentry on API + web (error tracking + source maps)
- [ ] Structured logging (pino) shipped to a log aggregator
- [ ] Uptime monitoring (BetterStack / UptimeRobot) on `/health` endpoint — `/health` endpoint now exists (returns status/uptime/timestamp); external monitor still to wire up
- [ ] Product analytics (PostHog is GDPR-friendly and self-hostable) for funnel: landing → signup → first score → first recording → upgrade
- [ ] Stripe revenue dashboard / alerts

## Things not initially mentioned but matter
- [ ] **Abuse prevention**: signup CAPTCHA (hCaptcha/Turnstile) — transcription is compute-expensive
- [ ] **Trial or free tier policy** — "all accounts paid" means no trial; consider a free trial to reduce signup friction, or a money-back window
- [ ] **Refund / dunning policy** — failed-payment retry, grace period before downgrade
- [x] **Onboarding** — 7-step onboarding flow (verify email, mic permission, name, background, instruments, referral, plan) in onboarding/page.tsx
- [x] **Empty states** — `/scores` has a "No scores yet" empty card with icon + CTA
- [ ] **Browser/device support matrix** — getUserMedia requires HTTPS, decide on mobile recording
- [x] **Audio permission UX** — clear explainer in onboarding mic-permission step
- [x] **Account settings page** — settings page with Profile/Editor/Notifications/Account tabs + change password/plan/delete dialogs (plan/billing flows are visual mocks pending backend)
- [ ] **Admin/support tooling** — at minimum: look up a user, see their credits, comp credits, refund a charge
- [ ] **Status page** (statuspage.io / instatus) once you have paying customers
- [ ] **Support inbox** (support@ email + help docs)
- [ ] **Backup of user-generated content** (scores in S3 — versioning enabled?)
- [ ] **Domain, DNS, SSL, email deliverability** (SPF/DKIM/DMARC for transactional mail)
- [ ] **Pre-launch beta** with a handful of musicians to validate transcription quality on real input — biggest product risk

---

**Suggested ordering** for fast ship: legal pages + Stripe + credits + email verification/reset + landing page + minimal tests on the credit ledger + Sentry + CI deploy → soft launch. Everything else iterates post-launch.
