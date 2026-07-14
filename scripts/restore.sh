#!/usr/bin/env bash
#
# Crown Island — restore from an encrypted backup produced by backup.sh (OPS-001).
#
# DESTRUCTIVE: this OVERWRITES the target database and upload trees. It refuses to
# run without an explicit `--yes`. Practise it on a scratch environment as part of
# the recovery drill (see docs/DISASTER-RECOVERY.md) BEFORE you ever need it live.
#
# Usage:
#   BACKUP_PASSPHRASE=… DATABASE_URL=… ./scripts/restore.sh <snapshot-dir> --yes
#
#   <snapshot-dir>   a directory containing db.dump.gpg, uploads.tar.gpg,
#                    private-uploads.tar.gpg, SHA256SUMS (local, or first `rclone
#                    copy` it down from BACKUP_REMOTE).
#
# Env mirrors backup.sh (DATABASE_URL, UPLOADS_DIR, PRIVATE_UPLOADS_DIR, GPG,
# PG_RESTORE, PSQL).
set -euo pipefail

SRC="${1:-}"
CONFIRM="${2:-}"
UPLOADS_DIR="${UPLOADS_DIR:-./public/uploads}"
PRIVATE_UPLOADS_DIR="${PRIVATE_UPLOADS_DIR:-./private-uploads}"
GPG="${GPG:-gpg}"
PG_RESTORE="${PG_RESTORE:-pg_restore}"
PSQL="${PSQL:-psql}"

fail() { echo "[restore] ERROR: $*" >&2; exit 1; }

[ -n "$SRC" ] || fail "usage: restore.sh <snapshot-dir> --yes"
[ -d "$SRC" ] || fail "snapshot dir '$SRC' not found."
[ "$CONFIRM" = "--yes" ] || fail "refusing to overwrite without --yes (this is destructive)."
[ -n "${BACKUP_PASSPHRASE:-}" ] || fail "BACKUP_PASSPHRASE not set."
[ -n "${DATABASE_URL:-}" ] || fail "DATABASE_URL not set."

# Verify integrity first — never restore a corrupted/tampered snapshot.
[ -f "$SRC/SHA256SUMS" ] || fail "snapshot has no SHA256SUMS — refusing an unverifiable restore."
echo "[restore] verifying checksums…"
( cd "$SRC" && sha256sum -c SHA256SUMS ) || fail "checksum verification FAILED — aborting."

decrypt() { "$GPG" --batch --yes --decrypt --passphrase "$BACKUP_PASSPHRASE" "$1"; }

# 1. Database. --clean --if-exists drops existing objects first so this is a full
#    replace, not a merge.
echo "[restore] restoring database (this OVERWRITES current data)…"
decrypt "$SRC/db.dump.gpg" | "$PG_RESTORE" --clean --if-exists --no-owner --no-privileges -d "$DATABASE_URL"

# 2. Upload trees.
restore_tree() { # $1 = archive label, $2 = target dir
  local gpg="$SRC/$1.tar.gpg"
  if [ -f "$gpg" ]; then
    echo "[restore] restoring $1 → $2 …"
    mkdir -p "$(dirname "$2")"
    rm -rf "$2"
    decrypt "$gpg" | tar -C "$(dirname "$2")" -xf -
  else
    echo "[restore] WARN: $gpg not present — skipping $1."
  fi
}
restore_tree "uploads" "$UPLOADS_DIR"
restore_tree "private-uploads" "$PRIVATE_UPLOADS_DIR"

echo "[restore] done. Verify: row counts, a signed-in login, and that /uploads + secure-media render."
