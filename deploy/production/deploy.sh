#!/usr/bin/env bash
set -Eeuo pipefail

readonly REPOSITORY_DIR="/opt/ovoshi-help-repo"
readonly BRANCH="main"
readonly BASE_COMPOSE=(docker compose --env-file .env.production -f docker-compose.prod.yml)
readonly ROLLOUT_COMPOSE_FILE="deploy/production/docker-compose.app.yml"
readonly NGINX_SWITCHER="/usr/local/sbin/ovoshi-help-switch-upstream"
readonly NGINX_CONFIG_APPLIER="/usr/local/sbin/ovoshi-help-apply-nginx-config"
readonly ROLLOUT_IMAGE_STATE_FILE="${XDG_STATE_HOME:-$HOME/.local/state}/ovoshi-help/rollout-image-history.env"
readonly CUTOVER_GUARD_FILE="$(dirname "$ROLLOUT_IMAGE_STATE_FILE")/cutover-needs-reconciliation"
readonly ROLLOUT_IMAGE_RETENTION_COUNT="${ROLLOUT_IMAGE_RETENTION_COUNT:-1}"
readonly DRAIN_SECONDS="${DRAIN_SECONDS:-45}"
readonly HEALTH_WAIT_ATTEMPTS="${HEALTH_WAIT_ATTEMPTS:-90}"
readonly HEALTH_WAIT_INTERVAL_SECONDS="${HEALTH_WAIT_INTERVAL_SECONDS:-2}"

deployment_stage() {
  printf '::ovoshi-help-stage::%s\n' "$1"
}

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <commit-sha>" >&2
  exit 64
fi

for retention_count in "$ROLLOUT_IMAGE_RETENTION_COUNT"; do
  if ! [[ "$retention_count" =~ ^[1-9][0-9]*$ ]]; then
    echo "Image retention counts must be positive integers" >&2
    exit 64
  fi
done

if [[ "${FORCE_APPLICATION_REBUILD:-false}" != true && "${FORCE_APPLICATION_REBUILD:-false}" != false ]]; then
  echo "FORCE_APPLICATION_REBUILD must be true or false" >&2
  exit 64
fi

readonly TARGET_SHA="$1"
deployment_stage preparing

if [[ -e "$CUTOVER_GUARD_FILE" ]]; then
  echo "Previous cutover needs reconciliation; preserve both slots and inspect $CUTOVER_GUARD_FILE before retrying." >&2
  exit 75
fi

cd "$REPOSITORY_DIR"
git fetch --prune origin "$BRANCH"
git cat-file -e "${TARGET_SHA}^{commit}"

if ! git merge-base --is-ancestor "$TARGET_SHA" "origin/$BRANCH"; then
  echo "Refusing to deploy a commit outside origin/$BRANCH" >&2
  exit 65
fi

PREVIOUS_SHA="$(git rev-parse HEAD)"
CHANGED_FILES="$(git diff --name-only "$PREVIOUS_SHA" "$TARGET_SHA")"
git checkout --detach "$TARGET_SHA"
"${BASE_COMPOSE[@]}" config --quiet

BACKEND_IMAGE=""
FRONTEND_IMAGE=""
BACKEND_PORT=""
FRONTEND_PORT=""
CANDIDATE_SLOT=""
CANDIDATE_STARTED=false
SWITCHED=false
REBUILD_APPLICATION="${FORCE_APPLICATION_REBUILD:-false}"

has_change() {
  grep -qE "$1" <<<"$CHANGED_FILES"
}

# Shared internal services must exist before a candidate application slot starts.
# This is safe for the active slot because it does not recreate backend/frontend.
if has_change '^docker-compose\.prod\.yml$'; then
  deployment_stage shared_services
  "${BASE_COMPOSE[@]}" up -d --no-build minio redis
fi


