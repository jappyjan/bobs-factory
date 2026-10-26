# Standalone nodes-v1 review loop

**Date:** 2026-10-26
**Tested base:** `7ca69084` plus the C2 working tree in this PR.
**Mode:** scripted specialist/fixer hooks, real isolated Git worktrees and local
bare remotes, mocked PR provider, production Factory runtime and authenticated
Factory API. No model inference, live providers or production repositories.

The maintained drive is `packages/edge-worker/test/V2ReviewRecipe.test.ts`:

```sh
pnpm --filter ./packages/edge-worker exec vitest run test/V2ReviewRecipe.test.ts
```

The correction scenario executes the actual generic Git commit/push and PR ensure
nodes. One affected specialist reruns after the resulting commit; the other five
retain their scoped findings, with exactly five engine reuse events. The remote
branch equals the corrected HEAD, and independent review approves the correction.

The human-assistance scenario launches through authenticated `POST /api/runs`
(202), deliberately leaves a finding unresolved after an unchanged correction,
and reaches the authored Display after two unchanged observations. It shuts down
and reloads the runtime while waiting. `POST /api/runs/:id/view-answer` (200)
submits Continue and corrective direction to the retained decision. The fixer
receives that exact direction, changes the worktree, publishes and obtains fresh
independent approval. The retained history contains one assistance response;
`GET /api/runs/:id` (200) exposes the approved review output.

Additional assertions cover clean approval, nonblocking nitpicks, architecture
and CI handoffs, restart during parallel work without duplicate completed or
not-yet-admitted provider calls, omitted complaints, settled finding reopening,
disagreements, proven versus unproven aliases, missing coverage, explicit scoped
waivers and requiring all six reviewers to complete. Tests close owned servers
and runtimes and remove their temporary repositories.

This proves standalone recipe orchestration, local revision reuse, durable
human waits and API visibility with scripted agents. It does not claim native
model judgment or a live forge/tracker integration drive. Full Factory/Takeover
composition and consolidated epic validation remain D1/D2 work.
