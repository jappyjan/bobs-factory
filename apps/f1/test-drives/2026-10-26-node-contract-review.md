# Node contract review corrections

**Date:** 2026-10-26 (Europe/Vienna)
**Result:** PASS
**Mode:** mocked agents, embedded EdgeWorker, protected HTTP API and disposable Git/home.

Re-ran the [existing node registry fixture](assets/node-registry.ts) after the
A1 review corrections. The [receipt](assets/2026-10-26-node-contract-review.json)
records the base commit plus exact changed source hashes and every completed
output stamp. Historical drive evidence remains unchanged.

```sh
pnpm --filter bobs-factory-edge-worker build
pnpm --filter bobs-factory-edge-worker typecheck
F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/node-registry.ts
```

The drive passed registered metadata, snapshot, isolated foreach reads, Check,
Fanout, child workflow mapping, Show/Approve, cold approval recovery, empty
File issues/Launch runs and mocked final agent execution. Completed history keeps
all input digests and resumes without replaying completed nodes. The fixture
stopped both workers and removed its disposable repository/home.

Focused verification passed **552 tests across 33 files**: 30 existing compatibility
suites / 526 tests, the final NodeRegistry suite / 12 tests, and two Improve
suites / 14 tests. The first aggregate run caught a missing manual launch origin
in the new chat fixture; that fixture was corrected and the final registry suite
passed. Existing test files were unchanged.

Registry regressions cover transient send → proven absence → one resend under
the original key, cancellation after the sending checkpoint but before invocation,
failed read attempt bookkeeping, actual filtered agent-history stamps, graph chat
inheritance through Workflow/Fanout/Foreach, optional JSON field deletion, and
capacity-free CI/human phases including retained passive leaves after cold restart
and cleanup after errors. Changed-code Biome and edge-worker server/web typecheck
passed; the edge-worker build passed.

The drive validates runtime compatibility. Provider effect recovery and wait-phase
semantics are tested deterministically in the registry suite; no live inference,
nonempty external provider mutations or visual browser QA are claimed.
