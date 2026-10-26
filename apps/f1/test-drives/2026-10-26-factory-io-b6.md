# Factory IO nodes through the issue/session lifecycle

Date: 2026-10-26 (Europe/Vienna).
Tested source commit: `4a2d9784e294c25a15b9037ca2bf968ee574088c`.

## Scenario

An isolated CLI issue selects a `nodes-v1` recipe by label. The actual EdgeWorker,
CLI tracker, workflow registry, native tracker adapter and command executor run
six steps: mocked agent, ticket read, a comment bound to that read, explicit
status, read-only exec with JSON output, and provider-confirmed merge. The Git
provider is scripted; no live forge or paid model API is contacted.

## Execution

```sh
pnpm --filter ./packages/edge-worker build
pnpm --filter ./apps/f1 build
F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/factory-io-b6.mjs
```

The fixture creates a fresh repository/home, takes an available loopback port,
starts the worker and CLI RPC, checks health, creates an issue and starts its
session through the F1 CLI. It polls for the completed run, inspects provider
state and activities, and stops the session/worker in `finally`.

## Results

PASS. Session `session-1` completed the actual registered graph in order:
`agent`, `read`, `comment`, `status`, `exec`, `merge`.

- Ticket comment body came from `read/title`; exactly one durable marker was
  posted through the native CLI tracker adapter.
- Ticket state was explicitly Started; no automatic milestone outbox was created.
- Exec returned structured JSON with `value: 42`.
- The scripted provider saw exactly one merge request. Output retained the
  provider-confirmed `fixture-merge` commit SHA and repository/PR identity.
- Session activities contained the mocked runner identity `claude/f1-mock`.
- The worker saved state and stopped cleanly; paid model calls: zero.

Run artifacts were written to
`/var/folders/5m/3pxzz_nd1v7f34rd9vnm01380000gn/T/f1-io-b6-boyBmV/`
(`result.json`, `activities.txt`, isolated tracker/workflow state).

This drive verifies orchestration and native CLI transport behavior on macOS.
Unit fakes separately cover Linear/Taskbot operations, uncertain-effect restart,
provider queues, grouped repositories and command access/timeout failures.
Live forge rules, live Linear/Taskbot services and Linux bubblewrap are not
claimed by this evidence.

## Review correction validation

2026-10-26: repeated the same mocked fixture against the review corrections
based on `b6a8466a` (sources committed with this note). Both package builds and
the fixture passed. Session `session-1` again completed all six nodes with one
comment, one scripted merge, parsed exec JSON, zero implicit milestones and zero
paid calls. Artifacts: `/var/folders/5m/3pxzz_nd1v7f34rd9vnm01380000gn/T/f1-io-b6-xeXITM/`.

Focused verification: 103 tests pass across FactoryIONodes, ExecSandbox,
RepositoryTicketIO, GitProvider, NodeRegistry, TicketTracking and FileIssues.
New cases cover cold restart after provider/view/readiness failure, shutdown
while waiting for a delivery reservation or command capacity, another run
acquiring the repository during merge confirmation, idempotent ticket retries,
GitLab fast-forward receipts, default effect parsing and inherited-map guards.
The edge-worker typecheck passes.

The four ExecSandbox integration tests also pass on Linux arm64, with actual
bubblewrap 0.8.0 installed in a disposable Node 24.19.0 Debian container. Namespace
creation was enabled for the container; Vitest and commands ran as the
unprivileged `node` user. The test source and runtime dependencies were bundled
from this worktree with esbuild (Vitest external), then executed with Linux's
native Node/bwrap binaries. Nothing mocked the command or sandbox boundary.
Tests cover separate streams/env/JSON, filesystem enforcement/timeout, a Git
commit in a linked worktree plus private TMPDIR writes, and network denial in
read-only mode. Linux hosts now fail these tests when bubblewrap is missing,
instead of silently skipping them. Host file reads remain available in both
access modes, as documented; this is not a confidentiality sandbox.
