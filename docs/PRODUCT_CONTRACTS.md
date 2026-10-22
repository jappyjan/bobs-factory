# Bob’s Factory contract inventory

The fork is Apache-2.0; preserve the upstream LICENSE, NOTICE and source attribution.
Historical changelogs and F1 reports retain their original names and commands.
Native Claude/Codex/Cursor/Gemini/OpenCode, Git, SSH and signing stores remain host-owned.

| Contract | Maintained producer / consumer | New representation | Explicit migration |
| --- | --- | --- | --- |
| Source toolchain | Workspace engines, CI/setup and trial launcher | Node 24.x only (pinned 24.18.0), pnpm 10.33.1; Bun 1.4.2 embeds the binary runtime | Remove Node 22 support outright. Factory binaries require no separate Node/Bun; Git and prepared agent tools/credentials stay external |
| Executable / service | CLI, launcher, install / service docs | `bobs-factory` | Replace approved service command; no alias |
| Workspace packages | manifests, imports, filters, lockfile | `bobs-factory-*`, private | Build-time only; upstream monorepo npm publishing stays retired |
| Public trial launcher | Proposed npm package `bobs-factory-trial`, website download guide | Small `npx` launcher for stable/nightly verified native artifacts; npm/Node required for launcher only | Registry name was unclaimed when checked on 2026-10-10; confirm authenticated project ownership before publishing. Never publish workspace packages or bypass release integrity verification |
| Product environment | CLI, worker, runners, capacity, helpers | `BOBS_FACTORY_*` | Rename keys, refuse collisions; keep provider keys |
| Ticket managers | unified CLI/desktop/service runtime, protected Settings → Ticket managers | per-provider `ticketManagers` connection settings, retained `linearWorkspaces` and native identities; live intake/synchronization policy and persistent delivery | Ignore legacy service mode metadata; remove saved global `platform`; keep native credentials, runs and project MCP sources. F1 injects fixture trackers explicitly |
| Home configuration | application, worker, config | `factoryHome`, `~/.bobs-factory` | Transform config field and owned paths only |
| Linear publication | shared presenter, activity sinks, queued delivery | Routine progress and role outcomes use `thought`; native lifecycle/input activities retain their types and automatic threaded comments; explicit documentation uses comments | Present legacy queued records before sending; retain raw evidence locally |
| Change impact and evidence reuse | Accepted workflow role, Factory/Takeover scheduler, review/QA and delivery gates | [`impact-v1`](factory/impact-decisions.md); original receipts plus explicit reuse links; configurable repeat limit; separate approval continuation | New stock definitions opt in. Saved/custom recipes and accepted run snapshots retain conservative graphs; custom workflows opt in explicitly with configured inventory/fanout associations |
| Persistence | worker state, factory runs / chats / evidence | `<home>/state`, `<home>/factory`; version 5 session manifests, immutable chunks and lazy run payloads | Preserve IDs, receipts, gates, accepted definitions and legacy document backups; commit referenced chunks before manifests; move/restore complete homes with their chunks |
| For each composition | Recipe schema/runtime, builder/simulator and activity | [Generic durable `foreach`](factory/foreach.md), stable keyed item frames, bounded dispatch, explicit failure summaries and lexical call inputs | Opt in in new/edited recipes; accepted collections, frozen definitions, original receipts and native conversations remain retained. No arbitrary exactly-once side-effect guarantee |
| Workflow recovery | role validation, accepted checkpoints and Git provider evidence | Bounded role correction, declared impact reassessment, exact merged-delivery reconciliation and provable committed-worktree restoration | Retain frozen graphs, native conversations, evidence and human decisions. Refuse missing uncommitted data, changed/locked branches, path escapes or unfinished custom work; CLI workers leave the resolved launch directory and desktop children start in the persistent Factory home |
| Coordinator | MachineCapacity and execution scope | `<factoryHome>/machine-capacity`, one pool per instance | Stop old consumers and descendants before transfer; capacity-directory overrides block apply until explicitly reconciled |
| Takeover repository base | FactoryTools inspection, retained repositories and planning context | Existing PR base stays distinct from the branch used to seed its worktree | Correct a self-targeting retained base only after the inspected PR head matches the working branch; preserve the PR, worktree and historical prompts. Operator recovery of an older run confirms the current provider base and records the correction |
| Repo hooks | GitService setup / teardown | `bobs-factory-setup.sh`, `bobs-factory-teardown.sh` | Rename only explicitly approved repository files |
| Owned MCP references | registrations, allowlists, prompts | `bobs-factory-tools`, `mcp__bobs-factory-tools__*` | Transform server-wide allow/deny entries, saved/frozen workflow tool steps (including fanout/nested definitions), server keys and owned HTTP routes; preserve prompts and transcripts |
| Stock skills / plugin | deployer, runner configs, instructions | `bobs-factory-skills`, `bobs-factory-skills-plugin` | Preserve custom skills and prompts |
| Certificates / sandbox | worker home, runner environment | `<home>/certs`, `BOBS_FACTORY_*` | Preserve keys, normalize path fields |
| Prepared Cursor SDK | binary runner / external Node host | `BOBS_FACTORY_CURSOR_SDK_PATH`, `BOBS_FACTORY_CURSOR_NODE` | Keep SDK/native files external; preserve native IDs |
| Distribution | build, CI, installer, metadata | frozen stable/nightly/beta candidates; stable uses an explicitly selected validated nightly promotion source, beta uses manually selected exact version on main, four-target archives, unsigned schema-2 manifest + candidate-bound SHA-256/size inventory | Stage replacement separately from mutable state; immutable schema-1 beta requires additive reviewed inventory attestation |
| Source transport | publisher, prepared-release validation and offline recovery | hash-bound ordered 1 GiB chunks reconstructing the exact full source archive when it exceeds GitHub asset limits | Keep local source/evidence monolith and unchanged semantic intake; preserve genuine single-file and schema-1 beta inventories; new tooling requires a new reviewed candidate identity |
| Release discovery | installer, Pages, Nix, runtime and desktop updaters | stable/default (inventoried beta fallback only without an explicit channel), explicit stable/nightly, exact version; GitHub HTTPS and SHA-256/size inventory | Preserve exact manifest bytes; no independent publisher signature claim |
| Instance updates | authenticated dashboard, CLI, external owned supervisor | `<factoryHome>/updates/state.json`, per-channel overrides, pause/pin and durable restart receipts; `factory-preservation-v2` hashes saved catalog bytes separately from bundled code | Preserve settings across entry points; snapshot only compatible Factory-owned state; native stores and Factory authentication stay outside rollback; reject mismatched preservation contracts before stopping, with an owner-managed stopped-worker upgrade for the legacy boundary |
| Desktop shell updates | local installed Electron launcher, external app helper | `<factoryHome>/desktop/updates/state.json`, shared policy/consent rules, hash-bound complete-app ownership receipt and health journal | Replace only the verified user-owned app; retain old UI; fence the local worker without restarting it; selected remote instances keep their own update settings |
| Publication | release workflows, publisher | repository-wide lock; retained asset/approval digests and recovery receipts; ordering against complete published provider history | Publication disabled until explicit rollout activation; stable approval binds exact unsigned bytes; rejected releases cannot hide provider history |
| External wire protocol | upstream HTTP adapters / MCP contexts | `X-Cyrus-Team-Id`, `X-Cyrus-Config-Capabilities`, `x-cyrus-mcp-context-id` | Retain ASCII protocol names; no hosted enrollment |
| Operator MCP | CLI, worker, operator grant store | `bobs-factory-operator`, `operator`, `operator-mcp`, `<home>/factory/operator` | Local owner grants; dashboard API keys and accepted run profiles remain separate |
| Dashboard access | CLI, FactoryServer, private authentication store; client clears private views on connection loss and rechecks sessions on reconnect | automatic direct HTTP loopback access; remote key sign-in, Settings → Access, local `factory-auth` recovery, `--origin`, `--session-hours`, `BOBS_FACTORY_FACTORY_*`, `<home>/factory/auth` | Version-3 digest-only keys and origin-bound sessions, with opt-in no-expiry sessions; version 2 upgrades preserving keys/deadlines, version-1 passkeys/sessions migrate to an empty store; local access creates no reusable session; IPv6 is a request authority alias |
| Terminal dashboard | CLI, FactoryServer, private authentication store | `tui`, `--theme`, `--home`, `--port`, localhost-bound terminal sessions | Local operator filesystem authority; memory-only session hashes, no browser credential or native store migration |
| Workflow catalog | defaultWorkflows, WorkflowCatalog, WorkflowRuntime and native adapters | code-owned bundled behavior; separate preferences, launch settings and availability; private fork graphs | digest-bound backup/receipt of legacy config; preserve custom graphs, frozen runs and native IDs; individual Resume after disabling through dashboard, terminal or operator MCP; stopped runs with saved progress can Resume individually after workflow availability checks, while Bring back changes only visibility; saved Simple runs use runtime recovery; ticket Simple resumes its retained native conversation and pending attachments; standalone chat resolves its selected model before saving the pending turn; Resume preserves that model through the production runner factory and retains queued input across preference changes; queued first chat turns persist proof that provider execution has not started and can Resume without a native conversation ID; the provider-start boundary is persisted after capacity admission and before provider side effects; confirmed cancellation or admission rejection before provider invocation durably restores the never-started state, while failed cleanup saves and uncertain provider effects retain conservative recovery errors; established chats and older records with unknown startup history require a saved native conversation ID, reporting how to restore it instead of starting a replacement conversation; failed recovery retains its block and reports missing prerequisites |
| Architecture approval | Architecture, WorkflowRuntime, FactoryServer and proposal UI | bundled proposal/review contracts, reviewer-facing findings/deliverables/criterion coverage and runtime-derived planned footprints bound to exact-version acceptance; local forks own prompt and approval-policy edits | new stock proposal steps opt into `architectureBrief: checkin-v1` (briefVersion 2 check-in: understood, plan, before/after scenes, who notices, calls to check, size and optional split, with the review brief as Bob’s notes); asking for changes on a pending stock `review-v1` proposal adopts the check-in prompt and reviewer while keeping agent settings; custom prompts and saved proposals retain their contracts and digests without replay; older proposals are retold from their summary, Bob’s own decisions and size; versions record `shownAt` and the reader counts drafts the human never saw; historical versions cannot accept the current proposal; footprint counts declared paths in planning worktrees, with file kinds and largest code area inferred by the runtime |
| Declarative recipe views | Workflow schema, runtime, Recipes and run screens | [`view-v1`](factory/views.md), generic Decide/Approve/Show, exact displayed-content human batches and bounded public lexical bindings | Additive for custom recipes; saved native human screens, frozen definitions, original receipts and approval authority remain unchanged |
| Review guides | defaultWorkflows, GuideAuthoring, ReviewBrief, WorkflowRuntime and review reader | `guideContract` `brief-v3` (review brief plus `story` show & tell, and Dig deeper: a `tour` placing every changed file once, plain flows with code links, `touches`, plain proof rows) for new stock guide steps; `brief-v2`, `brief-v1` and chapter guides stay readable | Regenerating a pending guide replaces only a recognised stock guide prompt with the current `brief-v3` prompt, keeping its agent settings and video/impact instructions; custom guide prompts are never rewritten |
| Dashboard | FactoryWebAssets, build script, server | immutable shell inventory, existing PWA protocol | Rebuild shell; keep API/SSE and workflow IDs |
| Manual launch attachments | LaunchFields, LaunchAssetStore, FactoryServer, WorkflowRuntime and composer | declared `files` fields, opaque draft/upload IDs, private hash-bound `launchAttachments` manifests; 10 files, 25 MiB each, 100 MiB total | New stock definitions opt in; saved/custom and accepted definitions keep their declarations. Preserve claimed directories with persisted runs; see [manual launch attachments](factory/manual-launch-attachments.md) |

