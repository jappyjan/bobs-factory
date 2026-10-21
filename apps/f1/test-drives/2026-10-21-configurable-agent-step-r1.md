# Configurable agent steps: review revisions

Date: 2026-10-21. Taskbot project `bobs-factory`, ticket #136, epic #135. PR [#173](https://github.com/jappyjan/bobs-factory/pull/173).

This report supplements the [original integration report](2026-10-21-configurable-agent-step.md). Its historical screenshots, results and logs remain unchanged.

## Tested state

- Final source and clean build: `f926f6c18be3ccdf1acd1593648719ae9523d247`.
- Node `v24.21.0`; F1 harness Bun `1.4.2`. Product source, build and CI target Node 24.
- Lockfile SHA256: `4d5086fbe1f4c882dd7466a569a75da99817eda5a9adeb89aa7526cc86406e72`.
- Complete built-artifact map digest: `773c896829c5bb92961c5b7b67184e5a9c5ea434ee00ee98763f29457184b247`.
- F1's executed `core`, `mcp-tools` and `edge-worker` JavaScript digest: `e7c3e114552a0f8b6f838ca3bd802d30e940c8cadd6f214d0307f66aab4e4074`. Recomputed after the drive and matched.
- Empty working-tree delta digest recorded by the harness: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`. The harness records the checked-out source before execution. Final revision evidence was parked outside the checkout during the drive and gates.

See the [clean-build manifest](assets/2026-10-21-configurable-agent-step-r1/validation/final-build-manifest.json.txt) and [raw results](assets/2026-10-21-configurable-agent-step-r1/results.json.txt). Required full gates and binary evidence are tracked separately in the [validation index](assets/2026-10-21-configurable-agent-step-r1/validation/README.md) and [complete local validation record](assets/2026-10-21-configurable-agent-step-r1/validation/final-gates.json.txt). Review revisions R1–R7 map to evidence in the [revision matrix](../../../docs/factory/agent-step-review-round1.md).

## Factory drive

```sh
F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/configurable-agent-step-r1.ts
```

PASS, 2026-10-21T18:13:37.398Z to 2026-10-21T18:15:33.292Z. The drive uses real EdgeWorker execution, CLI issue tracking, isolated Git worktrees, native MockAgentRunner events, configured validation, actual FactoryTools, explicit human review and confirmed merge-receipt handling. Agent decisions and forge responses are scripted. No model or inference API is called; paid calls: **0**.

| Recipe | Outcome | Native format calls | Activities | Comments | Human decision |
| --- | --- | --- | --- | --- | --- |
| `factory` | completed | 21 | 23 | 24 | `approve` |
| `renamed-factory` | completed | 21 | 23 | 24 | `approve` |

Both runs perform local Git publication and use simulated forge publication/merge receipts. The recorded turns include required stale-producer renewals, so this report uses the current 21-call results rather than the original report's 18-call counts.

The revision harness retains raw turn order and compares only contiguous declared independent specialist groups without requiring scheduler start order. Only these six exact declared members may reorder:

```text
pipeline/specialist-review/0/security-review
pipeline/specialist-review/1/architecture-review
pipeline/specialist-review/2/integration-review
pipeline/specialist-review/3/simplicity-review
pipeline/specialist-review/4/correctness-review
pipeline/specialist-review/5/requirements-review
```

Each declared member must execute exactly once; all serial key/format boundaries and existing tool, approval, publication, QA and merge assertions remain exact. The original harness is unchanged. The [preliminary strict-order failure](assets/2026-10-21-configurable-agent-step-r1/validation/f1-independent-start-order-before.log) records the test mechanism that was corrected; both actual runs had completed. The [earlier passing build](assets/2026-10-21-configurable-agent-step-r1/validation/preliminary-50e02029/results.json.txt) remains available separately.

Evidence: [full stdout log](assets/2026-10-21-configurable-agent-step-r1/factory-f1.log), [raw roles, turns and outcomes](assets/2026-10-21-configurable-agent-step-r1/results.json.txt), [stock activities](assets/2026-10-21-configurable-agent-step-r1/stock-activities.json.txt), [renamed activities](assets/2026-10-21-configurable-agent-step-r1/renamed-activities.json.txt), [stock comments](assets/2026-10-21-configurable-agent-step-r1/stock-comments.json.txt), [renamed comments](assets/2026-10-21-configurable-agent-step-r1/renamed-comments.json.txt).

## Live browser validation

The T3 collaborative browser used an isolated protected FactoryServer, in an incognito profile. The working fixture retains an older passing CI receipt while current runtime-owned provider state reports Build pending. The review fixture uses a valid human-review gate authored as `external-human-review`, with a guide and Changed files snapshot bound to actual temporary Git commits. These browser fixtures do not make provider requests. The full Factory drive above separately exercises actual orchestration.

The 20 inspected screenshots were captured from source `50e020294b8b414b2920af8952fd1467ae521180`, UI build `439e34cad97e0e35a98dcbb4`. The final backend was restarted from `f926f6c18be3ccdf1acd1593648719ae9523d247` and rechecked at 2026-10-21T18:14:23.413Z. Its **entire 11-file UI build matches** the captured build byte-for-byte; Backend compatibility and Node 24 policy corrections followed capture; the browser bundle is unchanged. The [browser evidence](assets/2026-10-21-configurable-agent-step-r1/ui-validation.json.txt) records both source identities, UI file hashes and final API/action checks. [Saved screenshot hashes](assets/2026-10-21-configurable-agent-step-r1/validation/screenshot-and-ui-proof.json.txt) are recorded separately.

Verified behavior:

- Raw HTTP, dashboard polling and focus return the current pending Build receipt, ahead of the retained older passing CI receipt. Working and review views show the blocker with no successful-check mark; blocker paragraph pseudo-content is `none`.
- The renamed review gate exposes Refresh guide. A stale review ID returns 409 and leaves the pending gate intact. Clicking the actual control starts the configured guide; subsequent API/UI polling removes the gate and refresh capability.
- The builder saved and reloaded Reads, a custom schema, Rules, Checks, bound revision, read-only Access with pinned repository tools, and Shared instructions. Remote schema references and malformed JSON are rejected; native tools are rejected in read-only configuration. Discard restores the saved JSON.
- Unknown format/check/instruction IDs and script rules return clear 400 errors without changing the recipe revision. Bundled configuration is read-only while existing agent preferences remain editable.
- Desktop 1440×1000 and mobile 390×844 layouts have no horizontal overflow, in light and dark. Saved PNG dimensions reflect browser scaling.

| Scenario | Desktop light | Desktop dark | 390px light | 390px dark |
| --- | --- | --- | --- | --- |
| Current Build pending | [Light](assets/2026-10-21-configurable-agent-step-r1/working-desktop-light.png) | [Dark](assets/2026-10-21-configurable-agent-step-r1/working-desktop-dark.png) | [390px light](assets/2026-10-21-configurable-agent-step-r1/working-mobile-light.png) | [390px dark](assets/2026-10-21-configurable-agent-step-r1/working-mobile-dark.png) |
| Renamed review gate and current checks | [Light](assets/2026-10-21-configurable-agent-step-r1/review-desktop-light.png) | [Dark](assets/2026-10-21-configurable-agent-step-r1/review-desktop-dark.png) | [390px light](assets/2026-10-21-configurable-agent-step-r1/review-mobile-light.png) | [390px dark](assets/2026-10-21-configurable-agent-step-r1/review-mobile-dark.png) |
| Builder schema and rules | [Light](assets/2026-10-21-configurable-agent-step-r1/builder-desktop-light-schema.png) | [Dark](assets/2026-10-21-configurable-agent-step-r1/builder-desktop-dark-schema.png) | [390px light](assets/2026-10-21-configurable-agent-step-r1/builder-mobile-light-schema.png) | [390px dark](assets/2026-10-21-configurable-agent-step-r1/builder-mobile-dark-schema.png) |
| Builder evidence and access | [Light](assets/2026-10-21-configurable-agent-step-r1/builder-desktop-light-evidence.png) | [Dark](assets/2026-10-21-configurable-agent-step-r1/builder-desktop-dark-evidence.png) | [390px light](assets/2026-10-21-configurable-agent-step-r1/builder-mobile-light-evidence.png) | [390px dark](assets/2026-10-21-configurable-agent-step-r1/builder-mobile-dark-evidence.png) |

Additional mobile detail: [rules light](assets/2026-10-21-configurable-agent-step-r1/builder-mobile-light-rules.png), [rules dark](assets/2026-10-21-configurable-agent-step-r1/builder-mobile-dark-rules.png), [access/revision light](assets/2026-10-21-configurable-agent-step-r1/builder-mobile-light-revision.png), [access/revision dark](assets/2026-10-21-configurable-agent-step-r1/builder-mobile-dark-revision.png). All 20 saved images were visually inspected.

## Focused revision regressions

The readiness reproduction originally returned current pending Build state through raw HTTP but omitted it from dashboard polling. Stock and renamed HTTP tests now preserve current readiness, omit provider discussion bodies, render the pending blocker, and observe the next successful poll without trusting the stale authored receipt.

Review capability/action tests cover valid renamed gates, unsupported stock external gates, arbitrary pending gates, stale review IDs, rendered control visibility, and capability removal after refresh. Accepted graph metadata supplies step color, icon and fixing semantics; generic historical-name collisions stay generic. Modern guide revision bindings require exact accepted slots, while cached historical views retain their compatibility behavior.

Cold presentation fixtures model exact executed called-frame outputs. Artifact deletion, content hash, image path, symlink and tampering assertions remain. Recovery fixtures preserve missing/dirty/changed-head/no-extra-tool assertions and use genuine accepted frozen definitions. The modern called-frame merge case retains a root collision and requires an exact qualified publication/merge receipt, with the root output untouched.

The [focused presentation run](assets/2026-10-21-configurable-agent-step-r1/validation/operational-review-focused.log) on screenshot source `50e02029` passed **24/24** tests across `FactoryOperationalPresentation`, `FactoryReviewState` and `FactoryRenamedPresentation`. See [test-change reasoning](../../../docs/factory/agent-step-test-changes.md) for the preserved assertions and mechanism changes; the complete local validation record above contains the complete package gate.

## Limits

This drive does not assess live model quality, real forge credentials/publication, remote provider merges, or live Linear/Taskbot delivery. Browser checks use controlled runtime state and actual local Git snapshots. The actual orchestration drive uses native mock events and scripted forge responses, with zero paid calls.
