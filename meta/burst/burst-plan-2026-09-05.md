# Burst plan — 2026-09-05, ~09:43 → 09:59 (Europe/Brussels)

**Purpose.** Spend the remaining weekly budget in the short window between the
next session-limit reset (~09:43) and the weekly reset (09:59) on the largest
set of _independent, self-verifying_ product improvements that a fan-out of
parallel agents can land safely. Hard rule: **all agent work stops at 09:57;
nothing launches after 09:50; the orchestrator finishes by 09:59.** After the
weekly reset there is no reason to keep spending — stop.

**How to run it (paste at ~09:43, right after the session limit resets):**

> ultracode: execute meta/burst/burst-plan-2026-09-05.md now. Follow its
> timing rules exactly — hard stop at 09:57 for agents, 09:59 for you — and
> stop spending once the weekly limit has reset. Report what merged, what
> didn't, and why.

(The `ultracode` keyword opts you into the multi-agent Workflow; without it
Claude will only use single subagents.)

## Ground rules for every agent

- Work in **your own git worktree** on branch `burst/<task-id>` off the tag
  **`burst-base-2026-09-05`** (commit `cd92875`, full CI-equivalent green at 07:45 plus type-check/lint/prettier and the api+web+admin unit suites on the later commits) —
  **not** off the tip of `experimental`, which may carry unverified commits from a
  session that was cut off by the usage limit. Create it with
  `git worktree add <dir> -b burst/<task-id> burst-base-2026-09-05`
  (`isolation: "worktree"` then works inside that directory). A fresh worktree has **no
  `node_modules`**: your first command is
  `pnpm install --frozen-lockfile --offline` (≈7 s from the warm store —
  measured; never without `--offline`, never `pnpm install` alone). Workspace
  packages resolve from source, so nothing needs building before tests run.
  Touch only the files listed for your task.
- **Playwright port.** The mocked e2e suite reuses any server already on its
  port, so two agents on :3300 would test each other's code. Every e2e-running
  task sets its own `E2E_WEB_PORT` (T3 3310, T5 3320, T10 3330 — written into
  the Verify lines); never run e2e on the default port.
- Never edit `pnpm-lock.yaml`, `package.json` files, migrations of other
  tasks, or anything under `meta/` except your own note.
- Budget: **12 minutes**. At minute 10, if your verification isn't green,
  revert (`git checkout -- .`), write what you learned to
  `meta/burst/notes/<task-id>.md`, commit only that note.
- Verification is the _smallest_ command that proves your change (named per
  task). Run it once at the end, not continuously. Prettier your files
  (`pnpm exec prettier --write <files>`) before committing.
- One commit, message starting with `burst(<task-id>):`, trailer
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Report back in ≤ 8 lines: branch, commit, verification result, anything the
  orchestrator must know before merging.

## Orchestrator

0. Pre-flight is **already done** — do not repeat it: `experimental` passed the
   full CI-equivalent (prettier, eslint, type-check, every unit suite, `pnpm
build`) at 07:45 on 2026-09-05, and fresh worktrees were exercised (offline
   install 7 s, web/api/notation tests run from source). Spend the window on the
   tasks, not on re-verifying the base.
1. 09:43–09:45 read this file; launch all tasks in parallel (each its own
   worktree). Do not launch anything after 09:50.
2. 09:57 collect reports. First decide the merge target: if `experimental`'s tip
   is the tag `burst-base-2026-09-05`, merge into `experimental`. If it has
   extra commits, run `pnpm type-check` on it once (≤ 1 min); green → merge into
   `experimental`; red → leave those commits on a new branch
   `experimental-wip-<HHMM>` (`git branch experimental-wip-<HHMM> experimental`),
   reset `experimental` to the tag (`git reset --hard burst-base-2026-09-05`),
   note it in the summary, and merge into that. Then, for each green task branch:
   `git merge --ff-only` (or a plain merge if the branch diverged trivially); on
   any conflict, leave the branch unmerged and list it.
3. 09:58 run `pnpm --filter @mushee/notation test` and
   `pnpm --filter @mushee/web test` once on the merged result if time allows;
   if red, revert the last merge(s) until green.
4. 09:59 append a summary to `meta/overnight-2026-09-04.md` (§ "Burst") and
   stop. Do not start anything else.

## Tasks (independent; disjoint files; each ≤ 12 min)

### T1 — minimize-accidentals idempotence (notation)

Files: `packages/notation/src/model/Score.ts` (only `minimizeAccidentals`),
`packages/notation/src/model/util/AccidentalMinimizer.ts`, tests under
`packages/notation/tests/model/util/`.
Goal: rank candidate key signatures on the notes' **sounding pitch classes**
(MIDI mod 12) rather than their current spellings so a second pass changes
nothing (see overnight log §24; reproduce with `EditInvariants` seed 2 by
re-adding an `expect(describeScore(...)).toEqual(once)` locally).
Verify: `cd packages/notation && npx vitest run --coverage` (100% model gate
must hold).

