# End-to-end tests

Two Playwright suites cover the web app:

| Suite | Config | Backend | Command |
| --- | --- | --- | --- |
| **Mocked editor** | `playwright.config.ts` | None — API + auth are intercepted with `page.route` | `pnpm test:e2e` |
| **Full-stack smoke** | `playwright.fullstack.config.ts` | Real `@mushee/api` + Postgres | `pnpm test:e2e:smoke` |

> The e2e suites run on their own ports (web `3300`, api `4300`, postgres `5532`),
> kept distinct from the main mushee dev stack (web `3200`, api `4200`, postgres
> `5632`) so you can run the tests while a dev server is up.

## Mocked editor suite (default)

Self-contained: starts the web app on **port 3300** and intercepts every backend
call. No database or API server is required.

```bash
pnpm --filter @mushee/web exec playwright install chromium   # one-time
pnpm --filter @mushee/web test:e2e
```

What it covers (`e2e/editor.spec.ts`, `e2e/library.spec.ts`):

- Editor loads and engraves a score (staff lines + noteheads).
- Keyboard pitch editing triggers the debounced autosave (`PATCH /scores/:id`).
- Control bar: duration change, rest toggle, clef/tempo popovers.
- Export to **MusicXML**, **MIDI**, and **PDF** (real downloads, verified headers).
- Library: list, open, create (serializes a fresh score in-browser), delete.

Auth/score responses live in `e2e/fixtures.ts`; the score DTO is in
`e2e/fixtures/score.partwise.json` (regenerate with the throwaway generator
described in that file if the serializer format changes).

### Override the web port

```bash
E2E_WEB_PORT=3400 pnpm test:e2e
```

## Full-stack smoke suite

Runs against a **real, already-running** stack. It does not start anything itself
— bring the stack up first, then run the suite. Every test auto-skips if the web
app isn't reachable, so it's safe to run anywhere.

1. Start the database on the e2e port (so it doesn't clash with the main dev db):

   ```bash
   docker run -d --name mushee-e2e-pg  -e POSTGRES_USER=mushee -e POSTGRES_PASSWORD=mushee -e POSTGRES_DB=mushee -p 5532:5432 postgres:17-alpine
   ```

2. Start the API on port 4300, pointed at that database (see `apps/api/.env.development`
   for the variables — `POSTGRES_HOST`/`POSTGRES_PORT`/..., `PORT`). Pending
   TypeORM migrations run automatically on boot.

   ```bash
   cd apps/api && PORT=4300 POSTGRES_PORT=5532 pnpm dev
   ```

3. Start the web app on port 3300, pointed at the API:

   ```bash
   cd apps/web && NEXT_PUBLIC_API_URL=http://localhost:4300 next dev -p 3300
   ```

4. Run the smoke:

   ```bash
   pnpm --filter @mushee/web test:e2e:smoke
   ```

By default it verifies the public login page serves and hydrates. To run the
authed **create → edit → reload** persistence flow, supply a valid better-auth
session token (sign-up needs email verification, so export one from a seeded
account):

```bash
E2E_SESSION_TOKEN=<better-auth.session_token> \
E2E_WEB_URL=http://localhost:3300 \
pnpm --filter @mushee/web test:e2e:smoke
```
