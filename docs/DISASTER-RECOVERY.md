# Crown Island — Backup & Disaster Recovery (OPS-001)

Covers the data that **cannot be rebuilt from source**: the PostgreSQL database
(bookings, payments, invoices, audit history, identity records) and the two
upload trees (`public/uploads`, and the **sensitive** `private-uploads/` — guest
IDs and payment/ops proofs).

> The in-app JSON export on `/admin/developer` (`src/server/services/backup.ts`)
> is a convenience export, **not** DR: it is additive, omits auth/provider/push
> state, and lives on the same host. Do not rely on it for recovery.

## Objectives

| | Target | How it's met |
|---|---|---|
| **RPO** (max data loss) | ≤ 6 hours | `backup.sh` on a 6-hourly cron. Tighten to hourly, or add WAL archiving (below), for a smaller window. |
| **RTO** (time to restore) | ≤ 1 hour | `restore.sh` against a fresh host + the last off-host snapshot. |
| **Retention** | 14 days local, remote per bucket policy | `RETENTION_DAYS` + the remote's lifecycle rules. |

## What runs

`scripts/backup.sh` — encrypted `pg_dump` (custom format) + `tar` of both upload
trees, each **GPG-AES256 encrypted** with `BACKUP_PASSPHRASE`, checksummed, then
pushed **off-host** with `rclone`, verified with `rclone check`, and pruned locally. `scripts/restore.sh` — the
reverse, integrity-checked and gated behind `--yes` (it OVERWRITES).

The backup fails closed when `BACKUP_REMOTE` is absent or remote checksum
verification fails. Restore likewise refuses a snapshot without `SHA256SUMS`.

### Configure (once, on the host)

```sh
# Store these in the host's secret store / root-only env file — NOT in the repo.
export BACKUP_PASSPHRASE='<long random passphrase — keep a copy OFF this host>'
export DATABASE_URL='postgresql://postgres:…@localhost:5432/crown_island'
export BACKUP_REMOTE='b2:crown-island-backups'   # any rclone remote (S3/B2/Drive/…)
export UPLOADS_DIR=/var/lib/docker/volumes/crown-island_uploads_data/_data
export PRIVATE_UPLOADS_DIR=/var/lib/docker/volumes/crown-island_private_uploads_data/_data
```

`rclone config` once to create the `b2:` (or S3/etc.) remote. The passphrase and
the remote credentials must live **somewhere other than this server**, or a host
loss takes the means of decryption with it.

### Schedule (cron on the host)

```cron
0 */6 * * * cd /opt/crown-island && ./scripts/backup.sh >> /var/log/ci-backup.log 2>&1
```

> Deliberately a HOST cron, not a compose sidecar: DR must keep working even when
> the app stack is down. If you prefer Docker, run `postgres:16-alpine` (it ships
> `pg_dump`) as a one-shot with the same env.

## Restore drill (run quarterly — an untested backup is not a backup)

1. On a scratch host/VM, `rclone copy b2:crown-island-backups/<STAMP> ./snap`.
2. `BACKUP_PASSPHRASE=… DATABASE_URL=…(scratch db) ./scripts/restore.sh ./snap --yes`.
3. Verify: row counts vs. production, one real sign-in, a booking detail page,
   an image under `/uploads`, and a secure-media (guest ID) fetch.
4. Record the wall-clock time — that is your measured RTO. File any gaps.

## Stronger RPO (optional): continuous WAL archiving / PITR

The 6-hourly dump caps data loss at ~6h. For near-zero RPO, enable Postgres
base-backup + WAL archiving (`archive_command` → the same off-host bucket) and
restore to any timestamp with `recovery_target_time`. This needs a Postgres image
with WAL archiving configured; the logical dump above is the simpler baseline and
is sufficient for the stated RPO.

## Failure-to-avoid checklist

- [ ] `BACKUP_REMOTE` is set (otherwise backups die with the host).
- [ ] `BACKUP_PASSPHRASE` + remote creds are stored OFF this host.
- [ ] The restore drill has been run at least once and RTO measured.
- [ ] `private-uploads` is included and its restored files stay non-public
      (served only via `/api/secure-media`).
