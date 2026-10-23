// Run through test/ReservationF1.test.ts with F1_AGENT_MODE=mock (source module loader).
// Runtime/Factory API + real isolated Git + controlled forge. No native/model/provider I/O.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
	githubApiReceipt,
	githubRequest,
} from "../../../../packages/edge-worker/test/fixtures/github-api.ts";

assert.equal(process.env.F1_AGENT_MODE, "mock");
const root = resolve(import.meta.dirname, "../../../..");
const source = resolve(
	process.env.F1_RUNTIME_SOURCE ??
		join(root, "packages/edge-worker/src/factory"),
);
const { defaultWorkflows } = await import(join(source, "defaultWorkflows.ts"));
const { WorkflowRuntime } = await import(join(source, "WorkflowRuntime.ts"));
const { validateWorkflows } = await import(join(source, "Workflow.ts"));
const { stockFactorySteps } = await import(
	join(source, "stockFactorySteps.ts")
);
const { FactoryTools } = await import(join(source, "FactoryTools.ts"));
const { FactoryServer } = await import(
	"../../../../packages/edge-worker/test/fixtures/authenticated-factory.ts"
);
const directory = mkdtempSync(join(tmpdir(), "f1-task146-"));
const resultFile = process.env.F1_RESULT;
assert.ok(
	resultFile && resolve(resultFile).startsWith(resolve(tmpdir())),
	"Use an own TMPDIR result path",
);
const gate = () => {
	let resolve;
	const promise = new Promise((r) => {
		resolve = r;
	});
	return { promise, resolve };
};
const held = gate(),
	entered = gate(),
	requested = gate();
const git = (cwd, ...args) =>
	execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
const seed = join(directory, "seed");
mkdirSync(seed);
git(seed, "init", "-qb", "main");
writeFileSync(join(seed, "source"), "Fixture\n");
git(seed, "add", ".");
git(
	seed,
	"-c",
	"user.name=F1",
	"-c",
	"user.email=f1@example.test",
	"-c",
	"commit.gpgsign=false",
	"commit",
	"-qm",
	"chore: fixture [skip ci]",
);
const head = git(seed, "rev-parse", "HEAD");
const local = validateWorkflows([
	...defaultWorkflows,
	{
		id: "isolated-correction",
		name: "Isolated correction",
		steps: [
			{
				id: "repair",
				name: "Local correction",
				type: "agent",
				prompt: "Correct local source; publication belongs to the next action",
				access: stockFactorySteps["code-fix"].access,
				next: "publish",
			},
			{
				id: "publish",
				name: "Publish correction",
				type: "tool",
				tool: "draft-pr",
				next: "end",
			},
		],
	},
]).at(-1);
const ready = validateWorkflows([
	...defaultWorkflows,
	{
		id: "ready-delivery",
		name: "Ready delivery",
		steps: [
			{
				id: "publication",
				name: "Continue prepared PR",
				type: "tool",
				tool: "draft-pr",
				next: "finalize",
			},
			{
				id: "finalize",
				name: "Final delivery",
				type: "tool",
				tool: "merge",
				reads: { draftPr: "publication" },
				access: stockFactorySteps.merge.access,
				next: "end",
			},
		],
	},
]).at(-1);
const visits = [],
	providerCalls = [],
	events = [];
let providerMerged = false,
	submissions = 0,
	runtime,
	server,
	restored;
