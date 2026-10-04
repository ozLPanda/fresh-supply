#!/usr/bin/env bash
set -Eeuo pipefail

# Run as the deploy user, after installing the distribution's docker-buildx CLI
# package. Do not run provision-blue-green.sh on an existing blue/green setup.
readonly BUILDER="${OVOSHI_HELP_BUILDER:-ovoshi-help-prod}"
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly BUILDKIT_IMAGE="moby/buildkit:v0.33.0"

docker buildx version
if docker buildx inspect "$BUILDER" >/dev/null 2>&1; then
  echo "Builder $BUILDER already exists; preserving its configuration and cache."
else
  docker buildx create --name "$BUILDER" --driver docker-container \
    --buildkitd-config "$SCRIPT_DIR/buildkitd.toml" \
    --driver-opt "image=$BUILDKIT_IMAGE" \
    --driver-opt memory=3g --driver-opt memory-swap=3g \
    --driver-opt cpu-period=100000 --driver-opt cpu-quota=200000 \
    --driver-opt restart-policy=unless-stopped
fi
[[ "$(docker buildx inspect "$BUILDER" | awk '$1 == "Driver:" {print $2}')" == docker-container ]]
details="$(docker buildx inspect "$BUILDER" --bootstrap)"
printf '%s\n' "$details"
grep -qE '^Status:[[:space:]]+running$' <<<"$details"