wait_for_healthy() {
  local service="$1"
  local container status

  container="$("${BASE_COMPOSE[@]}" ps -q "$service")"
  for ((attempt = 1; attempt <= HEALTH_WAIT_ATTEMPTS; attempt++)); do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container")"
    if [[ "$status" == "healthy" ]]; then
      return 0
    fi
    if [[ "$status" == "exited" || "$status" == "dead" ]]; then
      "${BASE_COMPOSE[@]}" logs --tail 100 "$service" >&2
      return 1
    fi
    sleep "$HEALTH_WAIT_INTERVAL_SECONDS"
  done

  echo "Timed out waiting for $service to become healthy after $((HEALTH_WAIT_ATTEMPTS * HEALTH_WAIT_INTERVAL_SECONDS)) seconds" >&2
  "${BASE_COMPOSE[@]}" logs --tail 100 "$service" >&2
  return 1
}

slot_ports() {
  case "$1" in
    blue)
      BACKEND_PORT=18092
      FRONTEND_PORT=18093
      ;;
    green)
      BACKEND_PORT=18094
      FRONTEND_PORT=18095
      ;;
    *)
      echo "Unknown application slot: $1" >&2
      return 64
      ;;
  esac
}

slot_compose() {
  local slot="$1"
  local backend_image="${BACKEND_IMAGE:-ovoshi-help-rollout-placeholder:latest}"
  local frontend_image="${FRONTEND_IMAGE:-ovoshi-help-rollout-placeholder:latest}"
  shift

  slot_ports "$slot"
  BACKEND_IMAGE="$backend_image" \
  FRONTEND_IMAGE="$frontend_image" \
  BACKEND_PORT="$BACKEND_PORT" \
  FRONTEND_PORT="$FRONTEND_PORT" \
    docker compose -p "ovoshi-help-${slot}" --env-file .env.production -f "$ROLLOUT_COMPOSE_FILE" "$@"
}

slot_container() {
  local slot="$1"
  local service="$2"

  if [[ "$slot" == "legacy" ]]; then
    "${BASE_COMPOSE[@]}" ps -q "$service"
  else
    slot_compose "$slot" ps -q "$service"
  fi
}

slot_image() {
  local slot="$1"
  local service="$2"
  local container

  container="$(slot_container "$slot" "$service")"
  [[ -n "$container" ]] || {
    echo "No $service container found in $slot slot" >&2
    return 1
  }
  docker inspect --format '{{.Config.Image}}' "$container"
}

write_rollout_image_state() {
  local current_backend="$1"
  local current_frontend="$2"
  local previous_backend="$3"
  local previous_frontend="$4"

  install -d -m 0750 "$(dirname "$ROLLOUT_IMAGE_STATE_FILE")"
  {
    printf '# Preserved image pairs after the last successful rollout.\n'
    printf 'CURRENT_BACKEND_IMAGE=%s\n' "$current_backend"
    printf 'CURRENT_FRONTEND_IMAGE=%s\n' "$current_frontend"
    printf 'PREVIOUS_BACKEND_IMAGE=%s\n' "$previous_backend"
    printf 'PREVIOUS_FRONTEND_IMAGE=%s\n' "$previous_frontend"
  } | tee "${ROLLOUT_IMAGE_STATE_FILE}.tmp" >/dev/null
  chmod 0640 "${ROLLOUT_IMAGE_STATE_FILE}.tmp"
  mv "${ROLLOUT_IMAGE_STATE_FILE}.tmp" "$ROLLOUT_IMAGE_STATE_FILE"
}

