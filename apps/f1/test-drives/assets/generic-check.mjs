// F1_AGENT_MODE=mock node apps/f1/test-drives/assets/generic-check.mjs
// Add F1_CHECK_RECOVERY=1 to include R1/R2/R3 assistance and native-session regressions.
// Actual EdgeWorker + CLI tracker; deterministic agents and forge/ticket boundaries.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCLIIssueTracker } from "../../../../packages/core/dist/index.js";
import { EdgeWorker } from "../../../../packages/edge-worker/dist/EdgeWorker.js";
import {
	digest,
	externalCompletionProven,
	TicketDelivery,
} from "../../../../packages/edge-worker/dist/factory/Delivery.js";
import { defaultWorkflows } from "../../../../packages/edge-worker/dist/factory/defaultWorkflows.js";
import { QaScopeSchema } from "../../../../packages/edge-worker/dist/factory/FactoryResults.js";
import {
	executeCommand,
	FactoryTools,
	QaCaptureSchema,
} from "../../../../packages/edge-worker/dist/factory/FactoryTools.js";
import { formatOf } from "../../../../packages/edge-worker/dist/factory/StepConfig.js";
import { readPath } from "../../../../packages/edge-worker/dist/factory/Workflow.js";
import { loadFactoryContextSnapshot } from "../../../../packages/mcp-tools/dist/index.js";
import { f1AgentHandlers } from "../../dist/src/MockAgentRunner.js";

assert.equal(process.env.F1_AGENT_MODE, "mock");
assert([undefined, "0", "1"].includes(process.env.F1_CHECK_RECOVERY));
const recoveryEnabled = process.env.F1_CHECK_RECOVERY === "1";
const diagnosticScenario = process.env.F1_CHECK_RECOVERY_ONLY ?? "";
assert(
	[
		"",
		"stock-specialist-assistance",
		"renamed-specialist-assistance",
		"native-recovery-alternate",
		"native-recovery-inspect",
	].includes(diagnosticScenario),
	"Unknown focused recovery scenario",
);
assert(!diagnosticScenario || recoveryEnabled);
for (const key of Object.keys(process.env))
	if (key.startsWith("BOBS_FACTORY_")) delete process.env[key];
const root = process.cwd(),
	directory = realpathSync(mkdtempSync(join(tmpdir(), "f1-generic-check-"))),
	home = join(directory, "home");
mkdirSync(home);
const startedAt = new Date().toISOString();
const revision = execFileSync("git", ["rev-parse", "HEAD"], {
	cwd: root,
	encoding: "utf8",
}).trim();
const untracked = execFileSync(
	"git",
	["ls-files", "--others", "--exclude-standard"],
	{ cwd: root, encoding: "utf8" },
)
	.trim()
	.split("\n")
	.filter(Boolean)
	.sort();
const deltaHash = createHash("sha256").update(
	execFileSync("git", ["diff", "HEAD"], { cwd: root }),
);
for (const path of untracked)
	deltaHash
		.update(path)
		.update("\0")
		.update(readFileSync(join(root, path)))
		.update("\0");
const delta = deltaHash.digest("hex");
function buildIdentity() {
	const buildHash = createHash("sha256");
	for (const packageName of ["core", "mcp-tools", "edge-worker"]) {
		const dist = join(root, "packages", packageName, "dist");
		for (const file of readdirSync(dist, { recursive: true })
			.filter((file2) => file2.endsWith(".js"))
			.sort())
			buildHash
				.update(`${packageName}/${file}`)
				.update("\0")
				.update(readFileSync(join(dist, file)))
				.update("\0");
	}
	buildHash
		.update("apps/f1/dist/src/MockAgentRunner.js\0")
		.update(readFileSync(join(root, "apps/f1/dist/src/MockAgentRunner.js")))
		.update("\0");
	return buildHash.digest("hex");
}
const buildSha256 = buildIdentity();
console.log(
	JSON.stringify({
		phase: "setup",
		diagnosticScenario,
		directory,
		revision,
		deltaSha256: delta,
		buildSha256,
		node: process.version,
		startedAt,
		paidCalls: 0,
	}),
);
const forge = deliveryFixture(directory),
	repository = forge.repositories[0];
forge.git(repository, "checkout", "main");
writeFileSync(
	join(repository.workspace, ".gitignore"),
	".claude/\n.codex/\n.cursor/\n.opencode/\nAGENTS.md\nCLAUDE.md\n",
);
forge.git(repository, "add", ".gitignore");
forge.git(repository, "commit", "-qm", "chore: ignore fixture runner files");
forge.git(repository, "push", "origin", "main");
async function freePort() {
	const server = createServer();
	await new Promise((done) => server.listen(0, "127.0.0.1", done));
	const port = server.address().port;
	await new Promise((done) => server.close(() => done()));
	return port;
}
const rpcPort = await freePort(),
	factoryPort = await freePort(),
	rpcOrigin = `http://127.0.0.1:${rpcPort}`;
process.env.BOBS_FACTORY_FACTORY_PORT = String(factoryPort);
process.env.BOBS_FACTORY_DISABLE_REMOTE_SESSION_STORE = "1";
process.env.BOBS_FACTORY_MIGRATION_SOURCE_CAPACITY_DIRECTORY = join(
	directory,
	"unused-legacy-capacity",
);
const tracker = createCLIIssueTracker(),
	fork = renamedFactory(defaultWorkflows),
	turns = [],
	sessions = [],
	results = [],
	recoveryResults = [];
let recovery;
const customRecoveryRuns = new Map();

function recoveryDefinitions() {
	const definition = (id, assistance, destination) => ({
		id,
		name: `F1 ${id}`,
		stepConfigVersion: "step-config-v1",
		triggers: ["manual", "ticket-assignment", "workflow"],
		steps: [
			{
				id: "inspect",
				name: "Inspect the fixture evidence",
				type: "agent",
				prompt: "Return the scripted review outcome without changing files.",
				output: { format: "review-v1" },
				next: "decision",
			},
			{
				id: "decision",
				name: "Evaluate the declared review result",
				type: "check",
				reads: { review: "inspect" },
				checks: [
					"review-evidence",
					...(assistance ? ["review-assistance"] : []),
				],
				check: {
					results: {
						reviewIncomplete: {
							path: "/evidence/review-evidence/incomplete",
							equals: true,
						},
						reviewBlocked: {
							path: "/evidence/review-evidence/incomplete",
							equals: true,
						},
						questions: { select: "/evidence/review-evidence/questions" },
					},
					passed: { path: "/results/reviewIncomplete", equals: false },
				},
				branches: assistance
					? [
							{
								when: { path: "reviewIncomplete", equals: true },
								next: destination,
							},
						]
					: [],
				next: "end",
			},
			...(destination === "alternate"
				? [
						{
							id: "alternate",
							name: "Continue in the alternate agent",
							type: "agent",
							prompt:
								"Return the scripted alternate result without changing files.",
							next: "end",
						},
					]
				: []),
		],
	});
	const definitions = [definition("f1-ordinary-review-fields", false, "end")];
	for (const destination of ["alternate", "inspect"]) {
		const id = `f1-review-recovery-${destination}`;
		definitions.push(
			{
				id,
				name: `F1 nested ${destination} recovery`,
				stepConfigVersion: "step-config-v1",
				triggers: ["manual", "ticket-assignment"],
				steps: [
					{
						id: "nested",
						name: "Call the recovery recipe",
						type: "workflow",
						workflow: `${id}-child`,
						next: "end",
					},
				],
			},
			{
				...definition(`${id}-child`, true, destination),
				internal: true,
				triggers: ["workflow"],
			},
		);
	}
	return definitions;
}

function customRecoveryReply(run, step) {
	if (!run.workflow.id.startsWith("f1-")) return;
	const state = customRecoveryRuns.get(run.id) ?? { reviews: 0 };
	customRecoveryRuns.set(run.id, state);
	if (step.id === "alternate") return { completed: true };
	assert.equal(step.id, "inspect");
	const blocked = ++state.reviews === 1;
	return {
		status: blocked ? "blocked" : "completed",
		blockers: blocked ? ["Fixture review access needs assistance"] : [],
		summary: blocked
			? "The fixture review could not finish"
			: "The original fixture reviewer resumed",
		findings: [],
	};
}
const decisionTools = new Set([
	"review-gate",
	"visual-gate",
	"delivery-mode",
	"delivery-route",
	"review-after-fix",
]);
function graphSteps(workflowId, definitions = defaultWorkflows) {
	const found = new Map();
	const visit = (steps, prefix, stack) => {
		for (const step of steps) {
			const key = prefix + step.id;
			found.set(key, step);
			if (step.type === "workflow") {
				assert(
					!stack.includes(step.workflow),
					"Fixture rejects recursive graph",
				);
				const called = definitions.find(
					(workflow) => workflow.id === step.workflow,
				);
				assert(called, `Missing called recipe ${step.workflow}`);
				visit(called.steps, `${key}/`, [...stack, step.workflow]);
			}
			for (const [index, group] of (step.groups ?? []).entries())
				visit(group, `${key}/${index}/`, stack);
		}
	};
	const workflow = definitions.find((workflow) => workflow.id === workflowId);
	assert(workflow, workflowId);
	visit(workflow.steps, "", [workflowId]);
	return found;
}
const declaredGraphs = ["factory", "takeover"].map((id) => {
	const steps = [...graphSteps(id)];
	for (const [key, step] of steps)
		assert(
			!decisionTools.has(step.tool),
			`${id}/${key} still uses ${step.tool}`,
		);
	assert(
		steps.some(([, step]) => step.type === "check"),
		`${id} must call real Check steps`,
	);
	return {
		id,
		checks: steps
			.filter(([, step]) => step.type === "check")
			.map(([key]) => key),
		actions: steps
			.filter(([, step]) => step.type === "tool")
			.map(([key, step]) => ({ key, tool: step.tool })),
	};
});
const entry = defaultWorkflows
	.find((workflow) => workflow.id === "factory")
	.steps.find((step) => step.type === "workflow");
