# Bundled workflow update preservation

Date: 2026-10-16. Tested implementation commit `194171bf`.

## Reproduction and scope

The manual run “Hide model selection for non-simple workflows” still failed at
`pipeline/capture`. Its saved probe produces the declared SHA-256
`25a2fa1c0b1fdc342be7fdd503442fe65d22c716596de8a172e1f0ada80e1bb5`.
The current verifier accepts it without modifying the run.

The running instance is still on commit `44832ee7`. Its update to the QA fix
`44a927fc` rolled back with `liveOwner=true; preservedState=false`. The old
preservation digest includes resolved bundled workflow code, so the fix's bundled
prompt change is mistaken for state loss. A focused reload regression reproduces
that mismatch. Saved Simple preferences and availability also changed without
changing the old receipt; the saved catalog hash now protects both.

F1 applies to update draining, replacement, retained workflow execution and health.
The lifecycle fixture now changes bundled behavior during controlled activation
and uses the current API-key session fixture for its protected HTTP requests.

## Drive and assertions

```sh
F1_AGENT_MODE=mock F1_TESTED_COMMIT=194171bf \
  F1_EVIDENCE_DIR=/tmp/bobs-preservation-f1 \
  node apps/f1/test-drives/assets/update-lifecycle.mjs
```

[Receipt](assets/2026-10-16-workflow-update-preservation/update-lifecycle.json):
all 11 scenarios passed, with at most one controlled worker. The candidate's
changed bundled catalog is visible after reload and passes preservation health.
Frozen definitions, native checkpoint IDs, the answer batch and review gate stay
unchanged. Active work drains naturally; parked work resumes once after release.
A deliberately failed trial restores the previous bundled behavior and run state.
Protected update routes still reject unauthenticated requests.

## Other validation and limits

- Edge-worker UpdateMaintenance, WorkflowCatalog, Impact and UpdateManager suites:
  **111 tests passed**.
- CLI OwnedUpdateLifecycle, InstallationOwnership and UpdateStateSnapshot suites:
  **13 tests passed**. Controlled executable preflight accepts matching contracts
  and rejects legacy/future mismatches before any executable switch.
- Repository build/typecheck hooks, targeted Biome and whitespace checks passed.

The drive uses real WorkflowRuntime, MachineCapacity, FactoryServer handlers and
durable update state with controlled in-process replacement and simulated agents.
Runtimes, capacity services, server and controlled descendants stopped cleanly.
It does not establish native service activation, publication, deployment or live
run recovery. No production state, installed runtime or update policy was changed.
The first legacy-to-v2 receipt boundary requires an owner-managed stopped-worker
upgrade as documented in `docs/distribution/UPDATES.md`; it is not silently
treated as a compatible automatic update. After installation, retry the failed
run through its retained checkpoint.
