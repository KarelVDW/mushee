# Project structure & cleanliness report — 2026-07-08 (post-restructure)

Second pass, same day: the morning survey graded every module (see git history of
this file for the original findings); this pass **executed the full backlog** it
produced. Every module now grades **clean**. Verification after the pass:
API `tsc --noEmit` + 85 vitest tests + `nest build` green (scripts/ now included
in the tsconfig project), web `tsc --noEmit` + 923 vitest tests green (100%
model-coverage gate intact), repo-wide `eslint .` zero errors.

## What changed in this pass

### apps/api

- **billing** (was *messy*) — Polar integration library moved into `billing/polar/`
  (`client.ts`, `products.ts`, `webhook-verify.ts`, `subscription-state.ts`); the
  confusing `polar-webhooks.ts` / `polar-webhook.controller.ts` near-duplicate is
  gone (the lib shim is now `polar/webhook-verify.ts`). Root holds only Nest-
  conventional files. Added `test/billing/billing.service.test.ts` — 22 tests over
  the payment-critical logic: checkout guards (beta/unconfigured/unmapped),
  plan change/cancel/resume mirroring, webhook signature + idempotency +
  out-of-order/stale-event handling, GDPR customer deletion.
- **recordings** (was *messy*) — split into two layers, documented in
  `src/recordings/README.md`: root = Nest transport/persistence (gateway,
  services, `recording-session.ts`, `recording-archiver.ts`, entities);
  `pipeline/` = the pure audio→notes DSP (with `profiles/` and `providers/`).
  All 34 files normalized to kebab-case (was a Pascal/kebab/camel mix); public
  Nest-layer paths unchanged, so no importers outside the module moved.
- **auth** — loose `auth.ts` renamed to `auth.config.ts` (the better-auth
  instance; it stays a plain module because better-auth config is built outside
  the DI container). Added `test/auth/guards.test.ts` covering AuthGuard/
  AdminGuard rejection and request-stamping paths.
- **mail** — added `test/mail/mail.service.test.ts`: production fail-fast without
  API key, dev log-only mode, from-identity, link-base fallback chain
  (`WEB_APP_URL` → `CORS_ORIGIN`), HTML escaping of user names.
- **beta** — `beta-config.ts` keeps its plain-module shape by design (readable
  from `auth.config.ts` and billing without dragging BetaModule into their
  graphs); the rationale is now documented in the file header. Already tested.
- **database** — `demo-data.ts`/`demo-seed.ts` moved to `database/seed/` (they
  stay in `src/` because the boot seeder runs in-process on `SEED_DEMO_DATA`).
- **scripts** — `scripts/eval/README.md` indexes every script (harness core,
  corpus fetchers, gates/benchmarks, diagnostics) with prerequisites and a
  pruning log; `tempo-experiment.ts` deleted (both questions answered and
  shipped). `scripts/**` joined `tsconfig.json` include, so `pnpm type-check`
  and eslint now cover it — the type/lint debt that surfaced was fixed
  (typed JSON.parse, dead Mongo persistence path removed from
  `test-recording-ws.ts`). New package.json entries: `eval:generate`,
  `eval:run`, `verify:recording-integration`.
- **model weights** — provenance `SOURCE.md` added to `model/` (basic-pitch,
  bit-identical to the `@spotify/basic-pitch` npm model), `model-crepe-tiny/`
  (marl/crepe via `fetch-crepe-model.sh`), and
  `apps/inference-crepe/crepe_saved_model/` (converted from the tiny tfjs
  weights, parity-gated). Deliberate keep in git (~5 MB); LFS only if the repo
  ever needs slimming.

### apps/web

- **`scores/[id]/page.tsx`** (was *acceptable→messy*, 578 lines) — now 300 lines.
  Extracted colocated `TitleInput.tsx`, `useRecording.ts` (WS session, limits,
  waveform), `usePlayback.ts` (transport lifecycle, preview, metronome),
  `useScoreAutosave.ts` (debounce + retry). All e2e aria-label invariants
  preserved verbatim.
