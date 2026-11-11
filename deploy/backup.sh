#!/bin/sh
# Postgres backup, kept for 14 days. Run from host cron, e.g. every night at 03:15:
#   15 3 * * * /srv/blueclouds/deploy/backup.sh >> /var/log/blueclouds-backup.log 2>&1
set -eu
cd "$(dirname "$0")/.."
DIR="${BACKUP_DIR:-/var/backups/blueclouds}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
umask 077 # dumps hold player data and password hashes
mkdir -p "$DIR"
file="$DIR/postgres-$(date -u +%Y%m%dT%H%M%SZ).dump"
# Dump to a temp name first, so a failed dump never looks like a good backup.
docker compose -f deploy/compose.yml --env-file "${ENV_FILE:-.env}" exec -T postgres \
	sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > "$file.part"
mv "$file.part" "$file"
# Old backups, and leftovers from failed runs.
find "$DIR" -name 'postgres-*.dump' -mtime +"$KEEP_DAYS" -delete
find "$DIR" -name 'postgres-*.part' -mtime +1 -delete
echo "$(date -u +%FT%TZ) backup ok: $file ($(du -h "$file" | cut -f1))"
