import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { evaluateCheck } from "../src/factory/Check.js";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { runEvidenceChecks } from "../src/factory/EvidenceChecks.js";
import { parseStepOutputAsync } from "../src/factory/OutputFormats.js";
import { nativeAgentReads } from "../src/factory/RolePrompt.js";
import {
	evaluateTransformAsync,
	TransformSchema,
} from "../src/factory/Rules.js";
import { v2ReviewRecipe } from "../src/factory/v2ReviewRecipe.js";
import { WorkflowSchema } from "../src/factory/Workflow.js";
import {
	type ExecutionContext,
	type FactoryRun,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import { FactoryServer } from "./fixtures/authenticated-factory.js";
import { waitForRuntime } from "./fixtures/runtime-wait.js";

vi.mock("../src/factory/FactoryWebAssets.js", () => ({
	factoryWebAssets: () => ({
		build: "000000000000000000000000",
		protocol: 1,
		assets: [],
	}),
}));
const provider = vi.hoisted(() => vi.fn());
vi.mock("../src/factory/GitProvider.js", async (original) => ({
	...(await original<object>()),
	resolveGitProvider: provider,
}));
const owned: {
	home: string;
	runtimes: WorkflowRuntime[];
	servers: FactoryServer[];
}[] = [];
afterEach(async () => {
	for (const resource of owned.splice(0)) {
		for (const runtime of resource.runtimes) await runtime.shutdown();
		for (const server of resource.servers) await server.stop();
		rmSync(resource.home, { recursive: true, force: true });
	}
	provider.mockReset();
});
const ids = [
	"security-review",
	"architecture-review",
	"integration-review",
	"simplicity-review",
	"correctness-review",
	"requirements-review",
];
const requirements = {
	summary: "Deliver the correction",
	requirements: [{ id: "R1", text: "The operation returns the correct value" }],
	decisions: [],
	outOfScope: [],
};
const plan = {
	summary: "Correct the operation",
	deliveryMode: "repository",
	steps: [{ id: "S1", text: "Fix and verify", requirementRefs: ["R1"] }],
	risks: [],
	repositories: ["fixture"],
};
function complaint(id = "correctness-review:F1", extra: object = {}) {
	return {
		id,
		rating: 2,
		status: "open",
		title: "The operation is incorrect",
		requirementRefs: ["R1"],
		evidence: "correctness-review.txt:1",
		remedy: "Return the correct value",
		reason: "",
		freshEvidence: "",
		kind: "finding",
		duplicateOf: "",
		...extra,
	};
}
function receipt(id: string, findings: unknown[] = []) {
	return {
		reviewer: id,
		status: "completed",
		summary: "Inspected the assigned area",
		findings,
		coverage:
			id === "requirements-review"
				? [
						{
							requirementId: "R1",
							status: "met",
							evidence: "Verified the operation",
							reason: "Required behavior is covered",
							decisionId: "",
						},
					]
				: [],
	};
}
type Options = {
	beforeAgent?: (ctx: ExecutionContext) => Promise<void>;
	impact?: (ctx: ExecutionContext) => object;
	reviewer?: (
		id: string,
		calls: number,
		ctx: ExecutionContext,
	) => unknown | Promise<unknown>;
	fix?: (ctx: ExecutionContext) => object | undefined;
};
function fixture(options: Options = {}) {
	const home = mkdtempSync(join(tmpdir(), "v2-review-"));
	const source = join(home, "source"),
		workspace = join(home, "worktree"),
		remote = join(home, "remote.git");
	mkdirSync(source);
	const git = (...args: string[]) =>
		execFileSync("git", args, {
			cwd: workspace,
			encoding: "utf8",
			stdio: "pipe",
		}).trim();
	const sourceGit = (...args: string[]) =>
		execFileSync("git", args, {
			cwd: source,
			encoding: "utf8",
			stdio: "pipe",
		}).trim();
	sourceGit("init", "-qb", "main");
	sourceGit("config", "user.name", "Review fixture");
	sourceGit("config", "user.email", "review@example.test");
	sourceGit("config", "commit.gpgsign", "false");
	for (const id of ids) writeFileSync(join(source, `${id}.txt`), "original");
	sourceGit("add", ".");
	sourceGit(
		"-c",
		"core.hooksPath=/dev/null",
		"commit",
		"-qm",
		"Fixture [skip ci]",
	);
	sourceGit("init", "--bare", remote);
	sourceGit("remote", "add", "origin", remote);
	sourceGit("push", "-u", "origin", "main");
	sourceGit("worktree", "add", workspace, "-b", "feature");
	const calls: string[] = [];
	const counters = new Map<string, number>();
	let fixed = 0;
	const resource = {
		home,
		runtimes: [] as WorkflowRuntime[],
		servers: [] as FactoryServer[],
	};
	owned.push(resource);
	const url = "https://github.com/fixture/repo/pull/1";
	const pr = {
		repositories: [
			{ id: "fixture", head: git("rev-parse", "HEAD"), url, isDraft: true },
		],
	};
	const forge = { title: "Correction", body: "Existing draft" };
	provider.mockImplementation(async () => ({
		list: async () => [{ url, isDraft: true }],
		view: async () => ({
			...forge,
			url,
			number: 1,
			state: "OPEN",
			isDraft: true,
			isCrossRepository: false,
			headRefName: "feature",
			headRefOid: git("rev-parse", "HEAD"),
			baseRefName: "main",
		}),
		update: async (_url: string, input: object) => Object.assign(forge, input),
	}));
	const hooks = {
		agent: async (ctx: ExecutionContext) => {
			const id = ctx.step.id;
			await options.beforeAgent?.(ctx);
			calls.push(id);
			counters.set(id, (counters.get(id) ?? 0) + 1);
			let output: unknown;
			if (id === "assess-impact")
				output = {
					summary: "Inspect each independent area",
					architectureRevision: false,
					readinessOnly: false,
					reviewers: Object.fromEntries(
						ids.map((id) => [id, { paths: [`${id}.txt`], corrections: [] }]),
					),
					...options.impact?.(ctx),
				};
			else if (id === "code-fix") {
				fixed++;
				output = {
					status: "completed",
					architectureRevision: false,
					summary: "Corrected the behavior",
					message: "fix: correct reviewed behavior [skip ci]",
					title: "Correction",
					body: "Corrected and independently reviewed",
					dispositions: [],
					...options.fix?.(ctx),
				};
			} else
				output =
					(await options.reviewer?.(id, counters.get(id)!, ctx)) ?? receipt(id);
			const parsed = await parseStepOutputAsync(
				ctx.step,
				output,
				undefined,
				ctx.signal,
			);
			return runEvidenceChecks(ctx, parsed);
		},
		tool: async () => {
			throw new Error("Legacy tool must not run");
		},
		script: async () => {
			throw new Error("Script must not run");
		},
	};
	const workflow = defaultWorkflows.find((w) => w.id === v2ReviewRecipe.id)!;
	const runtime = () => {
		const runtime = new WorkflowRuntime(home, hooks);
		runtime.updateWorkflows(defaultWorkflows);
		resource.runtimes.push(runtime);
		return runtime;
	};
	const instance = runtime();
	const create = () =>
		instance.create({
			title: "Review fixture",
			repositoryId: "fixture",
			workspace,
			input: "Review the correction",
			workflow,
			workflowDefinitions: defaultWorkflows,
			launchInputs: {
				requirements: JSON.stringify(requirements),
				plan: JSON.stringify(plan),
				pr: JSON.stringify(pr),
			},
			triggerOrigin: {
				type: "manual",
				workflowId: workflow.id,
				at: new Date().toISOString(),
			},
		});
	const server = (runtime: WorkflowRuntime) => {
		const server = new FactoryServer(runtime, {
			repositories: () => [{ id: "fixture", name: "Fixture" }],
			sessions: () => [],
			entries: () => [],
			stop: (id) => runtime.stop(id),
			start: async () => {
				const run = create();
				void runtime.launch(run);
				return run;
			},
		});
		resource.servers.push(server);
		return server;
	};
	return {
		home,
		workspace,
		git,
		calls,
		counters,
		instance,
		runtime,
		create,
		server,
		pr,
		get fixes() {
			return fixed;
		},
		fixFile: () =>
			writeFileSync(join(workspace, "correctness-review.txt"), "fixed"),
		isFixed: () =>
			readFileSync(join(workspace, "correctness-review.txt"), "utf8") ===
			"fixed",
	};
}
function output(run: FactoryRun) {
	return run.outputs.review as {
		approved: boolean;
		findings: { id: string }[];
		coverage: { requirementId: string; status: string }[];
		ledger: { id: string; finding: { status: string } }[];
		outcome: string;
	};
}
async function completed(runtime: WorkflowRuntime, run: FactoryRun) {
	void runtime.launch(run);
	await waitForRuntime(() =>
		expect(
			["completed", "failed", "stopped"].includes(run.status) ||
				!!run.viewDecision,
		).toBe(true),
	);

	expect(run.error).toBeUndefined();
	expect(run.status).toBe("completed");
	return output(run);
}

it("approves a clean standalone review through only generic nodes", async () => {
	const f = fixture();
	const run = f.create();
	const review = await completed(f.instance, run);
	expect(review).toMatchObject({
		approved: true,
		findings: [],
		coverage: [{ requirementId: "R1", status: "met" }],
		outcome: "completed",
	});
	expect(f.calls).toEqual(["assess-impact", ...ids]);
	expect(f.fixes).toBe(0);
	expect(run.reviewRounds).toBeUndefined();
	expect(run.reviewGate).toBeUndefined();
});

it("commits, pushes, ensures the PR and reruns only the reviewer whose scoped content changed", async () => {
	const f = fixture({
		reviewer: (id) =>
			receipt(
				id,
				id === "correctness-review"
					? [
							complaint(
								undefined,
								f.isFixed()
									? {
											status: "resolved",
											reason: "Verified the correction",
											evidence: "Checked fixed operation",
										}
									: {},
							),
						]
					: [],
			),
		fix: () => {
			f.fixFile();
		},
	});
	const before = f.git("rev-parse", "HEAD");
	const run = f.create();
	const review = await completed(f.instance, run);
	expect(review.approved).toBe(true);
	expect(f.fixes).toBe(1);
	for (const id of ids)
		expect(f.counters.get(id), id).toBe(id === "correctness-review" ? 2 : 1);
	expect(f.git("rev-parse", "HEAD")).not.toBe(before);
	expect(
		f.git("ls-remote", "--heads", "origin", "feature").split(/\s/)[0],
	).toBe(f.git("rev-parse", "HEAD"));
	expect(
		run.history
			.filter((h) => ["commit", "push", "publish-correction"].includes(h.step))
			.map((h) => h.step),
	).toEqual(["commit", "push", "publish-correction"]);
	expect(
		run.events.filter((e) => e.message === "reused (inputs unchanged)"),
	).toHaveLength(5);
	expect(review.ledger[0]?.finding.status).toBe("resolved");
});

it("retains nitpicks in the ledger without blocking", async () => {
	const f = fixture({
		reviewer: (id) =>
			receipt(
				id,
				id === "simplicity-review"
					? [complaint("simplicity-review:N1", { rating: 1 })]
					: [],
			),
	});
	const review = await completed(f.instance, f.create());
	expect(review.approved).toBe(true);
	expect(review.findings).toEqual([]);
	expect(review.ledger).toHaveLength(1);
	expect(f.fixes).toBe(0);
});

it("drives a stall, cold restart and human continue through the authenticated API, then resumes correction", async () => {
	let allowed = false;
	const f = fixture({
		reviewer: (id) =>
			receipt(
				id,
				id === "correctness-review" && !f.isFixed()
					? [complaint()]
					: id === "correctness-review"
						? [
								complaint(undefined, {
									status: "resolved",
									reason: "Rechecked the fix",
								}),
							]
						: [],
			),
		fix: (ctx) => {
			const answer = nativeAgentReads(ctx.step, ctx.input).assistance as
				| { values?: { notes?: string } }
				| undefined;
			if (answer) {
				expect(answer.values?.notes).toBe(
					"Access is restored. Apply the correction.",
				);
				allowed = true;
			}
			if (allowed) f.fixFile();
		},
	});
	const server = f.server(f.instance);
	const created = await server.app.inject({
		method: "POST",
		url: "/api/runs",
		headers: { "x-factory-request": "1" },
		payload: {
			repositoryId: "fixture",
			workflow: v2ReviewRecipe.id,
			prompt: "Review the correction",
			inputs: {
				requirements: JSON.stringify(requirements),
				plan: JSON.stringify(plan),
				pr: JSON.stringify(f.pr),
			},
		},
	});
	expect(created.statusCode, created.body).toBe(202);
	const run = f.instance.get(created.json().id);
	await waitForRuntime(() => {
		expect(run.viewDecision, run.error).toBeDefined();
		expect(run.status).toBe("waiting");
	});
	expect(run.step).toBe("assistance");
	expect(f.fixes).toBe(1);
	await f.instance.shutdown();
	const restarted = f.runtime();
	const loaded = restarted.get(run.id);
	restarted.resumeAll();
	await waitForRuntime(() => {
		expect(restarted.isExecuting(run.id)).toBe(true);
		expect(loaded.status, loaded.error).toBe("waiting");
	});
	const api = f.server(restarted);
	const answer = await api.app.inject({
		method: "POST",
		url: `/api/runs/${run.id}/view-answer`,
		headers: { "x-factory-request": "1" },
		payload: {
			batchId: loaded.viewDecision!.id,
			digest: loaded.viewDecision!.digest,
			documentDigest: loaded.viewDecision!.documentDigest,
			accepted: true,
			action: "continue",
			values: { notes: "Access is restored. Apply the correction." },
		},
	});
	expect(answer.statusCode, answer.body).toBe(200);
	await waitForRuntime(() =>
		expect(loaded.status, loaded.error).toBe("completed"),
	);
	expect(output(loaded).approved).toBe(true);
	expect(f.fixes).toBe(2);
	expect(loaded.history.filter((h) => h.step === "assistance")).toHaveLength(1);
	const fetched = await api.app.inject({
		method: "GET",
		url: `/api/runs/${run.id}`,
	});
	expect(fetched.statusCode).toBe(200);
	expect(fetched.json().outputs.review.approved).toBe(true);
});

it.each([
	"architecture",
	"ci",
])("returns the %s handoff with the review port", async (route) => {
	const f = fixture({
		impact: () => ({
			architectureRevision: route === "architecture",
			readinessOnly: route === "ci",
		}),
	});
	const review = await completed(f.instance, f.create());
	expect(review).toMatchObject({
		approved: false,
		findings: [],
		coverage: [{ requirementId: "R1", status: "not_met" }],
		outcome: `to-${route}`,
	});
	expect(f.calls).toEqual(["assess-impact"]);
});

it("restarts mid-parallel without duplicating completed or not-yet-admitted agent calls", async () => {
	let restarted = false,
		pending = false;
	const f = fixture({
		beforeAgent: async (ctx) => {
			if (ctx.step.id === "requirements-review" && !restarted) {
				pending = true;
				await new Promise<void>((_resolve, reject) =>
					ctx.signal.addEventListener(
						"abort",
						() => reject(ctx.signal.reason),
						{ once: true },
					),
				);
			}
		},
	});
	const run = f.create();
	void f.instance.launch(run);
	await waitForRuntime(() => {
		expect(pending).toBe(true);
		expect(
			run.history.filter((h) => h.step.startsWith("specialist-review/")).length,
			run.error,
		).toBe(5);
	});
	await f.instance.shutdown();
	restarted = true;
	const runtime = f.runtime(),
		loaded = runtime.get(run.id);
	runtime.resumeAll();
	await waitForRuntime(() =>
		expect(loaded.status, loaded.error).toBe("completed"),
	);
	expect(output(loaded).approved).toBe(true);
	for (const id of ["assess-impact", ...ids])
		expect(f.counters.get(id), id).toBe(1);
	expect(
		loaded.history.filter((h) => h.step.startsWith("specialist-review/")),
	).toHaveLength(6);
});

const parsedRecipe = WorkflowSchema.parse(v2ReviewRecipe);
async function transform(id: string, inputs: unknown) {
	const step = parsedRecipe.steps.find((s) => s.id === id)!;
	return evaluateTransformAsync(TransformSchema.parse(step.transform), inputs);
}
async function ledger(current: unknown[], prior: unknown[]) {
	return (await transform("aggregate", { current, prior })).ledger as {
		id: string;
		finding: ReturnType<typeof complaint>;
	}[];
}
const wrapped = (
	finding: ReturnType<typeof complaint>,
	previous?: unknown,
) => ({
	id: finding.id,
	reviewer: finding.id.split(":")[0],
	finding,
	previous,
});

it("retains omitted open findings and disagreements, and applies evidence-backed reviewer dispositions", async () => {
	const prior = [
		wrapped(complaint()),
		wrapped(complaint("architecture-review:D1", { kind: "disagreement" })),
	];
	const retained = await ledger([], prior);
	expect(retained.map((f) => f.id)).toEqual(prior.map((f) => f.id));
	const resolved = complaint(undefined, {
		status: "accepted-rejection",
		reason: "Reproduction disproved the claim",
		evidence: "Actual check receipt",
	});
	const next = await ledger([wrapped(resolved, prior[0])], prior);
	expect(next[0]?.finding.status).toBe("accepted-rejection");
	expect(next[1]?.finding.status).toBe("open");
});

it("retains settlement on unsupported reopening, but accepts fresh evidence", async () => {
	const prior = wrapped(
		complaint(undefined, { status: "resolved", reason: "Verified the fix" }),
	);
	expect(
		(await ledger([wrapped(complaint(), prior)], [prior]))[0]?.finding.status,
	).toBe("resolved");
	expect(
		(
			await ledger(
				[
					wrapped(
						complaint(undefined, {
							freshEvidence: "New failing boundary case",
						}),
						prior,
					),
				],
				[prior],
			)
		)[0]?.finding.status,
	).toBe("open");
});

it("deduplicates exact aliases only, preserving independent and cyclic duplicate claims in the ledger", async () => {
	const original = complaint();
	const alias = complaint("security-review:F2", { duplicateOf: original.id });
	const independent = complaint("integration-review:F3", {
		duplicateOf: original.id,
		evidence: "Different failure",
	});
	const cycle = complaint("architecture-review:F4", {
		duplicateOf: "architecture-review:F4",
	});
	const all = [original, alias, independent, cycle].map((f) => wrapped(f));
	const review = await transform("actionable", {
		ledger: all,
		coverage: [],
		requirements,
	});
	expect((review.findings as { id: string }[]).map((f) => f.id)).toEqual([
		original.id,
		independent.id,
		cycle.id,
	]);
	expect((await ledger(all, [])).map((f) => f.id)).toEqual(
		all.map((f) => f.id),
	);
});

it.each([
	{ rows: [] },
	{
		rows: [
			{
				requirementId: "R1",
				status: "deliberately_skipped",
				decisionId: "unaccepted",
			},
		],
	},
])("treats missing coverage and unauthorized scope waivers as not_met (%j)", async ({
	rows,
}) => {
	const normalized = await transform("coverage", { requirements, rows });
	const review = await transform("actionable", {
		ledger: [],
		coverage: normalized.rows,
		requirements,
	});
	expect(review.coverage).toEqual([{ requirementId: "R1", status: "not_met" }]);
});

it("accepts only an explicit waiver for the covered requirement", async () => {
	const input = {
		...requirements,
		decisions: [
			{
				id: "D1",
				question: "Defer R1?",
				answer: "Explicitly accepted",
				kind: "skip",
				requirementRefs: ["R1"],
				source: "Human answer 42",
			},
		],
	};
	const coverage = [
		{
			requirementId: "R1",
			assessment: {
				requirementId: "R1",
				status: "deliberately_skipped",
				decisionId: "D1",
			},
		},
	];
	expect(
		(
			await transform("actionable", {
				ledger: [],
				coverage,
				requirements: input,
			})
		).coverage,
	).toEqual([{ requirementId: "R1", status: "deliberately_skipped" }]);
	input.decisions[0]!.requirementRefs = ["R2"];
	expect(
		(
			await transform("actionable", {
				ledger: [],
				coverage,
				requirements: input,
			})
		).coverage,
	).toEqual([{ requirementId: "R1", status: "not_met" }]);
});

it("requires all six reviewers completed even when findings and coverage look clean", () => {
	const gate = parsedRecipe.steps.find((s) => s.id === "approved")!.check!;
	const input = {
		review: {
			findings: [],
			coverage: [{ requirementId: "R1", status: "met" }],
		},
		reviewers: ids.map((id) => ({ [id]: receipt(id) })),
	};
	expect(evaluateCheck(gate, input, {}, undefined, () => true).passed).toBe(
		true,
	);
	input.reviewers[0]![ids[0]!]!.status = "blocked";
	expect(evaluateCheck(gate, input, {}, undefined, () => true).passed).toBe(
		false,
	);
	input.reviewers.shift();
	expect(evaluateCheck(gate, input, {}, undefined, () => true).passed).toBe(
		false,
	);
});

it("asks for human help after four rejected rounds even when each correction changes HEAD", async () => {
	let corrections = 0;
	const f = fixture({
		reviewer: (id) =>
			receipt(id, id === "correctness-review" ? [complaint()] : []),
		fix: () => {
			writeFileSync(
				join(f.workspace, "correctness-review.txt"),
				`attempt ${++corrections}`,
			);
		},
	});
	const run = f.create();
	void f.instance.launch(run);
	await waitForRuntime(() => expect(run.viewDecision, run.error).toBeDefined());
	expect(run.step).toBe("assistance");
	expect(corrections).toBe(3);
	expect(run.outputs["round-budget"]).toMatchObject({
		stalled: true,
		cycles: 4,
	});
});

it("rejects needs-input corrections without a display before publication", async () => {
	const f = fixture({
		reviewer: (id) =>
			receipt(id, id === "correctness-review" ? [complaint()] : []),
		fix: () => ({ status: "needs-input" }),
	});
	const run = f.create();
	await f.instance.launch(run);
	expect(run.status).toBe("failed");
	expect(run.error).toContain("needs-input requires a display document");
	expect(run.outputs.push).toBeUndefined();
});