const fanout = defaultWorkflows
	.find((workflow) => workflow.id === entry.workflow)
	.steps.find((step) => step.type === "fanout");
assert(fanout.groups.every((group) => group.length === 1));
const parallelMembers = new Set(
	fanout.groups.map(
		(group, index) => `${entry.id}/${fanout.id}/${index}/${group[0].id}`,
	),
);
function comparableTurns(runId) {
	const actual = turns
		.filter((turn) => turn.run === runId)
		.map(({ key, format }) => ({ key: fork.original(key), format }));
	assert.deepEqual(
		actual
			.filter((turn) => parallelMembers.has(turn.key))
			.map((turn) => turn.key)
			.sort(),
		[...parallelMembers].sort(),
		"Every declared independent specialist must execute exactly once",
	);
	const ordered = [];
	for (let index = 0; index < actual.length; ) {
		if (!parallelMembers.has(actual[index].key)) {
			ordered.push(actual[index++]);
			continue;
		}
		const start = index;
		while (index < actual.length && parallelMembers.has(actual[index].key))
			index++;
		ordered.push(
			...actual.slice(start, index).sort((a, b) => a.key.localeCompare(b.key)),
		);
	}
	return ordered;
}
let runtime;
let scenario = "repository";
const contract = {
	format: "delivery-v1",
	version: 1,
	mode: "repository",
	authorization: { status: "authorized", reference: "Original request" },
	executionReference: "set-from-run",
	targets: [],
};
const externalTarget = {
	key: "fixture-ticket",
	resource: {
		provider: "taskbot",
		server: "fixture",
		instance: "https://fixture.invalid",
		project: "checks",
		id: "7",
		url: "https://fixture.invalid/p/checks/t/7",
	},
	capabilities: ["read", "content", "relationships"],
	baseline: {
		fields: { description: "before" },
		relationships: [{ type: "related", from: "7", to: "9" }],
	},
	operations: [
		{ id: "description", kind: "content", fields: { description: "after" } },
		{
			id: "blocker",
			kind: "add",
			relationship: { type: "blocks", from: "8", to: "7" },
		},
	],
	criteria: [
		{
			id: "content",
			requirementRef: "requirements/0",
			description:
				"Description updated with blocker and existing relationship preserved",
			fields: { description: "after" },
			relationships: [{ type: "blocks", from: "8", to: "7" }],
			absentRelationships: [],
		},
	],
	preservedRelationships: [{ type: "related", from: "7", to: "9" }],
};
let externalState;
const externalCalls = [],
	actionCalls = [];
