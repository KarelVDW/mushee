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

What it covers:

- `editor.spec.ts` — editor loads and engraves; keyboard pitch editing +
  debounced autosave; duration/rest controls; range selection (shift+arrows,
  drag); copy/paste; shortcut rebinding persists; clef/tempo popovers open;
  export to **MusicXML**, **MIDI**, and **PDF** (real downloads, verified headers).
- `editor-keyboard.spec.ts` — every remaining default keybinding from
  `commands.ts` (arrow navigation, R/T/./3 toggles, Backspace clear pitch) and
  that shortcuts stay suspended while a dialog is open.
- `editor-tools.spec.ts` — title rename autosave; dotted/triplet/tie toggles;
  accidental segmented control; clef/key-signature/tempo selection through the
  popovers; Escape dismissal; change-instrument dialog (apply + cancel);
  shortcuts dialog remove/restore-defaults; in-score add/remove measure;
  transport idle states.
- `library.spec.ts` — list, open (title + pencil), create (validation, Enter
  submit, cancel/Escape, instrument choice), delete (confirm, decline, Escape,
  ×, failure toast on a 500), search filter + no-match state, empty state,
  top-nav controls.
- `auth.spec.ts` — login (password visibility, Enter submit, links), signup
  into onboarding, reset-password stages + validation.
- `settings.spec.ts` — tabs, profile save, change-password validation,
  delete-account guards (phrase + password + checkbox), sign out, footer
  cookie-settings dialog.
- `landing.spec.ts` — unauthed CTAs, cookie banner (accept/essential/customize,
  persistence across reload).
- `mobile.spec.ts` — phone chrome, reflow, touch note editing, dock sheets.

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

2. Start the API on port 4300, pointed at that database. Pending TypeORM
   migrations run automatically on boot; `SEED_DEMO_DATA` provides the demo
   login the authed tests use. The web app runs on 3300 here, so the API must
   trust that origin (both CORS **and** better-auth — without `TRUSTED_ORIGINS`
   the sign-in POST is rejected with 403 "Invalid origin"):

   ```bash
   cd apps/api && PORT=4300 POSTGRES_PORT=5532 SEED_DEMO_DATA=true \
     CORS_ORIGIN=http://localhost:3300 TRUSTED_ORIGINS=http://localhost:3300 \
     BETTER_AUTH_URL=http://localhost:4300 pnpm dev
   ```

3. Start the web app on port 3300, pointed at the API:

   ```bash
   cd apps/web && NEXT_PUBLIC_API_URL=http://localhost:4300 next dev -p 3300
   ```

   > Don't leave this server running when you go back to the mocked suite: it
   > also uses port 3300 and will happily reuse a server that points at the
   > real API instead of the mock origin — every mocked test then fails.

4. Run the smoke:

   ```bash
   pnpm --filter @mushee/web test:e2e:smoke
   ```

Always (when the app is up) it verifies the public login page serves and
hydrates. The authed tests sign in through the real login form as the seeded
demo account (`demo@mushee.local` / `mushee-demo`; override with
`E2E_EMAIL`/`E2E_PASSWORD`) and cover the full score lifecycle against the real
API — create → edit → rename → reload → **delete** — plus a dedicated check
that the body-less DELETE round-trips cleanly (empty 200 body, no JSON
content-type on the request). That transport layer is exactly what the mocked
suite cannot see: its route mocks answer DELETE with well-formed JSON and
enforce no content-type rules, which is how the 2026-07 delete-button breakage
stayed green in CI. `E2E_SESSION_TOKEN` is still honored as a cookie-based
alternative to the form login.
