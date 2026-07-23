# Production overlay — GCP provisioning

GCP project: **sheemu-prod** (number 940791749471, billing 019C30-EAE17A-A82095,
account info@solkey.io). Region: **europe-west1** (EU, matching the EU-hosted
PostHog/DB posture). Web app deploys separately on Vercel — this overlay covers
the API + the two inference services only.

Provisioned 2026-07-09: Artifact Registry repo `mushee`, global static IP
`mushee-api-ip` = **34.117.52.77** (point the `api.solkey.io` A record at it),
versioned bucket `gs://sheemu-prod-storage`, and the enabled APIs (container,
sqladmin, artifactregistry, compute, servicenetworking, iamcredentials,
storage). The remaining one-time commands:

```sh
# 1. GKE Autopilot cluster (metrics + workload identity are built in).
gcloud container clusters create-auto mushee-prod --region=europe-west1

# 2. Private-services VPC peering (Cloud SQL private IP needs it once).
gcloud compute addresses create google-managed-services-default \
  --global --purpose=VPC_PEERING --prefix-length=16 --network=default
gcloud services vpc-peerings connect --service=servicenetworking.googleapis.com \
  --ranges=google-managed-services-default --network=default

# 3. Cloud SQL Postgres 17 — private IP, PITR + automated backups.
gcloud sql instances create mushee-prod \
  --database-version=POSTGRES_17 --region=europe-west1 \
  --tier=db-custom-1-3840 --network=default --no-assign-ip \
  --enable-point-in-time-recovery --backup-start-time=03:00
gcloud sql databases create mushee --instance=mushee-prod
gcloud sql users create mushee --instance=mushee-prod --password='<generate one>'
# …then REHEARSE ONE RESTORE before launch (clone from a backup to a throwaway
# instance and connect once). Non-negotiable.

# 3b. Let the Autopilot nodes pull from Artifact Registry. New GCP projects
# no longer auto-grant the default compute SA any roles, so without this the
# first rollout sits in ImagePullBackOff (bitten 2026-07-10).
gcloud projects add-iam-policy-binding sheemu-prod \
  --member="serviceAccount:940791749471-compute@developer.gserviceaccount.com" \
  --role=roles/artifactregistry.reader

# 4. Workload identity: GSA for the API, bucket access, KSA binding.
gcloud iam service-accounts create mushee-api
gcloud storage buckets add-iam-policy-binding gs://sheemu-prod-storage \
  --member="serviceAccount:mushee-api@sheemu-prod.iam.gserviceaccount.com" \
  --role=roles/storage.objectAdmin
gcloud iam service-accounts add-iam-policy-binding \
  mushee-api@sheemu-prod.iam.gserviceaccount.com \
  --role=roles/iam.workloadIdentityUser \
  --member="serviceAccount:sheemu-prod.svc.id.goog[mushee/api]"

# 5. GitHub OIDC deployer for .github/workflows/deploy.yml.
gcloud iam workload-identity-pools create github --location=global
gcloud iam workload-identity-pools providers create-oidc github \
  --location=global --workload-identity-pool=github \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository=='KarelVDW/mushee'"
gcloud iam service-accounts create github-deployer
gcloud projects add-iam-policy-binding sheemu-prod \
  --member="serviceAccount:github-deployer@sheemu-prod.iam.gserviceaccount.com" \
  --role=roles/artifactregistry.writer
gcloud projects add-iam-policy-binding sheemu-prod \
  --member="serviceAccount:github-deployer@sheemu-prod.iam.gserviceaccount.com" \
  --role=roles/container.developer
gcloud iam service-accounts add-iam-policy-binding \
  github-deployer@sheemu-prod.iam.gserviceaccount.com \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/940791749471/locations/global/workloadIdentityPools/github/attribute.repository/KarelVDW/mushee"
```

## Secret/api-secrets

Only real secrets go here — non-secret topology lives in `api-patch.yaml`.

```sh
kubectl create secret generic api-secrets -n mushee \
  --from-literal=POSTGRES_URL='postgres://mushee:<password>@<private-ip>:5432/mushee' \
  --from-literal=BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
  --from-literal=SENDGRID_API_KEY='<sendgrid key>' \
  --from-literal=ADMIN_EMAILS='info@solkey.io' \
  --from-literal=ADMIN_SECRET="$(openssl rand -base64 32)"
# ADMIN_SECRET is shared with the admin console's Vercel project (see
# "Admin console" below) — set both to the same value.
# Polar (add before enabling checkout; webhook path works without checkout):
#   POLAR_ACCESS_TOKEN, POLAR_WEBHOOK_SECRET, POLAR_SERVER=production,
#   POLAR_PRODUCT_{PRO,STUDIO,ARRANGER}_{MONTHLY,YEARLY},
#   POLAR_PRODUCT_PACK_{SINGLE,EP,ALBUM}
```

## Admin console (admin.solkey.io)

The standalone console (`apps/admin`) deploys as its own Vercel project — it
talks to the API **server-side only** (no CORS entry, no cookie-domain
involvement):

- Vercel: new project rooted at `apps/admin`, production branch `production`,
  domain `admin.solkey.io`. Env (Production): `API_URL=https://api.solkey.io`
  and `ADMIN_SECRET` equal to the value in `Secret/api-secrets` above.
- DNS: `admin.solkey.io` CNAME → `cname.vercel-dns.com`.
- Nothing k8s-side beyond the secret: the API's `/admin` endpoints answer 503
  until `ADMIN_SECRET` is set, and `ADMIN_APP_URL` (api-patch.yaml) only
  controls links in signup-notification emails.
- Recording replay signs 15-minute GCS URLs (V4 via IAM signBlob), which
  needs the API's service account to be able to sign as itself:

  ```sh
  gcloud iam service-accounts add-iam-policy-binding \
    mushee-api@sheemu-prod.iam.gserviceaccount.com \
    --role=roles/iam.serviceAccountTokenCreator \
    --member="serviceAccount:mushee-api@sheemu-prod.iam.gserviceaccount.com"
  ```

  Without it the console still plays recordings — the API just streams the
  audio itself instead of redirecting to the bucket (see AdminService).

## Deploying

Every push to the `production` branch builds, pushes, stamps immutable image
tags, and applies this overlay (`.github/workflows/deploy.yml`); pushes to
`staging` deploy `overlays/staging` the same way. First-time bring-up order: provision the
resources above → create the secret → run the Deploy workflow → wait for the
ManagedCertificate to become Active (`kubectl describe managedcertificate
api-cert -n mushee`, takes ~15–60 min after DNS resolves) → smoke-test one
real signup → login on https://solkey.io.