const externalAdapter = {
	capabilities: ["read", "content", "relationships"],
	read: async () => {
		externalCalls.push({
			operation: "read",
			state: structuredClone(externalState),
		});
		return structuredClone(externalState);
	},
	content: async (fields) => {
		externalCalls.push({
			operation: "content",
			fields: structuredClone(fields),
		});
		Object.assign(externalState.fields, fields);
	},
	relationship: async (kind, relationship) => {
		assert.equal(kind, "add");
		externalCalls.push({ operation: "relationship", kind, relationship });
		externalState.relationships.push(structuredClone(relationship));
	},
	limitation:
		"Fixture is a local scripted provider; no conditional remote writes.",
};
const resolveExternalAdapter = async (_run, target) => {
	assert.deepEqual(
		target,
		externalTarget.resource,
		"Only the declared fixture resource may use the scripted provider",
	);
	return externalAdapter;
};
const ticketDelivery = new TicketDelivery(resolveExternalAdapter, (run) =>
	runtime.save(run),
);
function guide() {
	return {
		contract: "brief-v3",
		verdict: {
			headline: "The record can be saved",
			readiness: "ready",
			why: "Save and readback passed.",
		},
		ask: { source: "F1 request", quote: "Save a record" },
		interpretation: [],
		story: {
			title: "Records stay saved",
			summary: "A saved record can be read back.",
			stats: [],
			slides: [
				{
					kind: "points",
					title: "Save",
					items: [
						{
							icon: "\u2713",
							title: "Saved record",
							detail: "Readback returned the saved value.",
						},
					],
				},
			],
		},
		tour: [{ file: "shared.txt", say: "The record is saved." }],
		requirements: [
			{
				id: "save",
				text: "Save a record",
				origin: "ask",
				covers: ["R1"],
				status: "tested",
				proof: {
					kind: "command",
					command: "node readback",
					output: "app changed",
				},
				files: ["shared.txt"],
			},
		],
		yourCall: [],
		beyondAsk: [],
		notVerified: [],
		hygiene: [],
	};
}
function blockedCoverage() {
	return {
		status: "blocked",
		blockers: ["Fixture specialist access is temporarily unavailable"],
		summary: "Final acceptance coverage review could not finish",
		findings: [],
		disagreements: [],
		// Match the retained legacy blocked-coverage fixture: blocked status
		// prevents acceptance while preserving prerequisite reviewers' work.
		coverage: [
			{
				requirementId: "R1",
				status: "met",
				reason:
					"Completed prerequisite reviewers cover the saved-record implementation; final independent fixture inspection remains blocked by access.",
				evidence: [
					"Completed specialist receipts at the frozen baseline; final acceptance fixture inspection is not completed",
				],
			},
		],
	};
}
function reply(format, run, snapshot, workingDirectory) {
	const request =
		scenario === "external"
			? "Update the fixture ticket description and blocker while preserving its existing relationship"
			: "Save a record";
	switch (format) {
		case "clarify-v1":
			return {
				questions: [],
				decisions: [],
				requirements: [request],
				deliveryMode: scenario,
			};
		case "plan-v1":
			contract.mode = scenario;
			contract.targets =
				scenario === "external" ? [structuredClone(externalTarget)] : [];
			contract.executionReference = digest(
				run.executionSnapshot ?? {
					runner: run.runner,
					repositoryId: run.repositoryId,
				},
			);
			return { plan: request, assets: [], deliveryContract: contract };
		case "plan-review-v1":
			return {
				approved: true,
				feedback: [],
				deliveryContractDigest: digest(contract),
			};
		case "architecture-checkin-v1": {
			const proposal2 = checkin("routine");
			proposal2.problem = [
				{
					repository: repository.id,
					paths: ["shared.txt"],
					observation: "The record needs saving.",
				},
			];
			proposal2.evidence = [
				{
					repository: repository.id,
					paths: ["shared.txt"],
					observation: "Existing record format.",
				},
			];
			proposal2.candidate.steps[0].files = [
				{ path: "shared.txt", change: "edit" },
			];
			proposal2.candidate.plan = "Save a record";
			proposal2.map = void 0;
			proposal2.decisions = [];
			proposal2.talk.checks = [];
			return proposal2;
		}
		case "architecture-review-v1":
			return { approved: true, feedback: [] };
		case "implement-v1":
			writeFileSync(join(workingDirectory, "shared.txt"), "app changed\n");
			return {
				status: "completed",
				summary: "Saved a record",
				checks: ["Local record write"],
				questions: [],
			};
		case "impact-v1":
			if (recovery?.kind === "specialist")
				return specialistRecoveryAssessment(run, snapshot);
			return {
				impactContract: "impact-v1",
				status: "completed",
				summary: "Review the complete implementation",
				classification: "full",
				rationale: "New record behavior needs all specialists",
				uncertainty: [],
				extractRequirements: true,
				specialists: snapshot.impactSnapshot.reviewers.map(
					(reviewer) => reviewer.id,
				),
				requirementIds: [],
				checks: [],
				qaCriteria: [],
				reuse: [],
				invalidate: [],
				targetCompatible: true,
				testAssertions: {
					inspected: true,
					weakened: false,
					evidence: "No assertions weakened",
				},
				humanReview: "no-prior-approval",
				approvalRationale: "Await explicit human approval",
				questions: [],
			};
		case "inventory-v1":
			return {
				schemaVersion: 1,
				requirements: [
					{
						id: "R1",
						criterion: "Save a record",
						classification: "active",
						stage: "code",
						sources: [{ source: "originalInput", reference: "/" }],
					},
				],
				decisions: [],
				conflicts: [],
				sourceReceipt: {
					considered: [{ source: "originalInput", reference: "/" }],
					unavailable: [],
				},
				questions: [],
			};
		case "specialist-v1":
		case "coverage-v1":
			if (recovery?.kind === "specialist")
				assert.equal(
					readFileSync(join(workingDirectory, "shared.txt"), "utf8").trim(),
					"app changed",
					"Completed specialist boundary observes the actual saved fixture record",
				);
			return {
				status: "completed",
				blockers: [],
				summary: "Record behavior inspected",
				findings: [],
				disagreements: [],
				...(recovery?.kind === "specialist"
					? {
							evidenceBoundary: {
								requirementIds: ["R1"],
								areas: [
									fork.original(snapshot.workflowExecution.currentStep.id),
								],
								dependencies: ["shared.txt"],
								independence:
									"Inspected the saved record and its complete local fixture; restoring reviewer access changes no source, callers, configuration, or assertions.",
							},
						}
					: {}),
				...(format === "coverage-v1"
					? {
							coverage: [
								{
									requirementId: "R1",
									status: "met",
									reason: "Local record readback passed",
									evidence: ["shared.txt contains app changed"],
								},
							],
						}
					: {}),
			};
		case "qa-scope-v1":
			return {
				...qaScope(),
				environment: { isolation: "worktree" },
				stories: qaScope().stories.map((story) => ({
					...story,
					requirementRefs: ["R1"],
				})),
				videoContract: "video-v1",
				videoTasks: [],
				videoReason: "Readback demonstrates this nonvisual change.",
			};
		case "qa-capture-v1": {
			const observed = execFileSync(
				"node",
				[
					"-e",
					'const fs=require("node:fs");const value=fs.readFileSync("shared.txt","utf8").trim();if(value!=="app changed")throw new Error(value);console.log(value)',
				],
				{ cwd: workingDirectory, encoding: "utf8" },
			).trim();
			assert.equal(observed, "app changed");
			const receipt = qaExecution();
			receipt.results[0].criteria[0].observed = observed;
			receipt.results[0].criteria[0].evidence = [
				{
					kind: "command",
					executed: true,
					action: "node -e read shared.txt and assert saved value",
					details: observed,
					exitCode: 0,
				},
			];
			return {
				...receipt,
				videoContract: "video-v1",
				videos: [],
				videoUnavailable: [],
			};
		}
		case "qa-review-v1":
			return {
				status: "completed",
				blockers: [],
				findings: [],
				summary: "QA readback inspected",
				qaContract: "qa-v1",
				acceptedScreenshots: [],
				acceptedVideos: [],
			};
		case "review-brief-v3":
			return guide();
		default:
			throw new Error(`Unexpected fixture format ${format}`);
	}
}
const worker = new EdgeWorker({
	platform: "cli",
	factoryHome: home,
	serverPort: rpcPort,
	serverHost: "127.0.0.1",
	defaultRunner: "codex",
	issueTrackerFactory: () => tracker,
	linearWorkspaces: {
		"cli-workspace": { linearToken: "fixture-no-provider-token" },
	},
	repositories: [
		{
			id: repository.id,
			name: "Generic Check Factory F1",
			repositoryPath: repository.workspace,
			workspaceBaseDir: join(directory, "worktrees"),
			baseBranch: "main",
			githubUrl: repository.githubUrl,
			linearWorkspaceId: "cli-workspace",
			isActive: true,
		},
	],
	handlers: {
		createAgentRunner: (_type, config) => {
			const connection = config.mcpConfig?.["factory-context"];
			if (!connection)
				return f1AgentHandlers(
					"mock",
					JSON.stringify({ title: "F1 Check Factory" }),
				).createAgentRunner(_type, config);
			const snapshot = loadFactoryContextSnapshot(connection.args.at(-1));
			const run = [...runtime.runs.values()].find(
				(run2) =>
					run2.status === "running" &&
					run2.workspace === config.workingDirectory,
			);
			assert(run, "Factory runner must belong to the active fixture run");
			const role = snapshot.workflowExecution.currentStep.id;
			const path = snapshot.workflowExecution.currentStep.key.split("/");
			let steps = run.workflow.steps;
			let step;
			while (path.length) {
				const id = path.shift();
				step = steps.find((candidate) => candidate.id === id);
				assert(
					step,
					`Missing fixture step at ${snapshot.workflowExecution.currentStep.key}: ${id}`,
				);
				if (step.type === "workflow")
					steps = run.workflowDefinitions.find(
						(definition) => definition.id === step.workflow,
					).steps;
				else if (step.type === "fanout")
					steps = step.groups[Number(path.shift())];
			}
			const custom = customRecoveryReply(run, step);
			const format = formatOf(step) ?? (custom ? "f1-generic-json" : undefined);
			assert(format, role);
			const turn = {
				run: run.id,
				key: snapshot.workflowExecution.currentStep.key,
				role: fork.original(role),
				format,
				resumeSessionId: config.resumeSessionId ?? null,
			};
			turns.push(turn);
			const runner = f1AgentHandlers(
				"mock",
				JSON.stringify(
					custom ?? reply(format, run, snapshot, config.workingDirectory),
				),
			).createAgentRunner(_type, config);
			const start = runner.start.bind(runner);
			runner.start = async (prompt) => {
				const result = await start(prompt);
				turn.sessionId = result.sessionId;
				return result;
			};
			return runner;
		},
	},
});
// Background tracking performs its own production TicketDelivery.finalCheck.
// It must use the same fixture adapter as actions; failed reads still invalidate proof.
worker.factoryDeliveryAdapter = resolveExternalAdapter;
runtime = worker.getFactoryRuntime();
const workerAgent = runtime.hooks.agent.bind(runtime.hooks);
runtime.hooks.agent = async (context) => {
	if (
		recovery?.kind === "specialist" &&
		!recovery.released &&
		formatOf(context.step) === "coverage-v1" &&
		fork.original(context.step.id) === "requirements-review"
	) {
		assert.equal(recovery.blockedTurns, 0);
		assert(
			context.reviewBaseline,
			"Controlled incomplete result needs the runtime review baseline",
		);
		recovery.blockedTurns++;
		// EdgeWorker intentionally treats blocked SDK specialists as infrastructure
		// failures. Exercise retained incomplete receipts at the generic runtime's
		// canonical controlled-agent boundary; runtime validation/stamping remains live.
		turns.push({
			run: context.run.id,
			key: context.stepKey,
			role: fork.original(context.step.id),
			format: formatOf(context.step),
			boundary: "generic-runtime-agent-hook",
			attemptId: context.attemptId,
			baseline: {
				key: context.reviewBaseline.key,
				round: context.reviewBaseline.round,
				inventoryDigest: context.reviewBaseline.inventory.digest,
				sourceContextDigest:
					context.reviewBaseline.inventory.sourceContextDigest,
				headSha: context.reviewBaseline.headSha,
				baseSha: context.reviewBaseline.baseSha,
			},
		});
		return blockedCoverage();
	}
	return workerAgent(context);
};
const tools = new FactoryTools({
	postComment: async () => {},
	ticketDelivery,
	command: async (...args) => {
		assert.notEqual(
			scenario,
			"external",
			"External delivery must not invoke Git/forge commands",
		);
		return forge.command(...args);
	},
});
runtime.hooks.evidence = (context) => tools.evidence(context);
runtime.hooks.tool = async (context) => {
	assert(
		!decisionTools.has(context.step.tool),
		`Decision tool invoked: ${context.step.tool}`,
	);
	const output = await tools.tool(context);
	actionCalls.push({
		run: context.run.id,
		key: context.stepKey ?? context.run.step ?? context.step.id,
		tool: context.step.tool,
		output: structuredClone(output),
	});
	return output;
};
function checkEvidence(run) {
	const graph = graphSteps(run.workflow.id, run.workflowDefinitions);
	const checks = [];
	for (const [key, step] of graph) {
		if (step.type !== "check") continue;
		const history = run.history.filter((receipt) => receipt.step === key);
		if (!history.length) continue;
		assert(
			!turns.some((turn) => turn.run === run.id && turn.key === key),
			`Check ${key} invoked an agent`,
		);
		for (const receipt of history) {
			assert.equal(
				typeof receipt.output.passed,
				"boolean",
				`${key} must return passed`,
			);
			assert(
				!Object.hasOwn(receipt.output, "next"),
				`${key} must not choose its next step`,
			);
		}
		const output = history.at(-1).output;
		const branch = step.branches.find(
			(candidate) =>
				JSON.stringify(readPath(output, candidate.when.path)) ===
				JSON.stringify(candidate.when.equals),
		);
		const prefix = key.slice(0, key.length - step.id.length);
		const siblings = [...graph].filter(
			([other]) => other.slice(0, other.lastIndexOf("/") + 1) === prefix,
		);
		const siblingIndex = siblings.findIndex(([other]) => other === key);
		const destination =
			branch?.next ?? step.next ?? siblings[siblingIndex + 1]?.[1].id ?? "end";
		const finished = run.events.findLastIndex(
			(event) =>
				event.step === key && event.message === `Finished ${step.name}`,
		);
		assert(finished >= 0, `${key} must finish in real runtime`);
		const next = run.events
			.slice(finished + 1)
			.find((event) => event.message.startsWith("Starting "));
		if (destination !== "end")
			assert.equal(
				next?.step,
				prefix + destination,
				`${key} must follow its configured route`,
			);
		checks.push({
			key,
			output,
			destination: destination === "end" ? "end" : prefix + destination,
			receipts: history.length,
			configuration: step.check,
			evidence: step.checks,
			reads: step.reads,
		});
	}
	assert(checks.length, "Scenario must execute actual Check nodes");
	return checks;
}
async function rpc(method, params = {}) {
	const response = await fetch(`${rpcOrigin}/cli/rpc`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
	});
	const payload = await response.json();
	assert(!payload.error, JSON.stringify(payload));
	return payload.result;
}
async function until(check, message) {
	const end = Date.now() + 18e4;
	while (Date.now() < end) {
		if (check()) return;
		for (const run of runtime.runs.values())
			assert.notEqual(run.status, "failed", `${run.step}: ${run.error}`);
		await new Promise((done) => setTimeout(done, 50));
	}
	throw new Error(
		message +
			": " +
			JSON.stringify(
				[...runtime.runs.values()].map((r) => ({
					id: r.id,
					status: r.status,
					step: r.step,
					error: r.error,
					events: r.events.slice(-3),
				})),
			),
	);
}

