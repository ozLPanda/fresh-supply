#!/usr/bin/env bash
set -Eeuo pipefail

# One-time, idempotent import of the encrypted photo archive into the private
# MinIO bucket. This script is intentionally not invoked by CI/CD.
readonly REPOSITORY_DIR="/opt/ovoshi-help-repo"
readonly NETWORK="ovoshi-help-prod_services"
readonly MC_IMAGE="minio/mc:latest"

if [[ $# -ne 1 ]]; then
  echo "Usage: APP_IMPORT_ARCHIVE_PASSWORD=... $0 /absolute/path/to/archive.zip" >&2
  exit 64
fi

readonly ARCHIVE="$1"
[[ "$ARCHIVE" = /* && -f "$ARCHIVE" ]] || {
  echo "Archive must be an existing absolute path" >&2
  exit 64
}
[[ -n "${APP_IMPORT_ARCHIVE_PASSWORD:-}" ]] || {
  echo "Set APP_IMPORT_ARCHIVE_PASSWORD for this one-time import" >&2
  exit 64
}

cd "$REPOSITORY_DIR"
set -a
. ./.env.production
set +a

readonly WORK_DIR="$(mktemp -d /tmp/ovoshi-help-minio-import.XXXXXX)"
cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

# The outer archive is encrypted and contains uploads.zip. Validate both
# archives before extracting the files that will be uploaded.
unzip -t -P "$APP_IMPORT_ARCHIVE_PASSWORD" "$ARCHIVE" >/dev/null
unzip -qq -P "$APP_IMPORT_ARCHIVE_PASSWORD" "$ARCHIVE" -d "$WORK_DIR/outer"
readonly INNER_ARCHIVE="$WORK_DIR/outer/uploads.zip"
[[ -f "$INNER_ARCHIVE" ]] || {
  echo "Expected uploads.zip inside archive" >&2
  exit 1
}
unzip -t "$INNER_ARCHIVE" >/dev/null
unzip -qq "$INNER_ARCHIVE" -d "$WORK_DIR/files"

readonly SOURCE_DIR="$WORK_DIR/files/uploads"
[[ -d "$SOURCE_DIR" ]] || {
  echo "Expected uploads/ directory inside archive" >&2
  exit 1
}

# Only regular JPEG/PNG files directly below uploads/ are accepted. This keeps
# existing database paths (/uploads/<file>) compatible and blocks path tricks.
while IFS= read -r -d '' entry; do
  basename="$(basename "$entry")"
  case "$basename" in
    *.jpg|*.jpeg|*.png|*.JPG|*.JPEG|*.PNG) ;;
    *)
      echo "Unexpected archive entry: $basename" >&2
      exit 1
      ;;
  esac
done < <(find "$SOURCE_DIR" -mindepth 1 -maxdepth 1 -type f -print0)

if find "$SOURCE_DIR" -mindepth 1 -maxdepth 1 ! -type f -print -quit | grep -q .; then
  echo "Archive contains a non-file entry in uploads/" >&2
  exit 1
fi

readonly LOCAL_COUNT="$(find "$SOURCE_DIR" -mindepth 1 -maxdepth 1 -type f | wc -l | tr -d ' ')"
[[ "$LOCAL_COUNT" -gt 0 ]] || {
  echo "Archive contains no uploads" >&2
  exit 1
}

# Copy one object at a time, skipping keys that already exist. This makes retries
# safe without ever overwriting an object in MinIO. The API is Docker-internal.
docker run --rm --network "$NETWORK" \
  --entrypoint /bin/sh \
  -e MINIO_ROOT_USER -e MINIO_ROOT_PASSWORD -e APP_STORAGE_BUCKET \
  -v "$SOURCE_DIR:/source:ro" \
  "$MC_IMAGE" -ec '
    mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
    mc mb --ignore-existing "local/$APP_STORAGE_BUCKET"
    for source in /source/*; do
      filename="$(basename "$source")"
      target="local/$APP_STORAGE_BUCKET/uploads/$filename"
      mc stat "$target" >/dev/null 2>&1 || mc cp "$source" "$target"
    done
  '

readonly REMOTE_COUNT="$(docker run --rm --network "$NETWORK" \
  --entrypoint /bin/sh \
  -e MINIO_ROOT_USER -e MINIO_ROOT_PASSWORD -e APP_STORAGE_BUCKET \
  "$MC_IMAGE" -ec '
    mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
    mc find "local/$APP_STORAGE_BUCKET/uploads" | wc -l
  ' | tr -d ' ')"

[[ "$REMOTE_COUNT" -ge "$LOCAL_COUNT" ]] || {
  echo "Import verification failed: expected at least $LOCAL_COUNT objects, found $REMOTE_COUNT" >&2
  exit 1
}
echo "Imported $LOCAL_COUNT files into $APP_STORAGE_BUCKET/uploads"
