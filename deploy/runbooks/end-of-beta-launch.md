# Runbook 5 — End the beta, open to the public

Two separable events: **turning on paid billing** (Polar production) and
**removing the waitlist gate** (`BETA_MODE` off). They can ship weeks apart —
billing first is the sensible order, so paying starts working while the
audience is still small and forgiving.

## 1. Pre-flight — before either flip

- [ ] Lawyer has reviewed `/terms` + `/privacy` (master-todo item 1's open
      half; include the stored-recording-audio section).
- [ ] **Signup CAPTCHA** — code shipped 2026-09-05 (Cloudflare Turnstile via
      better-auth's captcha plugin, signup endpoint only). Still to do: create
      the Turnstile widget in the Cloudflare dashboard (managed mode, domain
      solkey.io), put `TURNSTILE_SECRET_KEY` in `Secret/api-secrets` and
      `NEXT_PUBLIC_TURNSTILE_SITE_KEY` in the web project's Vercel env, then
      sign up once for real. Without the secret the API boots with a warning
      and signup is unprotected — treat the keys as a blocker for the
      BETA_MODE flip, not a nice-to-have.
- [ ] Error tracking wired — code done on both halves (web: PostHog
      `capture_exceptions` in `lib/analytics.ts`; API: `TelemetryModule`
      reports 5xx + crashes when `POSTHOG_API_KEY` is set, 2026-09-05).
      Remaining: put `POSTHOG_API_KEY` in `Secret/api-secrets` and enable
      Error tracking in the PostHog project settings — public users report
      bugs as vibes; you need stack traces.
- [ ] N-session recording load test ran (master-todo item 13,
      `scripts/test-recording-ws.ts`) so the per-pod ceiling and HPA maxima
      are numbers, not guesses.
- [ ] Restore rehearsal green within the last quarter (Runbook 4 §2).
- [x] GDPR data export exists (master-todo item 14, done 2026-09-05:
      Settings → Account → "Download my data", built client-side). The
      download deliberately leaves audio out; the recordings half of "your
      data" is the takes inventory below.
- [x] **Takes / recordings inventory** shipped 2026-09-05: per-score "Takes"
      panel in the editor header and the all-scores inventory in Settings →
      Your data (replay + two-step delete; `GET /recordings`,
      `DELETE /recordings/:id`). The privacy policy's "yours, delete any time"
      is now literally true, so nothing here blocks the flip — but spot-check
      once on production that playback streams and a delete removes both the
      audio folder and the row.
- [ ] **Share links** (`/s/<token>`, shipped 2026-09-05) — confirm on
      production before strangers arrive: a shared page carries `noindex` and
      `robots.txt` disallows `/s/`; the public `GET /shared/:token` payload is
      title/updatedAt/document only (no owner, never recordings); Terms §5 and
      Privacy §2 (dated 5 September 2026) describe the feature — include them
      in the lawyer's pass above; and the admin console's "Turn link off" on a
      score page (`DELETE /admin/scores/:id/share`) works, since that is the
      support lever for an abuse/DMCA-style report.
- [ ] **Beta-ending mail is drafted** — copy lives in
      `meta/marketing/BETA-ENDING-EMAIL.md`; send it via the admin
      Announcements tool (§3 below), never by hand from SendGrid.

## 2. Polar production go-live

Do the whole thing in **sandbox first** (`POLAR_SERVER=sandbox`,
sandbox.polar.sh) against uat or local; then repeat in production. The full
sandbox test matrix is in `meta/notes.md` §1: checkout → webhook → tier flips
in Settings; cancel → resume; plan change (`POST /billing/change` must update
the existing subscription with proration, never create a second one).

Production sequence:

1. Polar dashboard (production org): create **6 subscription products** —
   Songwriter $9/mo + $90/yr, Studio $19/mo + $190/yr, Arranger $49/mo +
   $490/yr — and **3 one-time minute packs** — Single $6 (15 min), EP $15
   (45 min), Album $39 (150 min) (the 2026-07 pricing relaunch; EUR at
   numeral parity, tax behavior `location-based`). Prices/names must stay in
   sync with the DB seed (`subscription_tiers`) and the display decoration in
   `apps/web/src/lib/plans.ts` — change all three together or the landing
   and /pricing pages lie.
2. Create an access token; add a webhook endpoint pointing at
   `https://api.solkey.io/billing/webhooks/polar`, subscribed to
   `subscription.*` + `customer.state_changed` + `order.paid` +
   `order.refunded` (packs land via `order.paid`); note the webhook secret.
3. Add to `Secret/api-secrets` (carry existing keys — recreate-and-apply as
   in Runbook 1 §4b) and restart the API:
   `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET`, `POLAR_SERVER=production`,
   `POLAR_PRODUCT_{PRO,STUDIO,ARRANGER}_{MONTHLY,YEARLY}`,
   `POLAR_PRODUCT_PACK_{SINGLE,EP,ALBUM}`.
4. Verify while checkout is still beta-locked (the webhook path is live even
   though purchase is blocked): Polar's dashboard can send a test event —
   expect 202 and a row in `processed_webhook_events`. A forged call must 403:
   `curl -s -o /dev/null -w '%{http_code}\n' -X POST https://api.solkey.io/billing/webhooks/polar -d '{}'`.
5. Real-money test once BETA_MODE is off (or with an admin account if
   checkout opens earlier): buy Songwriter monthly with a real card, watch the
   tier flip in Settings within seconds (webhook), then cancel and confirm
   the paid period plays out. Refund yourself in Polar afterwards.
6. First weeks of real charges: spot-check Polar's VAT handling on an EU
   invoice (they're merchant of record — it's their job, verify anyway), and
   revisit `meta/notes.md` on VAT if your own BTW status has changed.

Unconfigured→configured is graceful in both directions: if Polar
misbehaves, removing `POLAR_ACCESS_TOKEN` + restart puts billing back into
its 503/hidden state without touching anything else.

## 3. Decide the beta users' fate _before_ the flip

They're on tier `beta` (1800 credits = 30 min/day since the pricing relaunch
migration, not sellable). Options:

- **Grandfather them** (generous, zero effort): leave rows alone; the tier
  stays functional, they keep 30 min/day forever — more than Songwriter's
  20 min, so nobody on it ever has a reason to pay — can upgrade any time.
- **Migrate to free** (Sketch: 180 credits = 3 min/day, 5 scores):
  `UPDATE user_subscriptions SET "tierId"='free' WHERE "tierId"='beta';`
- Middle path: re-tune the beta tier itself (e.g. down to Songwriter's 1200)
  (`UPDATE subscription_tiers SET "dailyRecordingCredits"=… WHERE id='beta'`;
  live within 60 s, no deploy).

Whatever you choose, email them about it before they notice — from the admin
console's **Announcements** page (audience filter: plan `Beta`; send a test copy
to yourself first; every send is logged). The copy is
`meta/marketing/BETA-ENDING-EMAIL.md` — paste subject + plain-text body
(`{{name}}` is substituted per recipient), check the live count and the
sandboxed preview, **Send test** to yourself, then **Send to N accounts**. If the result says SendGrid rejected
some recipients, do **not** send again to the same filter — the accounts that
were reached already have it. Fix the cause (SendGrid status page, API key,
sender verification) and use the history row's **"Resend to N not reached"**,
which goes to exactly those accounts. A "you were here first" discount code in
Polar costs nothing and buys goodwill.

## 4. The flip

Semantics that make this safe (from `meta/notes.md`): `betaStatus` stamped
`pending` only at signup while the flag is on; flipping **off** un-gates
everyone instantly with zero data changes; flipping back **on** later never
locks out existing accounts. The server's runtime `betaMode` is trusted by
the web client too, so the gate drops even before the web rebuild.

1. `deploy/k8s/overlays/production/api-patch.yaml`: `BETA_MODE: 'false'` →
   commit → run Deploy. (Keep `ADMIN_EMAILS` — it still grants the studio
   tier at signup and receives signup notifications; console access itself
   is `ADMIN_SECRET`.)
2. Vercel env: `NEXT_PUBLIC_BETA_MODE=false` (Production) → redeploy web.
   This is the flip that changes the _copy_ — landing CTA, pricing buttons,
   the /pricing tier ladder, signup messaging (build-time baked, needs the
   rebuild).
3. Smoke: new signup goes straight to onboarding (no waiting room), pricing
   buttons lead to Polar checkout, `/beta` for an approved user shows
   "you're in", the admin console (admin.solkey.io) still signs in.
4. Watch signups: `SELECT count(*), max("createdAt") FROM "user";` and the
   SendGrid activity feed (OTP volume = signup volume). This is where the
   missing CAPTCHA would show up first.

## 5. Launch-day posture

- **Scaling headroom is config, not code**: API HPA 2→6 (raise `maxReplicas`
  in `base/api.yaml` if the load test says so — but check the DB connection
  arithmetic in Runbook 4 §7 first), crepe-inference 2→10.
  Autopilot adds nodes by itself; nothing else to pre-warm.
- Cloud SQL `db-custom-1-3840` is the most likely first bottleneck under
  real load; the resize is a 2-minute restart (Runbook 4 §7) — decide the
  threshold (CPU > 70% sustained in Cloud SQL monitoring) _before_ the day.
- The old product gap — an inference outage silently burning credits with
  no notes appearing — is closed since 2026-09-05: the recorder shows a
  toast and the session stops metering until transcription is back (Runbook
  3 §3). Under launch load, inference HPA lag will trigger that signal for
  a minute or two; that is the signal working, not a new incident.
- Have the two rollback levers ready in a terminal: previous-SHA redeploy
  (Runbook 3 §2) and Vercel instant rollback. Nothing about launch changes
  them; the point is not looking them up mid-incident.

## 6. The week after

- Prune the beta furniture when the data says nobody's pending: the `/beta`
  waiting room (web) and the admin console's waitlist page stay (harmless,
  `BETA_MODE` may return for future gated features), but master-todo items that were
  beta-scoped (uptime monitoring, support inbox, refund policy, DPAs —
  `meta/notes.md` §6) graduate from "later" to "now" the day real money and
  strangers are involved.
- Re-run Runbook 1 (rotate everything) if launch involved any credential
  passing through chats, screenshots, or streams. It did last time.