async function startRecoveryRun(
	workflowId,
	title,
	description = "Inspect the controlled fixture and preserve every required review and approval.",
) {
	runtime.updateWorkflows(runtime.listWorkflows(), workflowId);
	const { issue } = await rpc("createIssue", {
		teamId: "team-default",
		title,
		description,
	});
	const { session } = await rpc("startSession", { issueId: issue.id });
	sessions.push(session.sessionId);
	await until(
		() => runtime.runs.has(session.sessionId),
		"Recovery fixture run was not created",
	);
	return runtime.get(session.sessionId);
}

async function recoveryTimeline(run) {
	const timeline = await rpc("viewSession", {
		sessionId: run.id,
		limit: 1000,
		offset: 0,
	});
	assert(timeline.totalCount > 0);
	assert(
		timeline.activities.every(
			(activity) => activity.content && activity.createdAt,
		),
	);
	return {
		activityCount: timeline.totalCount,
		activityTypes: [
			...new Set(timeline.activities.map((activity) => activity.type)),
		],
	};
}

function specialistRecoveryAssessment(run, snapshot) {
	const current = snapshot.impactSnapshot;
	assert(current, "Recovery assessment needs the actual impact snapshot");
	const prior = current.reviewRound
		? snapshot.impactEvidence.filter(
				({ receipt }) =>
					receipt.status === "completed" &&
					receipt.blockers.length === 0 &&
					!receipt.findings.some(
						(finding) => finding.status === "open" && finding.rating > 1,
					) &&
					receipt.disagreements.length === 0 &&
					receipt.evidenceBoundary,
			)
		: [];
	let scopeReuse;
	if (current.reviewRound) {
		assert(recovery.released, "Reassessment follows explicit restored access");
		assert.equal(
			current.environmentDigest,
			recovery.initialImpact.environmentDigest,
		);
		assert(
			current.repositories.every(
				(repository) =>
					!repository.diff &&
					!repository.targetDiff &&
					!repository.uncertainty.length,
			),
			"Reuse requires actual unchanged source and target evidence",
		);
		assert.equal(prior.length, current.reviewers.length - 1);
		assert(
			prior.every(
				({ receipt }) =>
					fork.original(receipt.stamp.reviewer) !== "requirements-review",
			),
			"The blocked reviewer cannot supply retained completed evidence",
		);
		const baseline = run.reviewRounds.findLast(
			(round) =>
				round.key === current.key && round.round === current.reviewRound,
		);
		assert(baseline, "Recovery needs the exact prior review frame and round");
		assert.equal(current.inventoryDigest, baseline.inventory.digest);
		scopeReuse = {
			inventoryDigest: baseline.inventory.digest,
			originalSourceDigest: baseline.inventory.sourceContextDigest,
			reason:
				"Independently inspected the access-restoration answer and unchanged source/target diffs; it restores reviewer access without changing the accepted Save a record requirement or waiving review.",
		};
		assert(scopeReuse.originalSourceDigest);
	} else {
		assert.equal(snapshot.impactEvidence.length, 0);
		recovery.initialImpact = structuredClone(current);
	}
	const reuse = prior.map(({ digest, receipt }) => ({
		reviewer: receipt.stamp.reviewer,
		receiptDigest: digest,
		boundary: structuredClone(receipt.evidenceBoundary.boundary),
		reason:
			"The exact original receipt inspected shared.txt; current source and target diffs are empty, runtime environment is unchanged, and the answer changes access alone.",
	}));
	const assessment = {
		impactContract: "impact-v1",
		status: "completed",
		summary: current.reviewRound
			? "Retain completed independent evidence; retry only the blocked coverage reviewer"
			: "Review the complete implementation",
		classification: current.reviewRound ? "none" : "full",
		rationale: current.reviewRound
			? "Access restoration changes no requirement, source, target, dependency, or assertion; original completed receipts remain independently valid"
			: "New record behavior needs all configured specialists",
		uncertainty: [],
		extractRequirements: !current.reviewRound,
		...(scopeReuse ? { scopeReuse } : {}),
		specialists: current.reviewers
			.map(({ id }) => id)
			.filter((id) => !reuse.some(({ reviewer }) => reviewer === id)),
		requirementIds: [],
		checks: [],
		qaCriteria: [],
		qaReuse: [],
		reuse,
		invalidate: [],
		targetCompatible: true,
		testAssertions: {
			inspected: true,
			weakened: false,
			evidence:
				"Fixture implementation and unchanged assertions inspected; no code correction or assertion weakening occurred",
		},
		humanReview: "no-prior-approval",
		approvalRationale: "Await the unchanged explicit human acceptance boundary",
		questions: [],
	};
	recovery.assessments.push({
		snapshot: structuredClone(current),
		reuse: structuredClone(reuse),
		scopeReuse,
		specialists: [...assessment.specialists],
	});
	return assessment;
}