External cyrus-hosted tool catalogs are absent from this repository. They cannot
be updated here. This independent fork does not enroll with the upstream hosted
control plane. Migration must flag hosted-only setup for explicit conversion.

Dashboard requests use screen-specific projections: compact Today decisions,
run overviews, explicit architecture versions, launch configuration, recipe
editing and execution settings. Run mutations acknowledge acceptance and the
run identity instead of serializing retained execution state. Full artifacts,
raw activity, recipe exports and legacy full configuration/run reads retain
their complete data. Capacity updates use their own SSE flag and read endpoint;
ordinary run actions refresh affected views without waiting for unrelated
configuration probes. Human decision, question-context, configuration-revision,
authentication and build guards apply to every projection and mutation.

Factory role context exposes original operator answers and architecture/human
decision receipts under `/workflowExecution`. Scope extraction, coverage and
guides use an explicitly recorded name when available, otherwise
`Factory operator (name not recorded)` with the original receipt and rationale.
Missing name metadata alone does not reopen accepted scope or require a question;
an explicit task or mandatory repository rule requiring an identified approver
still applies. Runtime attribution instructions also apply to frozen workflows
without rewriting their graphs, historical decisions, digests or native sessions.
Discussion, automated review and rejection never become human acceptance.

Unanswered agent questions retain their original batch across a runtime update.
An explicit, exact-batch **Check again** request re-enters the waiting role in its
saved native conversation, retaining accepted definitions, evidence and decisions.
It is recorded separately from human answers and consumes the existing visit
budget. A request bound to the current repeated-impact blocker permits one fresh
assessment and its declared correction route; an unchanged subsequent cycle still
pauses, and missing-input questions, independent reviews and human gates remain
required. Fixers can hand a genuine architecture change back to their configured
proposal route while retaining unresolved findings for fresh review and acceptance.

