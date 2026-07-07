# Mushee

Sheet-music editor with live audio-to-notation recording. pnpm monorepo:

| Path | What it is |
|---|---|
| `apps/web` | Next.js app (editor UI), dev on **:3200** |
| `apps/api` | NestJS API + WebSocket recording pipeline, dev on **:4200** |
| `apps/inference-crepe` | Python gRPC service: CREPE forward pass (**:50051**) |
| `apps/inference-basic-pitch` | Python gRPC service: basic-pitch forward pass (**:50052**) |
| `packages/inference-proto` | Shared gRPC contract for the inference services |
| `deploy/k8s` | Kustomize manifests: `base/` (production-shaped) + `overlays/local/` |

The API owns everything about transcription except the neural-net forward pass,
which runs behind a `ModelBackend` seam: **in-process TF.js** by default (dev,
eval harness) or **remote gRPC** when `CREPE_INFERENCE_URL` /
`BASIC_PITCH_INFERENCE_URL` are set. That makes the API stateless and light —
scale it and each inference service independently.

## Local development

Prereqs: Node 22 + pnpm, Docker Desktop.

```sh
pnpm install
pnpm setup        # start dev Postgres (:5632) + fresh schema + demo data
pnpm dev          # web on :3200, api on :4200 (in-process inference)
```

Optionally copy `apps/api/.env.example` → `apps/api/.env.development` (and the
same in `apps/web`) to tweak settings; the defaults work out of the box.

### Demo accounts

Seeded by `pnpm setup` / `pnpm db:reset` / `pnpm db:seed` (or any environment
booted with `SEED_DEMO_DATA=true`). Password for all: **`mushee-demo`**.

| Email | Tier | Daily recording |
|---|---|---|
| `demo@mushee.local` | Studio | **unlimited** — the main demo account |
| `free@mushee.local` | Sketch (free) | 30 s |
| `pro@mushee.local` | Composer (pro) | 10 min |
| `studio@mushee.local` | Studio | unlimited |

### Database scripts

```sh
pnpm db:reset     # drop everything, re-run migrations, re-seed demo data
pnpm db:seed      # (re-)seed demo data only — idempotent, keeps existing rows
pnpm dev:db       # just start the dev Postgres container
pnpm pgweb        # browse the dev DB on :8632
```

Migrations run automatically on API boot (serialized across replicas with an
advisory lock), and include better-auth's tables — a fresh database needs no
manual steps. New app migrations: `pnpm --filter @mushee/api migration:generate`
and register them in `apps/api/src/database/migrations/index.ts`. If a
better-auth upgrade changes its schema, run `pnpm --filter @mushee/api migrate`
and snapshot the diff into a new migration (see `1782864000000-BetterAuthSchema`).

### Full backend stack in Docker

```sh
docker compose up --build   # api :3000 + both inference services + postgres
```

Boots migrated + seeded, with MusicXML storage on a named volume. The web dev
server (`pnpm dev:web`) can point at it with
`NEXT_PUBLIC_API_URL=http://localhost:3000`.

## Deployment (Kubernetes)

Images (build context is always the repo root; `docker compose build` produces
all three with these exact tags):

```sh
docker build -f apps/api/Dockerfile                   -t mushee/api:latest .
docker build -f apps/inference-crepe/Dockerfile       -t mushee/crepe-inference:latest .
docker build -f apps/inference-basic-pitch/Dockerfile -t mushee/basic-pitch-inference:latest .
```

**Local (Docker Desktop k8s)** — self-contained: ephemeral Postgres, dummy
secret, demo data, API on http://localhost:3000:

```sh
kubectl apply -k deploy/k8s/overlays/local
```

Start over with clean demo data: `kubectl rollout restart deploy postgres` (the
DB is an emptyDir), then `kubectl rollout restart deploy api` — the API
re-migrates and re-seeds on boot.

**Production** — `deploy/k8s/base` only (retag images to your registry, e.g.
via a kustomize `images:` override). The cluster must provide:

- `Secret/api-secrets` with `POSTGRES_*` (managed database), `BETTER_AUTH_SECRET`,
  `BETTER_AUTH_URL`, `CORS_ORIGIN`/`TRUSTED_ORIGINS`, `WEB_APP_URL`, SendGrid
  vars, Polar vars (`POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET`,
  `POLAR_SERVER`, `POLAR_PRODUCT_*`), beta switches (`BETA_MODE`,
  `ADMIN_EMAILS`), and `RCLONE_REMOTE` + `RCLONE_CONFIG_<NAME>_*` vars for
  cloud MusicXML storage (the API image ships rclone; a plain directory path
  also works if you mount a volume). Do **not** set `SEED_DEMO_DATA` in
  production (the API refuses to boot with it). See `apps/api/.env.example`
  for the full annotated list.