prune_rollout_images() {
  local image repository
  declare -A retained_images=()

  for image in "$@"; do
    [[ -n "$image" ]] && retained_images["$image"]=1
  done

  # Never untag an image referenced by a running or stopped application container.
  while IFS= read -r image; do
    case "$image" in
      ovoshi-help-rollout-backend:*|ovoshi-help-rollout-frontend:*) retained_images["$image"]=1 ;;
    esac
  done < <(docker ps -a --format '{{.Image}}')

  for repository in ovoshi-help-rollout-backend ovoshi-help-rollout-frontend; do
    # Keep only the latest tagged release image for each application, in addition
    # to images referenced by a slot.
    while IFS= read -r image; do
      [[ -n "$image" ]] && retained_images["$image"]=1
    done < <(
      docker image ls "$repository" --format '{{.Repository}}:{{.Tag}}|{{.CreatedAt}}' \
        | sort -t '|' -k2,2r \
        | head -n "$ROLLOUT_IMAGE_RETENTION_COUNT" \
        | cut -d '|' -f1
    )

    while IFS= read -r image; do
      [[ -z "$image" || "$image" == "<none>:<none>" ]] && continue
      [[ -n "${retained_images[$image]+x}" ]] && continue

      echo "Removing obsolete rollout image tag: $image"
      docker image rm "$image" || echo "Could not remove $image; keeping it for now." >&2
    done < <(docker image ls "$repository" --format '{{.Repository}}:{{.Tag}}')
  done

  # BuildKit manages only its own persistent cache through buildkitd.toml GC.
  # Never prune the shared daemon's images or builder cache during a rollout.
}

build_application_image() {
  deploy/production/build-image.sh "$@"
}

wait_for_slot_health() {
  local slot="$1"
  local service="$2"
  local container status

  container="$(slot_compose "$slot" ps -q "$service")"
  [[ -n "$container" ]] || {
    echo "No candidate $service container created" >&2
    return 1
  }

  for ((attempt = 1; attempt <= HEALTH_WAIT_ATTEMPTS; attempt++)); do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container")"
    if [[ "$status" == "healthy" ]]; then
      return 0
    fi
    if [[ "$status" == "exited" || "$status" == "dead" ]]; then
      slot_compose "$slot" logs --tail 100 "$service" >&2
      return 1
    fi
    sleep "$HEALTH_WAIT_INTERVAL_SECONDS"
  done

  echo "Timed out waiting for candidate $service to become healthy after $((HEALTH_WAIT_ATTEMPTS * HEALTH_WAIT_INTERVAL_SECONDS)) seconds" >&2
  slot_compose "$slot" logs --tail 100 "$service" >&2
  return 1
}

remove_slot() {
  local slot="$1"

  if [[ "$slot" == "legacy" ]]; then
    "${BASE_COMPOSE[@]}" stop backend frontend
    "${BASE_COMPOSE[@]}" rm -f backend frontend
  else
    slot_compose "$slot" stop backend frontend
    slot_compose "$slot" rm -f backend frontend
  fi
}

cleanup_failed_candidate() {
  local exit_code="$1"
  if [[ "$exit_code" -ne 0 && "$CANDIDATE_STARTED" == true && "$SWITCHED" != true ]]; then
    slot_compose "$CANDIDATE_SLOT" rm -sf backend frontend || true
  fi
}

trap 'exit_code=$?; cleanup_failed_candidate "$exit_code"; exit "$exit_code"' EXIT

# The embedding worker is internal. Its update is completed before a new public
# application slot is started, so the active frontend/backend keep serving traffic.
if has_change '^embedding-service/'; then
  deployment_stage embedding
  "${BASE_COMPOSE[@]}" up -d --build --no-deps embedding-service
  wait_for_healthy embedding-service
fi

if has_change '^docker-compose\.prod\.yml$'; then
  wait_for_healthy minio
fi

# Build candidate images while the active slot keeps receiving requests.
# Build tooling changes alone do not change application inputs and must not
# restart production. FORCE_APPLICATION_REBUILD repairs an incomplete rollout.
if has_change '^backend/' || [[ "$REBUILD_APPLICATION" == true ]]; then
  deployment_stage backend_build
  BACKEND_IMAGE="ovoshi-help-rollout-backend:${TARGET_SHA:0:12}"
  build_application_image \
    "$BACKEND_IMAGE" \
    backend/Dockerfile.prod \
    backend
fi