- **`onboarding/page.tsx`** (600 lines) — now 201 lines. Extracted
  `onboarding-data.ts` (option tables, `formatPrice`), `OnboardingControls.tsx`
  (StepShell/StepProgress/OptionCard/BillingToggle/TierCard, aria intact), and
  `OnboardingSteps.tsx` (one component per step; step-local state moved in,
  cross-step state stays in the page).
- **`src/origin/`** — gone; the generated Bravura glyph data now lives with its
  only consumers at `src/components/notation/fonts/bravura_glyphs.ts`
  (kept snake_case: generated file). Coverage exclude + design docs updated.
- **notation utils** — `glyph-utils.ts`/`note-utils.ts` → `glyphUtils.ts`/
  `noteUtils.ts`, matching the camelCase module convention of `model/`
  (`rowWidth.ts`) and the new hooks.

### Root / deploy / packages / inference

- **Inference proto stubs** (was *acceptable→messy*) — the checked-in
  `inference_pb2*.py` copies (mismatched protoc 6.31.1 vs 4.25.1) are deleted
  and gitignored. Both Dockerfiles already generated stubs at image build from
  `packages/inference-proto/inference.proto` with one pinned toolchain
  (grpcio-tools 1.62.3); host runs use the new
  `packages/inference-proto/generate-python.sh` (same pin, verified to produce
  identical stubs for both services).
- **docker-compose env drift** — compose now sets `WEB_APP_URL` and
  `BETA_MODE: 'false'` like the local k8s overlay; `TRUST_PROXY` is deliberately
  unset (no ingress in front of the container) with a comment saying so.
- **eslint config** — ignores extended with `**/coverage/**` and the local
  Python venvs (`**/.venv-*/**`, ~10k vendor-JS errors previously drowning the
  signal); targeted override for the tiny CommonJS `inference-proto` shim.
  Repo-wide `eslint .` is now genuinely zero-error, including the previously
  unlinted `apps/api/scripts/**`.

## Module grades

| Area | Grade |
|---|---|
| apps/api — account, auth, beta, billing, cache, cron, database, health, mail, onboarding, recordings, scores, settings, storage, subscriptions | clean |
| apps/api/scripts (+ eval) | clean |
| apps/web — app routes, components/ui, components/notation, lib, model, tests/e2e/design, public | clean |
| Root configs, deploy/k8s, docker-compose | clean |
| packages/inference-proto, apps/inference-* | clean |

## Deliberate keeps (not defects)

- **subscriptions vs billing**: complementary, not overlapping — subscriptions
  owns the data model + catalogue, billing owns the Polar integration and writes
  through `SubscriptionsService`. `polar/subscription-state.ts` (the pure
  payload→row-patch mapper) lives in billing because it speaks Polar.
- **Model weights in git** (~5 MB) with `SOURCE.md` provenance.
- **`beta-config.ts` / `postgres-ssl.ts`-style plain modules** where config must
  be readable outside the DI container.
- **`fixtures/test.webm`** (334 KB) — used binary fixture.
- Nest wiring (modules/controllers/gateways) is intentionally not unit-tested;
  logic layers are. The recording pipeline itself is eval-gated
  (`scripts/eval/README.md`).

## End-to-end verification (completed after the dev-server lock was freed)

- Mocked Playwright suite: **32/32 passed** (chromium + webkit) — editor chrome,
  autosave, selection, shortcuts, exports, library flows all green on the
  decomposed pages.
- Full-stack smoke: **2/2 passed** against a live stack (e2e Postgres on 5532,
  API on 4300 with the gRPC inference services, web on 3300) — the authed
  create → edit → reload persistence flow works through the restructured API.
- `pnpm verify:recording-integration`: **ALL CHECKS PASSED** against the same
  stack. One stale expectation in the script itself was fixed along the way:
  it streamed the fixture at ~10× real time on a wrap-around loop, while the
  server (deliberately, since the H6 fix) bills `max(wall-clock, decoded-audio)`
  seconds — so the "3-5 credits" check correctly billed ~21-31. `streamAudio`
  now paces at real time; the anti-abuse metering itself was verified correct.

## Outstanding

- Remaining low-priority follow-ups live in `master-todo.md` items 23–25.
