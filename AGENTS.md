# fresh-supply

This is a separate copy of the shop business modules with Hackalem's visual design.
Keep all existing routes, permissions and business flows. See `docs/project-merge.md`
and `docs/design-system.md`. Source projects are references, not runtime dependencies.

## Git publication and PC update commands

- When the user asks to create or publish a desktop release, use
  [.agents/skills/fresh-supply-desktop-release/SKILL.md](.agents/skills/fresh-supply-desktop-release/SKILL.md).
  Keep release descriptions and publication replies short.
- When the user asks to push this project (including «пуш в гит» or «отправь в гит»),
  use [.agents/skills/fresh-supply-git-update/SKILL.md](.agents/skills/fresh-supply-git-update/SKILL.md).
- After a successful push, always include copyable commands to pull and apply the
  actual published changes on the user's Windows/WSL PC. Select the minimum
  container actions using the workflow below, and include a readiness check.
  A commit link alone is not a complete response to a push request.
- The post-push update instructions are text only: put them in a Markdown `bash`
  code block with a short explanation for the user to run manually. Do not execute
  that block or its Docker/log/health checks on the Mac, Windows/WSL PC, or any
  other host unless the user separately and explicitly asks you to apply the update.
  A push request authorizes the agreed Git work, not an application deployment.
  For documentation-only changes, say that no container action is needed.

# Container workflow

## Browser verification of admin pages

- Before testing an implemented `/admin/` page in a browser, authenticate through
  `/admin/login` or verify that the current browser session is already signed in.
  Confirm that the admin interface has loaded, then navigate to the page under test.
- A direct visit to an admin URL before authentication may show 404. Do not treat
  that response as evidence of a missing route or an untestable UI until the
  authenticated flow has been checked.
- Use isolated local Chromium for UI verification. New project admin login is
  `http://localhost:5175/admin/login`; API is `http://localhost:8084`.
- New database credentials are configured for this project; do not assume that
  the original shop's Keychain credentials apply to a fresh database.
- A preview explicitly pointed at the original API is for read-only inspection.
  In that mode authenticate through the original `http://localhost:5174/admin/login`
  before opening new preview admin routes. Keep credentials in memory and use the
  normal login form; never print them or persist them in files, logs, or memory.
- Do not copy source secrets, databases or uploads, or modify either source project.
  Such data migration requires a separate user request.

## Navigation and return paths

- Every in-app back button must use an explicit, safe return route rather than
  browser history. A direct link must therefore fall back to the canonical list
  or parent page for the current entity.
- When a user opens a nested page from a contextual source (a filtered table,
  analytics detail, reservation list, etc.), pass that source as `returnTo` in
  React Router location state. Validate it as an internal `/admin/` path before
  navigating to it.
- Preserve the resolved return route through follow-up actions that stay in the
  same entity flow, such as save, copy, delete, and edit. Never rely on
  `navigate(-1)` for application navigation.

Use the smallest container action that can make a change visible. The development
Compose setup bind-mounts `frontend/` and `backend/`, so rebuilding their images is
not the default response to source changes. Run all commands from the repository
root.

## General rules

- Do not routinely run `docker compose up --build`, `docker compose build`, or
  `docker compose down`.
- Never use `docker compose down -v` unless the user explicitly asks to delete
  persistent data and dependency caches.
- Before acting, check the relevant service with `docker compose ps`.
- If the stack is already running, update only the affected service.
- If the stack is stopped and its images already exist, start it with
  `docker compose up -d --no-build`.
- Rebuild only the service whose image inputs changed. Do not rebuild the entire
  stack.
- After an action, verify with `docker compose ps <service>` and, when useful,
  `docker compose logs --tail 100 <service>`.

## Changes and the fastest action

| Changed files | Action |
| --- | --- |
| `frontend/src/**`, frontend CSS, or public assets | No container action. Vite HMR should apply the change automatically. |
| `frontend/vite.config.*` or another frontend runtime config | First allow Vite to reload its config. If it does not, run `docker compose restart frontend`. |
| `frontend/package.json` or `frontend/package-lock.json` | Run `docker compose exec frontend npm install`; restart `frontend` only if Vite must reload the dependency graph. Do not rebuild the image. |
| `backend/src/main/java/**`, `backend/src/main/resources/**`, or a Flyway migration | Run `docker compose restart backend`. The bind mount exposes the files and Maven recompiles on startup. |
| `backend/pom.xml` | Run `docker compose restart backend`. Maven uses the persistent `company_shop_maven_cache` volume to resolve dependencies. Rebuild only if the change also requires a new OS-level package in the image. |
| `backend/price-importer/*.py` | The files are bind-mounted. Prefer no action for a newly spawned importer process; otherwise restart `backend`. |
| `backend/price-importer/requirements.txt` | Rebuild and recreate only backend: `docker compose up -d --build --no-deps backend`. |
| `embedding-service/app.py` or `embedding-service/requirements.txt` | This service has no bind mount. Rebuild and recreate only it: `docker compose up -d --build --no-deps embedding-service`. |
| `deploy/Caddyfile` | Run `docker compose restart gateway`. |
| Service environment, ports, volumes, healthchecks, or other `docker-compose.yml` runtime settings | Recreate only the affected service without building: `docker compose up -d --no-build --no-deps <service>`. A plain restart does not apply Compose configuration changes. |
| A service's `Dockerfile`, base image, copied files, or installed system packages | Rebuild and recreate only that service: `docker compose up -d --build --no-deps <service>`. |

## Escalation order

When a change is not visible, use this order and stop as soon as it works:

1. Confirm the expected HMR or bind-mount behavior.
2. Restart only the affected service:
   `docker compose restart <service>`.
3. Recreate only the affected service without building:
   `docker compose up -d --no-build --no-deps <service>`.
4. Rebuild only the affected service if an image input actually changed:
   `docker compose up -d --build --no-deps <service>`.

Do not compensate for application errors by rebuilding containers. Inspect the
service logs and fix the underlying compile, startup, migration, or runtime error.
