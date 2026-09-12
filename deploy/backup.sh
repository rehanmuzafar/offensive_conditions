#!/usr/bin/env bash
#
# Nightly backup of everything that cannot be rebuilt from git.
#
# The code is in the repository and the images can be rebuilt. What cannot be
# recovered is the database, the uploaded files, and the secrets — lose those
# and the site is gone even though every line of code survives.
#
# These land on the same disk as the data they protect, which guards against a
# bad migration or a wrong DELETE, not against the disk dying. Copies off this
# machine are a separate job and still worth doing.

set -euo pipefail
cd "$(dirname "$0")"

DIR="$HOME/offcon/backups"
STAMP=$(date +%Y%m%d-%H%M)
KEEP_DAYS=14

U=$(grep -E '^DB_USER=' .env | cut -d= -f2)
D=$(grep -E '^DB_NAME=' .env | cut -d= -f2)
P=$(grep -E '^DB_PASSWORD=' .env | cut -d= -f2)

log() { echo "[$(date '+%F %T')] $*"; }

log "database"
docker exec -e PGPASSWORD="$P" offcon-postgres-1 \
  pg_dump -U "$U" -d "$D" --no-owner --no-acl -Fc > "$DIR/db-$STAMP.dump"

# A backup nobody has read is a hope, not a backup. pg_restore --list walks
# the archive's table of contents, so a truncated or corrupt dump fails here —
# tonight, in the log — instead of on the day it is needed.
#
# Copied into the container first: --list has to seek, and a custom-format
# archive fed through a pipe fails with "did not find magic string in file
# header", which reads exactly like a corrupt backup and is not one.
log "verifying the dump"
docker cp "$DIR/db-$STAMP.dump" offcon-postgres-1:/tmp/verify.dump >/dev/null
if ! docker exec offcon-postgres-1 pg_restore --list /tmp/verify.dump >/dev/null 2>&1; then
  docker exec offcon-postgres-1 rm -f /tmp/verify.dump >/dev/null 2>&1 || true
  log "FAILED: the dump is not readable — keeping it for inspection, not rotating"
  exit 1
fi
OBJECTS=$(docker exec offcon-postgres-1 pg_restore --list /tmp/verify.dump 2>/dev/null | grep -c "TABLE DATA")
docker exec offcon-postgres-1 rm -f /tmp/verify.dump >/dev/null 2>&1 || true
log "verified — $OBJECTS tables in the archive"

log "uploaded files"
docker run --rm -v offcon_minio_data:/data -v "$DIR":/out alpine \
  tar czf "/out/minio-$STAMP.tgz" -C /data . 2>/dev/null

log "secrets and env"
tar czf "$DIR/config-$STAMP.tgz" -C "$HOME/offcon/deploy" .env secrets 2>/dev/null
chmod 600 "$DIR"/config-*.tgz

# Old copies go, but only if a newer one exists — a failed run must not take
# the last good backup with it.
if [ "$(ls -1 "$DIR"/db-*.dump 2>/dev/null | wc -l)" -gt 1 ]; then
  find "$DIR" -name 'db-*.dump' -mtime +$KEEP_DAYS -delete
  find "$DIR" -name 'minio-*.tgz' -mtime +$KEEP_DAYS -delete
  find "$DIR" -name 'config-*.tgz' -mtime +$KEEP_DAYS -delete
fi

log "done — $(du -sh "$DIR" | cut -f1) in $DIR"
