#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 3 ]]; then
  echo "Usage: $0 <image:tag> <dockerfile> <context>" >&2
  exit 64
fi

readonly BUILDER="${OVOSHI_HELP_BUILDER:-ovoshi-help-prod}"
docker buildx version >/dev/null
driver="$(docker buildx inspect "$BUILDER" | awk '$1 == "Driver:" {print $2}')"
if [[ "$driver" != docker-container ]]; then
  echo "Expected a provisioned docker-container builder: $BUILDER" >&2
  exit 1
fi

# One build keeps all intermediate stages in the builder's persistent volume.
# --load makes the runtime image available to Compose in the local Docker daemon.
# Errors stop deployment; they must never trigger cache deletion or a cold retry.
exec docker buildx build --builder "$BUILDER" --platform linux/amd64 \
  --load --progress plain --tag "$1" --file "$2" "$3"