Architecture candidate reviewers may return `approved: false` with concrete
`questions` when an unresolved product, privacy or architecture choice needs human
input. The saved question survives restart. An answer follows the accepted rejection
route to revise and independently review the candidate; required exact-version human
architecture acceptance remains separate. Runtime guidance covers frozen roles
without replacing their definitions or resetting iteration budgets.

When an impact assessment requires correction, fresh provider readiness cannot
skip its declared fixer merely because the provider failure cleared. The fixer
receives the current assessment's summary, rationale, uncertainty and feedback,
scoped to the same accepted workflow frame and exact saved assessment. It returns
through the existing independent assessment and required gates. Blocked assessments
retain that obligation after their assistance answer; unrelated or superseded
assessments do not revive obsolete CI work.

Delivery candidates validate their accepted execution identity, stable operation
IDs and advancing revision version while the planner can still correct output.
Legacy invalid delivery checkpoints re-enter only their existing planner →
independent reviewer → delivery gate route. The runtime never increments an accepted
contract or fabricates a review. Earlier contracts and receipts remain retained.

An already-merged PR can finish a saved terminal merge, or a repeated handoff whose
existing human gate already recorded that exact approval. Provider and approval
heads must match; any retained worktree must be clean at that head. Custom
intervening/downstream work remains required. Missing single-repository worktrees
at passive CI/handoff/review/merge checkpoints can be restored only from a retained
clean committed role revision matching both the local branch and open PR. Staged
indexes, locked/other checkouts, unsafe paths and in-flight agents/scripts block
restoration. Missing evidence, chunks, native transcripts and uncommitted work
cannot be reconstructed from a branch.

