# Taskbot setup under full instance capacity

Date: 2026-10-13. Code revision: `2670e068` (PR #116).

F1 applies because manual ticket resolution, capacity visibility and setup cancellation change. The custom embedded F1 drive uses a real EdgeWorker, WorkflowRuntime, MachineCapacity, Git worktree and configured HTTPS MCP client. Its Taskbot server is a controlled loopback fixture. Agent/title roles use `f1AgentHandlers("mock", '{"ok":true}')`; no native model turn, provider credits or production mutations are involved.

The reported run `manual-2bd6b169-9864-4eba-be58-afcc28fbd1c6` started at 09:17:09 UTC and failed setup at 09:18:09. Retries at 09:19:59 and 09:21:08 failed after the same 60-second interval. Its retained history was empty and setup was incomplete. Capacity contained a queued MCP request for the run while three roles occupied its three slots. Both Taskbot adapters constructed the timeout before calling the capacity-gated transport.

The isolated drive occupies its single slot, launches a custom manual workflow from a Taskbot URL, waits 62 seconds, then frees the slot. Assertions cover:

- Run and persisted summary show capacity waiting; no transport starts while queued.
- Setup remains active beyond the 60-second transport budget.
- Admission fetches complete ticket context, creates a real worktree, executes a mocked role and completes without an error.
- Tracking comments reach the controlled ticket server and all execution leases clear.
- Stopping a second queued manual setup removes its setup request without retrieving that ticket or creating its workspace. Its separate stop-notification outbox is canceled during fixture shutdown.

Result: exit 0, `passed: true`. The queued interval was 62,003 ms; run `manual-62c847ac-d439-46b3-9f6f-de52da31ed13` completed and the second run stopped before setup. All leases cleared on cleanup.

Evidence and commands:

```sh
NODE_EXTRA_CA_CERTS=/tmp/bobs-taskbot-f1/retry/cert.pem \
BOBS_FACTORY_DISABLE_REMOTE_SESSION_STORE=1 \
bun run /tmp/bobs-taskbot-f1/retry/drive.ts
```

The driver, controlled TLS certificate, worker snapshots, log and JSON assertion receipts are retained in `/tmp/bobs-taskbot-f1/retry`. The initial drive verified completion after 62 seconds but its cancellation assertion incorrectly expected all capacity leaves to clear, including the separate stop-notification outbox. The final drive instead checks removal of the original setup request and cancels background tracking during shutdown.

Unit regression checks compress only the transport budget while retaining real admission. They fail against the unmodified base for both Codex and direct transports and pass with the fix. Admitted transport still times out and releases capacity; caller cancellation still removes queued work. Validation: 124 focused tests, full build/typecheck and focused Biome checks.

Limits: Codex OAuth transport selection is covered by mocked adapter regression tests; F1 exercises direct HTTPS transport. This drive does not establish live Taskbot availability, native OAuth or model behavior. Production run state is untouched.
