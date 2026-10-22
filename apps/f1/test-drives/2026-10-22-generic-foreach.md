# Generic For each — mocked EdgeWorker test drive

Taskbot `bobs-factory` #138, epic #135. Run date: 2026-10-22 Europe/Athens.
UTC interval: `2026-10-21T23:28:39.068Z`–`2026-10-21T23:28:57.780Z`;
owned worker shutdown completed at `2026-10-21T23:28:58.029Z`.
Result: **PASS**, exit 0.

Tested runtime, driver and clean source:
`9b79a19f7b672a8a759400cc9f715aec3f140635`.
The [driver](assets/taskbot138-foreach.mjs) constructs the actual EdgeWorker with
its production WorkflowRuntime, MachineCapacity, output validation, CLI issue
tracker/RPC, disposable Git worktrees and local bare remote. All role/title
runners use `f1AgentHandlers("mock", reply)`; no native provider CLI or inference
API is invoked. Paid calls: **0**. Two deliberate failed starts throw at the
controlled provider boundary and have no invented native session IDs.

```sh
F1_AGENT_MODE=mock node apps/f1/test-drives/assets/taskbot138-foreach.mjs
```

Node: `v24.21.0`. Working-tree delta before and after:
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
Driver SHA-256:
`345d449b373692f8ba2e1cff666be71e2756858843d572c61fa40bc2635f4ccd`.
Executed JavaScript SHA-256, checked unchanged after execution:
`a478c07dca61146cf7eb263071a7a56a4bd1cceae21628edd11ea5a6d62721be`.
This digest covers every built `.js` under core, mcp-tools and edge-worker plus
the built F1 MockAgentRunner. The Node development runtime truthfully reports an
unpackaged runtime identity; the checkout/driver/digest bridge identifies the
actual tested inputs. Later evidence-only commits do not relabel those inputs.

Fresh fixture home:
`/private/var/folders/5m/3pxzz_nd1v7f34rd9vnm01380000gn/T/f1-taskbot138-foreach-1jaJsh`.
Complete log: `/tmp/taskbot138-f1-final.log`. The retained
`results-index.json` in that fixture contains exact source/build/driver identities,
timestamps, every full keyed output, summary, progress record, role key/native
identity, history entry, activity/comment count and scenario result. Per-scenario
JSON files remain beside it. The complete [index](../../../docs/factory/evidence/taskbot138/f1-results.json)
and compressed raw log are retained in the repository evidence packet.

| Scenario | Expected runtime outcome | Provider starts / successful mock native sessions | Activities / comments |
| --- | --- | --- | --- |
| Earlier source agent → For each → Check | completed | 4 / 4 | 6 / 5 |
| Inline item list → For each → Check | completed | 3 / 3 | 5 / 4 |
| Call recipe mapping + nested For each → Check | completed | 5 / 5 | 7 / 6 |
| `all-must-succeed` | failed as required | 2 / 1 | 3 / 2 |
| `keep-successful` → Check | completed with explicit failure | 3 / 2 | 4 / 3 |
| Missing source pointer | failed before item dispatch | 1 / 1 | 3 / 2 |

Totals: six scenarios, 18 controlled provider invocations, 16 successful mock
native sessions, four downstream Check executions, 28 activities and 22 durable
CLI comments. Maximum simultaneous provider starts: **2**, exactly the configured
real MachineCapacity limit. Every fresh leaf key is unique; successful SDK turns
record their actual mock session ID and no resume request.

Assertions cover the complete accepted item-keyed results and deterministic
summary, source-output selection, inline sources, correct `/item` and `/index`
lexical frames, named `@item`/`@index` reads, mapped `@callInputs`, outer call
inputs surviving an inner item-frame change, complete called/nested output
shapes, source-path failure before dispatch, and ordinary named-read Check
consumption. Call/nested progress completes under a two-slot pool, exercising
the parent orchestration boundary without retaining a blocking parent lease.

The all-must fixture completes `good`, fails `bad`, marks undispatched `later`
cancelled, and cannot reach the downstream Check. The keep-successful fixture
retains `good` and `later`, records exactly the explicit `bad` failure/limitation,
and reaches the Check with the truthful counts. These deterministic failure
fixtures use concurrency one; active-sibling abort and crash/restart boundaries
belong to the separate production-runtime suite. CLI activity shape, timestamps,
pagination and durable milestone/completion comments are verified. All owned
sessions stop and the shared server closes cleanly in `finally`.

Limits: mocked model/provider output; local Git; no live model quality, remote
forge, paid CLI, production run, credential migration, deployment or release.
This driver does **not** restart an EdgeWorker process. Normal serialized runtime
loading, mid-item restart, retained native continuation and completed-item skip
are established by the dedicated production-runtime tests, not claimed by this
drive. Retained logical continuation can require a new native turn. No arbitrary
exactly-once external side-effect guarantee is claimed. Builder/run screenshots,
full local gates and the compiled-product smoke are separate evidence in the
integration delivery packet.

Readable receipt JSON uses repository formatting; [original generated bytes](../../../docs/factory/evidence/taskbot138/raw-json.json) are retained in gzip form with exact hashes.
