# Necessary file discoveries during implementation

Date: 2026-10-17. Base: `a37442b5a5802d9480edcc830ed9c6bd9f780538` plus this change.

F1 applies because the changed stock prompts govern planning, architecture review
and implementation blockers. All provider execution was scripted with
`MockAgentRunner`; no model CLI or inference API was invoked. Homes, Git
repositories, worktrees, tracker data and ports were isolated from the live run.

## Reproduction and change

Run `5038de80-80ce-4532-adb3-307aa674f25e` stopped six times for permission to edit
necessary additional callers, imports and fixtures. Its generated plan required
candidate revision for every omitted file. The architecture authoring prompt
required a revised proposal for undeclared conditional edits, and its reviewer
reinforced an exhaustive file surface. This turned implementation discoveries
within the accepted design into repeated human gates.

Stock plan authors, reviewers and implementers now share a policy that records
necessary discovered paths and their purpose without requesting per-file approval.
Explicit restrictions, non-goals, material requirement/architecture changes and
additional delivery targets retain their authorization boundaries. Saved plans and
definitions are preserved; an older wait needs normal operator direction.

## Executed assertions

- A synthetic F1 issue routes through the real EdgeWorker, isolated Git worktree,
  production runner configuration and scoped context MCP. All five affected stock
  role prompts reach the scripted runner intact.
- A scripted omitted-file wait survives worker restart and catalog changes. Its
  accepted workflow definitions stay identical. An answer authorizing necessary
  dependency edits resumes the same native conversation without rerunning planning.
- A fresh run waits at its configured architecture gate. Implementation has not
  executed before exact proposal/version/digest acceptance.
- After acceptance, scripted implementation updates a necessary caller fixture
  absent from the declared footprint and records its purpose in checks. It
  completes with no second question or gate. The accepted proposal digest stays
  unchanged. The runtime imposes no file allowlist.
- The final drive completes both runs and shuts down both servers cleanly.

The fixture adapts `assets/frozen-workflow-approval-context.mjs` to use current stock
role prompts, an omitted-file blocker, a concrete caller fixture and one injected
in-memory tracker across restart. The first drive passed its assertions but logged
a handled missing-session notification after recreating the tracker. The final
drive retains the tracker and completes without that error. Both logs are retained.

## Commands and results

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm --filter bobs-factory-edge-worker test:run \
  test/Architecture.test.ts test/WorkflowCatalog.test.ts \
  test/WorkflowRuntime.test.ts test/WorkflowExecution.test.ts --maxWorkers=1
pnpm typecheck
pnpm lint
F1_AGENT_MODE=mock node /tmp/bobs-factory-5038de80-f1.mjs
git diff --check
```

158 tests passed. Build and type checks passed. Lint passed with 20 existing
warnings. The F1 process inherited no Factory settings or provider tokens; its
explicit tracker injection prevented external tracker/tunnel initialization.

Fixture, source fingerprints, runner instructions, results, timeline and logs:
`/Users/jappy/.bobs-factory/factory/evidence/fix-run-5038de80/`.

This proves prompt delivery, continuation and approval boundaries with scripted
responses. It does not prove live model compliance or recover the active production
run. Its frozen plan remains intact; deploying new stock prompts does not rewrite
an accepted run or authorize its material design changes.
