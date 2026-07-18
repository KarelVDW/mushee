# Staging overlay — GCP provisioning

Staging shares the production cluster (`mushee-prod`, europe-west1, project
`sheemu-prod`) and the production Cloud SQL instance, but gets its own
namespace (`mushee-staging`), database, bucket, static IP, and workload
identity. URL scheme: web on **staging.solkey.io** (Vercel `staging` branch
domain), API on **api.staging.solkey.io** — one level below the production
hosts so the staging cookie domain (`.staging.solkey.io`) never collides with
production's (`.solkey.io`).

The GitHub OIDC deployer from the production README already covers staging:
its WIF condition is repository-scoped, and `roles/container.developer` +
`roles/artifactregistry.writer` are project-wide. No CI-side IAM changes.

One-time provisioning:

```sh
# 1. Static IP for the staging ingress; point api.staging.solkey.io (A) at it.
gcloud compute addresses create mushee-api-staging-ip --global
gcloud compute addresses describe mushee-api-staging-ip --global --format='value(address)'

# 2. Staging bucket (versioning off — nothing here is precious).
gcloud storage buckets create gs://sheemu-staging-storage --location=europe-west1

# 3. Staging database + user on the existing mushee-prod instance. The API
#    self-provisions its schema on boot, so creating the empty DB is enough.
gcloud sql databases create mushee_staging --instance=mushee-prod
gcloud sql users create mushee_staging --instance=mushee-prod --password='<generate one>'

# 4. Workload identity: staging GSA, staging-bucket-only access, KSA binding.
gcloud iam service-accounts create mushee-api-staging
gcloud storage buckets add-iam-policy-binding gs://sheemu-staging-storage \
  --member="serviceAccount:mushee-api-staging@sheemu-prod.iam.gserviceaccount.com" \
  --role=roles/storage.objectAdmin
gcloud iam service-accounts add-iam-policy-binding \
  mushee-api-staging@sheemu-prod.iam.gserviceaccount.com \
  --role=roles/iam.workloadIdentityUser \
  --member="serviceAccount:sheemu-prod.svc.id.goog[mushee-staging/api]"
```

## Secret/api-secrets

Same keys as production, staging values. Generate a fresh
BETTER_AUTH_SECRET — sharing production's would let session tokens cross
environments.

```sh
# The namespace normally comes from the overlay's first apply; create it by
# hand so the secret can land before the first deploy.
kubectl create namespace mushee-staging

kubectl create secret generic api-secrets -n mushee-staging \
  --from-literal=POSTGRES_URL='postgres://mushee_staging:<password>@10.56.0.3:5432/mushee_staging' \
  --from-literal=BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
  --from-literal=SENDGRID_API_KEY='<sendgrid key>' \
  --from-literal=ADMIN_EMAILS='info@solkey.io'
# Polar: use sandbox credentials here (POLAR_SERVER=sandbox), never production.
```

## DNS + Vercel (web side)

- DNS: `api.staging.solkey.io` A → the static IP from step 1;
  `staging.solkey.io` CNAME → `cname.vercel-dns.com`.
- Vercel: set the project's **production branch to `production`**, then add
  domain `staging.solkey.io` assigned to the **`staging` branch**. Give the
  Preview environment (or branch-scoped vars for `staging`):
  `NEXT_PUBLIC_API_URL=https://api.staging.solkey.io`,
  `NEXT_PUBLIC_SITE_URL=https://staging.solkey.io`, `NEXT_PUBLIC_BETA_MODE`
  matching the overlay, and leave `NEXT_PUBLIC_POSTHOG_KEY` unset so staging
  traffic never pollutes production analytics.

## Deploying

Every push to the `staging` branch builds images and applies this overlay
(`.github/workflows/deploy.yml`); the same workflow deploys `production` to
the production overlay. First-time bring-up: provision above → create the
secret → push to `staging` → wait for the ManagedCertificate to become Active
(`kubectl describe managedcertificate api-cert -n mushee-staging`, ~15–60 min
after DNS resolves) → smoke-test signup/login on https://staging.solkey.io.
