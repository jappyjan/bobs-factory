# D1b: generic delivery after legacy-engine removal

Date: 2026-10-27 (Europe/Berlin)

Tested code: `2d5ac8b9c13f29a402727d8a5687b39f12cae027`.

The changed workflow removes legacy tools, checks, human-step types and specialized
screens. These drives verify that the registered-node delivery recipes still
retain human consent, provider waits, correction state and original effects.

## Execution

From `packages/edge-worker`:

```sh
npx vitest run --maxWorkers=4
```

The full-suite invocation includes `FactoryDeliveryRecipes.test.ts`: **36 passed**.
Its two scripted F1 scenarios passed on the tested commit:

- `scripted F1 merge exposes required review and retains approval across capacity-free wait and restart`
- `scripted F1 external delivery drives correction, cold restart and explicit completion through the authenticated API`

Each fixture creates its own temporary Git repository and Factory home. Servers,
runtimes, capacity owners and fixture directories are cleaned up by the tests.

## Assertions and results

The merge drive reads the actual run through the Factory API and verifies that
missing provider review remains visible. An exact Display submission continues
polling without dispatching merge or holding execution capacity. After a cold
restart and provider approval, merge dispatches once; the original human approval
remains a single history receipt.

The external drive launches through the protected Factory API, submits requested
changes against the displayed batch/content digests, and checks independent
reverification and a new acceptance digest. After a cold restart, explicit human
acceptance completes the ticket. The API activity page includes the acceptance;
two original Display records remain and the apply effect executes once.

## Limits

Agents, ticket services and Git providers are controlled fixtures. Runtime,
registered-node execution, authenticated HTTP routes, real local Git, filesystem
persistence and restart paths are exercised. No provider credits, production
records or real merge/ticket effects are used. This is scripted orchestration and
API evidence; it does not establish native model behavior or browser appearance.
Historical test-drive reports and frozen run fixtures remain retained.

## Complete validation

The completed edge-worker suite on the tested code passed **217 files, 2,600 tests**,
with **one existing live-probe test skipped** and zero failures. This includes the
21 Factory/Takeover composition cases, old-run/fork gating, graphless Simple
recovery, outputs-first context/restart drives and the authenticated progress-budget
drive. Workspace build/typechecks and Biome pass. Operator MCP integration passes
11 tests, terminal UI passes 15, and all 18 node-catalog examples pass StepSchema.