async function specialistRecovery(renamed) {
	scenario = "repository";
	recovery = {
		kind: "specialist",
		released: false,
		blockedTurns: 0,
		assessments: [],
	};
	forge.requests.clear();
	const workflowId = renamed ? "renamed-factory" : "factory";
	const run = await startRecoveryRun(
		workflowId,
		`F1 ${renamed ? "renamed" : "stock"} specialist assistance`,
		"Save a record. Require the configured specialist review and restore temporary fixture access through assistance without replaying implementation or waiving approval.",
	);
	await until(
		() => run.status === "waiting",
		"Blocked specialist did not reach assistance",
	);
	assert.notEqual(
		run.reviewGate?.status,
		"pending",
		"Incomplete specialist work cannot open acceptance",
	);
	assert.equal(fork.original(run.step), "pipeline/review-gate");
	assert(run.questions.length > 0);
	assert.equal(recovery.blockedTurns, 1);
	const inventoryKey = turns.find(
		(turn) => turn.run === run.id && turn.format === "inventory-v1",
	).key;
	const originalInventoryBinding = structuredClone(
		run.boundOutputs[inventoryKey],
	);
	assert(
		originalInventoryBinding,
		"The original inventory retains its actual input binding",
	);
	const acceptedAssessment = run.history.find(
		(entry) => fork.original(entry.step) === "pipeline/assess-impact",
	).output;
	assert.equal(
		acceptedAssessment.snapshot.digest,
		recovery.assessments[0].snapshot.digest,
		"Operational impact bookkeeping cannot rewrite accepted assessment evidence",
	);
	assert.equal(
		acceptedAssessment.pending.specialists.length,
		recovery.initialImpact.reviewers.length,
	);
	const acceptedAssessmentBytes = JSON.stringify(acceptedAssessment);
	const gate = graphSteps(run.workflow.id, run.workflowDefinitions).get(
		run.step,
	);
	const blockedEntry = run.history.findLast(
		(receipt) => receipt.step === run.step,
	);
	const blocked = blockedEntry.output;
	assert.equal(
		blocked.reviewIncomplete,
		true,
		"Specialist incompleteness must remain projected into Check output",
	);
	const controlledTurn = turns.find(
		(turn) =>
			turn.run === run.id && turn.boundary === "generic-runtime-agent-hook",
	);
	assert(controlledTurn);
	assert.equal(
		controlledTurn.sessionId,
		undefined,
		"Controlled incomplete output makes no native-session claim",
	);
	const originalReview = blockedEntry.evidence?.["review-evidence"];
	assert(
		originalReview,
		"Exact original review evidence stays outside pure results",
	);
	const controlledReceipt = originalReview.reviewers.find(
		(reviewer) => reviewer.stamp.stepKey === controlledTurn.key,
	);
	assert(
		controlledReceipt,
		"Runtime must stamp the controlled incomplete receipt in the exact frame",
	);
	assert.equal(controlledReceipt.status, "blocked");
	assert(controlledReceipt.blockers.length > 0);
	assert.equal(
		controlledReceipt.stamp.reviewer,
		controlledTurn.key.split("/").at(-1),
	);
	assert.equal(controlledReceipt.stamp.round, controlledTurn.baseline.round);
	assert.equal(
		controlledReceipt.stamp.inventoryDigest,
		controlledTurn.baseline.inventoryDigest,
	);
	assert.equal(
		controlledReceipt.stamp.headSha,
		controlledTurn.baseline.headSha,
	);
	assert.equal(
		controlledReceipt.stamp.baseSha,
		controlledTurn.baseline.baseSha,
	);
	const route = gate.branches.find(
		(branch) =>
			JSON.stringify(readPath(blocked, branch.when.path)) ===
			JSON.stringify(branch.when.equals),
	);
	assert.equal(
		fork.original(route?.next ?? gate.next),
		"assess-impact",
		"Incomplete specialist recovery must take precedence over the code fixer route",
	);
	const assistance = {
		step: run.step,
		questionBatchId: run.questionBatchId,
		questions: [...run.questions],
		output: structuredClone(blocked),
	};
	const priorTurns = turns.filter((turn) => turn.run === run.id).length;
	recovery.released = true;
	runtime.answer(
		run.id,
		"Fixture specialist access is restored. Reassess the retained evidence and complete all outstanding review; no review or approval is waived.",
	);
	await until(() => {
		if (run.status === "waiting" && run.reviewGate?.status !== "pending")
			throw new Error(
				`Specialist recovery unexpectedly needs further assistance at ${run.step}: ${run.questions.join("; ")}`,
			);
		return run.reviewGate?.status === "pending";
	}, "Specialist recovery did not reach normal explicit acceptance");
	const actual = turns.filter((turn) => turn.run === run.id);
	const continuation = actual.slice(priorTurns);
	const assessment = continuation.findIndex(
		(turn) => turn.role === "assess-impact",
	);
	const reviewed = continuation.findIndex(
		(turn) => turn.role === "requirements-review",
	);
	assert(
		assessment >= 0 && reviewed > assessment,
		"The independent assessment must precede fresh outstanding specialist review",
	);
	assert.equal(
		actual.filter((turn) => turn.format === "implement-v1").length,
		1,
		"Assistance must not replay implementation",
	);
	assert(
		!actual.some((turn) => turn.role === "code-fix"),
		"Incomplete review is not a product code-fix obligation",
	);
	assert.equal(
		actual.filter((turn) => turn.format === "inventory-v1").length,
		1,
		"Access restoration must retain the independently extracted inventory",
	);
	assert.equal(recovery.assessments.length, 2);
	assert.deepEqual(
		run.boundOutputs[inventoryKey],
		originalInventoryBinding,
		"Scope reuse retains the original inventory binding instead of claiming fresh extraction",
	);
	assert.equal(JSON.stringify(acceptedAssessment), acceptedAssessmentBytes);
	const reassessment = recovery.assessments.at(-1);
	assert.deepEqual(
		reassessment.specialists.map(fork.original),
		["requirements-review"],
		"Only the blocked reviewer remains outstanding after reassessment",
	);
	const specialistCounts = Object.fromEntries(
		recovery.initialImpact.reviewers.map(({ id }) => {
			const role = fork.original(id);
			const count = actual.filter(
				(turn) =>
					["specialist-v1", "coverage-v1"].includes(turn.format) &&
					turn.role === role,
			).length;
			assert.equal(
				count,
				role === "requirements-review" ? 2 : 1,
				`${role}: completed independent reviewers must not replay`,
			);
			const native = actual.filter(
				(turn) =>
					["specialist-v1", "coverage-v1"].includes(turn.format) &&
					turn.role === role &&
					turn.boundary !== "generic-runtime-agent-hook",
			);
			assert.equal(
				native.length,
				1,
				`${role}: exactly one completed Worker SDK reviewer turn`,
			);
			assert.equal(typeof native[0].sessionId, "string");
			return [role, count];
		}),
	);
	const rounds = run.reviewRounds.filter(
		(round) => round.key === reassessment.snapshot.key,
	);
	assert.equal(rounds.length, 2);
	assert.equal(rounds[0].inventory.digest, rounds[1].inventory.digest);
	assert.equal(rounds[0].inventory.version, rounds[1].inventory.version);
	const decision = run.impactDecisions.findLast(
		(decision) => decision.snapshot.digest === reassessment.snapshot.digest,
	);
	assert(decision, "Runtime must accept the exact reassessment snapshot");
	assert.deepEqual(
		decision.reuseRecords.map(({ originalDigest }) => originalDigest).sort(),
		reassessment.reuse.map(({ receiptDigest }) => receiptDigest).sort(),
		"All completed reviewers retain the exact original runtime-stamped receipts",
	);
	runtime.decide(run.id, {
		reviewId: run.reviewGate.id,
		headSha: run.reviewGate.headSha,
		decision: "approve",
	});
	await until(
		() => run.status === "completed",
		"Specialist recovery did not complete guarded delivery",
	);
	const result = {
		scenario: renamed
			? "renamed-specialist-assistance"
			: "stock-specialist-assistance",
		workflowId,
		sessionId: run.id,
		status: run.status,
		assistance,
		controlledIncompleteBoundary: {
			turn: structuredClone(controlledTurn),
			receipt: structuredClone(controlledReceipt),
			stepAttempt: structuredClone(
				run.stepAttempts.find(({ id }) => id === controlledTurn.attemptId),
			),
			limitation:
				"One blocked coverage result uses the generic runtime agent hook. All other roles, including fresh coverage after assistance, use actual EdgeWorker mock SDK execution. Blocked SDK specialist output remains an infrastructure failure, as separately retained rejected drives show.",
		},
		retention: {
			originalInventoryBinding,
			acceptedAssessmentSnapshotDigest: acceptedAssessment.snapshot.digest,
			inventoryExecutions: 1,
			inventoryDigest: rounds[0].inventory.digest,
			inventoryVersion: rounds[0].inventory.version,
			specialistCounts,
			assessments: structuredClone(recovery.assessments),
			reusedReceiptDigests: decision.reuseRecords.map(
				({ originalDigest }) => originalDigest,
			),
		},
		turns: turns.filter((turn) => turn.run === run.id),
		checks: checkEvidence(run),
		actions: actionCalls.filter((call) => call.run === run.id),
		approval: run.humanDecisions.at(-1)?.decision,
		...(await recoveryTimeline(run)),
	};
	recoveryResults.push(result);
	recovery = undefined;
}

async function ordinaryReviewFields() {
	scenario = "repository";
	const run = await startRecoveryRun(
		"f1-ordinary-review-fields",
		"F1 ordinary reviewBlocked and questions fields",
	);
	await until(() => {
		assert.notEqual(
			run.status,
			"waiting",
			"Named reviewBlocked/questions fields cannot implicitly enable assistance",
		);
		return run.status === "completed";
	}, "Ordinary Check did not follow its declared terminal route");
	const checked = run.history.find(
		(receipt) => receipt.step === "decision",
	).output;
	assert.equal(checked.reviewBlocked, true);
	assert(Array.isArray(checked.questions) && checked.questions.length > 0);
	assert.equal(checked.passed, false);
	assert.equal(turns.filter((turn) => turn.run === run.id).length, 1);
	assert.equal(run.questions.length, 0);
	assert(
		!run.events.some((event) =>
			/Review assistance has no configured fixer recovery path/.test(
				event.message,
			),
		),
	);
	recoveryResults.push({
		scenario: "ordinary-review-fields",
		sessionId: run.id,
		status: run.status,
		turns: turns.filter((turn) => turn.run === run.id),
		checks: checkEvidence(run),
		...(await recoveryTimeline(run)),
	});
}

