# Nightly architecture fixture recovery

**Date:** 2026-10-21 (Europe/Athens)
**Result:** PASS
**Mode:** mocked agents, isolated local repositories and Factory homes.
**Base:** `61b97c642fd03dcb7c393a22e75949e6302b208e`, with the candidate fixture edits identified below.

Functional fixture changes require relevant F1 validation. This follow-up repairs
the release validation harness after the workflow-stall fix in
[#169](https://github.com/jappyjan/bobs-factory/pull/169); it changes no production
runtime or saved production data. The production-clone reproduction evidence
remains in [the workflow-stall report](2026-10-21-workflow-stall-recovery.md).

## Failure and correction

[Nightly producer 39505044400](https://github.com/jappyjan/bobs-factory/actions/runs/39505044400/job/118912048402)
failed the architecture drive: the run failed instead of reaching human acceptance.
Local reproduction exposed `Output correction exhausted after 2 attempts at
architecture`. The mock dispatched by obsolete English display names and returned
a legacy version-1 proposal, while the stock step requires the version-2 check-in.
The continuation drive independently rejected its legacy proposal with `This
architecture step requires briefVersion=2 and a complete check-in`.

Both architecture drives now use the maintained `checkin()` fixture. The primary
drive selects replies using the scoped context's current step ID and rejects
unscripted roles. Its deliberately open first decision is omitted from settled
calls to check. The three changed drives allocate available loopback ports instead
of sharing fixed ports with other local fixtures. Each owns its temporary home and
stops its worker; unrelated local processes remain untouched.

The failed candidate and its evidence remain unchanged. Release recovery requires
a new candidate from the merged fixture correction.

## Commands and assertions

After the normal workspace build, run from the repository root:

```sh
F1_AGENT_MODE=mock BOBS_FACTORY_MIGRATION_SOURCE_CAPACITY_DIRECTORY=$(mktemp -d) bun apps/f1/test-drives/media/2026-10-11-architecture-decision-brief/f1-drive.ts
F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/architecture-approval-continuation.mjs
F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/impact-feedback-recovery.mjs
F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/workflow-stall-recovery.mjs
F1_AGENT_MODE=mock F1_API_PORT=3716 bun apps/f1/test-drives/assets/api-responsiveness.ts
```

All five commands exited successfully on the final candidate content:

- **Architecture:** Factory and Takeover meaningful runs each retain three proposal
  versions and implement exactly once after exact-version acceptance. Open
  decisions block acceptance; explanation, revision and restart retain the
  boundary. Routine cases complete. A revision missing its required changes still
  fails correction and retains only the original proposal. The first proposal is
  explicitly asserted to contain a version-2 check-in.
- **Approval continuation:** four proposals, two explicit approvals and five
  implementation visits, including one resumed native conversation. Existing
  acceptance survives explanation/restart; changed behavior requires fresh
  acceptance. Its local receipt reports `status: passed`.
- **Impact feedback:** a fresh comment corrects the original conversation; a saved
  result corrects after worker restart and HTTP Retry using its retained
  conversation. Both self-referencing inventories pass selected checks, while
  human acceptance remains required. This drive and approval continuation passed
  concurrently using independent allocated ports.
- **Workflow stalls:** incomplete-review correction, current target readiness and
  one-time saved iteration allowances still pass the existing real-runtime drive.
- **API responsiveness:** thirteen existing checks pass, including compact reads,
  answer continuation, retained evidence, guarded recipe edits and full-history
  Unicode/baseline preservation. The fixture recorded 656 version requests with a
  maximum of 12.79 ms, and one full-context read for 57,603,120 logical history bytes.

Local logs are retained in `/tmp/bobs-nightly-architecture-final.log`,
`/tmp/f1-architecture-continuation-dynamic-green.log`,
`/tmp/f1-impact-feedback-recovery-green.log`,
`/tmp/bobs-nightly-followup-stall-f1.log` and `/tmp/bobs-nightly-api-f1.log`.
These are local receipts; the fresh nightly must independently pass its release
gates. Mocked orchestration does not establish live model behavior or publication.

## Tested fixture SHA-256

| Fixture | SHA-256 |
| --- | --- |
| `media/2026-10-11-architecture-decision-brief/f1-drive.ts` | `a9bf6ed3360d772e6711eaad9e21d6d0e2f356ad8efb6466432af541cb0c9128` |
| `assets/architecture-approval-continuation.mjs` | `234aaa990a96a0f4097777eaaba844282db547d219840bd420d0781d07e5690e` |
| `assets/impact-feedback-recovery.mjs` | `7f1509c7d39fd715309eaab1b49ce193da16537e7c5e09cd6c6fd7a5fa4bd4a4` |
