#!/usr/bin/env bash
set -Eeuo pipefail

# Run once as root on the production host after this repository revision has
# been checked out. It installs the narrowly-scoped Nginx switch helper and
# converts the existing site to named upstreams while keeping legacy ports live.

readonly REPOSITORY_DIR="${REPOSITORY_DIR:-/opt/ovoshi-help-repo}"
readonly PROD_HOST="${1:?Pass the production DNS name for this new project}"
readonly SWITCHER="/usr/local/sbin/ovoshi-help-switch-upstream"
readonly AUTO_DEPLOY_SCRIPT="/usr/local/sbin/ovoshi-help-auto-deploy"
readonly NGINX_CONFIG_APPLIER="/usr/local/sbin/ovoshi-help-apply-nginx-config"
readonly SITE_FILE="/etc/nginx/sites-available/ovoshi-help"
readonly SUDOERS_FILE="/etc/sudoers.d/ovoshi-help-deploy"

[[ "$PROD_HOST" =~ ^[A-Za-z0-9.-]+$ ]] || {
  echo "Invalid production host name" >&2
  exit 64
}

install -m 0755 "$REPOSITORY_DIR/deploy/production/ovoshi-help-switch-upstream" "$SWITCHER"
install -m 0755 "$REPOSITORY_DIR/deploy/production/ovoshi-help-auto-deploy" "$AUTO_DEPLOY_SCRIPT"
install -d -m 0755 /var/lib/ovoshi-help/deploy-status
install -m 0755 \
  "$REPOSITORY_DIR/deploy/production/ovoshi-help-apply-nginx-config" \
  "$NGINX_CONFIG_APPLIER"
install -m 0644 \
  "$REPOSITORY_DIR/deploy/production/systemd/ovoshi-help-auto-deploy.service" \
  /etc/systemd/system/ovoshi-help-auto-deploy.service
install -m 0644 \
  "$REPOSITORY_DIR/deploy/production/systemd/ovoshi-help-auto-deploy.timer" \
  /etc/systemd/system/ovoshi-help-auto-deploy.timer
systemctl daemon-reload
# Automatic polling is intentionally disabled until explicitly configured.
systemctl disable ovoshi-help-auto-deploy.timer || true

cat >"$SUDOERS_FILE" <<'EOF'
deploy ALL=(root) NOPASSWD: /usr/local/sbin/ovoshi-help-switch-upstream status
deploy ALL=(root) NOPASSWD: /usr/local/sbin/ovoshi-help-switch-upstream legacy
deploy ALL=(root) NOPASSWD: /usr/local/sbin/ovoshi-help-switch-upstream blue
deploy ALL=(root) NOPASSWD: /usr/local/sbin/ovoshi-help-switch-upstream green
deploy ALL=(root) NOPASSWD: /usr/local/sbin/ovoshi-help-apply-nginx-config
EOF
chmod 0440 "$SUDOERS_FILE"
visudo -cf "$SUDOERS_FILE"

# The legacy services already listen on 18090/18091. Create the initial
# upstream state first, then safely reload Nginx with the dynamic site config.
"$SWITCHER" legacy
sed "s/__PROD_HOST__/${PROD_HOST}/g" \
  "$REPOSITORY_DIR/deploy/nginx/ovoshi-help.conf.template" >"${SITE_FILE}.new"
install -m 0644 "${SITE_FILE}.new" "$SITE_FILE"
rm -f "${SITE_FILE}.new"
nginx -t
systemctl reload nginx
