# Runbook 2 — Stand up a new environment (uat / staging / dev)

Goal: a second, fully working Sheemu — web + API + inference + DB + storage —
that can't touch production data, reachable at `uat.sheemu.com` /
`api.uat.sheemu.com`. Written for "uat"; substitute the name throughout.

## 0. Decide the isolation level first

| Layer | Cheap & sane (recommended) | Full isolation (when compliance/load-testing demands it) |
|---|---|---|
| GCP project | same `sheemu-prod` | second project (repeat the whole provisioning runbook) |
| Cluster | same `mushee-prod`, new **namespace** `mushee-uat` | second Autopilot cluster |
| Database | same Cloud SQL instance, new **database** `mushee_uat` + own user | second (smaller) instance |
| Bucket | new bucket `sheemu-uat-storage` (always separate — GDPR deletion tests run here) | same |
| Images | **same images, same registry** — promote the exact SHA you tested | same |
| Web | same Vercel project, **Preview** environment on a branch, or a second project | second project |

The recommended column costs almost nothing extra (Autopilot bills per pod;
one API replica + downsized inference ≈ a few tens of €/month) and keeps one
cluster to operate. The one real risk of sharing the SQL instance is
connection budget: each API replica opens 2 pools × `POSTGRES_POOL_SIZE` (10)
connections; `db-custom-1-3840` allows ~100. Prod (2–6 replicas) + uat
(1 replica) fits. Set `POSTGRES_POOL_SIZE=5` in uat to be polite.

**Cookie-domain rule (the classic cross-env bug):** uat must use
`COOKIE_DOMAIN=.uat.sheemu.com`, *never* `.sheemu.com` — a `.sheemu.com`
cookie from uat would shadow the production session cookie in any browser
that visits both. `uat.sheemu.com` + `api.uat.sheemu.com` share the
`.uat.sheemu.com` parent, so login works.

## 1. GCP one-timers

```sh
gcloud config set project sheemu-prod

# Bucket (separate — recordings/GDPR tests must never touch prod objects)
gcloud storage buckets create gs://sheemu-uat-storage \
  --location=europe-west1 --uniform-bucket-level-access
# (versioning optional in uat)

# Database + user on the existing instance
gcloud sql databases create mushee_uat --instance=mushee-prod
openssl rand -hex 24 > /tmp/uat-db-password.txt
gcloud sql users create mushee_uat --instance=mushee-prod \
  --password="$(cat /tmp/uat-db-password.txt)"

# Static IP for the uat ingress + note the address for DNS
gcloud compute addresses create mushee-uat-api-ip --global
gcloud compute addresses describe mushee-uat-api-ip --global --format='value(address)'

# Workload identity for the uat namespace: reuse the GSA, add the uat KSA
# binding and grant it the uat bucket
gcloud storage buckets add-iam-policy-binding gs://sheemu-uat-storage \
  --member="serviceAccount:mushee-api@sheemu-prod.iam.gserviceaccount.com" \
  --role=roles/storage.objectAdmin
gcloud iam service-accounts add-iam-policy-binding \
  mushee-api@sheemu-prod.iam.gserviceaccount.com \
  --role=roles/iam.workloadIdentityUser \
  --member="serviceAccount:sheemu-prod.svc.id.goog[mushee-uat/api]"
```

(Sharing the GSA means uat *could* write to the prod bucket if the code had a
bug pointing at it. If that bothers you, mint `mushee-api-uat@` instead and
grant it only the uat bucket — one extra `iam service-accounts create` plus
using that email in the uat ServiceAccount annotation.)

DNS: `api.uat` A-record → the new static IP; `uat` CNAME → Vercel (added in §4).

## 2. The kustomize overlay

```sh
cp -r deploy/k8s/overlays/production deploy/k8s/overlays/uat
```

Then edit `deploy/k8s/overlays/uat/`:

- `kustomization.yaml`: `namespace: mushee-uat`. Keep the same `images:`
  entries — CI stamps them (or you stamp a specific tested SHA by hand).
- `namespace.yaml`: `name: mushee-uat`.
- `service-account.yaml`: unchanged if sharing the GSA (the annotation names
  the GSA; the KSA↔GSA binding in §1 is what scopes it to `mushee-uat/api`).
- `api-ingress.yaml`: `domains: [api.uat.sheemu.com]`, host
  `api.uat.sheemu.com`, `global-static-ip-name: mushee-uat-api-ip`. Rename the
  cert/frontend/backend objects (`api-cert-uat`, …) is unnecessary — they're
  namespaced — but the static-ip annotation **must** differ or the two
  ingresses fight over one IP.
