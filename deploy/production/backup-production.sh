#!/usr/bin/env bash
set -Eeuo pipefail

# Prepared manual backup procedure. It is deliberately not scheduled or called
# by CI/CD. Use a mounted/external destination, not disk on this same VPS.
readonly REPOSITORY_DIR="/opt/ovoshi-help-repo"
readonly MC_IMAGE="minio/mc:latest"

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 /absolute/path/to/backup-destination" >&2
  exit 64
fi

readonly DESTINATION_ROOT="$1"
[[ "$DESTINATION_ROOT" = /* ]] || {
  echo "Backup destination must be an absolute path" >&2
  exit 64
}

cd "$REPOSITORY_DIR"
set -a
. ./.env.production
set +a

readonly BACKUP_DIR="$DESTINATION_ROOT/ovoshi-help-$(date +%Y%m%d-%H%M%S)"
install -d -m 0700 "$BACKUP_DIR/minio"

docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom >"$BACKUP_DIR/postgres.dump"

docker run --rm --network ovoshi-help-prod_services \
  --entrypoint /bin/sh \
  -e MINIO_ROOT_USER -e MINIO_ROOT_PASSWORD -e APP_STORAGE_BUCKET \
  -v "$BACKUP_DIR/minio:/backup" \
  "$MC_IMAGE" -ec '
    mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
    mc mirror "local/$APP_STORAGE_BUCKET" /backup
  '

sha256sum "$BACKUP_DIR/postgres.dump" >"$BACKUP_DIR/SHA256SUMS"
find "$BACKUP_DIR/minio" -type f -print0 | sort -z | xargs -0 sha256sum >>"$BACKUP_DIR/SHA256SUMS"
echo "Backup written to $BACKUP_DIR"
