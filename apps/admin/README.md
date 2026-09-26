# Solkey admin console (`apps/admin`)

Standalone Next.js app for operating Solkey. No user accounts: you sign in with
the console secret, which never reaches the browser after that — the login
handler exchanges it for a signed session cookie, and every call to the API goes
through the server-side proxy at `src/app/api/admin/[...path]/route.ts`, which
adds the `x-admin-secret` header on the way through. The API therefore needs no
CORS entry for the console.

## Run it locally

```sh
pnpm --filter @mushee/admin dev     # http://localhost:3500
```

`apps/admin/.env.development` must carry the same `ADMIN_SECRET` as
`apps/api/.env.development`, plus `API_URL` (default `http://localhost:4200`).
Production sets `ADMIN_SECRET`, `API_URL` and optionally `ADMIN_SESSION_HOURS`.

Tests are pure logic only (`pnpm --filter @mushee/admin test`: session tokens,
piano-roll geometry, audience query mapping); pages are exercised against the
running stack.

## Pages

| Page              | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dashboard**     | Signups, recordings and credit usage at a glance.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Users**         | Search accounts; per user: plan, sessions (revoke), purchased-pack balance (grant / claw back), scores.                                                                                                                                                                                                                                                                                                                                                                    |
| **Waitlist**      | Beta applicants; approve sends the "you're in" e-mail.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Announcements** | Service e-mail to a filtered audience (plans, beta status, signup window, recent activity, verified only — the default). Live count + sample, **Export CSV** for SendGrid Marketing Campaigns, subject/body with `{{name}}`, `**bold**` and `[label](https://…)`, sandboxed preview, **Send test**, confirmed **Send to N**. Every run is recorded; a partially rejected run offers **Resend to N not reached**. Service mail only — no unsubscribe link, never marketing. |
| **Tiers**         | Subscription tiers as the API serves them (`GET /plans`), with user counts.                                                                                                                                                                                                                                                                                                                                                                                                |
| **Score detail**  | From a user's list: the score document, its recordings with playback, and the read-only share link with **Turn link off** for reported links.                                                                                                                                                                                                                                                                                                                              |

The end-of-beta runbook (`deploy/runbooks/end-of-beta-launch.md`) walks through
the Announcements flow for the "beta is ending" mail.
