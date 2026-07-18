# Runbook 5 — End the beta, open to the public

Two separable events: **turning on paid billing** (Polar production) and
**removing the waitlist gate** (`BETA_MODE` off). They can ship weeks apart —
billing first is the sensible order, so paying starts working while the
audience is still small and forgiving.

## 1. Pre-flight — before either flip

- [ ] Lawyer has reviewed `/terms` + `/privacy` (master-todo item 1's open
      half; include the stored-recording-audio section).
- [ ] **Signup CAPTCHA** (hCaptcha/Turnstile — master-todo item 15). The
      waitlist currently absorbs abuse; the moment approval is gone, signup
      is an open faucet with mail-sending attached. Treat as a blocker for
      the BETA_MODE flip, not a nice-to-have.
- [ ] Error tracking wired (`main.ts` + `instrumentation.ts` hook points) —
      public users report bugs as vibes; you need stack traces.
- [ ] N-session recording load test ran (master-todo item 13,
      `scripts/test-recording-ws.ts`) so the per-pod ceiling and HPA maxima
      are numbers, not guesses.
- [ ] Restore rehearsal green within the last quarter (Runbook 4 §2).
- [ ] GDPR data-export endpoint exists (master-todo item 14) — the privacy
      policy promises portability and a public launch widens exposure.

## 2. Polar production go-live

Do the whole thing in **sandbox first** (`POLAR_SERVER=sandbox`,
sandbox.polar.sh) against uat or local; then repeat in production. The full
sandbox test matrix is in `meta/notes.md` §1: checkout → webhook → tier flips
in Settings; cancel → resume; plan change (`POST /billing/change` must update
the existing subscription with proration, never create a second one).

Production sequence:

1. Polar dashboard (production org): create **4 products** — Composer $8/mo,
   Composer $80/yr, Studio $18/mo, Studio $180/yr. Prices/names must stay in
   sync with the DB seed (`subscription_tiers`) and the display decoration in
   `apps/web/src/lib/plans.ts` — change all three together or the landing
   page lies.
2. Create an access token; add a webhook endpoint pointing at
   `https://api.solkey.io/billing/webhooks/polar`, subscribed to
   `subscription.*` + `customer.state_changed`; note the webhook secret.
3. Add to `Secret/api-secrets` (carry existing keys — recreate-and-apply as
   in Runbook 1 §4b) and restart the API:
   `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET`, `POLAR_SERVER=production`,
   `POLAR_PRODUCT_PRO_MONTHLY`, `POLAR_PRODUCT_PRO_YEARLY`,
   `POLAR_PRODUCT_STUDIO_MONTHLY`, `POLAR_PRODUCT_STUDIO_YEARLY`.
4. Verify while checkout is still beta-locked (the webhook path is live even
   though purchase is blocked): Polar's dashboard can send a test event —
   expect 202 and a row in `processed_webhook_events`. A forged call must 403:
   `curl -s -o /dev/null -w '%{http_code}\n' -X POST https://api.solkey.io/billing/webhooks/polar -d '{}'`.
5. Real-money test once BETA_MODE is off (or with an admin account if
   checkout opens earlier): buy Composer monthly with a real card, watch the
   tier flip in Settings within seconds (webhook), then cancel and confirm
   the paid period plays out. Refund yourself in Polar afterwards.
6. First weeks of real charges: spot-check Polar's VAT handling on an EU
   invoice (they're merchant of record — it's their job, verify anyway), and
   revisit `meta/notes.md` on VAT if your own BTW status has changed.

Unconfigured→configured is graceful in both directions: if Polar
misbehaves, removing `POLAR_ACCESS_TOKEN` + restart puts billing back into
its 503/hidden state without touching anything else.

## 3. Decide the beta users' fate *before* the flip

They're on tier `beta` (300 credits = 5 min/day, not sellable). Options:

- **Grandfather them** (generous, zero effort): leave rows alone; the tier
  stays functional, they keep 5 min/day forever, can upgrade any time.
- **Migrate to free** (30 credits/day):
  `UPDATE user_subscriptions SET "tierId"='free' WHERE "tierId"='beta';`
- Middle path: re-tune the beta tier itself
  (`UPDATE subscription_tiers SET "dailyRecordingCredits"=… WHERE id='beta'`;
  live within 60 s, no deploy).

Whatever you choose, email them about it before they notice. A "you were
here first" discount code in Polar costs nothing and buys goodwill.

## 4. The flip

Semantics that make this safe (from `meta/notes.md`): `betaStatus` stamped
`pending` only at signup while the flag is on; flipping **off** un-gates
everyone instantly with zero data changes; flipping back **on** later never
locks out existing accounts. The server's runtime `betaMode` is trusted by
the web client too, so the gate drops even before the web rebuild.

1. `deploy/k8s/overlays/production/api-patch.yaml`: `BETA_MODE: 'false'` →
   commit → run Deploy. (Keep `ADMIN_EMAILS` — admin bootstrap still uses it.)
2. Vercel env: `NEXT_PUBLIC_BETA_MODE=false` (Production) → redeploy web.
   This is the flip that changes the *copy* — landing CTA, pricing buttons,
   signup messaging (build-time baked, needs the rebuild).
3. Smoke: new signup goes straight to onboarding (no waiting room), pricing
   buttons lead to Polar checkout, `/beta` for an approved user shows
   "you're in", `/admin` still works for you.
4. Watch signups: `SELECT count(*), max("createdAt") FROM "user";` and the
   SendGrid activity feed (OTP volume = signup volume). This is where the
   missing CAPTCHA would show up first.

## 5. Launch-day posture

- **Scaling headroom is config, not code**: API HPA 2→6 (raise `maxReplicas`
  in `base/api.yaml` if the load test says so — but check the DB connection
  arithmetic in Runbook 4 §7 first), crepe-inference 2→10, basic-pitch 1→4.
  Autopilot adds nodes by itself; nothing else to pre-warm.
- Cloud SQL `db-custom-1-3840` is the most likely first bottleneck under
  real load; the resize is a 2-minute restart (Runbook 4 §7) — decide the
  threshold (CPU > 70% sustained in Cloud SQL monitoring) *before* the day.
- Keep an eye on the known product gap: an inference outage silently burns
  users' credits with no notes appearing (Runbook 3 §3, last rows). Under
  launch load, inference HPA lag looks exactly like that for a minute or
  two. If launch traffic is a real possibility, fix the user-facing error
  signal first — it converts "Solkey is broken" tweets into "it told me to
  retry".
- Have the two rollback levers ready in a terminal: previous-SHA redeploy
  (Runbook 3 §2) and Vercel instant rollback. Nothing about launch changes
  them; the point is not looking them up mid-incident.

## 6. The week after

- Prune the beta furniture when the data says nobody's pending: `/beta`
  waiting room and `/admin` approval UI stay (harmless, `BETA_MODE` may
  return for future gated features), but master-todo items that were
  beta-scoped (uptime monitoring, support inbox, refund policy, DPAs —
  `meta/notes.md` §6) graduate from "later" to "now" the day real money and
  strangers are involved.
- Re-run Runbook 1 (rotate everything) if launch involved any credential
  passing through chats, screenshots, or streams. It did last time.
