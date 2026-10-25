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
