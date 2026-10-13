---
name: bobs-factory-setup-launch
description: Start a prepared Bob’s Factory installation in the foreground or configure a user-owned service.
---

# Launch

Run `bobs-factory` for guided local startup; it opens the browser directly to
choose a project and available agent without key setup or login. Use `--no-open`
for headless operation. An explicit launch uses `--repo REPOSITORY --agent AGENT`;
configured integrations use `bobs-factory --home STATE_HOME start`. Confirm
the selected executable, service account, home and env-file before starting.
Verify a single worker/coordinator, dashboard health and the intended repository.

Use the systemd or launchd examples in `SELF_HOSTING.md` for background startup.
Fresh users do not need npm or pm2. Existing pm2 services should be migrated
using `bobs-factory-migrate`, preserving service definitions and disabling old
consumers before cutover. Dashboard ingress remains separate from webhook ingress.

Remote dashboard connections require the exact configured HTTPS origin and its
browser session established with an API key. Proxies preserve public Host/Origin; use the local access boundary
and proxy guidance in `docs/FACTORY.md#protected-remote-access-design`.
