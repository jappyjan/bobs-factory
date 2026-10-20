# Workflow stall recovery and existing iteration budgets

**Date:** 2026-10-21 (Europe/Athens)
**Result:** PASS
**Mode:** mocked F1 agents/providers, plus isolated replay of production snapshots and recorded read-only provider responses.

The tested behavior changes runner/session recovery, provider readiness and saved
workflow limits, so relevant F1 validation is required. The exact candidate source
and compiled-module hashes are in the [sanitized evidence](assets/2026-10-21-workflow-stall-recovery.json).
The base commit was `121ebe302f869c1cfce36560904953d0c2233970`; this drive tested
the uncommitted candidate content identified by those hashes, before PR creation.

## Production reproduction

Copied eight production run manifests and their 21,666 referenced content chunks
into a private temporary directory. The copy includes 1,121,914,960 bytes of
referenced chunks. Factory configuration and credential stores were excluded.
Every copied chunk was verified against its content hash before loading it through
`JsonSnapshotStore`. A separate shallow Git clone retained the production head,
live target and historical base commits, with its own object store, no alternates
and no live remotes. Raw snapshots, provider comments and private repository data
remain outside the repository.

The original source reproduced the incomplete-round error before a correction role
could start. The original GitHub readiness implementation also returned the
historical PR base instead of the actual target branch. Replaying that value in
the independent Git store demonstrated the tracking-ref regression.

The candidate passed these assertions against the retained production data:

- An unfinished specialist round supplies all 14 unresolved consequential findings
  to correction, rejects missing dispositions, and records correction provenance.
- The same unfinished round still fails the strict approval lookup.
- A previously fatal unproven duplicate claim remains retained in raw evidence and
  its finding remains actionable; it cannot suppress a consequential finding.
- Three captured read-only provider responses, including the complete captured
  comment/review pages, produce the actual target SHA matching the saved review
  baseline. The actual `FactoryTools` CI implementation consumes that evidence
  without fetching or changing the target ref.
- Repeated target inspection stays stable. The copied Git store demonstrates that
  the previous historical value would disagree with the retained review baseline.
- Three existing production runs receive allowances for 46, 46 and 43 recognized
  stock steps. Standard and looping allowances double once, while accepted graphs,
  checkpoints, native sessions and prior grants remain retained.
- Replay leaves all copied run manifests unchanged and performs no production
  state writes or provider mutations.

Run the replay only against the private clone prepared for this investigation:

```sh
bun apps/f1/test-drives/assets/workflow-stall-production-replay.ts <private-production-clone>
```

## F1 workflow drive

```sh
F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/workflow-stall-recovery.mjs
```

The drive creates a fresh local Git repository and issue, enters a real
`EdgeWorker` session, then persists representative failed checkpoints. After a
worker restart it uses the Factory HTTP Retry endpoint to validate recovery:

- The original code-fix conversation resumes once, receives runtime-owned findings
  despite restricted recipe inputs, and reaches the real EdgeWorker finalizer.
  The finalizer records unchanged-code provenance and posts the assistance request
  in the originating session activities. Independent approval remains blocked.
- An existing stock clarification with nine visits and four previously granted
  passes resumes its original conversation with an effective limit of 20
  (`8 + 8 + 4`). Accepted workflow definitions and the saved checkpoint survive
  migration unchanged. A second worker restart preserves the same allowance.
- The real runtime CI step and `FactoryTools` implementation consume a scripted
  GitHub response whose historical base differs from the live target. Saved CI
  evidence uses the live target, the local tracking ref stays stable, and human
  approval remains required.
- Issue/session creation, observable session activities and clean worker shutdown
  succeed. Agent replies and provider I/O are deterministic mocks; no native agent
  CLI, inference call or provider mutation is involved.

The final drive passed after rebuilding the candidate, including the live-target
branch-name guard. These checks establish recovery and preserved safeguards; they
do not claim that independent findings in target repositories have been fixed.
Published nightly binary validation remains part of the separate release gates.