- Production hardening vars: `POSTGRES_SSL=require` (or `verify` +
  `POSTGRES_SSL_CA`) for TLS to a managed database, `TRUST_PROXY=1` so per-IP
  rate limiting sees real client addresses behind the ingress (the base
  manifest sets this), and `COOKIE_DOMAIN=.your-domain` when the web app and
  API live on different subdomains — without it the session cookie never
  reaches the web middleware and every signed-in user bounces to `/login`.
  `POSTGRES_URL` may replace the `POSTGRES_*` parts; it is honored by TypeORM,
  better-auth, and the seeder alike.
- **Backups**: the database is the only stateful component besides MusicXML
  storage. Enable your managed Postgres provider's automated backups /
  point-in-time recovery *and test a restore once* before launch; version or
  replicate the rclone bucket for the MusicXML files. Nothing in this repo
  does this for you.
- A metrics-server, so the HPAs scale the inference services on CPU (Docker
  Desktop has none — HPAs stay at min replicas there).
- An Ingress / managed LB for `Service/api` (the local overlay's
  `api-lb` LoadBalancer is local-only).

Scaling: every layer is horizontal — API replicas share state via Postgres
(recording locks, credits, edit cache), and the inference services are
stateless tensor→tensor functions behind ClusterIP services with HPAs
(CREPE serves most registers and scales widest; see `deploy/k8s/base/*.yaml`).

Before switching a model's inference to a new service build, run the parity
gate — numeric forward-pass diff + end-to-end F1 against the local backend:

```sh
cd apps/api && CREPE_INFERENCE_URL=localhost:50051 BASIC_PITCH_INFERENCE_URL=localhost:50052 \
  pnpm exec tsx scripts/eval/check-inference-parity.ts
```

(needs the eval fixtures — see `apps/api/scripts/eval/`).

## Billing (Polar)

Paid tiers are sold through [Polar](https://polar.sh) (merchant of record).
One-time setup in the Polar dashboard:

1. Create four subscription products — Composer monthly/yearly, Studio
   monthly/yearly — and put their ids in `POLAR_PRODUCT_PRO_MONTHLY`,
   `POLAR_PRODUCT_PRO_YEARLY`, `POLAR_PRODUCT_STUDIO_MONTHLY`,
   `POLAR_PRODUCT_STUDIO_YEARLY`.
2. Create an organization access token → `POLAR_ACCESS_TOKEN`
   (`POLAR_SERVER=sandbox` while testing against sandbox.polar.sh).
3. Add a webhook endpoint pointing at `<api-url>/billing/webhooks/polar`
   (subscribe to at least the `subscription.*` and `customer.state_changed`
   events) and put its secret in `POLAR_WEBHOOK_SECRET`.

With those unset, billing degrades gracefully: `/billing/*` answers 503 and
the web UI hides paid actions. Subscription state is mirrored into
`user_subscriptions` by the webhook handler; checkout and the customer portal
are Polar-hosted redirects.

## Analytics (PostHog)

Set `NEXT_PUBLIC_POSTHOG_KEY` (+ optionally `NEXT_PUBLIC_POSTHOG_HOST`,
default EU cloud) on the web build to enable product analytics, session
replay, and error tracking. Everything is gated behind the GDPR cookie
banner: nothing is captured until the visitor opts in, and events are proxied
through `/ingest` to dodge ad blockers. Unset = analytics fully off.

## Closed beta

Flip `BETA_MODE=true` on the API and `NEXT_PUBLIC_BETA_MODE=true` on the web
app to run Sheemu as a closed beta: new signups land on the `beta` tier
(5 min of recording/day), get a waitlist email, and must be approved before
they can use the app. Approvals happen at `/admin` (accounts whose email is
in `ADMIN_EMAILS` get the admin role at signup; the seeded
`demo@mushee.local` account is an admin too) or via
`POST /admin/beta/signups/:userId/approve`. Flip both vars back to `false`
to open the doors — pending users are no longer gated.

## More docs

- `apps/web/DESIGN.md` + `apps/web/design/` — design system (source of truth for web UI)
- `apps/web/src/model/ARCHITECTURE.md` — score model/layout architecture
- `apps/api/CONCURRENCY.md` — remaining WebSocket-concurrency optimizations (backlog)
- `apps/web/e2e/README.md` — e2e test suites
- `TODO.md` — go-live checklist
