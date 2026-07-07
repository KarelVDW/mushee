# Project structure & cleanliness report — 2026-07-08

Result of a full-repo structure evaluation (three parallel surveys: API, web, root/deploy/packages),
plus the cleanups applied in the same pass. Grades: **clean / acceptable / messy / very messy**.
No module earned *very messy*, so per the brief only small, safe fixes were applied; the rest is
reported here (and fed into `master-todo.md`).

## Actions taken in this pass

- **Docs reorg**: `TODO.md`, `AFTERTHOUGHTS.md`, `PRODUCTION-READINESS.md` (repo root) and
  `apps/api/CONCURRENCY.md` (→ `API-CONCURRENCY.md`) moved into `meta/` — all four are
  developer/agent communication, not user-facing docs. README's doc index updated.
  Kept in place: `README.md` (user-facing), `apps/web/DESIGN.md` + `design/` (design system),
  `apps/web/src/model/ARCHITECTURE.md` (living architecture reference), `e2e/README.md` (test docs).
- **Deleted (verified dead / stray, tracked in git)**:
  - `reference-keyboard.html` (repo root) — 248 KB HTML scraped from an external app's shortcut
    reference; zero references; the app has its own `KeyboardShortcutsDialog.tsx`.
  - `apps/web/src/actions.ts` — empty 0-byte stub; the real `actions.ts` lives in
    `app/scores/[id]/`.
  - `apps/web/public/{next,vercel,file,globe,window}.svg` — default Next.js starter assets,
    zero importers (real favicon/OG assets live in `src/app/`).
  - `apps/api/test/**` compiled artifacts (`.js`, `.js.map`, `.d.ts`, `.d.ts.map` for the beta and
    billing tests) — accidental `tsc` output committed next to sources; now gitignored.
  - `apps/api/scripts/eval/{brainstorm,tuning}-workflow.js` — orphaned one-off scripts, the only
    `.js` in a `.ts` dir, referenced nowhere.
- **Moved**: `apps/api/src/health.controller.ts` → `src/health/health.controller.ts` — it was the
  only feature sitting loose at the src root.
- Local-only junk removed from disk (untracked): `.DS_Store` files, orphaned
  `apps/api/tsconfig.eval-check.tsbuildinfo` (its tsconfig no longer exists).

## Module grades

### apps/api

| Module | Grade | Notes |
|---|---|---|
| account | clean | Standard controller/service/dto/entities. No tests, but low-risk. |
| auth | acceptable | `auth.ts` is a loose better-auth config outside the `*.service` convention; security-critical yet untested. |
| beta | acceptable | `beta-config.ts` loose config imported across modules (incl. auth) — mild coupling. |
| billing | **messy** | 7 loose root files; confusing near-duplicate names (`polar-webhooks.ts` lib vs `polar-webhook.controller.ts`); 346-line service; payment-critical logic largely untested (only products/state mappers have tests). Top refactor candidate. |
| cache, cron, onboarding, settings, storage, subscriptions | clean | Small and single-purpose. Note: subscriptions vs billing conceptual overlap (subscription state spans both). |
| database | acceptable | Demo/seed data (`demo-data.ts`, `demo-seed.ts`) lives in `src/` but is arguably a scripts concern. |
| health | clean (after fix) | Moved into its own folder this pass. |
| recordings | **messy** | The heavyweight: DSP/pipeline logic (NoteExtractor 518, RecordingPipeline 510 lines) mixed with Nest gateway/service concerns; worst file-naming inconsistency (PascalCase pipeline classes vs kebab-case Nest files vs camelCase `createModelBackend.ts`/`tfBackend.ts`/`pitchDecoder.ts` in providers/); only a few units tested. Works well (eval-gated), but structure needs a dedicated pass. |
| scripts/eval | **messy** | An experiment graveyard: ~10 standalone tuning/diagnostic scripts with no index, docs, or package.json entries. Needs a README + pruning decision. |
| scripts (rest) | acceptable | `verify-recording-integration.mjs` is a `.mjs` outlier not wired into package.json but still the documented integration check — keep. `fixtures/test.webm` (334 KB) is a committed binary fixture (used; acceptable). |

### apps/web

| Area | Grade | Notes |
|---|---|---|
| src/app routes | acceptable→messy | Routes are conventional. Two god pages: `scores/[id]/page.tsx` (~570 lines: editor shell + recording flow + dialogs + inline TitleInput) and `onboarding/page.tsx` (~600 lines: inline data tables + multi-step flow). Extract-component pass recommended. |
| src/components/ui | clean | Cohesive primitives; `Icon.tsx` is 639 lines but a flat glyph registry (data, not logic). |
| src/components/notation | clean | Well-factored; minor kebab-vs-PascalCase util naming inconsistency. |
| src/lib | clean | Transport-composed audio units + api/queries; clear responsibilities. |
| src/model (+layout/width/util) | clean | The showpiece: 1:1 test mirroring, 100% coverage gate, ARCHITECTURE.md. |
| src/origin | clean, odd placement | Only vendored Bravura glyph data (3567 lines, generated); the name `origin/` is opaque — would read better as notation asset data. |
| tests/, e2e/, design/ | clean | Left untouched per brief. `design/ui_kits/*.jsx` intentionally shadow real component names (reference mockups). |
| public | clean (after fix) | Contained only unused starter SVGs; deleted. |

### Root / deploy / packages / inference

| Area | Grade | Notes |
|---|---|---|
| Root configs | clean | Coherent scripts, flat eslint config, thorough ignores. |
| deploy/k8s | clean | Labels/selectors/HPAs/PDBs/NetworkPolicies consistent; textbook base+overlay. |
| packages/inference-proto | clean | Minimal, correct exports. |
| apps/inference-* | acceptable→messy | Generated gRPC stubs (`inference_pb2*.py`) are checked into each app AND generated with mismatched protobuf toolchains (crepe 6.31.1 vs basic-pitch 4.25.1). They interoperate, but should be regenerated from one toolchain (ideally at image build from `packages/inference-proto/inference.proto`). |
| docker-compose vs k8s local | acceptable | Minor env drift: compose lacks `WEB_APP_URL`, `BETA_MODE`, `TRUST_PROXY` that k8s sets. |

## Reported-but-not-fixed (ranked; also in master-todo.md)

1. **billing module reorganization + service tests** — payment-critical and the messiest src module.
2. **recordings module split** — separate the transcription pipeline (pure DSP, PascalCase classes)
   from the Nest transport layer (gateway/services); normalize file naming while at it.
3. **Editor page decomposition** (`scores/[id]/page.tsx`) — extract the recording flow and title
   input; onboarding page similar.
4. **scripts/eval index/prune** — README with what each script is for; delete what's superseded.
5. **Inference proto stubs** — single generation source (build-time protoc from the shared .proto).
6. **Committed model weights** (~5 MB total: `model/`, `model-crepe-tiny/`, `crepe_saved_model/`)
   — consider LFS or fetch-at-build; add missing provenance SOURCE.md files.
7. Minor: `src/origin/` naming, notation util-file casing, compose/k8s env drift,
   `database/demo-*` → scripts, missing `auth`/`mail`/`billing` service tests.
