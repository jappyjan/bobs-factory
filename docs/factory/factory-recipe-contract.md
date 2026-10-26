# Factory and Takeover on nodes: sub-recipe contract

Epic #156 rebuilds Factory and Takeover as `engineVersion: "nodes-v1"` compositions of
sub-recipes built only from generic nodes (see `nodes.md` and `display.md`). The C tickets
build the sub-recipes in parallel; D1 composes them and deletes the legacy graph. This
file is the contract between them. Change it in the same PR as any recipe that needs a
different shape.

## Transition rules

- New sub-recipes are bundled `internal` recipes with `engineVersion: "nodes-v1"` and ids
  prefixed `v2-`. The legacy `factory`, `takeover` and their sub-recipes keep running
  unchanged until D1 swaps the composition.
- A C ticket deletes legacy code only when nothing still references it. D1 removes the
  rest.
- Every sub-recipe declares `inputs` (only the ports it reads) and `outcomes`, can be
  launched standalone (`allowedTriggers: ["workflow", "manual"]`), and has a mocked
  end-to-end test of its own.
- No engine, node or web code may be added for a particular recipe. Missing generic
  capability goes into the node (with docs), never into a step-name branch.
- Prompts keep the substance of today's stock prompts (`stockFactorySteps.ts`,
  `InstructionLibrary.ts`). Byte-identical prompts are not required.

## Shared launch context

Every sub-recipe may read `@source` (the launch prompt and fields) and `@ticket` (the
originating ticket, when there is one). Nothing else is implicit.

## Ports

Calls bind ports by name. The producing sub-recipe's output step must emit the shape
below. Extra fields are allowed; listed fields are required unless marked optional.

| Port | Producer | Shape |
| --- | --- | --- |
| `requirements` | `v2-clarify-plan` | `{ summary, requirements: [{ id, text, source? }], decisions: [{ id, question, answer }], outOfScope: [string] }` |
| `plan` | `v2-clarify-plan` (revised by `v2-check-in`) | `{ summary, deliveryMode: "repository"\|"external"\|"mixed"\|"deferred", steps: [{ id, text, requirementRefs }], risks: [string], repositories: [id] }` |
| `architecture` | `v2-check-in` | `{ meaningful, accepted, decisions: [{ id, text }], approval?: <display output> }` |
| `change` | `v2-implementation`, any fixer | `{ summary, repositories: [{ id, head }] }` (git commit/push outputs) |
| `pr` | `v2-implementation` | the `pr ensure` output (`{ repositories: [{ id, head, url, isDraft }] }`) |
| `review` | `v2-review-loop` | `{ approved, findings: [{ id, rating, status, title, requirementRefs, reviewer }], coverage: [{ requirementId, status }] }` |
| `qa` | `v2-qa` | `{ needed, passed, scenarios: [{ id, title }], evidence: [{ scenarioId, kind: "screenshot"\|"video", path }] }` |
| `approval` | `v2-approval` | the approval `display` output, `bind`ing `pr` and the guide. Carry-forward adds `{ carriedFrom, decision }` |
| `merge` | `v2-merge` | the `merge` output |
| `delivery` | `v2-external` | `{ applied, verified, ticketUrl }` |

## Outcomes and composition loops

| Sub-recipe | Outcomes |
| --- | --- |
| `v2-clarify-plan` | `completed` |
| `v2-check-in` | `completed`, `revise-plan` |
| `v2-implementation` | `completed`, `to-architecture` |
| `v2-review-loop` | `completed`, `to-architecture`, `to-ci` |
| `v2-qa` | `completed`, `to-review` |
| `v2-ci` | `completed`, `to-review` |
| `v2-approval` | `completed`, `to-review`, `to-ci` |
| `v2-merge` | `completed`, `to-review`, `to-ci` |
| `v2-external` | `completed`, `revise-plan` |
| `v2-takeover-intake` | `completed` (also emits `requirements` and `plan`, so Takeover can skip clarify/plan) |

D1 composes Factory as: clarify-plan → `check` on `plan.deliveryMode` → (check-in →
implementation → review-loop → ci → qa → approval → merge) and/or external. Takeover:
takeover-intake → the same blocks. Composition-level `check` nodes route outcomes back
(`to-review` → review-loop, `to-ci` → ci, `to-architecture` / `revise-plan` →
check-in / clarify-plan).

## Human interaction

Every human screen is a `display` node. Agents that need answers emit
`{ status: "needs-input", display: <document> }`. A `check` routes to
`display(from: <agent>/display)`, and the agent continues with `session: "resume"`.
Approvals `bind` what they approve, and any gate after a human approval checks
`fresh(<approval>)`.
