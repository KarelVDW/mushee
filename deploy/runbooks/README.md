# Operations runbooks

Step-by-step guides for the scenarios that will come up operating Sheemu in
production. Written 2026-07-11, right after the first production bring-up, so
every command reflects the real topology:

| Piece | Value |
|---|---|
| GCP project | `sheemu-prod` (number 940791749471, account info@sheemu.com) |
| Cluster | GKE Autopilot `mushee-prod`, region `europe-west1`, namespace `mushee` |
| Database | Cloud SQL Postgres 17 `mushee-prod`, private IP `10.56.0.3`, db/user `mushee` |
| Blob storage | `gs://sheemu-prod-storage` (versioned) |
| API entry | `api.sheemu.com` → static IP `mushee-api-ip` (34.117.52.77), ManagedCertificate `api-cert` |
| Web | Vercel, apex `sheemu.com` primary (www 308→apex — must stay that way or CORS breaks) |
| Images | `europe-west1-docker.pkg.dev/sheemu-prod/mushee/{api,crepe-inference,basic-pitch-inference}:<git-sha>` |
| CD | `.github/workflows/deploy.yml` (manual dispatch, GitHub OIDC as `github-deployer`) |
| Secrets | `Secret/api-secrets` in ns `mushee` — the only secret store |

The guides:

1. **[Rotate every secret](rotate-all-secrets.md)** — full credential refresh
   (DB password, session-signing secret, SendGrid, later Polar), in the order
   that avoids downtime, with the blast radius of each rotation spelled out.
2. **[Stand up a new environment](new-environment.md)** — uat/dev/staging:
   what to share, what to isolate, and every step from namespace to DNS to a
   working login on `uat.sheemu.com`.
3. **[Deploy, roll back, diagnose](deploy-rollback-incidents.md)** — the
   normal release flow, three rollback levers (API, web, database), and a
   symptom→cause playbook built from the failures we actually hit.
4. **[Database recovery & operations](database-dr-operations.md)** — restore
   rehearsal, point-in-time recovery, promoting a clone, safe one-off SQL
   against the private-IP instance, migration failures, resizing.
5. **[End the beta, open to the public](end-of-beta-launch.md)** — Polar
   production go-live, the BETA_MODE flip, beta-tier migration, and the
   launch-day checklist.

Companion docs: `deploy/k8s/overlays/production/README.md` (one-time GCP
provisioning, already executed — kept as the record of what exists),
root `README.md` § Deployment (image building, cluster expectations),
`meta/notes.md` (architecture decisions, beta-mode semantics, gotchas).
