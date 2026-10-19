# Linear session acknowledgment and busy lifecycle synchronization

Date: 2026-10-19. Base: `e53ef4fdcb9c07e0011616d2f8c2af9e7691cc8e` plus this repair.
Mode: mocked provider and ticket reads; no live coding agent or production ticket mutation.

F1 applies because this changes Linear session admission, activity delivery and
native lifecycle synchronization. The scenario covers the actual EdgeWorker
created-event handler, durable reservation, ActivityPoster, signed transport,
SDK request scheduler, durable outbox and blocked-ticket stop path.

```sh
F1_AGENT_MODE=mock bun run apps/f1/test-drives/assets/linear-early-ack.ts
F1_AGENT_MODE=mock bun run apps/f1/test-drives/assets/linear-busy-budget.ts
```

The early-ack scenario queues eight background SDK reads and an existing routine
write, then submits a signed created webhook while ticket preflight is held.
With 100 ms API pacing, its acknowledgment reached the mocked provider in 190 ms,
before preflight completed. A repeated signed webhook produced no duplicate
acknowledgment. After releasing preflight, real dependency checking parked the
blocked ticket without creating a workspace or runner. Unassignment settled the
reservation and removed the parked ticket. SDK dispatch pacing remained enforced;
no scheduling metadata entered the provider mutation, pending delivery or
unhandled rejection remained. Timing measures SDK dispatch separately from
provider receipt so network arrival variance cannot masquerade as pacing failure.

The same drive builds a native ticket with 16 discussion comments. Full context
resolves all 16 authors. Lifecycle synchronization resolves zero comment profiles,
publishes its receipt and moves the ticket to Started. A subsequent external
status change is detected as a conflict and is retained. Complete comment and
attachment pagination and fresh lifecycle state checks remain in production code.

The existing busy-budget drive also passed: one mocked assignment completed,
three activities were published across six paced requests, and no delivery or
unhandled rejection remained.

Focused automated reproduction went red before repair: delayed preflight sent no
acknowledgment; eight queued reads delayed delivery to 18–20 seconds; an unavailable
comment profile blocked native lifecycle delivery. After repair, the regressions
and related suites pass (74 transport tests, 142 worker tests). Deterministic
2,000 ms pacing tests acknowledge after 2–4 seconds. These checks do not establish
availability during a provider throttle or a stalled network request, and mocked
F1 does not establish live model behavior.
