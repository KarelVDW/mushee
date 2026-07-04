# Afterthoughts — go-live implementation notes

Everything below was implemented in one pass without being able to ask questions
or test against live Polar/PostHog/SendGrid accounts. This file lists what you
need to plug in, the decisions I made on your behalf (and why), the bugs I found
and fixed along the way, and the loose ends I'd look at before launch.

Verified locally: `pnpm build` (both apps), `pnpm type-check`, `pnpm test`
(884 unit tests, incl. 17 new API tests), and the mocked Playwright e2e suite
(16/16). Nothing that needs live credentials could be exercised end-to-end.
Note: I had to stop a stale `next dev` on :3200 to run the e2e suite —
restart with `pnpm dev:web` if you were using it.

---

## 1. What you must configure before deploying

### Polar (billing)
1. Create 4 subscription products in the Polar dashboard: Composer $8/mo,
   Composer $80/yr, Studio $18/mo, Studio $180/yr (prices are displayed in the
   UI from `apps/web/src/lib/plans.ts` — change both places if you change
   pricing).
2. Env on the API (`apps/api/.env.example` documents all of these):
   `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET`, `POLAR_SERVER`
   (`sandbox` while testing), `POLAR_PRODUCT_PRO_MONTHLY`,
   `POLAR_PRODUCT_PRO_YEARLY`, `POLAR_PRODUCT_STUDIO_MONTHLY`,
   `POLAR_PRODUCT_STUDIO_YEARLY`, and `WEB_APP_URL` (checkout redirects).
3. Webhook endpoint in the Polar dashboard: `<api-url>/billing/webhooks/polar`.
   Subscribe to the `subscription.*` events and `customer.state_changed`.
4. Unconfigured Polar degrades gracefully: `/billing/*` answers 503 and the UI
   hides paid actions — the app still fully works on free/beta tiers.
5. **Test in sandbox before launch**: checkout → webhook → tier flips in
   Settings; cancel → resume; plan switch (uses `POST /billing/change`, which
   updates the existing subscription with proration rather than creating a
   second one).

### PostHog (analytics / replay / errors)
1. Create an **EU Cloud** project, put the key in `NEXT_PUBLIC_POSTHOG_KEY`
   (web). `NEXT_PUBLIC_POSTHOG_HOST` defaults to `https://eu.i.posthog.com`.
2. Enable Session replay + Error tracking in the PostHog project settings
   (client config is already set: replay starts only after consent, all
   inputs masked; exceptions auto-captured).
3. Events are proxied through `/ingest` (see `apps/web/next.config.ts`) to
   dodge ad blockers.
4. Custom events already emitted: `signup_completed`, `onboarding_completed`,
   `recording_started`, `checkout_started`, `plan_change_started`,
   `subscription_cancel_started`, `landing_cta_clicked`.

### Beta launch
- API: `BETA_MODE=true`, `ADMIN_EMAILS=you@yourdomain` — web: `NEXT_PUBLIC_BETA_MODE=true`.
- Full flow (walked through end to end): signup shows a closed-beta notice →
  account is created with `betaStatus='pending'` on the `beta` tier (300
  credits = 5 min/day) → waitlist email to the user + notification email to
  every `ADMIN_EMAILS` address → user completes onboarding (email
  verification works while pending) → lands on `/beta` waiting room (polls
  every 30 s) → you approve at `/admin` → approval email → the waiting room
  unlocks itself. Pending users are blocked server-side from `/scores` (HTTP)
  and from opening a recording socket, not just in the UI.
- Your admin account: sign up with an email listed in `ADMIN_EMAILS` (role +
  approval are stamped at signup). For an **existing** account run:
  `UPDATE "user" SET role='admin', "betaStatus"='approved' WHERE email='...';`
- Local dev: `demo@mushee.local` is seeded as admin, all demo accounts are
  pre-approved.
- Turning the beta **off** (both env vars to `false`) immediately un-gates
  pending users. They stay on the `beta` tier (still defined, 5 min/day)
  until you migrate them: `UPDATE user_subscriptions SET "tierId"='free' WHERE "tierId"='beta';`
  — decide whether beta users keep their perk at launch.

### Legal / branding placeholders (must replace)
- Legal entity + postal address: “Sheemu (Sheemu Music BV), Voorbeeldstraat 12,
  2000 Antwerp, Belgium” appears in `/privacy`, `/terms`, `/contact`.
- Dummy emails used everywhere: `support@`, `hello@`, `privacy@`,
  `legal@sheemu.app` (also inside transactional emails).
- Canonical domain: I defaulted `NEXT_PUBLIC_SITE_URL` to `https://sheemu.app`,
  but the repo's only real domain reference was `no-reply@mushee.app`
  (SendGrid default). Pick one domain and align: site URL, mail from-address,
  and DNS (SPF/DKIM/DMARC for SendGrid).
- Governing law is set to Belgium in the ToS (guessed from context).
- **Have a lawyer review both documents.** They are written to be GDPR-sound
  (consent-first analytics, correct legal bases, retention table, rights,
  MoR structure via Polar) but I'm not a law firm.

---

## 2. Decisions I made without input

- **Native NestJS Polar integration** instead of the `@polar-sh/better-auth`
  plugin. The plugin routes webhooks through the better-auth handler, which in
  this codebase re-serializes JSON bodies — that breaks standard-webhooks
  signature verification. Instead: a custom JSON body parser in `main.ts`
  preserves the raw bytes (`req.rawBody`), and `POST /billing/webhooks/polar`
  verifies signatures with `@polar-sh/sdk`'s `validateEvent`. Webhook
  deliveries are deduped via the `processed_webhook_events` table, and the
  tier is mirrored into `user_subscriptions` from both `subscription.*`
  events and `customer.state_changed` snapshots (idempotent upserts).
  Customers are keyed by `externalCustomerId = userId`.
