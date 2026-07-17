---
name: verify
description: Build, launch, and drive the Mushee stack to verify web/api changes end-to-end at the real browser surface.
---

# Verifying Mushee changes end-to-end

## Boot the real dev stack

```sh
pnpm run setup   # NOT `pnpm setup` — that hits pnpm's built-in and silently no-ops
pnpm dev         # web :3200, api :4200 (background it; readiness: curl :3200 and :4200/plans)
```

`pnpm run setup` needs `apps/api/.env.development` — copy it from
`apps/api/.env.example` if `db:clean` fails with "not found". Postgres runs in
Docker on :5632. Re-seed between destructive runs with `pnpm run db:seed`
(idempotent) or `pnpm run db:reset` (full wipe).

Demo login: `demo@mushee.local` / `mushee-demo` (others in root README).

## Drive the UI ad hoc

Playwright is in `apps/web` (`@playwright/test`, chromium installed). A plain
node script works, but it must resolve modules from `apps/web` — copy it into
`apps/web/*.tmp.mjs`, run, delete. Import `{ chromium } from '@playwright/test'`.

Login flow selectors: `getByLabel(/email/i)`, then
`getByRole('textbox', { name: /password/i })` (a bare `getByLabel(/password/i)`
is ambiguous — it also matches the visibility toggle), then the sign-in button;
wait for `**/scores`. Create-score dialog title field:
`getByPlaceholder('Untitled composition')`.

## Full-stack e2e smoke (real API, alternate ports)

`pnpm --filter @mushee/web test:e2e:smoke` — bring the stack up first per
`apps/web/e2e/README.md`: postgres :5532 (docker), API :4300, web :3300.
The API MUST get `TRUSTED_ORIGINS=http://localhost:3300` (plus
`CORS_ORIGIN`/`BETTER_AUTH_URL`) or better-auth 403s every sign-in with
"Invalid origin". Authed tests log in as the seeded demo account through the
real form. Kill the :3300 web server before running the mocked suite
(`pnpm --filter @mushee/web test:e2e`) — it reuses an existing :3300 server
and the mocked tests then hit the real API instead of the mock origin.

## Gotchas

- The mocked e2e suite (`apps/web/e2e`, port 3300) intercepts ALL API traffic
  and fulfills with well-formed JSON — it cannot catch real HTTP-layer bugs
  (empty bodies, content-type handling, CORS). Anything touching
  `apps/web/src/lib/api.ts` or transport behavior needs the real stack.
- The API is Fastify: it 400s any request that carries
  `Content-Type: application/json` with an empty body, and void controllers
  (e.g. DELETE) respond 200 with a completely empty body.
- Error toasts render text like "Could not delete the score. Please try
  again." — assert via `getByText(/could not .../i)`.
