# Production builds

Production uses Buildx with a dedicated `docker-container` builder named
`ovoshi-help-prod`, owned by the `deploy` user's Docker CLI configuration.
`build-image.sh` builds each application once and loads its runtime image into
Docker. The existing multistage Dockerfiles cache Maven/npm dependencies until
`pom.xml` or `package-lock.json` changes. Build errors abort before candidate
startup; no automatic cache deletion or `--no-cache` retry is performed.

## Provisioning an existing host

1. Wait for the current `ovoshi-help-auto-deploy.service` deployment to finish
   successfully. Verify the deployed revision, active slot and HTTP health.
2. Stop only `ovoshi-help-auto-deploy.timer`, then acquire
   `/run/ovoshi-help-auto-deploy.lock` with `flock`. Never stop Docker or the
   active app slot. Restore the timer when maintenance is complete or abandoned.
3. On Ubuntu 24.04 using `docker.io`, simulate installation first:
   `apt-get -s install --no-install-recommends docker-buildx`.
   Install **only** the CLI plugin, with no Engine upgrade and service restarts
   disabled: `DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l apt-get install
   -y --no-install-recommends --no-upgrade docker-buildx=0.30.1-0ubuntu1~24.04.1`.
   Recheck the available package version and transaction on another host.
4. Run `deploy/production/provision-buildx.sh` as `deploy`. It does not replace
   an existing builder or erase its cache. BuildKit is pinned to `v0.33.0`.
5. Verify builder status and container limits: 2 CPUs, 3 GiB RAM, no extra swap.
   `buildkitd.toml` allows one build step at a time and configures cache GC with
   2 GB reserved, 8 GB target maximum and 15 GB desired free disk space. These GC
   settings are reclamation targets, not filesystem quotas.
6. Build both applications with `build-image.sh`, using temporary verification
   image tags. Repeat identical builds to check `CACHED` steps. During builds,
   monitor public HTTP health, resource use, active container IDs/restart counts
   and Docker's PID/start time. The first BuildKit build is intentionally cold.
7. Install the reviewed `ovoshi-help-auto-deploy` and
   `ovoshi-help-switch-upstream` helpers in `/usr/local/sbin/` as root (0755)
   while holding the same lock. **Do not rerun `provision-blue-green.sh`** on an
   existing blue/green installation: it initializes the legacy upstream.
8. Publish the reviewed revision and resume the timer. The runner executes a
   temporary snapshot of the target revision's deploy script, avoiding the old
   build mechanism on the first deployment and checkout changes while Bash reads
   that script. Verify the deployed revision and healthy active slot. Build tooling changes
   alone intentionally leave application containers untouched; application source
   or runtime Compose changes use the usual blue/green rollout.

Example build from `/opt/ovoshi-help-repo` as `deploy`:

```sh
deploy/production/build-image.sh ovoshi-help-build-check-backend:verify backend/Dockerfile.prod backend
deploy/production/build-image.sh ovoshi-help-build-check-frontend:verify frontend/Dockerfile.prod frontend
docker buildx du --builder ovoshi-help-prod
```

BuildKit stores intermediate layers in its dedicated Docker volume. Leave that
volume intact; do not use `docker volume prune`, `docker builder prune -af`, or
remove the builder as routine maintenance. Old legacy cache tags are no longer
read. They can be reviewed separately for cleanup after migration.

## Failure handling and rollback

A build or candidate health failure leaves the active slot serving traffic.
Nginx cutover happens only after both candidate containers are healthy. Existing
connections drain for 45 seconds before the prior slot is removed. The previous
backend/frontend image pair is retained alongside the current pair; the deploy
user records these tags in
`~/.local/state/ovoshi-help/rollout-image-history.env` (or `$XDG_STATE_HOME`).

A switch failure preserves both slots. Exit 75 from the switch helper means the
reload outcome or recorded state is uncertain. Reconcile actual Nginx upstreams
and `active-slot` **before retrying another rollout**. The persistent
`~/.local/state/ovoshi-help/cutover-needs-reconciliation` guard blocks later
automatic rollouts; remove it only after resolving the upstream/slot state. Nginx reload rollback can
leave old workers draining requests against either slot.

If provisioning or build verification fails before cutover, keep serving the
current slot and restore the timer once the installed runner/build mechanism is
known to be usable. Do not remove active containers or clear caches as recovery.
Restore backed-up helper files if a migration must be abandoned before publication.

## Regression checks

```sh
python3 -m unittest discover -s deploy/production/tests -v
```

The deploy integration tests require Bash 4+ (production uses Bash 5), and use
mock commands and temporary paths. They must not access production or a Docker
socket.
