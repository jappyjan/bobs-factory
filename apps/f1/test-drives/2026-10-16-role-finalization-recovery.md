# Recover runs blocked after agent completion

Date: 2026-10-16. Base: `4ab99d21`, with this change applied.

F1 applies to result finalization, saved workflow Retry and takeover repository
metadata. The driver is `assets/role-finalization-recovery.mjs`:

```sh
F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/role-finalization-recovery.mjs
```

The passing drive retained evidence at
`/private/var/folders/5m/3pxzz_nd1v7f34rd9vnm01380000gn/T/f1-role-publication-LyvT6T`.
It used a fresh repository, injected persistent in-memory issue tracker, actual
EdgeWorker/RPC/dashboard/runtime and deterministic mocked providers. No agent CLI
or inference API was invoked; model usage and cost were zero.

Verified behavior:

- An issue created and started through RPC completed its mocked agent role,
  decision-recording tool and following script while external publication remained
  unresolved. Role outcomes and decisions were persisted as pending receipts.
- The worker stopped without waiting for publication. A replacement recovered a
  saved finalizing role on its exact clean revision without another model turn.
  Native conversation identity and completed history survived; retained receipts
  subsequently delivered through the controlled tracker boundary.
- Dashboard Retry on a failed nested visual gate returned to its accepted impact
  assessor. A fresh mocked assessment requested assistance and stayed waiting;
  no old gate was approved and retained implementation data stayed intact.
- Production takeover inspection, with a fixture PR receipt matching the actual
  worktree branch, corrected a self-targeting retained base to `main`. The branch
  and existing PR identity remained unchanged.
- A 1,024-file proposal retained all 26 deliverables and all unique runtime
  footprint paths through drafting and independent review. It waited at the
  pending exact-version architecture gate without a fabricated acceptance.

Exploratory attempts found fixture setup mistakes (missing team/input), stale
local run-object reads and a delivery assertion that raced final lifecycle
publication. The final driver waits for executor completion and all retained
delivery receipts. The passing run shut down cleanly and released its ports.

Other validation:

- 294 targeted tests passed across the affected EdgeWorker and Linear transport
  suites, including flat/nested stale-impact recovery and exact not-found versus
  inconclusive Linear lookup responses.
- Architecture coverage retains the 64-deliverable and 40-files-per-deliverable
  bounds while accepting the complete 1,024-file reproduction.
- The original finalization regression failed for both native and Taskbot
  publication before the fix. Linear's actual HTTP-200 `INPUT_ERROR` not-found
  shape also failed to reconcile before the fix.
- Relevant type checks and the CLI dependency build passed. Biome and
  `git diff --check` passed.
- A locally built macOS ARM64 binary passed isolated startup, dashboard/assets,
  protected API, runtime identity, MCP, shutdown and restart smoke checks.

The controlled drive does not establish native model behavior, real Git-provider
publication, successful production QA or human approval. Production recovery uses
the retained runs and gates separately; native stores and historical evidence
are preserved.
