# Production overlay — one-time GCP provisioning

The manifests here assume the GCP resources below exist. Replace `PROJECT_ID`
in `kustomization.yaml` + `service-account.yaml` (grep for it) once the
project is created. Web app deploys separately on Vercel — this overlay covers
the API + the two inference services only.

```sh
PROJECT_ID=<your-project>
REGION=europe-west1   # EU: matches the EU-hosted PostHog/DB posture

# 1. Artifact Registry for the three images (CI pushes here).
gcloud artifacts repositories create mushee \
  --repository-format=docker --location=$REGION

# 2. GKE Autopilot cluster (metrics + workload identity are built in).
gcloud container clusters create-auto mushee-prod --region=$REGION

# 3. Cloud SQL Postgres 17 — private IP, TLS, PITR + automated backups.
gcloud sql instances create mushee-prod \
  --database-version=POSTGRES_17 --region=$REGION \
  --tier=db-custom-1-3840 --network=default --no-assign-ip \
  --enable-point-in-time-recovery --backup-start-time=03:00
gcloud sql databases create mushee --instance=mushee-prod
# …create the app user, then REHEARSE ONE RESTORE before launch (clone to a
# throwaway instance from a backup and connect once). Non-negotiable.

# 4. GCS bucket for MusicXML + recording archives (EU, versioned).
gcloud storage buckets create gs://sheemu-prod-storage \
  --location=$REGION --uniform-bucket-level-access
gcloud storage buckets update gs://sheemu-prod-storage --versioning

# 5. Workload identity: GSA for the API, bucket access, KSA binding.
gcloud iam service-accounts create mushee-api
gcloud storage buckets add-iam-policy-binding gs://sheemu-prod-storage \
  --member="serviceAccount:mushee-api@$PROJECT_ID.iam.gserviceaccount.com" \
  --role=roles/storage.objectAdmin
gcloud iam service-accounts add-iam-policy-binding \
  mushee-api@$PROJECT_ID.iam.gserviceaccount.com \
  --role=roles/iam.workloadIdentityUser \
  --member="serviceAccount:$PROJECT_ID.svc.id.goog[mushee/api]"

# 6. Static IP for the ingress, then point DNS at it:
#    api.sheemu.com A -> this address (the managed cert needs DNS to resolve).
gcloud compute addresses create mushee-api-ip --global
gcloud compute addresses describe mushee-api-ip --global --format='value(address)'
```

## Secret/api-secrets

Only real secrets go here — non-secret topology lives in `api-patch.yaml`.

```sh
kubectl create secret generic api-secrets -n mushee \
  --from-literal=POSTGRES_URL='postgres://mushee:<password>@<private-ip>:5432/mushee' \
  --from-literal=BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
  --from-literal=SENDGRID_API_KEY='<sendgrid key>' \
  --from-literal=ADMIN_EMAILS='karel@advantitge.com'
# Polar (add before enabling checkout; webhook path works without checkout):
#   POLAR_ACCESS_TOKEN, POLAR_WEBHOOK_SECRET, POLAR_SERVER=production,
#   POLAR_PRODUCT_{PRO,STUDIO}_{MONTHLY,YEARLY}
```

## Deploying

CI (`.github/workflows/deploy.yml`) builds, pushes, stamps immutable image
tags, and applies this overlay. First-time bring-up order: provision the GCP
resources above → create the secret → run the Deploy workflow → wait for the
ManagedCertificate to become Active (`kubectl describe managedcertificate
api-cert -n mushee`, takes ~15–60 min after DNS resolves) → smoke-test one
real signup → login on https://sheemu.com.
