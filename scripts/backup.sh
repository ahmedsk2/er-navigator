#!/bin/bash
# Nightly logical backup of the ER Navigator database. Runs ON THE HOST (not in a container),
# installed by docs/RUNBOOK.md "Backups" as a systemd timer, before the first real case is
# entered. Scoped to this app's db container only.
#
#   pg_dump (custom format, compressed) -> /home/ubuntu/backups/ernav/ernav-YYYY-MM-DD-HHMM.dump
#   keep RETENTION_DAYS locally; upload to the OCI bucket when the uploader is configured
#
# Restore drill (into a scratch database, never over production):
#   sudo docker exec -i "$DB" createdb -U ernav_owner ernav_restore_test
#   sudo docker exec -i "$DB" pg_restore -U ernav_owner -d ernav_restore_test --no-owner < <file>
#   sudo docker exec -i "$DB" psql -U ernav_owner -d ernav_restore_test -tAc 'SELECT count(*) FROM "Case"'
#   sudo docker exec -i "$DB" dropdb -U ernav_owner ernav_restore_test
set -euo pipefail

APP_UUID="${APP_UUID:-jqcjqhmcmizxs1u51wnqlfwv}"
DEST="${DEST:-/home/ubuntu/backups/ernav}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
DB_NAME="${DB_NAME:-ernav}"
DB_USER="${DB_USER:-ernav_owner}"
# Optional off-host copy. Set UPLOAD_CMD to a command that takes the file path as $1, e.g. an
# `oci os object put` or `rclone copy` wrapper with credentials that live on the host, mode 600.
UPLOAD_CMD="${UPLOAD_CMD:-}"

DB=$(sudo docker ps --format '{{.Names}}' | grep "^db-${APP_UUID}" | head -1)
if [[ -z "$DB" ]]; then echo "backup: db container for ${APP_UUID} not running" >&2; exit 1; fi

mkdir -p "$DEST"
STAMP=$(date -u +%Y-%m-%d-%H%M)
FILE="$DEST/ernav-$STAMP.dump"
sudo docker exec "$DB" pg_dump -U "$DB_USER" -d "$DB_NAME" --format=custom --compress=6 > "$FILE"
chmod 600 "$FILE"
SIZE=$(stat -c %s "$FILE")
if [[ "$SIZE" -lt 1024 ]]; then echo "backup: dump suspiciously small ($SIZE bytes)" >&2; exit 1; fi
echo "backup: wrote $FILE ($SIZE bytes)"

find "$DEST" -name 'ernav-*.dump' -type f -mtime +"$RETENTION_DAYS" -delete

if [[ -n "$UPLOAD_CMD" ]]; then
  $UPLOAD_CMD "$FILE" && echo "backup: uploaded" || { echo "backup: upload FAILED" >&2; exit 1; }
fi
