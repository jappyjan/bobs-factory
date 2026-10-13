# Frozen workflow approval context and recovery

Date: 2026-10-13. Tested base: `537e19d9` with the workflow execution-context fix.
Agent mode: deterministic F1 `MockAgentRunner`; no live providers or credits.

F1 applies because the change affects Factory role instructions and scoped input
on initial execution and recovery. The [fixture](assets/frozen-workflow-approval-context.mjs)
uses an isolated home/repository, actual EdgeWorker and WorkflowRuntime, stdio MCP
context tools, issue-tracker RPC, rendered activities and protected Factory APIs.
Its target branch is `fixture-target`; ports 3601 and 3604 belong to the fixture.

Run after building edge-worker dependencies, edge-worker and F1:

```sh
F1_AGENT_MODE=mock node apps/f1/test-drives/assets/frozen-workflow-approval-context.mjs
```

The passing drive reached `completed` for both runs and verified:

- A ticket starts the accepted nested legacy `plan -> plan-review -> implement`
  graph. Every adapter receives the new instruction guidance and can read the
  runtime-owned `/workflowExecution` through the actual MCP connection. Unrelated
  current stock architecture gates are absent from that context.
- Automated plan review returns `approved: true`. A scripted implementation
  blocker seeds the historical false-prerequisite state; it produces a readable
  Factory clarification activity without an invented architecture proposal.
- Restart after current recipes gain an architecture gate preserves the original
  run's definitions. A guarded answer resumes only implementation in its original
  mocked native conversation. Planning and plan review execute once each;
  implementation executes twice. No architecture acceptance is manufactured.
- A fresh run using the updated recipe reaches its real architecture gate and
  does not execute implementation before exact proposal acceptance. The configured
  `always` policy still requires human acceptance for a routine proposal. The
  protected architecture-decision API accepts the exact identity/digest, and the
  implementer receives both the recorded decision and the accepted plan.

The drive wrote `results.json` and `timeline.txt` to the isolated home reported on
stdout. The worker stops in `finally`. Mocked recovery cannot establish live model
reasoning or durable external tracker recovery. The F1 in-memory tracker resets
on worker reconstruction, producing handled missing-session activity errors on
the restored run; rendered activities are checked before restart. Persisted
workflow/native recovery and fresh manual execution pass independently of that
fixture limitation.

Related checks: 182 tests passed across WorkflowExecution, EdgeWorker capture and
role recovery, Architecture and WorkflowRuntime. Removing runtime context
injection makes the restricted-input regression fail; restoring it makes the
regression pass. Edge-worker build/typecheck, Biome, fixture syntax and diff checks
passed. Unit coverage also retains renamed gate policies and decision records,
follows fanout calls, bounds graph cycles, reports missing definitions as unknown,
and rejects model-supplied context as a substitute for runtime-owned policy.