Architecture candidate plans accept up to 64 deliverables, each with at most
40 declared file operations. Large plans retain their complete runtime footprint
and normal exact-version review and acceptance. This widens schema capacity;
saved proposal contents, digests and accepted workflow definitions stay intact.
After explicit Retry, rejected architecture output is revalidated against the
current contract only on its exact clean revision. A now-valid candidate keeps
its native conversation and continues to independent review and human acceptance;
stale, dirty or invalid candidates still require normal correction.

GitHub readiness binds the current named target branch, rather than the PR's
retained base commit. Target changes during pagination invalidate the inspection;
an unavailable target cannot authorize an open delivery. Named provider targets
must still match the run's accepted branch before check coordination or ref updates.
Correction roles can
inspect exact-round retained specialist findings before aggregation completes,
including unresolved earlier findings and explicit incomplete-review blockers.
This correction context never supplies approval: independent aggregation, checks,
QA and human decisions retain their existing gates. Selected checks use the
normal twenty-minute workflow command budget instead of a shorter hidden limit.

Built-in step budgets default to 16 visits, with high-frequency built-in steps
allowing 200. Existing recognized stock steps receive an idempotent, recorded
allowance equal to their original 8/100 visits. Frozen graphs, prior extra-visit
grants, checkpoints, native conversations and human decisions remain intact;
customized step behavior and explicit custom limits retain their budgets.

