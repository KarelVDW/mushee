# Runbook 4 — Database recovery & operations

The database is the only truly stateful thing we run (blob storage is
versioned and replaceable per-object). Everything here targets Cloud SQL
instance `mushee-prod` (Postgres 17, private IP `10.56.0.3`, database
`mushee`, user `mushee`).

What's already configured: automated daily backups (03:00 Europe window),
**point-in-time recovery** (WAL archiving), TLS required from the API
(`POSTGRES_SSL=require`), private IP only (no public address).

## 1. Check backup health (do this occasionally, not just in a crisis)

```sh
gcloud sql backups list --instance=mushee-prod --limit=5
gcloud sql instances describe mushee-prod \
  --format='value(settings.backupConfiguration.enabled, settings.backupConfiguration.pointInTimeRecoveryEnabled)'
```

Both flags true and a recent `SUCCESSFUL` backup = healthy.

## 2. The restore rehearsal (run once before launch, then ~quarterly)

A backup you've never restored is a hope, not a backup.

```sh
# Clone the instance from a point in time (yesterday evening, say):
gcloud sql instances clone mushee-prod mushee-rehearsal \
  --point-in-time '2026-07-11T18:00:00Z'
# ~10 min. The clone inherits the private-IP config and gets its own IP:
gcloud sql instances describe mushee-rehearsal --format='value(ipAddresses[0].ipAddress)'
```

Verify from inside the cluster (see §5 for the psql-pod trick), against the
**clone's** IP:

```sql
SELECT count(*) FROM "user";
SELECT count(*) FROM scores;
SELECT "userId", "createdAt" FROM recordings ORDER BY "createdAt" DESC LIMIT 3;
```

Counts plausible for the chosen timestamp = rehearsal passed. Then:

```sh
gcloud sql instances delete mushee-rehearsal   # clones bill like instances — delete promptly
```

Record the date it passed in `meta/master-todo.md`.

## 3. Point-in-time recovery for real (bad deploy ate data, bad SQL, etc.)

Decide the recovery timestamp first — the moment *before* the damage. Then:

1. **Stop the writers** so the damage stops compounding:
   ```sh
   kubectl scale deploy api -n mushee --replicas=0
   ```
   (Vercel keeps serving the frontend; it will show API errors — acceptable
   during recovery. Post a heads-up if you have a channel to users.)
2. Clone at the chosen instant (same command as §2, your timestamp).
3. Verify on the clone (§2 queries + whatever the incident concerns).
4. **Promote by repointing, not by restoring in place**: update
   `POSTGRES_URL` in `Secret/api-secrets` to the clone's IP, then
   `kubectl scale deploy api -n mushee --replicas=2`. The clone is now
   production; the damaged instance is frozen evidence.
5. After the dust settles: rename mentally (or actually re-clone back), fix
   the runbooks' recorded IP, delete the damaged instance once anything
   worth salvaging (rows written *after* the recovery point) has been
   extracted from it.

Data loss window = time between the recovery point and the stop in step 1.
PITR granularity is seconds, so choose the timestamp precisely.

**Blob-storage caveat:** DB rows reference GCS objects
(`recordings/<user>/<score>/<id>/…`, MusicXML). Rolling the DB back does NOT
roll storage back — you may end up with orphaned objects (harmless, invisible)
or, worse, DB rows pointing at objects deleted after the recovery point. The
bucket is **versioned** precisely for this: a deleted object's previous
generation is recoverable —
`gcloud storage ls -a gs://sheemu-prod-storage/<path>` shows generations, copy
the old generation back over the live name.

## 4. Losing the whole instance / region

Same mechanics as §3, but clone/restore into a new instance (possibly another
region) and expect DNS-free repointing to just work — the API only knows
`POSTGRES_URL`. If the region is gone, backups are still restorable
(Cloud SQL backups are multi-regional by default); re-run the §1-provisioning
of `deploy/k8s/overlays/production/README.md` in the new region for the
cluster half. Accepted RTO at this stage: hours.

## 5. Running one-off SQL safely (no public IP, and keep it that way)

The instance has no public address; your laptop can't reach 10.56.0.x. Run
psql *inside the cluster*, reusing the credentials the API already has:

```sh
kubectl run -n mushee psql --rm -it --restart=Never --image=postgres:17-alpine \
  --env="PGURL=$(kubectl get secret api-secrets -n mushee -o jsonpath='{.data.POSTGRES_URL}' | base64 -d)" \
  -- sh -c 'psql "$PGURL"'
```

Interactive psql, TLS, no credentials on your machine, pod deletes itself on
exit. The recurring admin one-liners:

```sql
-- Promote an existing account to admin (+ beta approval):
UPDATE "user" SET role='admin', "betaStatus"='approved' WHERE email='...';
-- Re-tune a tier's daily credits (live within 60 s — in-memory cache):
UPDATE subscription_tiers SET "dailyRecordingCredits"=600 WHERE id='beta';
-- Move all beta users to free (end-of-beta, see Runbook 5):
UPDATE user_subscriptions SET "tierId"='free' WHERE "tierId"='beta';
-- Clear a stuck recording lock (self-heals in 20 s; this is the impatient path):
DELETE FROM active_recordings WHERE "userId"='...';
```

Rule: reads freely; writes only ones already documented in a runbook or
reviewed by a second pair of eyes (or an agent). Ad-hoc UPDATEs are how §3
incidents start.

## 6. Migration failures

Migrations run on API boot, serialized by Postgres advisory lock `727271`,
before the app starts listening. Failure modes:

- **Migration throws** → boot aborts → `CrashLoopBackOff`, and the previous
  ReplicaSet's pods keep serving (rolling update never took them down). Read
  the error (`kubectl logs <new pod> --previous`), fix **forward** — a
  corrective migration or a code fix — and redeploy. TypeORM runs each
  migration in a transaction, so a failed one didn't half-apply.
- **Boot hangs silently at startup** → almost always waiting on the advisory
  lock. Find the holder:
  ```sql
  SELECT pid, query_start, state FROM pg_stat_activity
   WHERE pid IN (SELECT pid FROM pg_locks WHERE locktype='advisory' AND objid=727271);
  ```
  A crashed-mid-migration pod releases the lock automatically when its
  connection dies; a *live-but-stuck* holder you can
  `SELECT pg_terminate_backend(<pid>);` — the waiting replica then proceeds.
- **Never** run `migration:revert` against production; roll forward.
  (Also on record: `synchronize` is off everywhere; nothing mutates schema
  except migrations.)

## 7. Resizing / maintenance

- Resize: `gcloud sql instances patch mushee-prod --tier=db-custom-2-7680` —
  causes a restart (~1–2 min downtime). The API rides it out: pods' `/health`
  fails, liveness restarts them, they reconnect when the DB returns. Still:
  quiet window.
- Connection budget: each API replica holds 2 pools × `POSTGRES_POOL_SIZE`
  (10) = 20 connections; HPA max 6 replicas → 120, which **exceeds**
  db-custom-1-3840's ~100 limit. Before raising HPA max or pool size, do that
  arithmetic; either bump the tier or lower `POSTGRES_POOL_SIZE`.
- Maintenance windows: Cloud SQL applies them with a restart; set a preferred
  window (`--maintenance-window-day/--maintenance-window-hour`) to a quiet
  hour if the default ever bites.
