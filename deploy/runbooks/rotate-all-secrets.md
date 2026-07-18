# Runbook 1 — Rotate every secret

When to run: on a schedule (yearly is reasonable at this scale), after a
credential may have leaked (pasted in a chat, in a screenshot, an ex-machine),
or after offboarding anyone who ever had access.

## 1. Know what exists — the full credential inventory

| Credential | Lives in | Rotating it breaks… | Downtime if done right |
|---|---|---|---|
| Cloud SQL password (user `mushee`) | Cloud SQL + `POSTGRES_URL` in `Secret/api-secrets` | new DB connections until secret + pods updated | none |
| `BETTER_AUTH_SECRET` | `Secret/api-secrets` only | **every user session — everyone is logged out** | none technically; all users re-login |
| `SENDGRID_API_KEY` | SendGrid dashboard + `Secret/api-secrets` | outgoing mail (OTP, waitlist, approval) | none if old key revoked *after* verification |
| `POLAR_ACCESS_TOKEN` / `POLAR_WEBHOOK_SECRET` (once billing is live) | Polar dashboard + `Secret/api-secrets` | checkout/portal calls; webhook verification | none if rotated pairwise (see §6) |
| PostHog project key (`NEXT_PUBLIC_POSTHOG_KEY`) | Vercel env (build-time) | analytics only | n/a — public by design, rotation rarely needed |
| Google Workspace / SendGrid / Polar / Vercel / GitHub / GCP **account passwords + 2FA** | the respective services | nothing in prod | n/a |

Deliberately **not** in the inventory, because the architecture avoids them:
no GCP service-account key files (GCS auth is workload identity; CI auth is
GitHub OIDC federation), no registry passwords, no kubeconfig tokens beyond
your own gcloud login, no web-side server secrets (Vercel holds only public
`NEXT_PUBLIC_*` values). There is nothing to rotate for GCS or CI.

Everything server-side funnels into **one** Kubernetes secret:
`Secret/api-secrets` in namespace `mushee`. That is the entire rotation
surface.

## 2. Preparation

```sh
gcloud auth login            # tokens expire ~daily on this setup
gcloud config set project sheemu-prod
gcloud container clusters get-credentials mushee-prod --region=europe-west1

# See what keys the secret currently holds (values stay hidden):
kubectl get secret api-secrets -n mushee -o jsonpath='{.data}' \
  | python3 -c "import json,sys; print(sorted(json.load(sys.stdin).keys()))"

# Snapshot the current secret so a botched rotation is a 10-second revert.
# This file contains live credentials — keep it OUT of the repo and delete it
# when done (it goes to /tmp on purpose):
kubectl get secret api-secrets -n mushee -o yaml > /tmp/api-secrets.backup.yaml
```

Pick a quiet window. The pod restarts in §5 drain live recording takes
(sessions get a clean SIGTERM finalize, but the user's take still stops).

## 3. Generate and stage the new values

Never paste secrets into a chat, a ticket, or a shell-history-visible
`--from-literal` with the value typed inline. Generate to files:

```sh
mkdir -p /tmp/rot && chmod 700 /tmp/rot
openssl rand -hex 24    > /tmp/rot/db-password.txt      # hex: URL-safe in POSTGRES_URL
openssl rand -base64 32 > /tmp/rot/better-auth.txt
# SendGrid: dashboard → Settings → API Keys → Create (Full Access) → save to:
#   /tmp/rot/sendgrid.txt        — do NOT revoke the old key yet
```

## 4. Apply, in this order

**a. Database password.** Postgres does not kill established connections on a
password change, so running pods keep working on their existing pools; only
*new* connections need the new password. That makes the order safe:

```sh
gcloud sql users set-password mushee --instance=mushee-prod \
  --password="$(cat /tmp/rot/db-password.txt)"
```

**b. Rewrite the k8s secret** (recreate is simpler than patching four keys):

```sh
kubectl create secret generic api-secrets -n mushee \
  --from-literal=POSTGRES_URL="postgres://mushee:$(cat /tmp/rot/db-password.txt)@10.56.0.3:5432/mushee" \
  --from-literal=BETTER_AUTH_SECRET="$(cat /tmp/rot/better-auth.txt)" \
  --from-literal=SENDGRID_API_KEY="$(cat /tmp/rot/sendgrid.txt)" \
  --from-literal=ADMIN_EMAILS='info@solkey.io' \
  --dry-run=client -o yaml | kubectl apply -f -
```

(Once Polar is configured, carry its keys over in the same command — check
the §2 key listing so you never silently drop a key. A dropped
`SENDGRID_API_KEY` means the API **refuses to boot**; a dropped
`BETTER_AUTH_SECRET` same. That's by design — fail loud, not forgeable.)

**c. Restart the API** — env is only read at boot:

```sh
kubectl rollout restart deploy api -n mushee
kubectl rollout status  deploy api -n mushee --timeout=5m
```

The inference services hold no secrets; leave them alone.

## 5. Verify before you burn the old credentials

```sh
curl -s https://api.solkey.io/health          # {"status":"ok",...} → DB password works
curl -s https://api.solkey.io/plans | head -c 200   # DB reads work
```

Then in a browser: log in (your session was invalidated by the
`BETTER_AUTH_SECRET` change — that's expected, and it doubles as the test),
and trigger one email (password-reset works without touching real users).
Mail arriving proves the new SendGrid key.

Watch the logs while you do it:

```sh
kubectl logs -n mushee -l app=api --tail=100 | grep -iv '"url":"/health"'
```

## 6. Revoke the old credentials — only now

- SendGrid: dashboard → API Keys → delete the old key.
- Polar (when applicable): revoke the old access token. For the webhook
  secret, Polar regenerates it on the endpoint; update the k8s secret and
  restart *immediately after* regenerating — between those two moments,
  webhook deliveries fail verification (Polar retries with backoff, and the
  `processed_webhook_events` dedup makes retries safe, so nothing is lost).
- Old DB password died at step 4a. `BETTER_AUTH_SECRET` has no revocation —
  replacing it already invalidated everything signed with it.

## 7. Clean up

```sh
rm -rf /tmp/rot /tmp/api-secrets.backup.yaml
```

If anything went wrong instead: `kubectl apply -f /tmp/api-secrets.backup.yaml
&& kubectl rollout restart deploy api -n mushee` puts the old world back
(re-set the old DB password first if you already ran §4a — which is why the
backup matters).

## Accounts beyond the app

A full refresh should also walk: Google Workspace (info@solkey.io), GCP
login, GitHub, Vercel, SendGrid, PostHog, Polar, and the domain registrar —
password + 2FA each. Nothing in production references those credentials, so
they can be done any time, no restarts, no order.