New stock Factory and Takeover architecture decisions opt into `continueAccepted`.
An independent candidate review can link a complete follow-up proposal to the latest
exact human acceptance with `continuation: {proposalId, version, digest, reason}`.
The runtime verifies that receipt, source route and frozen proposal/assets before
continuing; it retains the original decision and records the link separately.
Open choices, material or uncertain changes and `approval: always` still wait.
Saved/custom graphs retain their accepted policy; no upgrade rewrites their gates.

New stock Factory and Takeover plans treat declared file operations as the expected
implementation footprint. Necessary dependency, caller, fixture, test, configuration
and documentation edits within the accepted requirements and architecture proceed
with their paths and reasons recorded in implementation checks. Omitted paths alone
do not require another approval. Explicit user/repository restrictions, non-goals,
material architecture or requirement changes and additional delivery targets retain
their authorization boundaries. Saved/custom recipes and accepted run snapshots keep
their original instructions; recovering an older file-scope wait requires explicit
operator direction through its normal answer flow.

Direct localhost dashboard/API access requires an actual loopback socket peer, an exact
configured HTTP loopback authority and same-origin browser context. IPv4 `127.0.0.1`,
IPv6 `::1` and `localhost` work without enrollment, login or a session cookie.
Mutation Origin/action/version guards, navigation/Fetch Metadata checks and media
path boundaries still apply. Forwarding headers never establish local authority;
forwarded loopback authorities are rejected. Public/TLS origins require origin-bound browser sessions established by API key sign-in.
Keys are instance credentials managed in local or signed-in remote Settings. Secrets
are shown once; rotation/removal revokes issuing sessions. Keys do not authorize
Bearer API requests. Valid legacy passkey state migrates to an empty key store,
revoking old sessions without modifying runs, integrations or native credentials. Proxies must preserve the configured public Host and Origin.
A raw port-forward or proxy that strips every forwarding signal and rewrites Host
to localhost exposes local operator authority; the worker cannot distinguish that
socket from a local process. Do not publish the local authority through such a proxy.
Local operator actions are audited as `local-operator`; authentication recovery
revokes remote sessions but does not revoke direct local filesystem/network authority.

Dashboard keys have no expiry. Browser sessions default to 12 hours; explicit Stay signed in creates a revocable no-expiry session (`expires: null`), with a browser-capped persistent cookie refreshed on access checks. Version-2 stores upgrade atomically to version 3, preserving keys and bounded sessions; older binaries cannot read version 3. Dashboard API key sign-in rotates the session cookie. The client suspends
the old live stream and cancels requests bound to the old cookie without clearing
the credential-management form. It reconnects after session verification;
connection loss, expiry and current-session rejection still clear private views.

Device code sign-in is explicitly enabled in Settings → Access by local authority
or a valid remote session. A single memory-only six-digit grant can authorize one
device within five minutes. Correct code entry creates a pending browser-bound
request; matching confirmation numbers and exact trusted approval precede any key
issuance. An independent 256-bit receiving-browser secret lives in a temporary
Secure/HttpOnly/SameSite=Strict host-only cookie, with only its hash held server-side.
Code possession, request IDs and confirmation numbers cannot collect a key alone.
Approval reserves the grant for one request; collection consumes it synchronously.
Cancellation, replacement, recovery, restart and loss of its issuing remote session
disable pending and uncollected approved requests. Receiver withdrawal and trusted
rejection are request-specific. Throttling never revokes the code; bounded per-peer
and instance request windows ignore untrusted forwarding headers. Proxy peers share
their allowance and sustained network floods can still delay pairing. Public status
exposes availability and cookie-bound own-request metadata; management requires
access. Dashboard framing is denied. HTTPS collection issues a distinct normal key,
then existing key sign-in and session behavior apply without persisting the raw key.
The version-3 digest-only store and key/session revocation remain unchanged.

Migration blocks `CYRUS_CAPACITY_DIRECTORY` and `BOBS_FACTORY_CAPACITY_DIRECTORY`
in the source `.env` or the helper's inherited environment. These overrides no
longer select a runtime pool. Reconcile custom/shared coordinator state and all
consumers explicitly, preserving policy, request identities and queue order in
the source home's `machine-capacity` directory; remove obsolete overrides from
environment files and service definitions, then regenerate the preview. The
helper validates the reconciled state before apply and relocates owned identities.

