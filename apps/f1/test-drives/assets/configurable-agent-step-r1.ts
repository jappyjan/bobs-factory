// F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/configurable-agent-step-r1.ts
// Actual EdgeWorker/CLI tracker/worktrees/MockAgentRunner. Git is local; forge responses are scripted.
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
import { digest } from "../../../../packages/edge-worker/dist/factory/Delivery.js";
import { defaultWorkflows } from "../../../../packages/edge-worker/dist/factory/defaultWorkflows.js";
import { FactoryTools } from "../../../../packages/edge-worker/dist/factory/FactoryTools.js";
import { formatOf } from "../../../../packages/edge-worker/dist/factory/StepConfig.js";
import { checkin } from "../../../../packages/edge-worker/test/fixtures/architecture.js";
import { deliveryFixture } from "../../../../packages/edge-worker/test/fixtures/grouped-delivery.js";
import {
	qaExecution,
	qaScope,
} from "../../../../packages/edge-worker/test/fixtures/qa.js";
import { renamedFactory } from "../../../../packages/edge-worker/test/fixtures/renamed-factory.js";
import { loadFactoryContextSnapshot } from "../../../../packages/mcp-tools/dist/index.js";
import { MockAgentRunner } from "../../src/MockAgentRunner.js";

assert.equal(process.env.F1_AGENT_MODE, "mock");
for (const key of Object.keys(process.env))
	if (key.startsWith("BOBS_FACTORY_")) delete process.env[key];
const root = process.cwd(),
	directory = realpathSync(
		mkdtempSync(join(tmpdir(), "f1-configurable-agent-")),
	),
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
const buildHash = createHash("sha256");
for (const packageName of ["core", "mcp-tools", "edge-worker"]) {
	const dist = join(root, "packages", packageName, "dist");
	for (const file of (readdirSync(dist, { recursive: true }) as string[])
		.filter((file) => file.endsWith(".js"))
		.sort())
		buildHash
			.update(`${packageName}/${file}`)
			.update("\0")
			.update(readFileSync(join(dist, file)))
			.update("\0");
}
const buildSha256 = buildHash.digest("hex");

const forge = deliveryFixture(directory),
	repository = forge.repositories[0]!;
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
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	const port = (server.address() as { port: number }).port;
	await new Promise<void>((done) => server.close(() => done()));
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
	turns: any[] = [],
	sessions: string[] = [],
	results: any[] = [];
const entry = defaultWorkflows
	.find((workflow) => workflow.id === "factory")!
	.steps.find((step) => step.type === "workflow")!;
const fanout = defaultWorkflows
	.find((workflow) => workflow.id === entry.workflow)!
	.steps.find((step) => step.type === "fanout")!;
