# Runtime update snapshots with retained evidence links

Scope: runtime update state preflight and rollback preservation. Agent and script
callbacks are deterministic mocks; this drive makes no native OS restart or live
coding-agent claim.

Reproduce with `F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/desktop-service-lifecycle.mjs`.

The drive pauses a real WorkflowRuntime run with a saved question, outputs,
history and a native checkpoint ID. It adds an expired absolute tooling link
beneath that run's retained evidence, then invokes the same state-copy routine
used by OwnedUpdateLifecycle.

Assertions passed:

- The isolated candidate preflight loads the same saved run and cannot access the
  tooling link; it is absent from that copy.
- The rollback snapshot and restored copy retain the exact link string.
- Reading restored state preserves the saved question, outputs, history and
  checkpoint without running workflow callbacks.
- The original run still resumes after its answer and completes once: three mock
  agent calls, one scripted completion.
- Existing one-home ownership, protected detail/activity and graceful reopening
  checks remain green.

Focused CLI tests separately cover relative links, absolute external directory
links, dangling targets, native-auth exclusion and refusal of links in saved
configuration/state. Rollback uses verbatim link copying. Release CI continues
to require native service, runtime update and Electron validation.