async function nativeRecoveryDestination(destination) {
	scenario = "repository";
	const run = await startRecoveryRun(
		`f1-review-recovery-${destination}`,
		`F1 exact native recovery to ${destination}`,
	);
	await until(
		() => run.status === "waiting",
		"Incomplete review did not reach declared assistance",
	);
	assert.equal(run.step, "nested/decision");
	const frame = run.checkpoint.active.children[0];
	const visitsBefore = structuredClone(frame.visits);
	const reviewer = turns.find(
		(turn) => turn.run === run.id && turn.key === "nested/inspect",
	);
	assert(reviewer.sessionId);
	assert.equal(frame.agentSessions?.inspect?.sessionId, reviewer.sessionId);
	const assistance = {
		step: run.step,
		questions: [...run.questions],
		questionBatchId: run.questionBatchId,
	};
	runtime.answer(
		run.id,
		"The fixture input is available. Follow this recipe's declared recovery destination; retain the original review and conversation.",
	);
	await until(
		() => run.status === "completed",
		"Configured native recovery did not complete",
	);
	const actual = turns.filter((turn) => turn.run === run.id);
	assert.deepEqual(
		actual.map((turn) => turn.key),
		["nested/inspect", `nested/${destination}`],
	);
	assert.equal(
		frame.agentSessions?.inspect?.sessionId,
		reviewer.sessionId,
		"A different destination cannot replace the original reviewer's native identity",
	);
	if (destination === "alternate") {
		assert.deepEqual(
			run.history.find((receipt) => receipt.step === "nested/alternate").output,
			Object.assign(Object.create(null), { completed: true }),
		);
		assert.equal(
			actual[1].resumeSessionId,
			null,
			"An alternate agent must not resume the original reviewer's conversation",
		);
		assert.notEqual(actual[1].sessionId, reviewer.sessionId);
		assert.equal(
			frame.visits.inspect,
			visitsBefore.inspect,
			"An alternate recovery cannot consume the original reviewer's visits",
		);
		assert.equal(frame.visits.alternate, 1);
	} else {
		assert.equal(
			actual[1].resumeSessionId,
			reviewer.sessionId,
			"Retrying the original reviewer must retain its native conversation",
		);
		assert.equal(actual[1].sessionId, reviewer.sessionId);
		assert.equal(frame.visits.inspect, visitsBefore.inspect + 1);
	}
	recoveryResults.push({
		scenario: `native-recovery-${destination}`,
		sessionId: run.id,
		status: run.status,
		assistance,
		turns: actual,
		visitsBefore,
		visitsAfter: frame.visits,
		sessions: frame.agentSessions,
		checks: checkEvidence(run),
		...(await recoveryTimeline(run)),
	});
}

