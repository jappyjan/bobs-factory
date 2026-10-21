# Configurable agent step: round2 Factory verification

Date: 2026-10-21. Exact source: `7106f734ca6fc4066448e2766495f5bacb4fa0d9`. Node24.21.0; Bun1.4.2. Applicable runtime changes are exercised through actual EdgeWorker execution, CLI issue tracking, isolated local Git worktrees, native MockAgentRunner events, configured output/evidence validation, FactoryTools, human approval and merge-receipt handling.

Command, unchanged maintained driver:

```sh
F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/configurable-agent-step-r1.ts
```

PASS, exit0, from `2026-10-21T19:30:14.099Z` through `2026-10-21T19:33:40.763Z`. Paid calls:0. Agent decisions and forge responses are scripted; this does not claim live model quality, credentials, remote publication or a real provider merge.

| Recipe | Outcome | Native format calls | Activities | Durable comments | Human decision |
| --- | --- | --- | --- | --- | --- |
| factory | completed |21 |23 |24 |approve |
| renamed-factory | completed |21 |23 |24 |approve |

Both runs preserve the same21-format sequence, including stale-producer renewals, QA capture/review and review-brief-v3. All serial turn boundaries match exactly. The driver permits reordering only within the six declared contiguous independent specialist groups, and each specialist must execute exactly once. Its existing local publication, scripted forge publication/merge, review, issue/session, activity-content/timestamp, pagination and durable comment assertions all passed. Raw turn order is retained in `results.json.txt`.

Before and after the drive, source was clean and every supplied manifest production input and artifact hash matched. The driver's empty working-tree delta digest is `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`. Manifest input digest: `f92022cd6f7880be4eb531d027bb3df7ca947ac8ac237a6165f3ab9ea882adfb`; complete artifact digest: `f19164f64fa9050e49b04f4a5bb56b9cceea8c40a8115e57c5a584f110796ad1`. The exact executed core/mcp-tools/edge-worker JavaScript digest is `c1e05ac9bebdf8cef645a3cdf14fe8af820867aa403b2c3d74834da7e9c4f4cd`, independently recomputed after the drive and matched.

Evidence in this directory: complete `factory-f1.log`, `summary.json.txt`, `results.json.txt`, both activity/comment records, supplied `build-manifest.json.txt`, `before-identity.json.txt`, and `after-identity.json.txt`. The temporary fixture repository/home remain at the directory recorded in the raw summary. The worker/server stopped normally.

## Rule-budget smoke on the same source

The accepted-config parser fixture was bundled for Node24 and compiled to a Bun executable from this source, with all outputs outside the checkout:

```sh
bun build packages/edge-worker/test/fixtures/rule-budget-smoke.ts --target=node --external @cursor/sdk --outfile /tmp/ticket136-r2-f1-7106f734/rule-smoke-node.mjs
bun build --compile packages/edge-worker/test/fixtures/rule-budget-smoke.ts --external @cursor/sdk --outfile /tmp/ticket136-r2-f1-7106f734/rule-smoke-bun
```

Each executable ran under an external8-second child-process deadline, exit0. Both5k/20k accepted each+lookup configurations stopped specifically at the total-work limit, heartbeat timers ran, cancellation propagated, and the useful small lookup passed. The independent100k condition-visit limit remains; total work is1m units with2048-unit async checkpoints, collection limit20k and data depth48.

| Runtime |5k elapsed |20k elapsed |Maximum heartbeat gap |Cancellation |
| --- | --- | --- | --- | --- |
| Node24.21.0 |897ms |830ms |42ms |21ms |
| Compiled Bun1.4.2 fixture |421ms |400ms |91ms |73ms |

Timings reflect concurrent full-gate load. The raw precision/counts, complete runtime logs, build logs and executable SHA256 hashes are in `rule-results.json.txt`, `node24.log`, `compiled-bun.log`, `rule-node-build.log`, and `rule-bun-build.log`. This compiled fixture is the accepted workflow/parser execution pipeline; it is distinct from the whole product CLI binary, which the coordinator validates separately. No source, dependency, distribution or fixture assertions were changed during this verification.

The earlier96b drive was deliberately interrupted after stock completed for a subsequent view-only source correction. It remains separately labeled preliminary at `/tmp/ticket136-r2-final-f1/PRELIMINARY-96b7cb03.md`; it is not used as the final passing comparison.