Migration validates persisted MCP JSON files and configured MCP references before
apply. External or linked files needing owned-reference changes, ambiguous relative
paths, legacy executable commands and conflicting old/new server keys require
explicit reconciliation. Migration never rewrites external MCP files or opaque
headers, environment values, tool arguments, completed receipts or review gates.
Workflow tool changes are limited to saved recipes and the run's top-level frozen
`workflow` / `workflowDefinitions`; workflow-shaped step outputs and checkpoint
outputs remain completed results, including when later steps consume them.
Singular `output` payloads in completed and rejected agent checkpoints (including
nested graph frames and Simple execution) remain opaque result data. Migration
does not rewrite their fields or interpret them as native conversation records.

Retained screenshot receipts may contain absolute paths from the source home.
QA gates and screenshot serving resolve their same-run `factory/evidence/<run-id>/`
suffix under the current home only when the copied image matches the recorded
SHA-256. Source files are never read, receipts and acceptance digests stay unchanged,
and missing copies, changed bytes, other-run paths and escaping symlinks still reject.
New capture authoring retains the strict current evidence directory boundary.

The issued egress certificate keeps its existing `cyrus-egress-ca.pem` filename
inside the new home. Migration preserves certificate/key bytes and system trust;
this retained artifact name does not enable an old command or home fallback.