- `api-patch.yaml` — the environment's identity, all in one reviewable place:
  ```yaml
  - { name: BETTER_AUTH_URL, value: 'https://api.uat.sheemu.com' }
  - { name: WEB_APP_URL,     value: 'https://uat.sheemu.com' }
  - { name: CORS_ORIGIN,     value: 'https://uat.sheemu.com' }
  - { name: TRUSTED_ORIGINS, value: 'https://uat.sheemu.com' }
  - { name: COOKIE_DOMAIN,   value: '.uat.sheemu.com' }
  - { name: STORAGE_DRIVER,  value: 'gcs' }
  - { name: GCS_BUCKET,      value: 'sheemu-uat-storage' }
  - { name: POSTGRES_SSL,    value: 'require' }
  - { name: POSTGRES_POOL_SIZE, value: '5' }
  - { name: BETA_MODE,       value: 'true' }   # or false — uat's call
  ```
  Also worth adding in uat: patch `replicas: 1` for api and crepe-inference,
  and drop the HPA min-replicas (a small `patches:` entry), otherwise uat
  costs as much as prod.

Sanity-check locally: `kubectl kustomize deploy/k8s/overlays/uat | less` —
grep that **every** occurrence of `sheemu.com` is the uat variant and the
namespace is `mushee-uat` throughout.

## 3. Secret + first apply

```sh
kubectl create namespace mushee-uat
kubectl create secret generic api-secrets -n mushee-uat \
  --from-literal=POSTGRES_URL="postgres://mushee_uat:$(cat /tmp/uat-db-password.txt)@10.56.0.3:5432/mushee_uat" \
  --from-literal=BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
  --from-literal=SENDGRID_API_KEY='<the prod key is fine — mail is real either way>' \
  --from-literal=ADMIN_EMAILS='info@sheemu.com'

cd deploy/k8s/overlays/uat
kustomize edit set image \
  "mushee/api=europe-west1-docker.pkg.dev/sheemu-prod/mushee/api:<tested-sha>" \
  "mushee/crepe-inference=europe-west1-docker.pkg.dev/sheemu-prod/mushee/crepe-inference:<tested-sha>" \
  "mushee/basic-pitch-inference=europe-west1-docker.pkg.dev/sheemu-prod/mushee/basic-pitch-inference:<tested-sha>"
kubectl apply -k .
```

The API self-migrates `mushee_uat` on first boot (advisory-locked, replica
safe). The managed certificate needs the `api.uat.sheemu.com` A-record
resolving first, then ~15–60 min.

For CI: add an `environment` input to `.github/workflows/deploy.yml` whose
value picks the overlay directory (`production` | `uat`) — the build-push job
is identical, only the `working-directory` of the stamp-and-apply step
changes. That gives you the real promotion flow: deploy SHA to uat → test →
run Deploy again with the **same SHA** against production.

## 4. The web side (Vercel)

`NEXT_PUBLIC_*` is **baked at build time**, so uat needs its own build with
its own values — a runtime env change does nothing.

Simplest reliable shape: a long-lived `uat` git branch plus Vercel's
Preview-environment variables.

1. Vercel → Settings → Domains → add `uat.sheemu.com`, assign it to the
   `uat` branch (its latest Preview deployment).
2. Settings → Environment Variables — add these scoped to **Preview**
   (Production values stay untouched):
   `NEXT_PUBLIC_API_URL=https://api.uat.sheemu.com`,
   `NEXT_PUBLIC_SITE_URL=https://uat.sheemu.com`,
   `NEXT_PUBLIC_BETA_MODE` per §2, and a **separate PostHog project's** key
   (or leave the key unset in Preview — analytics off in uat is usually
   right, and unset is exactly how the code degrades).
3. Push the branch → Vercel builds → `uat.sheemu.com` serves it.

Caveat: Preview-scoped vars apply to *all* preview deployments, i.e. every PR
preview will also point at the uat API. For this project that's a feature
(PR previews get a real but non-prod backend). If it ever isn't, split into a
second Vercel project instead.

Also tell search engines uat isn't a website: the cheap version is a
`X-Robots-Tag: noindex` header added in `next.config.ts` gated on
`NEXT_PUBLIC_SITE_URL.includes('uat.')`.

## 5. Seeding test data

`SEED_DEMO_DATA=true` **refuses to boot** under `NODE_ENV=production` — and
the production image bakes `NODE_ENV=production`, so uat cannot self-seed.
That guard is correct (demo accounts have a public password); don't fight it.
Options, in order of preference:

- Create accounts through the real signup flow (mail works in uat).
- Promote a uat admin the manual way:
  `UPDATE "user" SET role='admin', "betaStatus"='approved' WHERE email='...';`
  (see Runbook 4 §5 for how to run SQL against the private instance).
- If demo data is truly needed, run the seeder as a one-off pod with
  `NODE_ENV` unset, pointing `POSTGRES_URL` at `mushee_uat` — accept that
  those demo credentials are public and uat must never hold real user data.

## 6. Smoke test (same bar as production)

Signup on `uat.sheemu.com` → OTP mail arrives → login survives navigation
(cookie domain right) → editor loads → record one take → object appears under
`gs://sheemu-uat-storage/recordings/…`. If all six pass, the environment is
real.

## Teardown

`kubectl delete ns mushee-uat`, delete the uat database + user, the bucket,
the static IP, the DNS records, and the Vercel domain+branch. Nothing else
references the environment.