try {
	runtime.updateWorkflows(fork.definitions, "factory");
	await worker.start();
	await rpc("ping");
	for (const [scenarioId, renamed, mode] of [
		["stock-repository", false, "repository"],
		["renamed-repository", true, "repository"],
		["stock-external", false, "external"],
	]) {
		if (diagnosticScenario) break;
		scenario = mode;
		if (mode === "external")
			externalState = {
				resource: structuredClone(externalTarget.resource),
				...structuredClone(externalTarget.baseline),
				complete: true,
			};
		const workflowId = renamed ? "renamed-factory" : "factory";
		runtime.updateWorkflows(runtime.listWorkflows(), workflowId);
		forge.requests.clear();
		const { issue } = await rpc("createIssue", {
			teamId: "team-default",
			title: `F1 ${scenarioId} Factory`,
			description:
				mode === "external"
					? "Edit the fixture ticket description and add its blocker while preserving the existing relationship. Do not change repository files."
					: "Save a record",
		});
		const { session } = await rpc("startSession", { issueId: issue.id });
		sessions.push(session.sessionId);
		await until(
			() => runtime.runs.get(session.sessionId)?.status === "waiting",
			"Factory did not reach explicit review",
		);
		const run = runtime.get(session.sessionId);
		assert.equal(run.reviewGate?.status, "pending");
		assert.equal(run.reviewGate.mode === "external", mode === "external");
		assert.equal(
			forge.publications.length,
			mode === "external" ? 2 : results.length + 1,
		);
		if (mode === "external") {
			assert(
				externalCalls.filter((call) => call.operation === "read").length >= 2,
				"External review needs independent readback",
			);
			assert.throws(
				() =>
					runtime.decide(run.id, {
						reviewId: run.reviewGate.id,
						headSha: "",
						externalDigest: "stale-digest",
						decision: "approve",
					}),
				/revision changed/,
			);
		}
		runtime.decide(run.id, {
			reviewId: run.reviewGate.id,
			headSha: run.reviewGate.headSha,
			...(mode === "external"
				? { externalDigest: run.reviewGate.externalDigest }
				: {}),
			decision: "approve",
		});
		await until(
			() => run.status === "completed",
			"Factory did not complete after approval",
		);
		const timeline = await rpc("viewSession", {
			sessionId: run.id,
			limit: 1e3,
			offset: 0,
		});
		assert(timeline.totalCount > 0);
		await worker.getTicketTracking().flush(run);
		const comments = await tracker.fetchComments(issue.id);
		assert(
			comments.nodes.length > 0,
			"CLI completion preserves durable ticket comments",
		);
		writeFileSync(
			join(directory, `${scenarioId}-comments.json`),
			JSON.stringify(
				comments.nodes.map((comment) => ({ body: comment.body })),
				null,
				2,
			),
		);
		assert(
			timeline.activities.every(
				(activity) => activity.content && activity.createdAt,
			),
		);
		const page = await rpc("viewSession", {
			sessionId: run.id,
			limit: 1,
			offset: 0,
		});
		assert.equal(page.activities.length, 1);
		assert.equal(page.hasMore, true);
		const sequence = turns
			.filter((turn) => turn.run === run.id)
			.map((turn) => turn.format);
		if (mode === "repository") {
			assert(sequence.includes("qa-capture-v1"));
			assert(sequence.includes("review-brief-v3"));
		} else {
			assert.deepEqual(sequence, ["clarify-v1", "plan-v1", "plan-review-v1"]);
			assert.equal(externalCompletionProven(run), true);
			assert.deepEqual(externalState, {
				resource: externalTarget.resource,
				fields: { description: "after" },
				relationships: [
					{ type: "related", from: "7", to: "9" },
					{ type: "blocks", from: "8", to: "7" },
				],
				complete: true,
			});
			assert.equal(
				externalCalls.filter((call) => call.operation === "content").length,
				1,
			);
			assert.equal(
				externalCalls.filter((call) => call.operation === "relationship")
					.length,
				1,
			);
		}
		results.push({
			scenario: scenarioId,
			mode,
			workflowId,
			sessionId: run.id,
			status: run.status,
			sequence,
			checks: checkEvidence(run),
			actions: actionCalls.filter((call) => call.run === run.id),
			history: run.history,
			provenance: run.stepAttempts,
			activityCount: timeline.totalCount,
			activityTypes: [
				...new Set(timeline.activities.map((activity) => activity.type)),
			],
			commentCount: comments.nodes.length,
			worktree: run.workspace,
			head: forge.git(
				{ ...repository, workspace: run.workspace },
				"rev-parse",
				"HEAD",
			),
			approval: run.humanDecisions.at(-1)?.decision,
			summary: run.resultSummary,
		});
		writeFileSync(
			join(directory, `${scenarioId}-activities.json`),
			JSON.stringify(timeline, null, 2),
		);
	}
	if (!diagnosticScenario) {
		assert.deepEqual(
			comparableTurns(results[1].sessionId),
			comparableTurns(results[0].sessionId),
		);
		assert.deepEqual(forge.publications, [repository.id, repository.id]);
		assert.deepEqual(forge.merges, [repository.id, repository.id]);
	}
	if (recoveryEnabled) {
		runtime.updateWorkflows(
			[...runtime.listWorkflows(), ...recoveryDefinitions()],
			"factory",
		);
		if (diagnosticScenario) {
			if (diagnosticScenario.startsWith("native-recovery-"))
				await nativeRecoveryDestination(diagnosticScenario.slice(16));
			else
				await specialistRecovery(
					diagnosticScenario === "renamed-specialist-assistance",
				);
			assert.deepEqual(
				recoveryResults.map(({ scenario }) => scenario),
				[diagnosticScenario],
			);
		} else {
			await specialistRecovery(false);
			await specialistRecovery(true);
			await ordinaryReviewFields();
			await nativeRecoveryDestination("alternate");
			await nativeRecoveryDestination("inspect");
		}
		const deliveries = diagnosticScenario.startsWith("native-recovery-")
			? 0
			: diagnosticScenario
				? 1
				: 4;
		assert.deepEqual(forge.publications, Array(deliveries).fill(repository.id));
		assert.deepEqual(forge.merges, Array(deliveries).fill(repository.id));
	}
	assert.equal(
		buildIdentity(),
		buildSha256,
		"Executed build changed during drive",
	);
	writeFileSync(
		join(directory, "results.json"),
		JSON.stringify(
			{
				mode: "mock/scripted",
				revision,
				deltaSha256: delta,
				buildSha256,
				startedAt,
				finishedAt: new Date().toISOString(),
				paidCalls: 0,
				comparison: {
					kind: "exact-serial-and-contiguous-independent-specialists",
					parallelMembers: [...parallelMembers],
				},
				results,
				recoveryEnabled,
				diagnosticScenario,
				recoveryResults,
				declaredGraphs,
				externalCalls,
				turns,
				publications: forge.publications,
				merges: forge.merges,
			},
			null,
			2,
		),
	);
	console.log(
		JSON.stringify({
			result: "PASS",
			directory,
			revision,
			deltaSha256: delta,
			buildSha256,
			startedAt,
			finishedAt: new Date().toISOString(),
			results,
			recoveryEnabled,
			diagnosticScenario,
			recoveryResults,
			paidCalls: 0,
		}),
	);
	writeFileSync(
		join(directory, "checks-and-actions.json"),
		JSON.stringify(
			{
				declaredGraphs,
				recoveryEnabled,
				diagnosticScenario,
				recoveryResults,
				results: results.map(({ scenario, checks, actions }) => ({
					scenario,
					checks,
					actions,
				})),
				externalCalls,
			},
			null,
			2,
		),
	);
} catch (error) {
	writeFileSync(
		join(directory, "failure.json"),
		JSON.stringify(
			{
				error: error.stack ?? String(error),
				revision,
				deltaSha256: delta,
				buildSha256,
				directory,
				completedResults: results,
				recoveryEnabled,
				diagnosticScenario,
				recoveryResults,
				activeRecovery: recovery,
				turns,
				actionCalls,
				externalCalls,
				runs: [...runtime.runs.values()].map((run) => ({
					id: run.id,
					status: run.status,
					step: run.step,
					error: run.error,
					history: run.history,
					events: run.events.slice(-20),
				})),
			},
			null,
			2,
		),
	);
	console.error(
		JSON.stringify({ result: "FAIL", directory, error: String(error) }),
	);
	throw error;
} finally {
	for (const id of sessions)
		try {
			await rpc("stopSession", { sessionId: id });
		} catch {
			runtime.stop(id);
		}
	await worker.stop();
}
function proposal(classification = "meaningful") {
	return {
		architectureContract: "architecture-v1",
		briefVersion: 1,
		classification,
		rationale:
			"Keep the runtime checkpoint as the owner of the approval boundary.",
		title: "Approve designs before Bob builds them",
		summary:
			"Bob pauses after planning so you can approve the design. Merging still needs a separate PR review.",
		changes: [],
		problem: [
			{
				repository: "bobs-factory",
				paths: ["src/factory/WorkflowRuntime.ts"],
				observation:
					"Designs currently proceed to implementation without an exact-version approval checkpoint.",
			},
		],
		criteria: [
			{
				id: "AC1",
				text: "Require exact-version architecture acceptance before implementation.",
				source: "User request",
				status: "covered",
				reason:
					"The saved checkpoint blocks implementation until this exact proposal is accepted.",
			},
		],
		nonGoals: ["Replace the separate PR merge review."],
		acceptance: [
			"A pending design survives restart and implementation starts exactly once after acceptance of its current version.",
		],
		decisions: [
			{
				id: "boundary",
				question: "Where should the approval live?",
				status: "decided",
				pick: "checkpoint",
				decidedBy: "bob",
				options: [
					{
						id: "checkpoint",
						name: "Next to the run checkpoint",
						upside: "Survives restarts with the rest of the run.",
						catch: "Adds one more saved field.",
					},
					{
						id: "pr",
						name: "Reuse PR approval",
						upside: "No new approval step.",
						catch: "You would approve a design only after it is built.",
						preview: {
							parts: [
								{
									id: "pr-review",
									label: "PR review",
									note: "approves the design late",
									detail:
										"The design is approved together with the finished PR.",
									area: "human",
									status: "outside",
								},
							],
							links: [{ from: "proposal", to: "pr-review" }],
							hide: ["decision"],
						},
					},
				],
			},
		],
		map: {
			areas: [
				{ id: "runtime", name: "Runtime" },
				{ id: "human", name: "You" },
			],
			parts: [
				{
					id: "proposal",
					label: "Proposal",
					note: "saved with the run",
					detail: "Bob's design, saved as an exact version.",
					file: "src/factory/WorkflowRuntime.ts",
					area: "runtime",
					status: "new",
				},
				{
					id: "decision",
					label: "Your approval",
					note: "exact version",
					detail: "You approve one exact version of the design.",
					area: "human",
					status: "new",
				},
			],
			links: [{ from: "proposal", to: "decision", label: "version" }],
		},
		evidence: [
			{
				repository: "bobs-factory",
				paths: ["src/factory/WorkflowRuntime.ts"],
				observation: "Checkpoints already save every step of a run.",
			},
		],
		risks: ["A restart could repeat a step."],
		candidate: {
			plan: "Preserve existing PR https://github.com/JappyJan/bobs-factory/pull/90 and branch existing. Implement the approved runtime boundary. Validate restart and rejection.",
			steps: [
				{
					id: "D1",
					title: "Save the approval with the run",
					what: "Pause before implementation and retain the exact proposal and approval across restarts.",
					kind: "code",
					size: "M",
					traces: [{ criterion: "AC1" }],
					files: [{ path: "src/factory/WorkflowRuntime.ts", change: "edit" }],
				},
			],
			assets: [],
		},
	};
}
function checkin(classification = "meaningful") {
	const value = proposal(classification);
	value.briefVersion = 2;
	value.talk = {
		understood:
			"You want to approve a design before Bob builds it, so a wrong direction costs minutes instead of a day.",
		plan: "I\u2019d pause the run after planning and save the exact design with it. Bob only starts building once you approve that version.",
		scenes: [
			{
				title: "Bob finishes a plan",
				before: ["Bob writes the plan", "Bob starts building straight away"],
				after: [
					"Bob writes the plan",
					"Bob checks it with you",
					"Bob builds once you say go",
				],
			},
		],
		notice: [{ who: "You", what: "Each design waits for your go-ahead." }],
		checks: [
			{
				decision: "boundary",
				say: "I kept the approval next to the run, so it survives restarts.",
				instead:
					"Reusing PR approval needs no new step, but you would only see the design once it is built.",
			},
		],
		size: "Small: one change to how runs pause.",
	};
	return value;
}
function deliveryFixture(directory2) {
	const repositories = [];
	const requests = new Map();
	const publications = [],
		merges = [],
		commands = [];
	let failPublication, failMerge;
	const git = (repository2, ...args) =>
		execFileSync("git", args, {
			cwd: repository2.workspace,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
	for (const [index, name] of ["app", "api", "context"].entries()) {
		const workspace = join(directory2, name),
			origin = join(directory2, `${name}.git`),
			baseBranch = index === 1 ? "development" : "main";
		mkdirSync(workspace, { recursive: true });
		execFileSync("git", ["init", "--bare", "-q", origin]);
		const repository2 = {
			id: name,
			name,
			workspace,
			repositoryPath: workspace,
			baseBranch,
			githubUrl: `https://github.com/fixture/${name}`,
		};
		repositories.push(repository2);
		git(repository2, "init", "-q", "-b", baseBranch);
		git(repository2, "config", "user.name", "Fixture");
		git(repository2, "config", "user.email", "fixture@example.test");
		git(repository2, "config", "commit.gpgsign", "false");
		writeFileSync(
			join(workspace, "shared.txt"),
			`${name} base
`,
		);
		git(repository2, "add", ".");
		git(repository2, "commit", "-qm", "chore: base");
		git(repository2, "remote", "add", "origin", origin);
		git(repository2, "push", "-qu", "origin", baseBranch);
		git(repository2, "checkout", "-qb", "factory/group");
		if (name !== "context")
			writeFileSync(
				join(workspace, "shared.txt"),
				`${name} changed
`,
			);
	}
	const command = async (context, executable, args, timeout) => {
		const repository2 = repositories.find(
			(repository22) => repository22.id === context.run.repositoryId,
		);
		const worktree = { ...repository2, workspace: context.run.workspace };
		commands.push({ repositoryId: repository2.id, executable, args });
		if (executable === "git") {
			const output = await executeCommand(context, executable, args, timeout);
			if (args[0] === "push" && requests.has(repository2.id))
				requests.get(repository2.id).headSha = git(
					worktree,
					"rev-parse",
					"HEAD",
				);
			return output;
		}
		if (executable !== "bobs-factory:github-api")
			throw new Error(`Unexpected command ${executable}`);
		const api = githubRequest(args);
		const pulls = `repos/fixture/${repository2.id}/pulls`;
		if (api.method === "GET" && api.path.startsWith(`${pulls}?`))
			return JSON.stringify(
				requests.has(repository2.id)
					? [
							{
								html_url: requests.get(repository2.id).url,
								draft: requests.get(repository2.id).isDraft,
							},
						]
					: [],
			);
		if (api.method === "POST" && api.path === pulls) {
			if (failPublication === repository2.id)
				throw new Error("Injected publication outage");
			const request2 = {
				url: `https://github.com/fixture/${repository2.name}/pull/1`,
				headSha: git(worktree, "rev-parse", "HEAD"),
				state: "OPEN",
				isDraft: true,
				branchName: git(worktree, "branch", "--show-current"),
			};
			requests.set(repository2.id, request2);
			publications.push(repository2.id);
			const pr = githubApiReceipt(
				[JSON.stringify({ ...api, method: "GET", path: `${pulls}/1` })],
				{ url: request2.url, headRefOid: request2.headSha },
			);
			pr.head.ref = request2.branchName;
			pr.base.ref = repository2.baseBranch;
			return JSON.stringify(pr);
		}
		const request = requests.get(repository2.id);
		if (!request) throw new Error(`Missing fixture PR ${repository2.id}`);
		if (api.path === "graphql") {
			const query = api.body.query;
			if (query.includes("markPullRequestReadyForReview"))
				request.isDraft = false;
			if (query.includes("convertPullRequestToDraft")) request.isDraft = true;
		}
		if (api.method === "PUT" && api.path.endsWith("/merge")) {
			if (failMerge === repository2.id)
				throw new Error("Injected merge outage");
			if (api.body.sha !== request.headSha)
				throw new Error("Unapproved revision");
			request.state = "MERGED";
			merges.push(repository2.id);
		}
		const receipt = githubApiReceipt(args, {
			url: request.url,
			headRefOid: request.headSha,
			baseRefName: repository2.baseBranch,
			baseRefOid: git(
				repository2,
				"rev-parse",
				`origin/${repository2.baseBranch}`,
			),
			state: request.state,
			isDraft: request.isDraft,
			mergeStateStatus: "CLEAN",
			reviewDecision: "APPROVED",
		});
		if (api.method === "GET" && api.path === `${pulls}/1`) {
			receipt.head.ref = request.branchName;
			receipt.base.ref = repository2.baseBranch;
		}
		return JSON.stringify(receipt);
	};
	return {
		repositories,
		requests,
		publications,
		merges,
		commands,
		git,
		command,
		failPublication: (id) => {
			failPublication = id;
		},
		failMerge: (id) => {
			failMerge = id;
		},
	};
}
function githubRequest(args) {
	return JSON.parse(args[0]);
}
function githubApiReceipt(args, extra = {}) {
	const request = githubRequest(args);
	const receipt = providerReceipt(extra);
	const pr = receipt.data.repository.pullRequest;
	if (request.path === "graphql") {
		const query = request.body.query;
		const mutation = query.includes("convertPullRequestToDraft")
			? "convertPullRequestToDraft"
			: query.includes("markPullRequestReadyForReview")
				? "markPullRequestReadyForReview"
				: void 0;
		if (mutation)
			return {
				data: {
					[mutation]: {
						pullRequest: {
							id: "PR_node",
							isDraft: mutation === "convertPullRequestToDraft",
						},
					},
				},
			};
		return receipt;
	}
	if (request.path.endsWith("/merge")) return { merged: true };
	if (/\/pulls\/\d+$/.test(request.path))
		return {
			html_url: pr.url,
			number: 1,
			node_id: "PR_node",
			title: "Change",
			body: "Description",
			draft: pr.isDraft,
			state: pr.state === "OPEN" ? "open" : "closed",
			merged: pr.state === "MERGED",
			head: {
				ref: "feature",
				sha: pr.headRefOid,
				repo: { full_name: request.project },
			},
			base: {
				ref: pr.baseRefName,
				sha: pr.baseRefOid,
				repo: { full_name: request.project },
			},
		};
	if (request.path.includes("/reviews"))
		return (pr.reviews?.nodes ?? []).map((review) => ({
			id: review.id,
			body: review.body,
			state: review.state,
			submitted_at: review.submittedAt,
			user: review.author,
		}));
	return [];
}
function qaScope(surface = "api") {
	return QaScopeSchema.parse({
		qaContract: "qa-v1",
		changed: surface === "ui",
		captureBudget: 24,
		areas:
			surface === "ui"
				? [
						{
							name: "Editor",
							url: "/",
							states: ["saved"],
							instructions: "Save the record",
							dependencies: ["view.ts"],
						},
					]
				: [],
		stories: [
			{
				id: "save",
				goal: "Save a record",
				requirementRefs: ["requirements/0"],
				interface: surface,
				preconditions: ["Application ready"],
				fixtures: ["Record fixture"],
				actions: ["Save a valid record"],
				criteria: [{ id: "saved", expected: "Record is persisted" }],
				evidenceInstructions: "Execute save and read it back",
				screenshotTasks:
					surface === "ui" ? [{ area: "Editor", state: "saved" }] : [],
			},
		],
		exclusions: [],
	});
}
function qaExecution(outcome = "passed") {
	return QaCaptureSchema.parse({
		qaContract: "qa-v1",
		screenshots: [],
		unavailable: [],
		findings: [],
		observations: [],
		results: [
			{
				storyId: "save",
				outcome,
				criteria: [
					{
						criterionId: "saved",
						outcome,
						expected: "Record is persisted",
						observed:
							outcome === "passed" ? "Read back record 42" : "Record missing",
						...(outcome === "blocked"
							? { blockedReason: "Test account unavailable" }
							: {}),
						evidence:
							outcome === "blocked"
								? []
								: [
										{
											kind: "http",
											executed: true,
											action: "POST /records; GET /records/42",
											details: "201 created; 200 record 42",
										},
									],
					},
				],
			},
		],
	});
}
function renamedFactory(baseWorkflows) {
	const definitions = structuredClone(baseWorkflows).filter((workflow) =>
		["factory", "takeover", "factory-pipeline"].includes(workflow.id),
	);
	const ids = new Map();
	const collect = (steps) => {
		for (const step of steps) {
			if (!ids.has(step.id)) ids.set(step.id, `node_${ids.size}`);
			for (const group of step.groups ?? []) collect(group);
		}
	};
	for (const workflow of definitions) collect(workflow.steps);
	const reference = (value) =>
		value.startsWith("@")
			? value
			: value
					.split("/")
					.map((part) => ids.get(part) ?? part)
					.join("/");
	const argumentsValue = (value) =>
		typeof value === "string"
			? (ids.get(value) ??
				value.replace(
					/outputs\.([\w-]+)/g,
					(_match, id) => `outputs.${ids.get(id) ?? id}`,
				))
			: Array.isArray(value)
				? value.map(argumentsValue)
				: value && typeof value === "object"
					? Object.fromEntries(
							Object.entries(value).map(([key, item]) => [
								key,
								argumentsValue(item),
							]),
						)
					: value;
	const rewrite = (steps) => {
		for (const step of steps) {
			step.id = ids.get(step.id);
			if (step.next && step.next !== "end") step.next = ids.get(step.next);
			for (const branch of step.branches)
				if (branch.next !== "end") branch.next = ids.get(branch.next);
			step.inputs = step.inputs?.map(reference);
			if (step.workflow) step.workflow = `renamed-${step.workflow}`;
			for (const [name, binding] of Object.entries(step.reads ?? {}))
				step.reads[name] =
					typeof binding === "string"
						? reference(binding)
						: { ...binding, from: reference(binding.from) };
			if (step.arguments) step.arguments = argumentsValue(step.arguments);
			if (step.args) step.args = argumentsValue(step.args);
			for (const group of step.groups ?? []) rewrite(group);
		}
	};
	for (const workflow of definitions) {
		workflow.id = `renamed-${workflow.id}`;
		workflow.name = `Renamed ${workflow.name}`;
		workflow.labels = [];
		rewrite(workflow.steps);
	}
	const originals = new Map([...ids].map(([old, current]) => [current, old]));
	return {
		definitions: [...baseWorkflows, ...definitions],
		original: (key) =>
			key
				.split("/")
				.map((part) => originals.get(part) ?? part)
				.join("/"),
	};
}

function providerReceipt(extra = {}) {
	return {
		data: {
			repository: {
				squashMergeAllowed: true,
				mergeCommitAllowed: true,
				rebaseMergeAllowed: true,
				pullRequest: {
					id: "PR_node",
					url: "https://github.com/test/repo/pull/1",
					headRefOid: "head",
					baseRefOid: "base",
					baseRefName: "main",
					baseRef: {
						name: extra.baseRefName ?? "main",
						target: { oid: extra.baseRefOid ?? "base" },
					},
					state: "OPEN",
					isDraft: true,
					isCrossRepository: false,
					isMergeQueueEnabled: false,
					isInMergeQueue: false,
					mergeable: "MERGEABLE",
					mergeStateStatus: "BLOCKED",
					reviewDecision: "REVIEW_REQUIRED",
					reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } },
					comments: { nodes: [], pageInfo: {} },
					reviews: { nodes: [], pageInfo: {} },
					statusCheckRollup: {
						contexts: {
							nodes: [
								{ name: "test", status: "COMPLETED", conclusion: "SUCCESS" },
							],
							pageInfo: { hasNextPage: false },
						},
					},
					...extra,
				},
			},
		},
	};
}
