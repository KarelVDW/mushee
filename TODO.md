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
- [ ] Email verification flow (better-auth supports it — needs SMTP + UI)
- [ ] Password reset flow (forgot password → email → reset page)
- [ ] Transactional email provider (Resend / Postmark / SES)
- [ ] Account deletion endpoint (GDPR)

## High priority (safety / reliability)

### Database
- [ ] Turn off `synchronize: true`, write proper TypeORM migrations
- [ ] Migration runner in deploy pipeline
- [ ] Backup strategy for Postgres + Mongo (managed service or scheduled dumps)
- [ ] Decide whether MongoDB is actually needed — Postgres+JSONB might collapse two DBs into one

### API hardening
- [ ] Rate limiting (per-IP + per-user) — `@fastify/rate-limit`
- [ ] Request body size limits (especially WebSocket audio chunks)
- [ ] Structured input validation (`class-validator` + global ValidationPipe with `whitelist`/`forbidNonWhitelisted`)
- [ ] Security headers (`@fastify/helmet`)
- [ ] Audit AuthGuard coverage on every endpoint (recordings WebSocket especially)

### Recording pipeline robustness
- [ ] Per-recording timeout / max-length cap (defense in depth on top of credits)
- [ ] Concurrent recording limit per user
- [ ] Graceful FFmpeg failure handling
- [ ] Decide which model ships in prod (basic-pitch / CREPE / YIN) and pin the choice; remove/feature-flag the others

### Testing
- [ ] Unit tests for the credit ledger (this is where bugs cost money)
- [ ] Unit tests for billing webhook handlers (idempotency!)
- [ ] Integration tests for auth + scores CRUD
- [ ] Integration test for the recording → transcription pipeline (one short canned audio file → expected notes)
- [ ] E2E (Playwright) for the golden path: signup → checkout → create score → record → export
- [ ] Test runners wired into CI

### CI/CD
- [ ] GitHub Actions: lint + typecheck + test on PR
- [ ] Build pipeline producing deployable artifacts (Docker images for API)
- [ ] Deploy pipeline (API → Fly/Railway/Render/ECS; web → Vercel)
- [ ] Environment management: dev / staging / prod with separate DBs and Stripe keys
- [ ] `.env.example` checked in
- [ ] Secrets in a real secret store (Doppler / Vercel env / cloud provider)

## Marketing & SEO
- [ ] Actual landing page at `/` (currently redirects to `/scores`) — hero, demo video/gif of transcription, pricing, FAQ, footer
- [ ] Pricing page with the three tiers
- [ ] Pages: About, Contact, Blog (optional), Changelog (optional)
- [ ] `metadata` per route (title, description, OG, Twitter cards)
- [ ] `sitemap.xml` (Next.js `app/sitemap.ts`)
- [ ] `robots.txt`
- [ ] Structured data (JSON-LD: SoftwareApplication, FAQPage)
- [ ] OG share image
- [ ] Favicons / PWA manifest
- [ ] Canonical URLs
- [ ] Lighthouse pass (perf / a11y / SEO)

## Legal / compliance (blocker for EU launch)
- [ ] Privacy Policy page
- [ ] Terms of Service page
- [ ] Cookie consent banner (GDPR) — needed if you add analytics
- [ ] Data export endpoint (user can download their data)
- [ ] Data deletion endpoint (right to be forgotten)
- [ ] DPA with subprocessors (Stripe, hosting, email provider, S3)
- [ ] Decide on data residency (EU vs US bucket/DB)

## Export
- [ ] MusicXML download wired to a UI button (data exists; needs an export endpoint + button)
- [ ] PDF export — render MusicXML to PDF (Verovio server-side, or OSMD client-side + print)
- [ ] Possibly MIDI export too (cheap once MusicXML is solid)

## Observability
- [ ] Sentry on API + web (error tracking + source maps)
- [ ] Structured logging (pino) shipped to a log aggregator
- [ ] Uptime monitoring (BetterStack / UptimeRobot) on `/health` endpoint + add `/health` if missing
- [ ] Product analytics (PostHog is GDPR-friendly and self-hostable) for funnel: landing → signup → first score → first recording → upgrade
- [ ] Stripe revenue dashboard / alerts

## Things not initially mentioned but matter
- [ ] **Abuse prevention**: signup CAPTCHA (hCaptcha/Turnstile) — transcription is compute-expensive
- [ ] **Trial or free tier policy** — "all accounts paid" means no trial; consider a free trial to reduce signup friction, or a money-back window
- [ ] **Refund / dunning policy** — failed-payment retry, grace period before downgrade
- [ ] **Onboarding** — first-time user tutorial / sample score / "record this clip to try it"
- [ ] **Empty states** — the empty `/scores` page should sell the feature, not just say "no scores"
- [ ] **Browser/device support matrix** — getUserMedia requires HTTPS, decide on mobile recording
- [ ] **Audio permission UX** — clear explainer before the browser prompt
- [ ] **Account settings page** — change email/password, view plan, manage billing, delete account
- [ ] **Admin/support tooling** — at minimum: look up a user, see their credits, comp credits, refund a charge
- [ ] **Status page** (statuspage.io / instatus) once you have paying customers
- [ ] **Support inbox** (support@ email + help docs)
- [ ] **Backup of user-generated content** (scores in S3 — versioning enabled?)
- [ ] **Domain, DNS, SSL, email deliverability** (SPF/DKIM/DMARC for transactional mail)
- [ ] **Pre-launch beta** with a handful of musicians to validate transcription quality on real input — biggest product risk

---

**Suggested ordering** for fast ship: legal pages + Stripe + credits + email verification/reset + landing page + minimal tests on the credit ledger + Sentry + CI deploy → soft launch. Everything else iterates post-launch.