Optional desktop artifacts match the complete inventory, including candidate-bound
functional validation receipts. Native builds retain public-installer validation
with controlled unsigned downloads, tied to source/version/tooling/candidate.
Release approval and actual native validation remain gates; paid Apple signing,
notarization/stapling and publisher RSA signatures/key pins are not requirements.
Complete shell updates consume hash-bound `updateArchive` and `updateMetadata`
records independently of runtime candidates. Apple Silicon packaging may retain
free local ad-hoc Mach-O signing solely for execution, without identity/keychain
access or a publisher-authentication claim. DMG/user AppImage updates require
writable ownership and a complete installed-byte match. External packages use
their owner. Preserve quarantine and require the user's per-app macOS allow action.
See [the desktop update contract](distribution/DESKTOP.md#complete-app-updates).

Accepted Linear sessions acknowledge their durable launch reservation before
ticket preflight, repository routing and dependency checks. Interactive delivery
priority is local outbox metadata, survives retries and retains shared API pacing
and provider throttle windows; historical records keep their normal priority.
Background lifecycle synchronization yields to foreground requests and reads complete comment pages, attachments,
fresh state and team information without fetching comment profiles or unrelated
assignee/project/parent context. Initial ticket and agent context reads retain
their full snapshots.

## Factory external ticket delivery

New stock planning outputs use `delivery-v1`. Clarification classifies repository,
external or mixed delivery; plan review confirms the exact contract digest.
Execution authorization (or deferral) is a separate referenced instruction.
Targets retain verified tracker coordinates, immutable IDs, URLs, complete
before-state, allowed operations, preserved relationships and criterion references.
The contract binds the accepted execution snapshot; credentials never appear in it.

`FactoryRun.delivery` retains the frozen contract, operation intent/before-state,
pending/applied/failed/uncertain/conflicted receipts and independent
`external-evidence-v1` snapshots. Snapshot digests normalize relationship ordering
and exclude lifecycle status, comments, PR links and volatile provider metadata.
Human gates/decisions retain optional delivery mode and external digest alongside
legacy Git evidence. Mixed decisions bind every exact repository revision as well.
External guides retain linked resources, applied changes, executed criteria and
limitations without inventing files, Git SHAs or screenshots.

External completion requires independent verification, explicit acceptance and a
fresh matching state check. Mixed delivery also requires provider-confirmed merges.
Delayed Done synchronization rechecks external state without replaying mutations.
Read failures and drift block closure. Review guides show pending ticket synchronization
and its error even after work is accepted; completion notices distinguish approved
work from unfinished tracking. Requested changes preserve applied work and
return through reviewed planning and reconciliation. Contract changes advance their
version, preserve previous contracts/receipts and invalidate affected acceptance.
Conflicted retries retain the reviewed baseline; observed intervening state never
authorizes an overwrite. Successful relationship operations reconcile both ticket
endpoints within the tracker scope. Mixed feedback before merge renews the plan
and external contract before repository corrections resume. After grouped merges,
external reacceptance runs once and binds all retained repository revisions.

Existing saved definitions remain readable and frozen. Authenticated external
recovery creates a separate `recoveryWorkflow` overlay and `deliveryRecovery` audit
record, retaining the original definition, checkpoint and history. It starts with
current-state reconciliation/verification, never replaying historical mutations.
See [the operator procedure](factory/external-delivery.md).

`externalReverifications` audits explicit operator transitions after delayed
external completion fails. The retained verification overlay resumes independent
reads and a fresh human gate, supersedes stale completion receipts and preserves
all applied work and confirmed merges. Tracking-only retries never start that
execution transition.

## Factory operator setup and recovery

Factory operator setup and recovery contracts are documented in
[factory-operator-mcp.md](factory-operator-mcp.md). Operator grants do not approve
review or merge; profile MCP repairs apply only to future accepted snapshots.
Listener errors identify the instance and requested run (when
supplied), with sanitized context and recovery guidance. Overlapping connection
edits return `stale_configuration`; overlapping run actions return `stale_state`.

## Host Git identity and SSH agent

Settings → Identity profiles → Host Git identity saves an optional instance socket in `<factoryHome>/factory/git-settings.json`.
The saved socket overrides inherited `SSH_AUTH_SOCK` for host Git commands, worktree
preparation/hooks and new host agent sessions. It is read for subsequent commands
and retained-run retries without restarting the worker. Clearing it restores the
inherited agent. Running child processes retain their launch environment.

Host and explicit identity bindings share an SSH agent selector that shows detected
Bitwarden/1Password sockets and tests connectivity/key availability. Host settings
also show the effective source. Custom paths are absolute or `~/` paths
on the Factory machine; saving requires an existing socket. Only the socket path is
stored. Native keys, Git signing policy, repository accounts and credential stores
stay unchanged. Explicit execution environments keep their declared bindings;
profiles using shared host signing use the instance agent. Saving never retries a
run or approves publication automatically. After repairing access, use the failed
run’s **Retry step** action. An agent connection test does not sign a commit or
establish that a particular signing key is unlocked.

## Storage retention

Settings → Storage and the protected `bobs-factory storage` service commands share
one per-instance coordinator. Versioned policy, producer ownership, identity-bound
historical elections, workspace reservations and compact deletion receipts live in
`<factoryHome>/storage-retention`, outside frozen workflows and state snapshots.
Defaults are automatic startup/daily reconciliation, two verified usable rollbacks
(minimum one), seven-day disposable artifacts, thirty-day delivered worktrees and
a five-GiB warning threshold. Preservation overrides age, count and disk pressure.

Cleanup uses process-start-aware exclusion, durable use before provider execution,
fresh accepted-provider delivery checks, complete owner/reference checks and safe
Git removal. Symlinked owned roots, changed identity, unique ignored files, native
continuation uncertainty and protected group members retain data. Ticket closure
only requests reconciliation; the legacy deletion API defers to Storage. Artifact
manifest verification and usage scans yield with continuation. Cleanup verifies
rollback runtimes, scans dependencies across every retained run and evidence link,
and detaches verified artifacts into private quarantine before removal. Completed
workflow role-session identities and review history alone do not retain a delivered
workspace; Simple conversations and unfinished native checkpoints still do.
Historical preparation/recovery elections require exact current-state comparisons;
new committed migration preparation enrolls only reconciled state/factory copies
under shared claims, keeping source/native/external backups protected. Interrupted
enrollment resumes on migration retry after validating and completing its saved
ownership publication intent, record, path index, inventory page and count. Changed
identities or conflicting records preserve the unfinished marker and all data.
Runtime-owned workspace identities and exact saved command receipts remain
historical only at configured workflow locations associated with the owning run.
Inspection validates each loaded record during traversal, so restored paged
history preserves these semantics without requiring stable cached object identities.
Copied snapshot digests, copied receipts in arbitrary outputs and descendant file
references still protect their content. Historical
run dependencies and every grouped parent entry are checked before removal;
concurrent replacement files survive failed leaf verification. Failed or uncertain
hooks need explicit verified idempotent retry. Receipts and original evidence stay
retained. Apparent bytes and observed volume free-space changes remain separate.
See [storage retention](factory/storage-retention.md) for limits and recovery.

Capacity lock acquisition retries transient symlink replacement/removal within its
existing deadline. It still verifies live ownership before admission and refuses
unexpected regular files occupying a lock path.
