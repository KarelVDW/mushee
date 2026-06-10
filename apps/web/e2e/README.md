# End-to-end tests

Two Playwright suites cover the web app:

| Suite | Config | Backend | Command |
| --- | --- | --- | --- |
| **Mocked editor** | `playwright.config.ts` | None — API + auth are intercepted with `page.route` | `pnpm test:e2e` |
| **Full-stack smoke** | `playwright.fullstack.config.ts` | Real `@mushee/api` + Postgres + Mongo | `pnpm test:e2e:smoke` |

> Default dev ports (web `3000`, api `4000`, postgres `5432`, mongo `27017`) are assumed
> to be in use by another project, so everything here runs on **alternate ports**.

## Mocked editor suite (default)

Self-contained: starts the web app on **port 3100** and intercepts every backend
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
E2E_WEB_PORT=3200 pnpm test:e2e
```

## Full-stack smoke suite

Runs against a **real, already-running** stack. It does not start anything itself
— bring the stack up first, then run the suite. Every test auto-skips if the web
app isn't reachable, so it's safe to run anywhere.

1. Start databases on alternate ports (so they don't clash with the other project):

   ```bash
   docker run -d --name mushee-e2e-pg  -e POSTGRES_USER=mushee -e POSTGRES_PASSWORD=mushee -e POSTGRES_DB=mushee -p 5532:5432 postgres:17-alpine
   docker run -d --name mushee-e2e-mongo -p 27117:27017 mongo:8
   ```

2. Start the API on port 4100, pointed at those databases (see `apps/api/.env.development`
   for the variables — typically `DATABASE_URL`, `MONGO_URL`, `PORT`).

   ```bash
   cd apps/api && PORT=4100 DATABASE_URL=postgres://mushee:mushee@localhost:5532/mushee \
     MONGO_URL=mongodb://localhost:27117/mushee pnpm dev
   ```

3. Start the web app on port 3100, pointed at the API:

   ```bash
   cd apps/web && NEXT_PUBLIC_API_URL=http://localhost:4100 next dev -p 3100
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
E2E_WEB_URL=http://localhost:3100 \
pnpm --filter @mushee/web test:e2e:smoke
```