### T2 — persist the audio object key on takes (API)

Files: new migration `apps/api/src/database/migrations/<ts>-RecordingAudioKey.ts`

- `index.ts` registration, `apps/api/src/recordings/entities/recording.entity.ts`,
  `recording-archiver.ts`, `recording-session.ts`, `recordings.service.ts`
  (`audioFor` reads the key, falls back to listing when null), tests in
  `apps/api/test/recordings/recordings.service.takes.test.ts`.
  Goal: stop one bucket LIST per replay (overnight log §14).
  Verify: `cd apps/api && pnpm type-check && npx vitest run test/recordings`.

### T3 — mobile e2e for the header chips (web)

Files: `apps/web/e2e/mobile.spec.ts` only.
Goal: on the mobile project, Share → turn link on/off, Takes → list + delete,
Export menu opens as icon-only chips; assert nothing overflows the header
(`header` bounding box width ≤ viewport).
Verify: `cd apps/web && E2E_WEB_PORT=3310 npx playwright test mobile.spec --project=mobile-chromium`.

### T4 — eval app lint debt (eval)

Files: `apps/eval/**` only.
Goal: fix the ~35 eslint errors so `pnpm exec eslint apps/eval` is clean; no
behaviour changes (types/unused imports/non-null assertions).
Verify: `pnpm exec eslint apps/eval && pnpm --filter @mushee/eval type-check`.

### T5 — shared-page title + Open Graph (web)

Files: `apps/web/src/app/s/[token]/page.tsx`, `SharedScorePage.tsx`,
`apps/web/e2e/shared.spec.ts`.
Goal: `document.title` = `<score title> — Solkey` once the token resolves;
`generateMetadata` may fetch `GET /shared/:token` server-side (no session
needed; `NEXT_PUBLIC_API_URL`) for a real title/description with `noindex`
kept; fall back gracefully on 404.
Verify: `cd apps/web && pnpm type-check && E2E_WEB_PORT=3320 npx playwright test shared.spec --project=chromium`.

### T6 — announcement copy for the beta ending (marketing)

Files: `meta/marketing/BETA-ENDING-EMAIL.md` (new).
Goal: two ready-to-paste announcements for the admin Announcements tool
(grandfather variant / migrate-to-Sketch variant; plain text with the tool's
`**bold**` and `[label](https://…)` markup where useful; `{{name}}`;
≤ 180 words each; subject lines; send timing suggestion), consistent with
`meta/marketing/LAUNCH-KIT.md` §5 and `deploy/runbooks/end-of-beta-launch.md` §3.
Verify: `pnpm exec prettier --check meta/marketing`.

### T7 — public endpoint rate limit (API)

Files: `apps/api/src/scores/shared-scores.controller.ts`, `apps/api/src/main.ts`
(only if a route-level limiter config is needed), `apps/api/test/scores/`.
Goal: `GET /shared/:token` gets a tighter per-IP limit than the global 120/min
(e.g. 30/min) using `@fastify/rate-limit`'s route config or a Nest guard; keep
the global limiter untouched.
Verify: `cd apps/api && pnpm type-check && npx vitest run test/scores`.

### T8 — README product overview (docs)

Files: `README.md` only (a new "## What Solkey does" section near the top,
≤ 25 lines: live audio-to-notation, editor, import/export, share links, takes,
pricing pointer). No env/deploy changes.
Verify: `pnpm exec prettier --check README.md`.

### T9 — `Score.minimizeAccidentals` / transpose keyboard shortcuts audit (web)

Files: `apps/web/src/app/scores/[id]/commands.ts`, `apps/web/tests/lib/Keybindings.test.ts`.
Goal: make sure every editor action in `actions.ts` that has a UI control also
has a default shortcut listed in the shortcuts dialog (add missing ones with
non-conflicting defaults; document in the dialog copy).
Verify: `cd apps/web && npx vitest run tests/lib/Keybindings.test.ts tests/app`.

### T10 — recordings inventory e2e (web)

Files: `apps/web/e2e/settings.spec.ts`, `apps/web/e2e/fixtures.ts` (only the
TAKES mock: add a take on a second, deleted score to cover the "Deleted score"
label).
Goal: settings inventory shows the score title per take and "Deleted score"
for an orphan; play button disabled for audio-less takes.
Verify: `cd apps/web && E2E_WEB_PORT=3330 npx playwright test settings --project=chromium`.

## If fewer than 10 agents can run

Priority order: T1, T2, T3, T5, T7, T10, T4, T9, T6, T8.