const tools = new FactoryTools({
	postComment: async () => {},
	command: async (context, exe, args) => {
		if (exe === "git") return git(context.run.workspace, ...args);
		const request = githubRequest(args);
		providerCalls.push({
			run: context.run.input,
			path: request.path,
			method: request.method ?? "GET",
		});
		if (request.path.endsWith("/merge")) {
			submissions++;
			requested.resolve();
		}
		return JSON.stringify(
			githubApiReceipt(args, {
				headRefOid: head,
				baseRefOid: head,
				isDraft: false,
				reviewDecision: "APPROVED",
				mergeStateStatus: "CLEAN",
				state: providerMerged ? "MERGED" : "OPEN",
				merged: providerMerged,
				mergeCommit: { oid: head },
			}),
		);
	},
});
const hooks = {
	agent: async ({ run }) => {
		visits.push(`${run.input}:repair`);
		entered.resolve();
		await held.promise;
		return {};
	},
	script: async () => ({}),
	tool: async (context) => {
		visits.push(`${context.run.input}:${context.step.tool}`);
		if (["draft-pr", "inspect-existing"].includes(context.step.tool))
			return { url: "https://github.com/test/repo/pull/1", headSha: head };
		return tools.tool(context);
	},
};
function observe(runtime, predicate) {
	if (predicate()) return Promise.resolve();
	return new Promise((done, reject) => {
		const timeout = setTimeout(() => {
			off();
			reject(new Error("Fixture transition timeout"));
		}, 15000);
		const off = runtime.subscribe(() => {
			if (predicate()) {
				clearTimeout(timeout);
				off();
				done();
			}
		});
		if (predicate()) {
			clearTimeout(timeout);
			off();
			done();
		}
	});
}
try {
	runtime = new WorkflowRuntime(directory, hooks);
	runtime.updateWorkflows([...defaultWorkflows, local, ready]);
	runtime.subscribe(({ id }) => {
		if (id) {
			const run = runtime.get(id);
			const c = run.deliveryCoordination;
			const key = JSON.stringify([id, run.status, c?.phase, c?.reason]);
			if (events.at(-1)?.key !== key)
				events.push({
					key,
					run: run.input,
					status: run.status,
					coordination: c ? structuredClone(c) : null,
				});
		}
	});
	server = new FactoryServer(runtime, {
		repositories: () => [{ id: "repo", name: "Fixture" }],
		sessions: () => [],
		entries: () => [],
		stop: (id) => runtime.stop(id),
		start: async (input) => {
			const workflow = input.workflow === ready.id ? ready : local,
				workspace = join(directory, input.prompt);
			git(seed, "worktree", "add", "-qb", input.prompt, workspace, "main");
			const run = runtime.create({
				repositoryId: "repo",
				workflow,
				workspace,
				input: input.prompt,
				triggerOrigin: {
					type: "manual",
					workflowId: workflow.id,
					at: new Date().toISOString(),
				},
			});
			run.outputs.repository = {
				githubUrl: "https://github.com/test/repo",
				baseBranch: "main",
			};
			run.repositories = [
				{
					id: "repo",
					name: "Fixture",
					repositoryPath: seed,
					workspace,
					githubUrl: "https://github.com/test/repo",
					baseBranch: "main",
				},
			];
			run.takeoverSource = {
				url: "https://github.com/test/repo/pull/1",
				headSha: head,
				headRefName: input.prompt,
				baseRefName: "main",
			};
			run.outputs["draft-pr"] = {
				url: "https://github.com/test/repo/pull/1",
				headSha: head,
				baseSha: head,
			};
			if (workflow.id === ready.id)
				run.humanDecisions = [
					{
						decision: "approve",
						headSha: head,
						reviewId: "fixture-human-original",
						at: new Date().toISOString(),
					},
				];
			void runtime.launch(run);
			return run;
		},
	});
	const api = async (method, url, payload) => {
		const r = await server.app.inject({
			method,
			url,
			payload,
			headers: { "x-factory-request": "1" },
		});
		assert.ok(r.statusCode < 300, r.body);
		return r.json();
	};
	const fixer = await api("POST", "/api/runs", {
		repositoryId: "repo",
		workflow: local.id,
		prompt: "fixer",
	});
	await entered.promise;
	const delivery = await api("POST", "/api/runs", {
		repositoryId: "repo",
		workflow: ready.id,
		prompt: "delivery",
	});
	const newBoundary =
		stockFactorySteps["code-fix"].access.publication === "action";
	await observe(
		runtime,
		() =>
			runtime.get(delivery.id).status === "failed" ||
			(newBoundary
				? submissions === 1
				: runtime.get(delivery.id).deliveryCoordination?.phase === "queued"),
	);
	assert.notEqual(
		runtime.get(delivery.id).status,
		"failed",
		runtime.get(delivery.id).error,
	);
	const during = await api("GET", `/api/runs/${delivery.id}`);
	const beforeRelease = {
		fixerActive: runtime.isExecuting(fixer.id),
		mergeRequests: submissions,
		fixerClaim: structuredClone(runtime.get(fixer.id).deliveryCoordination ?? null),
		deliveryClaim: structuredClone(runtime.get(delivery.id).deliveryCoordination ?? null),
	};
	assert.equal(beforeRelease.fixerActive, true);
	assert.equal(submissions, newBoundary ? 1 : 0);
	if (!newBoundary) {
		held.resolve();
		await observe(
			runtime,
			() => submissions === 1 || runtime.get(delivery.id).status === "failed",
		);
		assert.equal(submissions, 1, runtime.get(delivery.id).error);
	}
	// Submission is not completion. Stop passive polling, then reconcile a controlled merge on restart.
	runtime.stop(delivery.id);
	held.resolve();
	await runtime.shutdown();
	assert.equal(submissions, 1);
	assert.equal(runtime.get(delivery.id).status, "stopped");
	const originalDecision = JSON.stringify(
		runtime.get(delivery.id).humanDecisions,
	);
	providerMerged = true;
	restored = new WorkflowRuntime(directory, hooks);
	restored.resume(delivery.id);
	await observe(
		restored,
		() =>
			restored.get(delivery.id).status === "completed" ||
			restored.get(delivery.id).status === "failed",
	);
	assert.equal(
		restored.get(delivery.id).status,
		"completed",
		restored.get(delivery.id).error,
	);
	assert.equal(submissions, 1);
	assert.equal(
		JSON.stringify(restored.get(delivery.id).humanDecisions),
		originalDecision,
	);
	const result = {
		mode: newBoundary ? "after" : "before",
		head,
		source,
		beforeRelease,
		visits,
		submissions,
		providerCalls,
		originalDecisionPreserved: true,
		restartConfirmedWithoutReplay: true,
		apiAdmission: during.deliveryCoordination ?? null,
		events,
		mocks: { paidCalls: 0, liveProviderCalls: 0, nativeAgentCalls: 0 },
		cleanup: {
			runtime: true,
			restoredRuntime: true,
			api: true,
			syntheticHome: true,
		},
	};
	await restored.shutdown();
	restored = undefined;
	await server.app.close();
	server = undefined;
	runtime = undefined;
	rmSync(directory, { recursive: true, force: true });
	writeFileSync(resultFile, JSON.stringify(result, null, 2));
	process.stdout.write(
		JSON.stringify({
			resultFile,
			mode: result.mode,
			beforeRelease,
			visits,
			submissions,
		}) + "\n",
	);
} catch (error) {
	writeFileSync(
		resultFile,
		JSON.stringify(
			{
				error: String(error),
				visits,
				submissions,
				providerCalls,
				events,
				retained: directory,
			},
			null,
			2,
		),
	);
	throw error;
} finally {
	held.resolve();
	for (const active of [runtime, restored])
		if (active) {
			for (const run of active.runs.values()) active.stop(run.id);
			await active.shutdown();
		}
	if (server) await server.app.close();
}
