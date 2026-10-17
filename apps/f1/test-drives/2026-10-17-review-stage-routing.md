# Saved review obligations reach their proper gates

Date: 2026-10-17. Source: `00f9e051` plus this change to
`SpecialistReview.ts` and `WorkflowRuntime.ts`.

F1 applies to requirement extraction, specialist review and saved-run lifecycle.
The scenario uses a real EdgeWorker, injected in-memory tracker, isolated Git
repository and deterministic `MockAgentRunner` responses. No native provider
or inference API was called.

The regression is a conservative review that treats missing final acceptance and
merge receipts as code defects, preventing it from reaching QA and human review.
The expected outcome is an approved code gate with those obligations explicitly
pending, QA execution, then an unanswered human wait that survives restart.

## Results

- F1 ping, issue creation and session launch passed on RPC port 3670; dashboard
  reads used port 3671.
- Runtime stage instructions reached the inventory and coverage agents despite
  saved prompts lacking those instructions and the absence of `impact-v1`.
- The frozen inventory contained one code criterion plus acceptance and delivery
  criteria. Code coverage was `met`; later criteria were `deferred` with specific
  actions and evidence. The aggregate approved code readiness without a fixer.
- QA executed a local Node command against the fixture's actual validator.
- Calls were exactly `inventory, coverage, qa, acceptance`. The run waited for
  an explicit answer; no human decision or provider merge was invented.
- Restart preserved the graph, history and pending wait without replaying roles.
- The separate runtime regression exercises the real human-decision checkpoint:
  merge execution remains unreachable until an explicit matching approval.
- The fixture worker stopped cleanly. The in-memory tracker cannot retain
  historical sessions across restart; its handled missing-session logging does
  not establish production tracker delivery.

## Reproduction and evidence

From the repository root, after building the worker and F1:

```sh
F1_AGENT_MODE=mock node ~/.bobs-factory/factory/evidence/operator-review-stage-457a007d/f1-review-stage-457a.mjs
pnpm --filter bobs-factory-edge-worker test:run test/SpecialistReview.test.ts test/ReviewRecovery.test.ts test/ReviewBrief.test.ts --maxWorkers=1
pnpm --filter bobs-factory-edge-worker test:run test/Impact.test.ts -t 'retries stale impact|keeps optional disagreements' --maxWorkers=1
```

The private local evidence directory retains the executed fixture, log,
`results.json` and rendered tracker `timeline.txt`. The successful fixture home
was `/var/folders/5m/3pxzz_nd1v7f34rd9vnm01380000gn/T/f1-review-stages-IX5BAR`.
Initial setup attempts exposed missing explicit tracker injection, polling before
run creation and unignored generated agent settings; the corrected isolated
fixture passed. This is scripted orchestration evidence, not real-model reasoning,
production QA, final acceptance or an actual provider merge.

The original run was separately resumed through its version-guarded assistance
API with gate-order correction and all final approval/delivery requirements
retained. Its installed binary was not replaced; other active runs continued.
