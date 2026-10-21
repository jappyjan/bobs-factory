/**
 * Prompt Assembly Tests - Routing Context Generation
 *
 * Tests the routing context generation for orchestrator multi-repository scenarios.
 *
 * IMPORTANT: These tests assert the ENTIRE prompt, not partial checks with .toContain().
 * This ensures comprehensive test coverage and catches regressions in prompt structure.
 */

import { describe, it } from "vitest";
import { createTestWorker, scenario } from "./prompt-assembly-utils.js";

describe("Prompt Assembly - Routing Context", () => {
	it("should not include routing context for single-repository setup", async () => {
		const repository = {
			id: "repo-single-123",
			name: "Single Repo",
			repositoryPath: "/test/single-repo",
			workspaceBaseDir: "/test/workspace",
			linearWorkspaceId: "test-workspace-1",

			baseBranch: "main",
			githubUrl: "https://github.com/org/single-repo",
			routingLabels: ["backend"],
			teamKeys: ["BACK"],
			labelPrompts: {
				orchestrator: { labels: ["Orchestrator"] },
			},
		};

		const worker = createTestWorker([repository]);

		const session = {
			issueId: "issue-123",
			workspace: { path: "/test" },
			metadata: {},
		};

		const issue = {
			id: "issue-123",
			identifier: "BACK-100",
			title: "Single repo orchestration",
			description: "Test issue",
		};

		await scenario(worker)
			.newSession()
			.assignmentBased()
			.withSession(session)
			.withIssue(issue)
			.withRepository(repository)
			.withUserComment("Orchestrate this task")
			.withLabels("Orchestrator")
			.expectUserPrompt(`<git_context>
<repository>Single Repo</repository>
<base_branch>main</base_branch>
</git_context>

<linear_issue>
<id>issue-123</id>
<identifier>BACK-100</identifier>
<title>Single repo orchestration</title>
<description>Test issue</description>
<url></url>
<assignee>
<linear_id></linear_id>
<linear_display_name></linear_display_name>
<linear_profile_url></linear_profile_url>
<github_username></github_username>
<github_user_id></github_user_id>
<github_noreply_email></github_noreply_email>
</assignee>
</linear_issue>

<workspace_context>
<teams>

</teams>
<labels>

</labels>
</workspace_context>

<user_comment>
Orchestrate this task
</user_comment>`)
			.expectSystemPrompt(undefined)
			.expectPromptType("label-based")
			.expectComponents("issue-context", "user-comment")
			.verify();
	});

	it("should include routing context for multi-repository setup", async () => {
		const frontendRepo = {
			id: "repo-frontend-123",
			name: "Frontend App",
			repositoryPath: "/test/frontend",
			workspaceBaseDir: "/test/workspace",
			linearWorkspaceId: "test-workspace-2",

			baseBranch: "main",
			githubUrl: "https://github.com/myorg/frontend-app",
			routingLabels: ["frontend", "ui"],
			teamKeys: ["FE"],
			labelPrompts: {
				orchestrator: { labels: ["Orchestrator"] },
			},
		};

		const backendRepo = {
			id: "repo-backend-456",
			name: "Backend API",
			repositoryPath: "/test/backend",
			workspaceBaseDir: "/test/workspace",
			linearWorkspaceId: "test-workspace-2",

			baseBranch: "main",
			githubUrl: "https://github.com/myorg/backend-api",
			routingLabels: ["backend", "api"],
			teamKeys: ["BE"],
			projectKeys: ["API Project"],
		};

		const worker = createTestWorker([frontendRepo, backendRepo]);

		const session = {
			issueId: "issue-456",
			workspace: { path: "/test" },
			metadata: {},
		};

		const issue = {
			id: "issue-456",
			identifier: "FE-200",
			title: "Cross-repo feature",
			description: "Add feature spanning frontend and backend",
		};

		await scenario(worker)
			.newSession()
			.assignmentBased()
			.withSession(session)
			.withIssue(issue)
			.withRepository(frontendRepo)
			.withUserComment("Orchestrate this cross-repo feature")
			.withLabels("Orchestrator")
			.expectUserPrompt(`<git_context>
<repository>Frontend App</repository>
<base_branch>main</base_branch>
</git_context>

<linear_issue>
<id>issue-456</id>
<identifier>FE-200</identifier>
<title>Cross-repo feature</title>
<description>Add feature spanning frontend and backend</description>
<url></url>
<assignee>
<linear_id></linear_id>
<linear_display_name></linear_display_name>
<linear_profile_url></linear_profile_url>
<github_username></github_username>
<github_user_id></github_user_id>
<github_noreply_email></github_noreply_email>
</assignee>
</linear_issue>

<workspace_context>
<teams>

</teams>
<labels>

</labels>
</workspace_context>

<repository_routing_context>
<description>
When creating sub-issues that should be handled in a DIFFERENT repository, use one of these routing methods.

**IMPORTANT - Routing Priority Order:**
The system evaluates routing methods in this strict priority order. The FIRST match wins:

1. **Description Tag (Priority 1 - Highest, Recommended)**: Add \`[repo=repo-name]\` to the sub-issue description.
   - Multiple repos: \`[repo=repo1]\` and \`[repo=repo2]\`, or \`repos=repo1,repo2\`
   - Base branch override: \`[repo=repo-name#branch-name]\` to target a specific branch instead of the default
   - Unbracketed syntax also works: \`repo=repo-name\` or \`repo=repo-name#branch\`
   - Agent selector: \`[agent=claude|gemini|codex|cursor|opencode]\` to choose the execution harness
   - Linear label selector: \`<provider>/<model>\` (for example \`openai/gpt-5.5\`) to choose both harness and model. For OpenCode, use \`opencode/<provider>/<model>\` (for example \`opencode/openai/gpt-5.5\`).
2. **Routing Labels (Priority 2)**: Apply a label configured to route to the target repository.
3. **Project Assignment (Priority 3)**: Add the issue to a project that routes to the target repository.
4. **Team Selection (Priority 4 - Lowest)**: Create the issue in a Linear team that routes to the target repository.

Repository selection applies to every workflow, including Factory, Takeover and Simple. A shared routing label selects every configured repository with that label. The accepted scope stays fixed through follow-ups and recovery. Grouped Factory delivery creates and reviews a PR or merge request in each changed repository; unchanged repositories remain context, approval binds every delivered revision, and completion requires all deliveries to merge.

For reliable cross-repository routing, prefer Description Tags as they are explicit and unambiguous.

Current workflow launch behavior (capability reference): The manual launcher selects its project in the heading and shows declared workflow inputs and attachment chips inside a chat-style prompt composer whose bottom controls choose the recipe, agent, reasoning and run settings. New stock Factory, Takeover and Simple definitions declare an optional files attachment field. Custom workflows accept uploads only when they declare files fields. Uploads accept any file type with limits of 10 files, 25 MiB each and 100 MiB total; the guarded binary API stages private immutable assets outside worktrees, claims them once for a run and exposes launchAttachments manifests with canonical readable paths through role/tool/script context and Simple instructions. Drafts expire after 24 hours; claimed files remain available across retries and restarts while persisted runs reference them. Relevant plan assets enter architecture approval snapshots. Existing saved/frozen workflow definitions remain unchanged. Machine selection is deferred to BOBS-84. All production entry points use one runtime. Settings → Ticket managers configures Linear OAuth, signed webhook intake and project workspace routing, plus Taskbot MCP connections. Each manager can be enabled or disabled live. Disabled managers pause ticket intake and runtime tracking while preserving existing work, credentials and pending publication; provider retries govern missed incoming events. Standalone work remains available. Existing project Taskbot MCP transports and tool permissions remain binding. Factory roles receive runtime-owned /workflowExecution context describing the accepted frozen graph and recorded decisions. Current recipes and repository code do not add gates to saved runs; automated plan-review approval remains distinct from human acceptance, and actual required gates and task restrictions remain binding. QA criterion provenance is saved during capture finalization before review hashes are generated; gates validate it without rewriting original evidence. Chapter reading progress binds every repository revision and validates saved scope before restoration; secondary repository changes reset uncertain progress even when the primary revision and guide are unchanged. Normal browser navigation cancels protected requests and ignores their late failures so reviewed chapter progress survives reload; genuine connection or access loss still clears private state. Grouped delivery feedback fingerprints every repository receipt, and comment assessments bind repository identity to provider comment IDs. New stock Factory and Takeover runs check in with the human after drafting the plan: a versioned check-in (briefVersion 2) restates the goal, sketches what people experience before and after, names who will notice, asks for judgment only on uncertain calls, states size and exclusions, and keeps the complete review brief as Bob’s notes. Reactions to individual points become one change request; asking for changes on a pending stock review-v1 proposal adopts the check-in prompt. Meaningful choices require explicit acceptance of the exact proposal, candidate plan and snapshotted assets before implementation. Routine work records a bypass reason. Discussion and explanation never authorize implementation; feedback regenerates a freshly reviewed version. Recipes edits execution preferences for the bundled proposal role; fork Factory or Takeover to change proposal prompts or approval policy for new launches. Frozen active runs and customized legacy planning paths remain unchanged. Independent child delivery remains separate planned work. Background ticket synchronization retains external completion proof during rereads, invalidates it on drift or failed reads and never closes a ticket without fresh state checks. Completed external or mixed runs whose ticket synchronization loses state proof offer authenticated Reverify ticket changes. This audited action retains applied work and merges, retires stale completion receipts, resumes only independent verification and requires renewed explicit acceptance; tracking-only retry never executes it automatically. New stock Factory delivery-v1 contracts classify repository, external or mixed delivery during clarification and plan review, separately from execution authorization. External ticket content/relationship work uses configured Linear/Taskbot integrations, persisted before-state/intents, safe retry reconciliation, independent complete-state verification, snapshot-bound human acceptance and a final state check. External work bypasses publication, code-diff fanout, CI and merge; repository safeguards remain. Mixed work requires external proof and every confirmed repository merge. Lifecycle status/comments and PR links remain runtime-owned and excluded from external fingerprints. Done synchronization rechecks external evidence; tracking-only retries do not replay task work. Saved definitions remain frozen; authenticated reviewed recovery of an idle failed draft-pr run verifies already-applied external work before a new human gate and preserves original history/checkpoint/conversations. Every workflow accepts the same retained repository scope. Repositories with identical nonempty routing-label sets appear as one project in the manual composer; shared labels route issues to all matching repositories. Manual launches may pass repositoryIds alongside the primary repositoryId. A grouped workspace contains one worktree per repo. Factory and Takeover publish and review one PR/MR per changed repository, preserve per-repo delivery receipts through retries, bind human approval to every exact URL/head, and complete only after all delivered revisions are confirmed merged. Unchanged repos remain context. Custom scripts/exec run once in the shared workspace with FACTORY_REPOSITORIES and tool input repositories exposing the scope. Factory publication, takeover, CI readiness, handoff and SHA-guarded merge use the repository Git provider. GitHub and GitLab (including explicit self-managed hosts) are built in; other hosts use repositories[].gitProvider custom executable adapters. Public hosts and existing githubUrl/gitlabUrl fields auto-detect. Unknown hosts require explicit provider selection. Runs retain accepted provider coordinates/adapter on retry and recovery. GitHub delivery uses the built-in REST/GraphQL client; the GitHub CLI is optional. Local first launch opens guided project/installed-agent selection without enrollment or login. Direct HTTP loopback dashboard and API access requires an actual loopback socket peer, exact loopback authority and same-origin browser context; forwarding headers never grant access. Remote HTTPS origins retain separate origin-bound browser sessions established with API keys. Connect GitHub in protected Project setup to save a private token for API delivery and managed Git authentication; explicit execution profiles retain their accepted repository-scoped credential bindings. For token-free API requests from agent commands, save a JSON request containing method, path and optional body, then run bobs-factory github-api --repo <selected GitHub repository URL> --request <request file>. Native Git/SSH/forge credential stores remain host-owned. Human approval and provider-confirmed merge still gate completion. Handoff routes unresolved guide requirements and delivery gaps through the configured fixer, rebuilds the guide and rechecks readiness. Repeated unresolved gaps at an unchanged revision wait for specific assistance; an answer does not waive scope or approve delivery. Runtime coordinates finalization of overlapping repository/base scopes after publication while implementation remains parallel; assistance and human waits release admission. Runtime supervises queued CI and bounded retries of concretely identified infrastructure failures without holding an agent; unknown failures still require diagnosis. Review results explicitly declare completed, blocked or failed: an empty findings list alone cannot approve. Scoped context tools expose applied limits and pagination; large role outputs can submit validated revision-bound artifacts. Run provenance identifies actual runtime/workflow/contract/instruction receipts and preserves unknown historical identity. Newly authored technical/mixed review guides require whole-PR scope classification, 3–6 system-map lanes and chapter part links; only evidenced purely visual scope is exempt. Saved older guides remain readable. New stock review guides use brief-v3: a colleague-style show & tell story (checklist, before/after, measured chart, screenshot, video and point slides, then the brief's decisions, limits and side effects), followed by Dig deeper tabs: plain-language flows linked to code lines, a code tour of the whole diff in reading order with notes pinned to lines, tests under the files they test and reformatting collapsed, plain checks with the recorded values on demand, and the choices made. Regenerating a pending stock guide adopts the current brief-v3 prompt while keeping its agent settings; custom guide prompts stay unchanged; brief-v1 and brief-v2 guides stay readable. New stock Factory/Takeover runs support video-v1: select up to three authentic headless demonstrations when useful, validate media and revision provenance including linked QA story definitions, inspect playback, then embed accepted clips lazily with transcripts in guides and inspector. Optional recording failures remain limitations; explicit required recordings stay blocked. Legacy/frozen runs and custom recipes opt in only explicitly. Videos supplement screenshots and fresh QA; human approval remains required. Media is loopback-only and bounded (120 seconds/50 MiB per clip; 512 MiB per run), with startup cleanup of current and historical capture assets for terminal runs after 30 days and abandoned temporary files after 24 hours. Browser installation and help controls are hidden in the native desktop app using its existing window.factoryDesktop bridge. The review reader keeps item commenting throughout and collects feedback, additional feedback and page-level PR/diff actions on Decide, reached through the sticky feedback count. Direct HTTP localhost dashboard access requires a validated loopback socket peer, loopback Host and same-origin browser context, without key setup or login. Remote HTTPS addresses require origin-bound browser sessions established with API keys. Empty remote stores require first-key creation in localhost Settings. Local users and signed-in remote users can add, remove and rotate keys; secrets are shown once. Rotation/removal revokes issuing sessions, including the current session. Keys do not authenticate direct Bearer API requests. Legacy passkey state migrates to an empty key store and revokes old sessions. Provider webhooks and OAuth use their separate listener. Explicitly stopped runs with saved progress offer individual Resume; bringing them back only restores visibility, and disabled workflows must be re-enabled before any continuation. New stock Factory and Takeover runs extract a versioned requirement inventory before six independently configurable specialist reviewers run through fanout. Coverage-required fanout needs exactly one coverage-v1 supplier; replace it explicitly before removing it. Reviewers share a runtime-frozen clean revision and context baseline; incomplete or stale results cannot approve. Called workflows retain their review association in parent guides, QA, subsequent fanout branches and approval steps across restart; QA uses configured aggregate provenance even when gates are renamed. Settled findings require fresh evidence to reopen across intervening omissions. Recipes edits affect new launches; accepted runs and customized legacy reviewers keep their frozen contracts. New workflow steps default to sixteen visits, with stock coordination steps bounded at 200. Restoring unfinished saved stock work adds one versioned allowance that doubles recognized original step budgets from 8/100 to 16/200 without changing its frozen graph, completed evidence, explicit additional passes or human decisions. Customized steps and local recipes retain their budgets; failed runs still require individual Retry and stopped runs upgrade only on explicit Resume. New stock Factory/Takeover repository runs use impact-v1: one configurable independent assessment selects affected configured specialists, discovered checks and QA criteria, records explicit original-evidence reuse and tracks downstream obligations at their own gates. Initial acceptance retains complete configured coverage. Source, scope, dependency, fixture, environment, findings or target drift invalidates reuse. Review receipts keep original execution stamps. Relevant target overlap or unavailable combined-tree evidence requires integration or investigation; unrelated target advancement can preserve proven independent evidence. Optional findings and optional disagreements stay nonblocking; consequential findings need evidence, a requirement or mandatory rule, consequence and remedy. Configured unchanged-cycle limits default to three and enter assistance without approving or merging. Frozen/custom workflows retain conservative behavior unless explicitly opted in. Executable QA and screenshots remain required. A prior explicit approval can continue for independently assessed safe minor cumulative corrections, including production code, only after all required checks and evidence pass. Meaningful or uncertain changes, rejection, failed checks and consequential disputes require renewed approval. Continuation retains the original human decision and separately binds the current exact repository delivery revisions; fresh provider readiness and SHA-guarded confirmed merge remain required. Refinement questions support questionChoices with single or multiple selection, optional preselected option IDs and a separate custom-text alternative in both web and terminal interfaces. Defaults never submit answers; blank custom answers cannot fall back to defaults. Changed choice contracts invalidate stale batches. Legacy refinement questions can include generated questionRecommendations with zero-based questionIndex, answer and evidence-based reason. The dashboard selects suggestions by default and provides a separate blank Custom answer field. Recommendations require explicit Send answers submission or a ticket reply; they never automatically authorize work. Legacy questions without metadata use blank text fields. Changed questions or recommendations notify the originating ticket once per batch; unchanged restored waits retain notification deduplication. Factory manual launches accept an originating Linear or Taskbot ticket URL as the prompt or explicit ticket source. The runtime fetches complete ticket context, retains verified tracker identity through roles and follow-ups, and owns publication and PR links. Native Linear routine progress, tool failures and role outcomes use transcript thoughts. Necessary lifecycle and input activities retain native types and automatic threaded comments under the accepted publication exception. Confirmed delivery documentation uses one native completion response; durable decisions remain explicit issue comments. Factory role results are presented only after parsing, artifact resolution and validation; raw messages and rejected outputs remain local. Decision comments contain accepted answers and rationale without serialized clarification history. Successful tool chatter and unchanged check states are suppressed; actionable failures remain readable. Legacy queued content is presented before sending and uncertain writes reconcile original content first. Status and PR links do not depend on comment publication. Taskbot retains milestone comments. Missing manual Linear transcript configuration leaves delivery visibly pending. Coding tickets stay nonterminal during work, In Review awaiting human/provider action, and Done only after provider-confirmed merge. Ticket synchronization failures remain visible in run activity and ticketSync receipts; retry only tracking through POST /api/runs/:id/ticket-sync after restoring access or reassessing conflicts. Simple retains its native tracking lifecycle. Factory supports opt-in Web Push through Settings → Notifications for new questions, review revisions, human-only blockers, failures needing help and successful completions. Enable and test each browser device explicitly; remote disable never auto-enables. Rephrasing a pending decision does not create a new question notification. VAPID subscriptions and consumed transition receipts survive restart. Only fresh transitions are attempted, with TTL zero and no replay after enablement, outage or recovery; provider acceptance does not prove display. Notification text is minimal; clicks refresh protected run/review state before actions. Configure the push contact in Settings → Notifications; saved contact updates apply immediately without changing keys or device consent. BOBS_FACTORY_FACTORY_PUSH_SUBJECT remains an optional first-start bootstrap; saved push state takes precedence. For the trusted HTTPS proxy, configure the exact BOBS_FACTORY_FACTORY_ORIGIN; physical-device background delivery remains unverified. Workflow selection is separate from repository routing. Execution identity and tool profiles are independent choices in Settings and the manual composer/API. Settings has separate pages for local access and remote API keys, execution defaults, identity profiles, tool profiles, Notifications, instance capacity and run titles; Recipes manages workflows and launch permissions. Unsent browser choices and Settings edits belong to the current form and clear on navigation, relevant configuration changes, reloads and updates; explicitly saved settings and accepted run snapshots persist. Each choice resolves manual override, repository default, factory default, then Legacy. Explicit profiles require declared tool sources and authentication bindings for every workflow provider and the title agent; Claude/Codex native-login Share binds an existing configuration root and account email with Share tools. Other combinations require API credentials. Capability checks inspect the actual runner executable; binary installations use prepared Claude/Codex launchers and the configured Cursor SDK/Node paths, including in private environments. Unsupported tool versions, native settings including Codex notification commands, or missing bindings reject before setup. Existing runs, nested roles, Simple, title jobs, follow-ups and recovery retain accepted snapshots. Use credential references only, never literal secrets. Native subscription login remains available in Legacy and eligible explicit Claude/Codex Share profiles; isolated native cache migration is unsupported. Stock workflow labels are workflow:factory (or factory), workflow:takeover (or takeover), and workflow:simple; operators can customize labels in Recipes. New launches select an explicit manual UI/API workflow choice, then [workflow=<id>] in the original triggering comment, then the issue description, then the first matching workflow in configured label order, then the single saved default. Escaped brackets are supported. Quoted text and code examples are ignored; repeated identical selectors are valid, but malformed or conflicting selectors in the winning source reject without fallback. Higher-priority sources override lower-source conflicts. New mention-created sessions on an active issue reject temporarily pending #36; reply to the existing session for steering or answers. Explicitly settled finished runs release ticket ownership, including historical stopped sessions; resumed execution and background work still retain ownership. The selected workflow must allow ticket-assignment for assignments or @mentions, manual for new UI/API or follow-up launches, and workflow for nested calls. A disallowed selection is rejected without fallback; enable its permission in Recipes, change the selection/label, or choose an eligible default. Existing runs retain their accepted definitions; replies and resume do not select a new workflow. Use these supported launch methods when starting work. Waiting agent questions can be explicitly reassessed after changed conditions through Check again in Factory, c check again in the terminal, or the operate-scoped recheck_run operator tool. This resumes the retained role without supplying an answer, granting iterations or approving work; human decision gates remain separate. When the task requests changes to this product, evaluate the proposed behavior against the task's requirements and accepted decisions, within your assigned role. Missing current capabilities are implementation work, not a conflict with these instructions; update the capability reference alongside an implemented behavior change. Explicit task restrictions such as planning-only or deferred implementation still apply.
</description>

<available_repositories>
  <repository name="Frontend App" (current)>
    <github_url>https://github.com/myorg/frontend-app</github_url>
    <gitlab_url>N/A</gitlab_url>
    <routing_methods>
    - Description tag: \`[repo=myorg/frontend-app]\` or \`[repo=myorg/frontend-app#branch]\` for base branch override
    - Routing labels: "frontend", "ui"
    - Team keys: "FE" (create issue in this team)
    </routing_methods>
  </repository>
  <repository name="Backend API">
    <github_url>https://github.com/myorg/backend-api</github_url>
    <gitlab_url>N/A</gitlab_url>
    <routing_methods>
    - Description tag: \`[repo=myorg/backend-api]\` or \`[repo=myorg/backend-api#branch]\` for base branch override
    - Routing labels: "backend", "api"
    - Team keys: "BE" (create issue in this team)
    - Project keys: "API Project" (add issue to this project)
    </routing_methods>
  </repository>
</available_repositories>
</repository_routing_context>

<user_comment>
Orchestrate this cross-repo feature
</user_comment>`)
			.expectSystemPrompt(undefined)
			.expectPromptType("label-based")
			.expectComponents("issue-context", "user-comment")
			.verify();
	});

	it("should exclude inactive repositories from routing context", async () => {
		const activeRepo = {
			id: "repo-active-123",
			name: "Active Repo",
			repositoryPath: "/test/active",
			workspaceBaseDir: "/test/workspace",
			linearWorkspaceId: "test-workspace-3",

			baseBranch: "main",
			githubUrl: "https://github.com/org/active-repo",
			isActive: true,
			labelPrompts: {
				orchestrator: { labels: ["Orchestrator"] },
			},
		};

		const inactiveRepo = {
			id: "repo-inactive-456",
			name: "Inactive Repo",
			repositoryPath: "/test/inactive",
			workspaceBaseDir: "/test/workspace",
			linearWorkspaceId: "test-workspace-3",

			baseBranch: "main",
			githubUrl: "https://github.com/org/inactive-repo",
			isActive: false,
		};

		const worker = createTestWorker([activeRepo, inactiveRepo]);

		const session = {
			issueId: "issue-789",
			workspace: { path: "/test" },
			metadata: {},
		};

		const issue = {
			id: "issue-789",
			identifier: "TEST-300",
			title: "Test inactive filtering",
			description: "Should not show inactive repo",
		};

		// Only one active repo means no routing context (same as single-repo case)
		await scenario(worker)
			.newSession()
			.assignmentBased()
			.withSession(session)
			.withIssue(issue)
			.withRepository(activeRepo)
			.withUserComment("Check routing context")
			.withLabels("Orchestrator")
			.expectUserPrompt(`<git_context>
<repository>Active Repo</repository>
<base_branch>main</base_branch>
</git_context>

<linear_issue>
<id>issue-789</id>
<identifier>TEST-300</identifier>
<title>Test inactive filtering</title>
<description>Should not show inactive repo</description>
<url></url>
<assignee>
<linear_id></linear_id>
<linear_display_name></linear_display_name>
<linear_profile_url></linear_profile_url>
<github_username></github_username>
<github_user_id></github_user_id>
<github_noreply_email></github_noreply_email>
</assignee>
</linear_issue>

<workspace_context>
<teams>

</teams>
<labels>

</labels>
</workspace_context>

<user_comment>
Check routing context
</user_comment>`)
			.expectSystemPrompt(undefined)
			.expectPromptType("label-based")
			.expectComponents("issue-context", "user-comment")
			.verify();
	});

	it("should only include repositories from the same workspace", async () => {
		const workspace1Repo = {
			id: "repo-ws1-123",
			name: "Workspace 1 Repo",
			repositoryPath: "/test/ws1",
			workspaceBaseDir: "/test/workspace",
			linearWorkspaceId: "workspace-1",

			baseBranch: "main",
			githubUrl: "https://github.com/org/ws1-repo",
			labelPrompts: {
				orchestrator: { labels: ["Orchestrator"] },
			},
		};

		const workspace2Repo = {
			id: "repo-ws2-456",
			name: "Workspace 2 Repo",
			repositoryPath: "/test/ws2",
			workspaceBaseDir: "/test/workspace",
			linearWorkspaceId: "workspace-2",

			baseBranch: "main",
			githubUrl: "https://github.com/org/ws2-repo",
		};

		const worker = createTestWorker([workspace1Repo, workspace2Repo]);

		const session = {
			issueId: "issue-999",
			workspace: { path: "/test" },
			metadata: {},
		};

		const issue = {
			id: "issue-999",
			identifier: "WS1-100",
			title: "Workspace isolation test",
			description: "Should not show other workspace repos",
		};

		// Only one repo in this workspace means no routing context
		await scenario(worker)
			.newSession()
			.assignmentBased()
			.withSession(session)
			.withIssue(issue)
			.withRepository(workspace1Repo)
			.withUserComment("Check workspace isolation")
			.withLabels("Orchestrator")
			.expectUserPrompt(`<git_context>
<repository>Workspace 1 Repo</repository>
<base_branch>main</base_branch>
</git_context>

<linear_issue>
<id>issue-999</id>
<identifier>WS1-100</identifier>
<title>Workspace isolation test</title>
<description>Should not show other workspace repos</description>
<url></url>
<assignee>
<linear_id></linear_id>
<linear_display_name></linear_display_name>
<linear_profile_url></linear_profile_url>
<github_username></github_username>
<github_user_id></github_user_id>
<github_noreply_email></github_noreply_email>
</assignee>
</linear_issue>

<workspace_context>
<teams>

</teams>
<labels>

</labels>
</workspace_context>

<user_comment>
Check workspace isolation
</user_comment>`)
			.expectSystemPrompt(undefined)
			.expectPromptType("label-based")
			.expectComponents("issue-context", "user-comment")
			.verify();
	});

	it("generateRoutingContextForAllWorkspaces should include routing contexts for each multi-repo workspace", () => {
		const workspace1RepoA = {
			id: "repo-ws1-a",
			name: "Workspace One App",
			repositoryPath: "/test/ws1/app",
			workspaceBaseDir: "/test/workspace",
			linearWorkspaceId: "workspace-1",

			baseBranch: "main",
			githubUrl: "https://github.com/org/ws1-app",
			labelPrompts: {
				orchestrator: { labels: ["Orchestrator"] },
			},
		};

		const workspace1RepoB = {
			id: "repo-ws1-b",
			name: "Workspace One API",
			repositoryPath: "/test/ws1/api",
			workspaceBaseDir: "/test/workspace",
			linearWorkspaceId: "workspace-1",

			baseBranch: "main",
			githubUrl: "https://github.com/org/ws1-api",
			labelPrompts: {
				orchestrator: { labels: ["Orchestrator"] },
			},
		};

		const workspace2RepoA = {
			id: "repo-ws2-a",
			name: "Workspace Two Service",
			repositoryPath: "/test/ws2/service",
			workspaceBaseDir: "/test/workspace",
			linearWorkspaceId: "workspace-2",

			baseBranch: "main",
			githubUrl: "https://github.com/org/ws2-service",
			labelPrompts: {
				orchestrator: { labels: ["Orchestrator"] },
			},
		};

		const workspace2RepoB = {
			id: "repo-ws2-b",
			name: "Workspace Two Worker",
			repositoryPath: "/test/ws2/worker",
			workspaceBaseDir: "/test/workspace",
			linearWorkspaceId: "workspace-2",

			baseBranch: "main",
			githubUrl: "https://github.com/org/ws2-worker",
			labelPrompts: {
				orchestrator: { labels: ["Orchestrator"] },
			},
		};

		const worker = createTestWorker([
			workspace1RepoA,
			workspace1RepoB,
			workspace2RepoA,
			workspace2RepoB,
		]);

		const promptBuilder = (worker as any).promptBuilder as {
			generateRoutingContextForAllWorkspaces: () => string;
		};
		const context = promptBuilder.generateRoutingContextForAllWorkspaces();

		expect(context.match(/<repository_routing_context>/g)?.length || 0).toBe(2);
		expect(context).toContain("Workspace One App");
		expect(context).toContain("Workspace Two Service");
		expect(context).toContain("`[repo=org/ws1-app]`");
		expect(context).toContain("`[repo=org/ws2-service]`");
	});
});