- **One plan catalogue.** There were three divergent `PLAN_TIERS` copies
  (landing showed $15/$99 tiers named Tinkerer/Hobbyist/Professional; settings
  and onboarding said $8/$18 Sketch/Composer/Studio). Consolidated into
  `apps/web/src/lib/plans.ts`, matching the API's `SubscriptionTier`.
- **Feature lists trimmed to the truth.** The old tier cards promised
  collaborators, shareable links, themes, custom templates, and a 3-score
  limit — none of which exist (there's also no score-count enforcement, so
  advertising a limit would be odd). Plans now differ only by recording time,
  which is what the backend actually enforces.
- **Removed fabricated testimonials and the “Trusted by Berklee/Juilliard”
  strip** from the landing page — fake endorsements are a legal liability the
  moment you charge money.
- **Hero “GIF”**: I can't screen-record the real editor from here, so the hero
  is a hand-built looping animation (`apps/web/src/app/HeroDemo.tsx`) that
  re-creates a recording session: REC indicator + timer, live waveform, notes
  landing on the staff one by one with a playhead. It's honest about being a
  re-creation (caption says “Recording in the Sheemu editor”), respects
  `prefers-reduced-motion`, and weighs ~0 KB. If you'd rather have real
  footage: record the editor with QuickTime/Kap, export an `.mp4`/`.webm`
  (not an actual GIF — 10× smaller), drop it in `apps/web/public/`, and swap
  `<HeroDemo />` for a `<video autoPlay muted loop playsInline>` element.
- **Consent design**: one `analytics` category (PostHog covers product
  analytics, web analytics, replay, and error tracking — one purpose bundle),
  versioned via `CONSENT_VERSION` so changing what you track re-prompts
  everyone. Equal-prominence “Accept all” / “Essential only” buttons, and a
  footer “Cookie settings” reopener. PostHog initializes opted-out with
  in-memory persistence, so literally nothing is stored or sent pre-consent.
  Server-side error reports (instrumentation.ts) run on legitimate interest.
- **Beta semantics**: `betaStatus` is stamped at signup (`pending`), `null`
  means “predates the beta / not applicable” — so existing accounts are never
  locked out if you flip the flag on later, and flipping it off un-gates
  everyone without data changes.
- **Admins get the Studio tier at signup** (unlimited recording), since you'll
  be testing recording a lot.
- **Emails rebranded to Sheemu** (they said “Mushee”, the internal repo name),
  including the SendGrid from-name default.

## 3. Bugs found and fixed along the way

1. **`apps/web/src/proxy.ts` was a no-op**: `publicPaths = ['/', ...]` with
   `startsWith` matching meant *every* path matched `'/'` — the auth
   middleware never redirected anyone. Fixed with exact-match for `/` +
   explicit prefixes.
2. **`/reset-password` wasn't a public path** in the middleware, so password
   reset links from email bounced to `/login` for signed-out users (the exact
   people resetting passwords).
3. **Raw audio of every recording was written to disk unconditionally**
   (`RecordingPipeline.writeDebugBundle` defaulted to `debug/recordings/`).
   In production that silently persists users' voice recordings — a GDPR
   problem and a disk filler. Now: only in non-production, or when
   `RECORDINGS_DEBUG_DIR` is explicitly set. (The privacy policy promises
   audio is processed in memory only — this fix makes that true.)
4. **`Brand.tsx` used React hooks without `'use client'`** — broke the build
   as soon as a server component imported `Wordmark`/`Footer`.
5. **`@polar-sh/sdk` peer-pinned to 0.47.x** (1.8.x of the webhook types need
   it; 0.48 was initially resolved and unmet).
6. API `tsconfig` split into `tsconfig.json` (IDE/type-check/tests) and
   `tsconfig.build.json` (nest build, src only) so the new test suite is
   type-checked and linted.

## 4. Loose ends I'd look at next

- **Root `pnpm lint` has a large pre-existing error baseline** (~10k, mostly
  `apps/api/scripts/eval/**`, generated proto files, and older any-typed
  spots). Everything I added or touched lints clean; the baseline predates
  this work. Worth a dedicated cleanup or scoping lint to `src/`.
- **GDPR data export (portability)**: per-score MusicXML/MIDI/PDF export
  exists in the editor, but there's no one-click “export everything +
  account data” endpoint. The privacy policy currently promises export via
  the editor and data access on request — fine for launch, nicer with an
  endpoint.
- **Webhook events table** grows one row per delivery — harmless for years,
  but a monthly prune cron would be tidy.
- **Session cookie cache is 5 min**, so `role`/`betaStatus` in the session can
  lag; every gate that matters reads fresh state from the DB instead
  (`/beta/status`, `BetaApprovalGuard`, recording gateway), and the waiting
  room polls. Just don't rely on `session.user.betaStatus` for enforcement.
- **PLAN_TIERS ↔ Polar products** are linked by env vars only; if you change
  tiers, update `SubscriptionTier` (API), `plans.ts` (web), and the Polar
  products together.
- **CI**: nothing runs these checks automatically yet. A GitHub Actions
  workflow running `type-check` + `test` + `build` on both apps would have
  caught everything I fixed above.
- **hCaptcha/Turnstile on signup** (from your TODO) is still open — during
  the closed beta the manual approval effectively rate-limits abuse, but add
  it before opening signups.
- The `sitemap`/`robots`/OG image derive from `NEXT_PUBLIC_SITE_URL` — set it
  in production or everything says `sheemu.app`.
- **k8s**: `deploy/k8s/overlays/local/secret.yaml` got the new keys with safe
  local defaults; production `api-secrets` needs the real Polar/beta/mail
  values (README § Deployment lists them all).
