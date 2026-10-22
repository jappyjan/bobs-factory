# Taskbot #138 acceptance findings — implementation response

PR [#175](https://github.com/jappyjan/bobs-factory/pull/175), Taskbot [#138](https://taskbot.apps.janjaap.de/p/bobs-factory/t/138), epic [#135](https://taskbot.apps.janjaap.de/p/bobs-factory/t/135).
This is the current implementation evidence after independent round 1 comment2117
(CHANGES REQUIRED on7d4d9bf7). It requests a NEW independent review; it is not an
acceptance verdict. The original evidence remains untouched in the parent directory.

The retained isolated checkout is
`/Users/jappy/.t3/worktrees/bobs-factory/taskbot-138-foreach`, branch
`taskbot/138-foreach`. Base remains freshly fetched main
`fdf52677be7ef22f8e31001031a26da61f4efdb3`, whose exact required CI was green
before implementation. Parent/reviewer/#136/#137 checkouts were not modified.
T3 thread binding is not claimed changed. Node24.21.0, pnpm10.33.1, Bun1.4.2;
no dependency, native credential, deployment, release or active-run changes.

## R1 — input behavior before validation

Reproduced both original probes before repairs. Enumerable `Object.keys` omitted
hidden descriptors, Zod read inherited settings, and original-object serialization
invoked `toJSON`. Array key-count equality did not prove dense indexed data.
The original failed review and our reproduction logs are retained separately.

The fix first checks exact plain/null prototypes and complete own descriptors.
Accessors, symbols and hidden properties reject before property parsing; source
arrays require every own index and reject extra properties. A bounded recursive
copy constructs hook-free data before serialization/size measurement, then clones
only that safe data to retain ordinary JSON interfaces. A shallow StepSchema
prepass also protects the type discriminator and items getter before Zod reads
those fields, without deep-validating unrelated workflow configuration or changing
ordinary optional-undefined defaults. Output pointers use own descriptors.

`Foreach.test.ts` now has48 cases (15 added): hidden/inherited own data surfaces,
toJSON getter/function, symbols/non-enumerables, sparse-plus-extra and dense-extra
arrays; zero getter/hook calls; direct settings and actual StepSchema entrypoints;
valid JSON/null-prototype data/string keys/defaults/limits retained. The independent
safe-data repro now rejects all malformed inputs with ZERO getter calls; a valid
snapshot remains accepted. No data-only promise was weakened.

## R2 — reads mistaken for produced outputs

Reproduced the exact inline and mapped Call probes before repairs. Their only
executed keys were outer `skipped` and child `route`; nevertheless inherited
`skipped.approved` appeared in the child aggregate and passed Check. Child maps
intentionally clone READ context, so own-property membership was not production.

The fix preserves inherited reads and stores separate immutable operational result
receipts in each new item/mapped Call frame, recording the exact qualified producer
key and its produced output at step completion. Projection reads those receipts,
not the mutable read-context map. Generic Parallel branches inside these scopes
obey the same ownership rule. Existing shared/unmapped Call and Parallel conventions
outside these scopes remain intact. Original history, accepted snapshots, native
sessions, visit counters and provenance are not rewritten.

Receipts persist through normal save/load. For a pre-receipt operational frame,
restoration requires both local visits and an original qualified receipt with exact
item-frame identity/digest. An unvisited colliding name is never restored from old
history or ancestor reads. Completed item results must match their produced receipts
by established canonical JSON digest, because the snapshot store can hydrate JSON
with null prototypes. If an older compound result lacks enough descendant ownership
proof, execution stops explicitly before Check and retains all original results,
history and native evidence. It does not replay a completed child to invent proof.

New `ForeachOwnership.test.ts` has15 consequential cases: inline/mapped skipped
approval denial and declared inherited reads; legitimate executed collision retained;
ancestor/sibling/nested/called names; generic Parallel collisions; legacy shared Call
and Parallel compatibility; mid-item and mapped Call disk reload/native continuation;
completion-before-join save barrier; repeated qualified names across outer visits
with absent new operational metadata; saved source before initial dispatch; and
fail-closed older completed compound ownership without replay or evidence rewriting.
The independent exact compiled-runtime probes now show only `route` under the child
result and `{passed:false,childApproved:false}` for both forms.

Only new test code changed during this repair; existing behavioral/security
assertions remain unchanged. One new restart assertion was strengthened to show
`run.error` alongside expected status. Missing-metadata fixtures remove only the
new operational ownership map before ordinary save/flush/load; accepted snapshots,
results, history and native sessions remain exactly as originally captured.
The prior ticket-launch teardown-only rationale remains in the original packet.

## Focused stabilization and failed attempts

The final focused seven-file run passed111/111 before freeze. The new actual mocked
EdgeWorker/CLI ownership pilot passed3/3 with8 controlled SDK turns, capacity2,
zero paid calls; inline, mapped Call and called/nested cases all denied an unearned
approval while retaining inherited reads. These source-moving runs are preliminary,
separate from final frozen-source gates and drives.

An early seven-file attempt passed105 and failed5 restart assertions because the
new completed-result comparison used JavaScript prototype-sensitive equality.
Normal storage hydrates null-prototype JSON; replacing that comparison with the
existing canonical JSON digest fixed the production guard. The diagnostic and failed
logs are preserved. No assertion was weakened to force a pass. An initial root
`pnpm exec vitest` command found no root Vitest; the proper package-filtered command
was then used. That invocation did not run tests. UI automation locator/read-size/
page-change attempts were corrected and recaptured; only inspected final captures
are presented as UI evidence. No accepted state or guard was patched.

## Current criterion map

| Criterion / risk | Current evidence |
| --- | --- |
| Safe inline/path/named sources; duplicates/keys/limits/no truncation |48 safe-data cases, zero-hook repro, existing path/runtime tests |
| Inline or mapped Call; truthful child ownership and downstream Check |15 ownership regressions, exact reviewer probe and3 ownership F1 scenarios |
| Concurrent dispatch and actual MachineCapacity without nested deadlock | Existing full runtime cases, original six-scenario F1 rerun and native smoke |
| Both policies, sibling abort, pending work, cancellation/partial honesty | Existing runtime and final F1/native policy cases |
| Durable completed skip, unfinished native continuation, visit limits/Retry | Existing runtime plus new normal disk reload/save-barrier/receipt restoration cases |
| Nested item/index/call/read/provenance authority | Existing lexical tests plus new nested/called ownership, F1 and native cases |
| Human restriction through Call/nesting; cycles/depth/provider preflight | Existing schema/catalog/preflight cases in complete package gate |
| Agent output → For each → Check end-to-end | Original six-scenario actual EdgeWorker/CLI F1 rerun on repaired source |
| Container/source/body/settings; invalid Save; simulation; per-item run activity | Fresh18 captures and actual filled interactions against new bundle |
| Frozen legacy shared Call/Parallel and previous #136/#137 safeguards | New explicit compatibility regressions plus full packages/apps/scripts |
| Capability reference/full expected prompt | Public behavior/syntax unchanged; repairs restore existing promises. Entire existing prompt expectation retained and checked by full package gate |
| Docs/changelog | Syntax docs clarify descriptor safety and exact produced results; original Unreleased PR175 entry updated |
| Required local gates/audit/binary | Exact-source identities, full logs, exits/counts/timestamps and fresh smoke below |

## Limits

Runtime restart tests use graceful shutdown/normal serialized loading and controlled
save barriers, not arbitrary OS kills. Actual EdgeWorker F1 does not restart its
process. Compiled native restart is after terminal settlement. Retained logical
continuation may create a new native turn; no arbitrary exactly-once external-effect
claim. Mocked model output is not paid-provider/model-quality validation. The UI
fixture uses production dispatch with scripted hooks; its simulation is explicitly
synthetic and does not execute nested recipes or model/effect work. Final Check in
that live progress fixture remains unreached while items are unfinished.

The new browser build changes because Foreach.ts is shared with simulation. Thus
all required images were refreshed; no old-backend/shared-helper equivalence claim
is used. Original18 screenshots and old F1/native/gate logs remain historical.
No future #139–#148 behavior, new convergence policy or generic stale-input exemption.
Parent owns exact revised-head CI, NEW independent acceptance and merge.

## Frozen source and final checks

All final executions identify clean source `19258b1427711693a25dda416a9ac6f231f2f8cc`,
tree `f70cd8035f212f90429507fe8006e63d74ac6fb4`. [Fresh fetch](base-refresh.json) confirmed
main remainsfdf52677. Final head after this packet differs only by documentation
and retained evidence; the finalization proof lists its exact allowlist. Earlier
7d4d9bf7/9b79/f4fe gates are historical and are not reused for these repairs.

All commands exited0. [Gates](gates.json) record every exact command, UTC start/end,
exit, elapsed seconds, full raw log hash and empty before/after source status.

| Gate | Result | Seconds |
| --- | --- | --- |
| build | PASS | 5.187 |
| typecheck | PASS | 4.224 |
| lint | 0 errors / 34 existing warnings | 1.58 |
| packages | 4,043 pass / 2 skip | 757.257 |
| apps | 312 pass / 1 skip | 79.822 |
| scripts | 179 pass | 105.199 |
| audit | 0 advisories | 0.913 |

[Fresh F1 report](../../../../../apps/f1/test-drives/2026-10-22-generic-foreach-review-fixes.md):
nine actual mocked EdgeWorker/CLI scenarios,26 controlled starts/24 successful mock
sessions, actual capacity2, zero paid calls. Built-JS digest
`820d241291b15a7cbffedf2db109ac961f3dc7981d4fade341823b9c86c46667` was checked unchanged before/after both drives.
The original six-scenario driver is unchanged; the new three-scenario ownership
driver has SHA `19922214e2ceffc9577568e222f4249df95b0f033015627579576a724001d8f3`.

Fresh native darwin-arm64 Bun1.4.2 build, standard smoke and three runtime smoke
cases all passed. [Full original receipt](native-results.json), [command metadata](extra-validation.json).
Actual binary SHA `58d3dcb5e0a3b42db94e57ea3ab18cc230fb53767157ead880be1e4a02548125`,
embedded resource digest `6bfeedcce61adfaec78aab0eec9d28379a99159ea313389194426ce6f3c5769c`,
web build `6b824666272cfdac87925a8a`, dirtyfalse. Both startup and restart
return the exact frozen source, target and digest. Standard smoke7.789s; nested
Call/For each/Check and both policies plus settled restart6.064s. Node/Bun absent
from product PATH; three title provider starts rejected by controlled stub;
zero paid calls. The original native driver is unchanged (SHA
`0aecbcb1b9a3541ffc90f0819a26336615460367a6bbca302eb65745a958b513`). It is a development smoke, not release publication;
its original build.json correctly retains its build-time pending-smoke field,
while the separate runtime receipt proves the later pass.

[UI report](ui.md): eighteen fresh original PNGs, 1440×1000 and390×844 CSS viewports,
light/dark builder and run pages, actual saved edit, malformed Save and synthetic
simulation. Source/backend and served-asset identities are retained, including the
changed shared Foreach helper and new backend. No backend equivalence is inferred
from unchanged renderer files. The fixture stopped normally at
`2026-10-22T00:39:57.270Z`.

[Validation index](validation-index.json) retains30 compressed logs,21 byte-exact
original JSON receipts plus readable formatted copies, five exact probe artifacts,
and18 original PNGs. Gzip hashes refer to original uncompressed bytes; formatted
copies are verified semantically equal. All original baseline files remain intact.
The failed105/5 restart run and diagnostic remain separately classified. Original
reviewer harness hashes match comment2117, and the after-probe explicitly asserts
zero getter calls and safe rejection. This packet is implementation evidence for
NEW independent acceptance, never a replacement for that review.
