# Repository IO nodes: real Git and uncertain PR recovery

**Date:** 2026-10-26 (Europe/Vienna)
**Candidate:** `feat/156-b5-git-pr-ci`, based on `0acfa08d`, with the B5 working diff.
**Task:** [Taskbot #162](https://taskbot.apps.janjaap.de/p/bobs-factory/t/162), epic #156.

## Applicability and setup

New Factory IO nodes change publication, CI inspection and durable recovery, so
F1 is applicable. The maintained fixture starts a real embedded EdgeWorker and
Factory HTTP server, uses isolated Git source/worktree/home directories and a
local bare remote, and installs a temporary scripted `glab` executable. Agents
and GitLab API responses are mocked. No live inference, hosted Git writes,
merges or ticket mutations are performed.

The scenario reads the node catalog over HTTP, launches a recipe through
`POST /api/runs`, commits/pushes real changes, and deliberately loses the response
after its simulated GitLab provider has accepted MR creation. It shuts down and
restarts the worker, retries through the run HTTP endpoint, and asserts recovery
before continuing with PR read/comment/ready, CI status and Git diff.

```sh
pnpm --filter 'bobs-factory-edge-worker^...' build
pnpm --filter ./packages/edge-worker build
F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/repository-io-nodes.ts
```

## Results

- Passed registry metadata checks for all three nodes and their serializable
  operation-effect maps; no executor/schema leaked through the browser catalog.
- Passed real dedicated-worktree creation, configured identity commit and push
  to a local bare remote. The published branch matched the committed SHA.
- Passed uncertain creation persistence and cold worker restart. The provider's
  creation count remained **one**, and the existing MR marker confirmed the
  durable effect receipt on retry.
- Passed PR read, one comment, and ready state through the real GitLab adapter
  with simulated transport responses.
- Passed single-pass CI inspection at the committed head and original base,
  with a provider-required build check and zero failures.
- Passed structured diff file/stat output, visible run activities and resolved
  input stamps for all completed steps. Completed history was `seed`, `write`,
  `commit`, `push`, `pr`, `read`, `comment`, `ready`, `ci`, `diff`.
- Passed worker/server shutdown and temporary fixture cleanup.

Receipt from the final pre-commit drive:

```json
{
  "result": "PASS",
  "mode": "mock",
  "runId": "manual-e0a01b2f-47ce-4469-a4dd-9b5307ff3dd7",
  "head": "1a5d7002c43cb636c50ffdfa6aef718a3d55ef45",
  "base": "ce6d8d1f4bb7f15e53a716673424a6c6c74f4cb2"
}
```

Initial setup failed because this fresh checkout had no compiled web assets.
Building the worker supplied them; subsequent complete drives passed. Source-mode
startup warned that default bundled skills were unavailable; mocked agents did
not require deployed skills. Live hosted-provider behavior, physical SSH/signing
agents and browser interaction were not exercised. Focused tests separately
cover both provider transports, multi-repository scope, every operation and cold
restart outcomes (confirmed, independently absent and unknown).
