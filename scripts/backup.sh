#!/usr/bin/env bash
#
# Crown Island — encrypted off-host backup (OPS-001).
#
# Produces a point-in-time-ish snapshot of everything that cannot be rebuilt:
#   1. a full PostgreSQL dump (custom format, restorable with pg_restore), and
#   2. the two upload trees (public /uploads + SENSITIVE /private-uploads).
# Both are GPG-symmetric-encrypted with BACKUP_PASSPHRASE, then (optionally)
# pushed off-host with rclone so a lost Docker host / deleted volume is
# recoverable. Local copies older than RETENTION_DAYS are pruned.
#
# This is DR — distinct from the in-app JSON export (src/server/services/backup.ts),
# which is an additive convenience export and omits auth/provider/push state.
#
# Run from cron on the host, e.g. every 6h:
#   0 */6 * * *  BACKUP_PASSPHRASE=… /opt/crown-island/scripts/backup.sh >> /var/log/ci-backup.log 2>&1
#
# Required env:
#   DATABASE_URL            postgres://user:pass@host:port/db   (or PG* vars)
#   BACKUP_PASSPHRASE       symmetric encryption passphrase (KEEP IT OFF THIS HOST)
# Required env (continued):
#   BACKUP_REMOTE           rclone remote:path           (e.g. b2:ci-backups) — off-host copy
# Optional env:
#   BACKUP_DIR              local staging dir            (default: /var/backups/crown-island)
#   UPLOADS_DIR             public uploads path          (default: ./public/uploads)
#   PRIVATE_UPLOADS_DIR     sensitive uploads path       (default: ./private-uploads)
#   RETENTION_DAYS          local prune age              (default: 14)
#   PG_DUMP / RCLONE        override binary paths
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/crown-island}"
UPLOADS_DIR="${UPLOADS_DIR:-./public/uploads}"
PRIVATE_UPLOADS_DIR="${PRIVATE_UPLOADS_DIR:-./private-uploads}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
PG_DUMP="${PG_DUMP:-pg_dump}"
RCLONE="${RCLONE:-rclone}"
GPG="${GPG:-gpg}"

fail() { echo "[backup] ERROR: $*" >&2; exit 1; }

[ -n "${BACKUP_PASSPHRASE:-}" ] || fail "BACKUP_PASSPHRASE is not set — refusing to write an unencrypted backup."
[ -n "${DATABASE_URL:-}${PGDATABASE:-}" ] || fail "DATABASE_URL (or PG* vars) not set."
[ -n "${BACKUP_REMOTE:-}" ] || fail "BACKUP_REMOTE is not set — refusing a same-host-only backup."
command -v "$GPG" >/dev/null 2>&1 || fail "gpg not found (needed for encryption)."
command -v "$PG_DUMP" >/dev/null 2>&1 || fail "pg_dump not found."
command -v "$RCLONE" >/dev/null 2>&1 || fail "rclone not found (required for the off-host copy)."

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$BACKUP_DIR/$STAMP"
mkdir -p "$DEST"
echo "[backup] $STAMP → $DEST"

encrypt() { # encrypt stdin → $1.gpg (AES-256, symmetric)
  "$GPG" --batch --yes --symmetric --cipher-algo AES256 \
    --passphrase "$BACKUP_PASSPHRASE" -o "$1.gpg"
}

# 1. PostgreSQL — custom format (compressed, selective restore), streamed to GPG.
echo "[backup] dumping database…"
if [ -n "${DATABASE_URL:-}" ]; then
  "$PG_DUMP" --format=custom --no-owner --no-privileges "$DATABASE_URL" | encrypt "$DEST/db.dump"
else
  "$PG_DUMP" --format=custom --no-owner --no-privileges | encrypt "$DEST/db.dump"
fi

# 2. Upload trees — tar each, streamed to GPG. `|| true` on tar's "file changed
#    while reading" (exit 1) is intentional: a file written mid-backup is caught
#    next run; a genuine failure still shows in the log.
backup_tree() { # $1 = path, $2 = label
  if [ -d "$1" ]; then
    echo "[backup] archiving $2 ($1)…"
    tar -C "$(dirname "$1")" -cf - "$(basename "$1")" | encrypt "$DEST/$2.tar"
  else
    echo "[backup] WARN: $2 dir '$1' not found — skipping."
  fi
}
backup_tree "$UPLOADS_DIR" "uploads"
backup_tree "$PRIVATE_UPLOADS_DIR" "private-uploads"

# Manifest for restore-time integrity verification.
( cd "$DEST" && sha256sum ./*.gpg > SHA256SUMS ) || fail "checksum step failed."
echo "[backup] wrote: $(ls -1 "$DEST" | tr '\n' ' ')"

# 3. Off-host copy (the part that makes this real DR). Without a remote the
#    backup only survives a lost VOLUME, not a lost HOST — warn loudly.
echo "[backup] uploading to $BACKUP_REMOTE/$STAMP …"
"$RCLONE" copy "$DEST" "$BACKUP_REMOTE/$STAMP" || fail "off-host upload failed."
"$RCLONE" check "$DEST" "$BACKUP_REMOTE/$STAMP" --one-way || fail "off-host checksum verification failed."
echo "[backup] off-host copy verified."

# 4. Prune local snapshots older than retention (off-host retention is managed
#    by the remote's own lifecycle policy).
echo "[backup] pruning local snapshots older than ${RETENTION_DAYS}d…"
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime "+$RETENTION_DAYS" -exec rm -rf {} + 2>/dev/null || true

echo "[backup] done."
