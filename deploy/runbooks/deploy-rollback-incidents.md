# Runbook 3 — Deploy, roll back, diagnose

## 1. The normal release

1. Merge/push to `master` — CI (`ci.yml`) must be green (lint, type-check,
   API + web unit tests incl. the model 100%-coverage gate, build, mocked e2e).
2. GitHub → Actions → **Deploy** → Run workflow (leave "apply" checked).
   It builds all three images from the exact commit, pushes them SHA-tagged,
   stamps the tags into `overlays/production`, applies, and waits for all
   three rollouts.
3. The web deploys **separately and automatically**: Vercel builds every push
   to `master`. There is no coordination mechanism between the two — for
   changes where API and web must move together (a changed API contract),
   ship the API first (it tolerates old clients) and merge the web change
   after the workflow finishes.
4. Post-deploy check, 60 seconds:
   ```sh
   curl -s https://api.sheemu.com/health
   kubectl get pods -n mushee
   kubectl logs -n mushee -l app=api --tail=200 | grep -iv '"url":"/health"' | tail -20
   ```

Rollout mechanics you get for free: 2 API replicas, rolling update, 60 s
termination grace in which live recording takes drain (the take stops for the
user but finalizes cleanly). Deploys during peak recording hours are safe but
not free — prefer quiet windows.

## 2. Rolling back

Three independent levers. Know which layer is actually broken first (§3).

**API / inference — redeploy the previous SHA.** Fastest, no CI required:

```sh
git log --oneline -5           # find the last good commit sha (full 40 chars for the tag)
GOOD=<full-sha>
cd deploy/k8s/overlays/production
for img in api crepe-inference basic-pitch-inference; do
  kustomize edit set image \
    "mushee/$img=europe-west1-docker.pkg.dev/sheemu-prod/mushee/$img:$GOOD"
done
kubectl apply -k .
kubectl rollout status deploy api -n mushee
```

Images are immutable and never garbage-collected, so any previously deployed
SHA is redeployable forever. (`kubectl rollout undo deploy api -n mushee`
also works for the API alone, but the kustomize route keeps the repo state
truthful — commit the tag change or revert it after the incident.)

**Web — Vercel instant rollback.** Vercel dashboard → Deployments → the last
good deployment → ⋯ → *Instant Rollback*. Seconds, no rebuild. Remember the
build-time envs: a rollback also rolls back to that build's baked
`NEXT_PUBLIC_*` values.

**Database — see Runbook 4.** Migrations are roll-*forward* by design (the
API runs them on boot). Never `migration:revert` against production data; if
a migration is bad, write a corrective migration and deploy it.

**Config-only incident** (bad env value, wrong secret): fix
`Secret/api-secrets` or `api-patch.yaml`, then
`kubectl rollout restart deploy api -n mushee`. No images involved.

## 3. Diagnosis playbook — symptom → likely cause

Start every incident with the same three commands:

```sh
kubectl get pods -n mushee
kubectl get events -n mushee --sort-by=.lastTimestamp | tail -20
kubectl logs -n mushee -l app=api --tail=500 | grep -iv '"url":"/health"' | tail -50
```

| Symptom | Check | Likely cause / fix |
|---|---|---|
| `ImagePullBackOff` | `kubectl describe pod …` pull error; does the tag exist in Artifact Registry? | Tag typo (`set-by-ci` applied manually?) — stamp a real SHA. Or node SA lost `roles/artifactregistry.reader` (bit us 2026-07-10). |
| `Pending` pods | events say `FailedScheduling` | Autopilot scaling up a node — normal for 1–3 min after a deploy. Persistent → resource requests grew beyond quota. |
| `CrashLoopBackOff`, exit code 1 | `kubectl logs <pod> --previous` | App error at boot — the fail-fast guards name themselves: missing `BETTER_AUTH_SECRET`, missing `SENDGRID_API_KEY`, dev DB creds, `SEED_DEMO_DATA` in prod, `STORAGE_DRIVER=gcs` without `GCS_BUCKET`, or a failed migration (see Runbook 4 §6). |
| Killed with exit 137, empty logs | `describe pod` Last State | Boot exceeded the probe window (migrations + cold node) — the startupProbe (36×5 s) covers 3 min; if a migration legitimately needs longer, raise it. Or OOM: `describe` says `OOMKilled` → long recordings, see memory notes in `meta/notes.md` §4. |
| `/health` 503 | logs: `database unreachable` | DB down/unreachable. `kubectl run -n mushee dbtest --rm -i --image=busybox --restart=Never -- nc -zv -w 5 10.56.0.3 5432`. Also: `/health` failing makes **liveness** fail → pods restart in a loop while the DB is down; they stabilize when it returns. |
| Whole API down but pods Ready | `kubectl describe ingress api -n mushee`; cert status | LB/NEG desync or cert expiry event: `kubectl describe managedcertificate api-cert -n mushee` (should be `Active`; renewal is automatic **as long as the DNS A-record keeps pointing at 34.117.52.77**). |
| Browser: CORS errors, signup hangs | which origin is the page on? | The site is being served from a non-canonical host. `sheemu.com` must be Vercel's primary domain (www 308→apex). Bit us on launch day. |
| Everyone bounced to /login | — | Session-cookie problem: `COOKIE_DOMAIN` missing/wrong (must be `.sheemu.com`), or `BETTER_AUTH_SECRET` changed (that logs everyone out once — expected after rotation). |
| OTP mails not arriving | API logs around signup; SendGrid dashboard → Activity | SendGrid key revoked/rotated without updating the secret, or sender-domain auth broken by a DNS change. Signup itself survives (flow proceeds to onboarding, which can re-send). |
| Recording connects then no notes appear | inference pods Ready? their logs? | Inference outage is deliberately **silent** for the recorder (audio still archives, credits still burn — known product gap, `recording-pipeline.ts` swallows forward-pass errors). Fix inference pods, not the API. |
| Recording sockets drop at exactly N s | — | LB timeout: BackendConfig `timeoutSec: 7200` bounds a WS connection. If takes legitimately exceed it, raise it together with `RECORDING_MAX_SECONDS`. |
| "Recording already in progress" stuck for a user | `active_recordings` table | Stale lock after an unclean pod death — self-heals in 20 s (heartbeat takeover). Persistent → delete the user's row. |
| 429s under normal use | which replica count? | Rate limit is per-replica in-memory (120/min each); replica churn resets it. Raise `RATE_LIMIT_MAX` via the overlay patch rather than fighting it. |

## 4. When the cluster itself is suspect

Autopilot removes most node-level failure modes. What's left:

- **Quota**: a scale-up silently stalls → events on the pending pod name the
  quota. `gcloud compute regions describe europe-west1` shows usage; request
  more in the console.
- **Regional outage**: nothing to do but wait (single-region deployment is an
  accepted risk at this stage). The database has PITR; the bucket is
  versioned. If europe-west1 evaporates permanently, Runbook 4 §4 (restore to
  a new instance) + re-running the provisioning runbook in another region is
  the DR path — hours, not minutes, and that's the current, deliberate SLA.

## 5. After any incident

Write down what happened in `meta/notes.md` (§ gotchas) or extend the table
above — this file only stays useful if every real incident feeds it. If the
fix changed infra (an IAM grant, a probe, a timeout), commit it to the
overlay/runbook in the same PR so the next environment inherits it.
