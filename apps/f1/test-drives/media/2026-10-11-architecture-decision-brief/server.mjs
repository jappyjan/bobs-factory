// Local browser fixture for the architecture proposal page. Build edge-worker first,
// run with node, then open http://localhost:3994 with cookie factory-local-session=fixture-session.
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dist = new URL(
	"../../../../../packages/edge-worker/dist/factory",
	import.meta.url,
).pathname;
const { WorkflowRuntime } = await import(`${dist}/WorkflowRuntime.js`);
const { FactoryServer } = await import(`${dist}/FactoryServer.js`);

const part = (id, label, note, detail, area, status, file) => ({
	id,
	label,
	note,
	detail,
	area,
	status,
	...(file ? { file } : {}),
});
function jira(version) {
	const v2 = version > 1;
	return {
		architectureContract: "architecture-v1",
		classification: "meaningful",
		rationale: "Adds a new outside service and a new place to keep secrets.",
		title: "Add Jira support next to Taskbot",
		summary:
			"When a run starts from a Jira issue, Bob keeps that issue up to date. It moves the status, links the PR and leaves a final comment.",
		changes: v2
			? [
					{
						text: "Jira comments come later. A reminder ticket was added.",
						from: "you",
					},
					{
						text: "The Jira token is now kept in the system keychain.",
						from: "you",
					},
					{
						text: "Linux servers without a keychain can use an environment variable.",
						from: "bob",
					},
				]
			: [],
		decisions: [
			{
				id: "where",
				question: "Where should the Jira code live?",
				status: "decided",
				pick: "adapter",
				decidedBy: "bob",
				options: [
					{
						id: "adapter",
						name: "Next to the Taskbot code",
						upside: "Same pattern Bob already uses.",
						catch: "Bob keeps a small Jira client.",
					},
					{
						id: "mcp",
						name: "Use Atlassian’s MCP server",
						upside: "Less code.",
						catch:
							"Everyone must log in through a browser, so background runs break.",
						preview: {
							parts: [
								part(
									"mcp",
									"Atlassian MCP",
									"browser login per person",
									"Atlassian’s server; each person logs in through a browser.",
									"adapters",
									"outside",
								),
							],
							links: [
								{ from: "tracking", to: "mcp" },
								{ from: "mcp", to: "jira", label: "login" },
							],
							hide: ["jiraC"],
						},
					},
					{
						id: "package",
						name: "A new separate package",
						upside: "Ready for two-way sync later.",
						catch: "Much more to build than we need now.",
					},
				],
			},
			{
				id: "status",
				question: "How does Bob pick the right Jira status?",
				status: "decided",
				pick: "map",
				decidedBy: "bob",
				options: [
					{
						id: "map",
						name: "You map them once per project",
						upside: "Works even if your team renamed its statuses.",
						catch: "A minute of setup.",
					},
					{
						id: "guess",
						name: "Bob guesses from the names",
						upside: "No setup.",
						catch: "Quietly breaks when statuses have custom names.",
						preview: { parts: [], links: [], hide: ["settings"] },
					},
				],
			},
			v2
				? {
						id: "comments",
						question: "Should Jira comments reach Bob while it works?",
						status: "decided",
						pick: "later",
						decidedBy: "you",
						options: [
							{
								id: "later",
								name: "Not yet, add it later",
								upside: "A smaller change now.",
								catch: "Comments in Jira won’t reach Bob yet.",
							},
							{
								id: "now",
								name: "Yes, in this change",
								upside: "Jira works both ways, like Linear.",
								catch: "Makes this change about 40% bigger.",
							},
						],
					}
				: {
						id: "comments",
						question: "Should Jira comments reach Bob while it works?",
						why: "Bob can’t tell from the code. It depends on where your team talks.",
						status: "open",
						options: [
							{
								id: "later",
								name: "Not yet, add it later",
								upside: "A smaller change now.",
								catch: "Comments in Jira won’t reach Bob yet.",
							},
							{
								id: "now",
								name: "Yes, in this change",
								upside: "Jira works both ways, like Linear.",
								catch: "Makes this change about 40% bigger.",
								preview: {
									parts: [
										part(
											"hook",
											"Jira webhook",
											"receives comments",
											"Receives Jira comments and passes them to the run.",
											"adapters",
											"new",
										),
									],
									links: [
										{ from: "jira", to: "hook", label: "comments" },
										{ from: "hook", to: "tracking" },
									],
									hide: [],
								},
							},
						],
					},
		],
		map: {
			areas: [
				{ id: "dashboard", name: "Dashboard" },
				{ id: "core", name: "Bob’s core" },
				{ id: "adapters", name: "Connections" },
				{ id: "outside", name: "Outside Bob" },
			],
			parts: [
				part(
					"form",
					"Start-a-run form",
					"accepts Jira links",
					"You can paste a Jira link to start a run.",
					"dashboard",
					"changed",
					"LaunchFields.ts",
				),
				part(
					"settings",
					"Settings",
					"new Jira section",
					"Where you add your Jira site, token and status mapping.",
					"dashboard",
					"new",
					"web/settings.tsx",
				),
				part(
					"tracking",
					"Ticket tracking",
					"learns about Jira",
					"Picks the right connection for each ticket. Gets one small addition.",
					"core",
					"changed",
					"TicketTracking.ts",
				),
				v2
					? part(
							"token",
							"System keychain",
							"stores the token",
							"Keeps the Jira token in your computer’s keychain, not in a file.",
							"core",
							"new",
							"FactoryAuthStore.ts",
						)
					: part(
							"token",
							"Config file",
							"stores the token",
							"Holds the Jira token as plain text.",
							"core",
							"changed",
							"ConfigManager.ts",
						),
				part(
					"jiraC",
					"Jira connection",
					"new",
					"Moves the issue’s status, links the PR and posts a final comment.",
					"adapters",
					"new",
					"JiraAdapter.ts",
				),
				part(
					"taskbotC",
					"Taskbot link",
					"stays the same",
					"Existing. Jira will work the same way.",
					"adapters",
					"unchanged",
					"TicketTracking.ts",
				),
				part(
					"jira",
					"Jira",
					"status, PR, comment",
					"Atlassian’s Jira Cloud.",
					"outside",
					"outside",
				),
			],
			links: [
				{ from: "form", to: "tracking", label: "Jira link" },
				{ from: "settings", to: "tracking", label: "mapping" },
				{ from: "settings", to: "token", label: "token" },
				{ from: "tracking", to: "jiraC" },
				{ from: "tracking", to: "taskbotC" },
				{ from: "token", to: "jiraC", label: "token" },
				{ from: "jiraC", to: "jira" },
			],
		},
		evidence: [
			{
				repository: "bobs-factory",
				paths: ["packages/edge-worker/src/factory/TicketTracking.ts"],
				observation:
					"Taskbot and Linear already connect this way. Jira simply becomes the third one.",
			},
			{
				repository: "bobs-factory",
				paths: ["packages/edge-worker/src/factory/TicketTracking.ts"],
				observation: "Old runs keep working. The change only adds things.",
			},
			...(v2
				? [
						{
							repository: "bobs-factory",
							paths: ["docs/PRODUCT_CONTRACTS.md"],
							observation:
								"Bob’s rules say secrets belong in the system keychain.",
						},
					]
				: []),
		],
		risks: [
			"The Jira token belongs to one person. If they leave, syncing stops. Bob will show a warning on the run.",
			"Someone may rename a Jira status later. Bob checks the mapping at the start of every run.",
			...(v2
				? [
						"Some Linux servers have no keychain. Bob then reads the token from an environment variable.",
					]
				: []),
		],
		candidate: {
			plan: "Full implementation plan for the Jira adapter.\n\n1. Extend TicketReferenceSchema...",
			steps: [
				{
					title: "Let runs start from a Jira link",
					files: ["TicketTracking.ts", "LaunchFields.ts"],
				},
				{ title: "Build the Jira connection", files: ["JiraAdapter.ts"] },
				{ title: "Plug it into ticket tracking", files: ["TicketTracking.ts"] },
				{
					title: "Add a Jira section to Settings",
					files: ["web/settings.tsx"],
				},
				{
					title: v2
						? "Save the Jira token in the system keychain"
						: "Save the Jira token in the config file",
					files: [v2 ? "FactoryAuthStore.ts" : "ConfigManager.ts"],
				},
				{
					title: "If a Jira status is missing, post a comment instead",
					files: ["JiraAdapter.ts"],
				},
				{
					title: "Test it, including a full practice run",
					files: ["JiraAdapter.test.ts", "apps/f1"],
				},
				...(v2
					? [{ title: "Write a follow-up ticket for Jira comments", files: [] }]
					: []),
			],
			assets: [],
		},
	};
}

