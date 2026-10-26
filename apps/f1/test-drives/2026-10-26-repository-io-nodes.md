# Repository IO nodes: real Git and uncertain PR recovery

**Date:** 2026-10-26 (Europe/Vienna)
**Candidate:** `a03590fe` on `feat/156-b5-git-pr-ci`, based on `0acfa08d`.
**PR:** [#201](https://github.com/jappyjan/bobs-factory/pull/201).
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

Receipt from the final drive of the committed implementation:

```json
{
  "result": "PASS",
  "mode": "mock",
  "runId": "manual-fb6344a7-9ce1-45f1-8d24-6510b9047e85",
  "head": "9c67ade8bf44fb46f92d64421e532ce41dcad4e6",
  "base": "5add7c93e74c91ffc67803edc3de9317d6b4493a"
}
```

Initial setup failed because this fresh checkout had no compiled web assets.
Building the worker supplied them; subsequent complete drives passed. Source-mode
startup warned that default bundled skills were unavailable; mocked agents did
not require deployed skills. Live hosted-provider behavior, physical SSH/signing
agents and browser interaction were not exercised. Focused tests separately
cover both provider transports, multi-repository scope, every operation and cold
restart outcomes (confirmed, independently absent and unknown).

Validation after fetching/rebasing `origin/main`: 107 focused tests passed across
five files. Worker typechecking and the unmodified pre-commit hook’s full build,
full typecheck and staged-file lint/format checks passed.


## Review follow-up validation

The follow-up fixture also installs a failing real pre-commit hook and commits
with `verify: false`, checks the real Git upstream after push, supplies a title
with a trailing newline and a provider-normalized body, and reports a stale PR
head on the first CI read followed by the current head on the next read. The HTTP
catalog now asserts `read-only` classification. PR read assertions include raw
merge status, conversation comments, factual blockers and queue state.

Command: `F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/repository-io-nodes.ts`.
Passed with run `manual-93b41867-96f2-43a2-89c9-d3300ecdb986`, committed fixture head
`fa3a4d0e0a85f12ec050f9191a64f30f25200bfd` and base
`1095bc543c572c898fde905d768e2ad90596d213`. The first CI result had
`headMatches: false` and `summary.complete: false`; the second had both `true`.
The existing cold-restart PR recovery, activity and revision assertions still
passed. Provider transport and agents remain scripted, with no hosted writes or
paid inference. Focused restart tests cover failed pushes to existing branches and
failed draft updates; provider tests cover skipped retries and cached GitLab logs.


## Main integration follow-up

Re-ran the same scripted fixture after rebasing onto `9a8bf551` (#200, #203 and
#205 merged) and fixing recipe-only CI cache ownership and the Git/agent `verify`
field interaction. The drive passed with run
`manual-e6d146a9-9aa4-46e9-b67c-ca036f8eab6f`, fixture head
`3fb18c46a25abac5ffe88492738027754c5fbd81` and base
`d8673231b38e91b6917d3380dc4b9eead41c533b`. The transport and agents remain
scripted. Separate engine regression tests exercise two consecutive CI status
nodes on fresh runs using each real provider adapter with mocked transport:
GitLab traces and GitHub check-run details are fetched once. Both tests fail
with two downloads when the run-level cache initialization is removed.

After #204 merged, rebased again onto `640c504d` and repeated the build, worker
typecheck and scripted drive. The drive passed on candidate `e1e32d2c` with run
`manual-63cb29ba-5b4b-4170-9e35-3b97eaaf4eab`, fixture head
`d65e77ffd35c639c04b154c0b383f9342299d4a0` and base
`c76eba59b3ef3709eb0efa93789b1955aa638be2`. Both sets of IO node registrations,
provider merge receipts, fast-forward merge coverage, docs and changelogs remain.

Final integration validation: **293 tests passed across 12 files**: the requested
RepositoryIONodes, GitProvider, GithubApi, CISupervision, MergeReadiness,
DiagnosticsReadiness, FactoryLogicFlow, NodeRegistry, AgentNode and DisplayNode,
plus StepConfig and #204's FactoryIONodes. The explicit edge-worker build and
typecheck passed. The enabled pre-commit hook passed staged-file Biome checks,
the full workspace build and full workspace typecheck.
