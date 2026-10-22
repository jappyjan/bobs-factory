# Generic For each review fixes — fresh mocked EdgeWorker/CLI drive

Taskbot #138 / epic #135 / PR175. Result **PASS**, both commands exit0 on clean
source `19258b1427711693a25dda416a9ac6f231f2f8cc`, tree `f70cd8035f212f90429507fe8006e63d74ac6fb4`.
This fresh report supersedes the earlier source-specific F1 run for current claims;
the earlier report remains preserved as historical evidence.

```sh
F1_AGENT_MODE=mock node apps/f1/test-drives/assets/taskbot138-foreach.mjs
F1_AGENT_MODE=mock node apps/f1/test-drives/assets/taskbot138-foreach-ownership.mjs
```

Actual EdgeWorker + production WorkflowRuntime/MachineCapacity/output validation,
CLI issue tracker/RPC, disposable Git worktrees/local bare remotes; controlled
`f1AgentHandlers("mock", reply)` only. No paid/native provider calls. Node24.21.0.

| Drive | UTC scenario interval | Scenarios | Controlled starts / successful mock sessions |
| --- | --- | --- | --- |
| Original generic source/inline/nested/policies/path cases | 2026-10-22T00:51:44.171Z – 2026-10-22T00:52:07.793Z | 6 |18 /16 |
| Ownership inline/mapped/called-nested collisions | 2026-10-22T00:52:09.222Z – 2026-10-22T00:52:17.678Z | 3 |8 /8 |

All original six assertions remain unchanged: source agent→For each→Check; inline
items; mapped Call + nested lexical item/index and named inputs; both failure
policies; missing pointer before item dispatch. Maximum active real capacity2.
Four original downstream Checks and truthful explicit failures/limitations retained.

The new three cases deliberately create outer `skipped` approval and route each
child to end before its same-named `skipped` agent. Inline two-item, direct mapped
Call and mapped Call→nested two-item forms preserve declared inherited READs and
mapped @callInputs, retain each legitimate route output, and publish no unexecuted
child approval. Every downstream approval Check returns
`{passed:false,childApproved:false}` and reaches the actual denial route. No approval
agent starts. Native mock IDs, exact calls/history, qualified keys and complete
keyed output equality are checked. Both workers shut down/flush their state.

Both before/after source deltas are empty SHA
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
Original driver SHA `345d449b373692f8ba2e1cff666be71e2756858843d572c61fa40bc2635f4ccd`;
ownership driver SHA `19922214e2ceffc9577568e222f4249df95b0f033015627579576a724001d8f3`.
Both executed built-JS digests (every .js under core/mcp-tools/edge-worker plus F1
MockAgentRunner), checked unchanged afterward:
`820d241291b15a7cbffedf2db109ac961f3dc7981d4fade341823b9c86c46667`.

[Full original result index](../../../docs/factory/evidence/taskbot138/review-r1-fixes/f1-original-results-index.json),
[ownership index](../../../docs/factory/evidence/taskbot138/review-r1-fixes/f1-ownership-results-index.json),
[exact commands/logs/UTC completion including shutdown](../../../docs/factory/evidence/taskbot138/review-r1-fixes/extra-validation.json),
[complete source/evidence packet](../../../docs/factory/evidence/taskbot138/review-r1-fixes/README.md).
Original raw JSON/scenarios and full compressed logs are byte-preserved in the
validation index. Pilot source-moving3/3 remains separately labeled preliminary.

Limits: controlled model output, no paid quality/provider validation or remote forge.
Neither F1 driver restarts EdgeWorker. Production runtime tests establish mid-item
normal disk reload, retained native continuation, completed skip and save barriers;
compiled product smoke covers settled restart. No arbitrary exactly-once external
effect or abrupt-kill-at-every-instruction guarantee. No active production runs,
credential stores, deployment, release publication or later-ticket changes.