if has_change '^frontend/' || [[ "$REBUILD_APPLICATION" == true ]]; then
  deployment_stage frontend_build
  FRONTEND_IMAGE="ovoshi-help-rollout-frontend:${TARGET_SHA:0:12}"
  build_application_image \
    "$FRONTEND_IMAGE" \
    frontend/Dockerfile.prod \
    frontend
fi

if has_change '^(backend/|frontend/|deploy/production/docker-compose\.app\.yml$|docker-compose\.prod\.yml$)' || [[ "$REBUILD_APPLICATION" == true ]]; then
  ACTIVE_SLOT="$(sudo "$NGINX_SWITCHER" status)"
  case "$ACTIVE_SLOT" in
    legacy|blue|green) ;;
    *)
      echo "Unknown active deployment slot: $ACTIVE_SLOT" >&2
      exit 1
      ;;
  esac

  if [[ "$ACTIVE_SLOT" == "blue" ]]; then
    CANDIDATE_SLOT=green
  else
    CANDIDATE_SLOT=blue
  fi

  PREVIOUS_BACKEND_IMAGE="$(slot_image "$ACTIVE_SLOT" backend)"
  PREVIOUS_FRONTEND_IMAGE="$(slot_image "$ACTIVE_SLOT" frontend)"

  # Source changes build a new image. Configuration-only changes reuse the
  # image running in the active slot and still get an atomic Nginx cutover.
  BACKEND_IMAGE="${BACKEND_IMAGE:-$(slot_image "$ACTIVE_SLOT" backend)}"
  FRONTEND_IMAGE="${FRONTEND_IMAGE:-$(slot_image "$ACTIVE_SLOT" frontend)}"

  deployment_stage candidate
  slot_compose "$CANDIDATE_SLOT" rm -sf backend frontend || true
  CANDIDATE_STARTED=true
  slot_compose "$CANDIDATE_SLOT" up -d --no-build --no-deps backend frontend
  deployment_stage health
  wait_for_slot_health "$CANDIDATE_SLOT" backend
  wait_for_slot_health "$CANDIDATE_SLOT" frontend

  # Once a switch is attempted, preserve both slots on errors or interruption:
  # Nginx may already have accepted traffic even if the helper did not return.
  install -d -m 0750 "$(dirname "$CUTOVER_GUARD_FILE")"
  printf 'previous=%s candidate=%s revision=%s\n' "$ACTIVE_SLOT" "$CANDIDATE_SLOT" "$TARGET_SHA" >"$CUTOVER_GUARD_FILE"
  SWITCHED=true
  deployment_stage switch
  if sudo "$NGINX_SWITCHER" "$CANDIDATE_SLOT"; then
    :
  else
    switch_status=$?
    echo "Nginx cutover failed: both application slots have been preserved." >&2
    exit "$switch_status"
  fi

# Nginx reloads gracefully: existing requests stay on the old worker while
# new requests are sent to the healthy candidate slot. Changes to this script
# also use the same no-build rollout path, which keeps deployment mechanics tested.
  deployment_stage drain
  sleep "$DRAIN_SECONDS"
  deployment_stage cleanup
  remove_slot "$ACTIVE_SLOT"
  rm -f "$CUTOVER_GUARD_FILE"

  if ! write_rollout_image_state \
    "$BACKEND_IMAGE" \
    "$FRONTEND_IMAGE" \
    "$PREVIOUS_BACKEND_IMAGE" \
    "$PREVIOUS_FRONTEND_IMAGE"; then
    echo "Could not record rollout image history." >&2
  fi
  prune_rollout_images \
    "$BACKEND_IMAGE" \
    "$FRONTEND_IMAGE" \
    "$PREVIOUS_BACKEND_IMAGE" \
    "$PREVIOUS_FRONTEND_IMAGE"
fi

# Apply new routes only after the new backend is serving them.
if has_change '^deploy/nginx/ovoshi-help\.conf\.template$'; then
  deployment_stage nginx
  sudo "$NGINX_CONFIG_APPLIER"
fi

trap - EXIT
deployment_stage completed
echo "Deployed $TARGET_SHA"
