# Durable recipe progress

New bundled recipes declare a root `convergence` policy. Custom recipes can set it
through Recipes → JSON or the existing workflow API, then save a new copy and
start a new run:

```json
{"convergence":{"maxUnchangedAttempts":8,"continueAttempts":2}}
```

The root's accepted policy applies to nested Call, Parallel and For each work.
Child policies cannot expand it. Existing accepted definitions without this option
retain their original visit, output correction and impact guards. Editing a catalog
recipe never changes a retained run's saved policy; adopting a different policy
requires a saved copy and new run. Missing observed history is labelled
`legacy-from-now` with its starting history length, without reconstructing credit
from incomplete events.

The runtime records actual attempts using the accepted definition's structural
operation, committed repository trees, accepted host input and validated semantic
Check/impact evidence. Different routes and fresh child frames share those
observations. For each items retain independent accepted identities. New summaries,
attempt UUIDs, empty commits and unverified output claims cannot replenish budget.
Returning to an earlier source/evidence state returns to its retained counter.
Working changes must reach an accepted source checkpoint to establish source
progress. Existing independent impact assessment and original evidence provenance
continue to govern actual review reuse.

Physical role turns charge after admission; failed mandatory context setup charges
infrastructure recovery separately. Missing MCP tools never become malformed-schema
failures. A retry must verify mandatory tool readiness again before model work.
Rejected candidates, schema attempts, explicit repair generations and supported native
conversation IDs remain retained. Completed outputs recovered without execution do
not count as another physical attempt. CI polling, capacity/resource queues, human
waits and offline elapsed time do not spend attempt credit.

When unchanged work exhausts its limit, the run fails at its retained checkpoint
with the operation, relevant identity, attempted work and repeated failure. Its
existing Retry/Continue action grants only `continueAttempts` executions for that
exact blocked observation and records the grant. Another route does not receive
that credit. Repeated explicit grants remain visible; none are issued automatically.
Original step limits/additional visits, schema limits and configured impact-cycle
limits remain independent safety ceilings. Expiry never approves review, human
acceptance, a missing check or provider delivery.

The public run response includes a small `convergence` diagnostic with the current
blocker, recent attempted operations and continuation grants. Full receipts and
checkpoints remain in their existing stores. Bookkeeping reads no accumulated run
history per attempt. It keeps at most 4,096 distinct observations automatically,
256 evidence facts, 16 recent attempt summaries and 32 recent grant receipts plus
a cumulative grant count. Filling the identity window asks for deliberate bounded
additional slots, retaining every earlier counter and completed sibling; it never
evicts identities to invent fresh budget. No timing/cost telemetry or remote model
judgment is inferred from these records.