const home = mkdtempSync(join(tmpdir(), "pr74-arch-"));
const runtime = new WorkflowRuntime(home, {
	agent: async (c) => {
		if (c.step.architectureContract === "architecture-v1")
			return jira((c.run.architectureProposals?.length ?? 0) + 1);
		if (c.step.architectureContract === "architecture-review-v1")
			return { approved: true, feedback: [] };
		if (c.step.id === "question-explanation")
			return {
				questions: [
					"Atlassian’s server needs a browser login for every person, so background runs would break. My plan stays the same.",
				],
			};
		await new Promise((r) => setTimeout(r, 600000));
		return { status: "completed", summary: "done", checks: [], questions: [] };
	},
	script: async () => ({}),
	tool: async () => ({}),
});
const fork = runtime.forkWorkflow("factory", "Browser architecture fixture");
const definitions = runtime.listWorkflows();
const pipeline = definitions.find((w) => w.id === fork.steps[0].workflow);
pipeline.steps = pipeline.steps.filter((s) =>
	[
		"architecture",
		"architecture-review",
		"architecture-decision",
		"implement",
	].includes(s.id),
);
pipeline.steps.find((s) => s.id === "implement").next = "end";
runtime.updateWorkflows(definitions);
const run = runtime.create({
	title: "Sync runs to Jira",
	workflow: definitions.find((w) => w.id === fork.id),
	repositoryId: "fixture",
	workspace: home,
	input: "Sync Factory runs to Jira issues",
	triggerOrigin: {
		type: "manual",
		workflowId: fork.id,
		at: new Date().toISOString(),
	},
});
void runtime.launch(run);
const origin = "http://localhost:3994";
const server = new FactoryServer(
	runtime,
	{
		repositories: () => [{ id: "fixture", name: "bobs-factory" }],
		sessions: () => [],
		entries: () => [],
		start: async () => {
			throw new Error("fixture only");
		},
		stop: (id) => runtime.stop(id),
	},
	{ origins: [origin], sessionHours: 12 },
);
server.auth.store.update((state) => {
	state.credentials.push({
		id: "fixture",
		origin,
		publicKey: "fixture",
		counter: 0,
		label: "Fixture",
		deviceType: "singleDevice",
		backedUp: false,
		createdAt: Date.now(),
		lastUsedAt: Date.now(),
	});
	state.sessions.push({
		hash: createHash("sha256").update("fixture-session").digest("hex"),
		credential: "fixture",
		origin,
		expires: Date.now() + 36e5,
		verifiedAt: Date.now(),
	});
});
await server.start(3994);
console.log(JSON.stringify({ origin, runId: run.id }));
