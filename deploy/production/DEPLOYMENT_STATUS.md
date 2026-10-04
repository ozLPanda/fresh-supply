# Production deployment status

The admin dashboard reads deployment state from `/var/lib/ovoshi-help/deploy-status` through authenticated backend endpoints. Only users with `deployments.read` can access it. The directory is mounted read-only in the production backend container. `status.json` contains the current stage and attempt ID; `history.jsonl` links completed attempts to their logs. Each attempt's combined deployment output is available while it runs at `logs/<attemptId>.log`. Deployment commands must never print credentials or secret values: output is retained and shown to authorized admins.

The host's installed `/usr/local/sbin/ovoshi-help-auto-deploy` is a copy of the repository script. After the revision containing this feature is deployed, install the updated copy on the production host as root:

```bash
install -d -m 0755 /var/lib/ovoshi-help/deploy-status
install -m 0755 /opt/ovoshi-help-repo/deploy/production/ovoshi-help-auto-deploy /usr/local/sbin/ovoshi-help-auto-deploy
systemctl start ovoshi-help-auto-deploy.service
```

The next timer run creates `status.json` and `history.jsonl`. The dashboard reports `unavailable` until those files are present. History starts when the updated host script is installed; prior deployments are not backfilled. It retains the latest 100 completed attempts and up to 100 logs on disk. Each log is capped at 8 MiB by retaining recent output. On the production host, the log directory is restricted to root and group 10001 (the backend container's group), and log files are mode 0640.

`running` means a revision is being built or rolled out. `succeeded` and `failed` are the outcomes of the latest attempt. `idle` means the most recently checked `main` revision is already deployed. A failed revision is not retried automatically until a newer revision appears or the existing retry override is used. If the Git fetch fails, the current state becomes `unavailable`.

Stages are emitted by the target revision's `deploy.sh`. Older revisions without stage markers still produce a live console log and show the generic preparation stage until completion. Status `checkedAt` also refreshes during output from long-running commands.