assert(fanout.groups!.every((group) => group.length === 1));
const parallelMembers = new Set(
	fanout.groups!.map(
		(group, index) => `${entry.id}/${fanout.id}/${index}/${group[0]!.id}`,
	),
);
function comparableTurns(runId: string) {
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
	const ordered: typeof actual = [];
	for (let index = 0; index < actual.length; ) {
		if (!parallelMembers.has(actual[index]!.key)) {
			ordered.push(actual[index++]!);
			continue;
		}
		const start = index;
		while (index < actual.length && parallelMembers.has(actual[index]!.key))
			index++;
		ordered.push(
			...actual.slice(start, index).sort((a, b) => a.key.localeCompare(b.key)),
		);
	}
	return ordered;
}
let runtime: any;
const contract: any = {
	format: "delivery-v1",
	version: 1,
	mode: "repository",
	authorization: { status: "authorized", reference: "Original request" },
	executionReference: "set-from-run",
	targets: [],
};
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
							icon: "✓",
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
function reply(
	format: string,
	run: any,
	snapshot: any,
	workingDirectory: string,
) {
	switch (format) {
		case "clarify-v1":
			return {
				questions: [],
				decisions: [],
				requirements: ["Save a record"],
				deliveryMode: "repository",
			};
		case "plan-v1":
			contract.executionReference = digest(
				run.executionSnapshot ?? {
					runner: run.runner,
					repositoryId: run.repositoryId,
				},
			);
			return { plan: "Save a record", assets: [], deliveryContract: contract };
		case "plan-review-v1":
			return {
				approved: true,
				feedback: [],
				deliveryContractDigest: digest(contract),
			};
		case "architecture-checkin-v1": {
			const proposal = checkin("routine");
			proposal.problem = [
				{
					repository: repository.id,
					paths: ["shared.txt"],
					observation: "The record needs saving.",
				},
			];
			proposal.evidence = [
				{
					repository: repository.id,
					paths: ["shared.txt"],
					observation: "Existing record format.",
				},
			];
			proposal.candidate.steps[0]!.files = [
				{ path: "shared.txt", change: "edit" },
			];
			proposal.candidate.plan = "Save a record";
			proposal.map = undefined;
			proposal.decisions = [];
			proposal.talk!.checks = [];
			return proposal;
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
			return {
				impactContract: "impact-v1",
				status: "completed",
				summary: "Review the complete implementation",
				classification: "full",
				rationale: "New record behavior needs all specialists",
				uncertainty: [],
				extractRequirements: true,
				specialists: snapshot.impactSnapshot.reviewers.map(
					(reviewer: any) => reviewer.id,
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
			return {
				status: "completed",
				blockers: [],
				summary: "Record behavior inspected",
				findings: [],
				disagreements: [],
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
			receipt.results[0]!.criteria[0]!.observed = observed;
			receipt.results[0]!.criteria[0]!.evidence = [
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
			name: "Configurable Factory F1",
			repositoryPath: repository.workspace,
			workspaceBaseDir: join(directory, "worktrees"),
			baseBranch: "main",
			githubUrl: repository.githubUrl,
			linearWorkspaceId: "cli-workspace",
			isActive: true,
		},
	],
	handlers: {
		createAgentRunner: (_type: any, config: any) => {
			const connection = config.mcpConfig?.["factory-context"];
			if (!connection)
				return new MockAgentRunner(
					config,
					JSON.stringify({ title: "F1 configurable Factory" }),
				);
			const snapshot = loadFactoryContextSnapshot(connection.args.at(-1));
			const run = [...runtime.runs.values()].find(
				(run: any) =>
					run.status === "running" && run.workspace === config.workingDirectory,
			) as any;
			assert(run, "Factory runner must belong to the active fixture run");
			const role = snapshot.workflowExecution.currentStep.id;
			const path = snapshot.workflowExecution.currentStep.key.split("/");
			let steps = run.workflow.steps;
			let step: any;
			while (path.length) {
				const id = path.shift();
				step = steps.find((candidate: any) => candidate.id === id);
				assert(
					step,
					`Missing fixture step at ${snapshot.workflowExecution.currentStep.key}: ${id}`,
				);
				if (step.type === "workflow")
					steps = run.workflowDefinitions.find(
						(definition: any) => definition.id === step.workflow,
					).steps;
				else if (step.type === "fanout")
					steps = step.groups[Number(path.shift())];
			}

			const format = formatOf(step);
			assert(format, role);
			turns.push({
				run: run.id,
				key: snapshot.workflowExecution.currentStep.key,
				role: fork.original(role),
				format,
			});
			return new MockAgentRunner(
				config,
				JSON.stringify(reply(format, run, snapshot, config.workingDirectory)),
			);
		},
	},
});
runtime = worker.getFactoryRuntime();
const tools = new FactoryTools({
	postComment: async () => {},
	command: forge.command,
});
runtime.hooks.tool = (context: any) => tools.tool(context);
async function rpc(method: string, params: any = {}) {
	const response = await fetch(`${rpcOrigin}/cli/rpc`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
	});
	const payload = await response.json();
	assert(!payload.error, JSON.stringify(payload));
	return payload.result;
}
async function until(check: () => boolean, message: string) {
	const end = Date.now() + 180000;
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
				[...runtime.runs.values()].map((r: any) => ({
					id: r.id,
					status: r.status,
					step: r.step,
					error: r.error,
					events: r.events.slice(-3),
				})),
			),
	);
}
try {
	runtime.updateWorkflows(fork.definitions, "factory");
	await worker.start();
	await rpc("ping");
	for (const renamed of [false, true]) {
		const workflowId = renamed ? "renamed-factory" : "factory";
		runtime.updateWorkflows(runtime.listWorkflows(), workflowId);
		forge.requests.clear();
		const { issue } = await rpc("createIssue", {
			teamId: "team-default",
			title: `F1 ${renamed ? "renamed" : "stock"} Factory`,
			description: "Save a record",
		});
		const { session } = await rpc("startSession", { issueId: issue.id });
		sessions.push(session.sessionId);
		await until(
			() => runtime.runs.get(session.sessionId)?.status === "waiting",
			"Factory did not reach explicit review",
		);
		const run = runtime.get(session.sessionId);
		assert.equal(run.reviewGate?.status, "pending");
		runtime.decide(run.id, {
			reviewId: run.reviewGate.id,
			headSha: run.reviewGate.headSha,
			decision: "approve",
		});
		await until(
			() => run.status === "completed",
			"Factory did not complete after approval",
		);
		const timeline = await rpc("viewSession", {
			sessionId: run.id,
			limit: 1000,
			offset: 0,
		});
		assert(timeline.totalCount > 0);
		await (worker as any).getTicketTracking().flush(run);
		const comments = await tracker.fetchComments(issue.id);
		assert(
			comments.nodes.length > 0,
			"CLI completion preserves durable ticket comments",
		);
		writeFileSync(
			join(directory, `${renamed ? "renamed" : "stock"}-comments.json`),
			JSON.stringify(
				comments.nodes.map((comment: any) => ({ body: comment.body })),
				null,
				2,
			),
		);
		assert(
			timeline.activities.every(
				(activity: any) => activity.content && activity.createdAt,
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
		assert(sequence.includes("qa-capture-v1"));
		assert(sequence.includes("review-brief-v3"));
		results.push({
			workflowId,
			sessionId: run.id,
			status: run.status,
			sequence,
			activityCount: timeline.totalCount,
			activityTypes: [
				...new Set(timeline.activities.map((activity: any) => activity.type)),
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
			join(directory, `${renamed ? "renamed" : "stock"}-activities.json`),
			JSON.stringify(timeline, null, 2),
		);
	}
	// Revision snapshots are asynchronous. Compare only the contiguous declared
	// specialist phase without imposing scheduler order on independent groups.
	// Raw turns remain unchanged in the report; all serial boundaries stay exact.
	assert.deepEqual(
		comparableTurns(results[1].sessionId),
		comparableTurns(results[0].sessionId),
	);
	assert.deepEqual(forge.publications, [repository.id, repository.id]);
	assert.deepEqual(forge.merges, [repository.id, repository.id]);

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
			paidCalls: 0,
		}),
	);
} finally {
	for (const id of sessions)
		try {
			await rpc("stopSession", { sessionId: id });
		} catch {
			runtime.stop(id);
		}
	await worker.stop();
}
