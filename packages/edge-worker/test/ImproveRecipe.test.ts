import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { parseStepOutputAsync } from "../src/factory/OutputFormats.js";
import { pinReadOnlyAccess } from "../src/factory/RevisionBinding.js";
import { stepBindings } from "../src/factory/StepBindings.js";
import { WorkflowSchema } from "../src/factory/Workflow.js";
import {
	type ExecutionContext,
	type FactoryRun,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import { waitForRuntime } from "./fixtures/runtime-wait.js";

const homes: string[] = [],
	instances: WorkflowRuntime[] = [];
afterEach(async () => {
	for (const r of instances.splice(0)) await r.shutdown();
	for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});
const opportunity = (id: string, dependencies: string[] = []) => ({
	id,
	title: `Improve ${id}`,
	problem: `Split ${id} ownership`,
	evidence: ["README.md at the pinned source revision"],
	consequence: "Recovery crosses unrelated modules",
	before: "Callers coordinate state",
	after: "One owner coordinates state",
	plan: `Concentrate ${id} ownership and verify recovery`,
	criteria: ["MUST retain pending obligations across restart."],
	nonGoals: [],
	risks: [],
	paths: ["src/owner.ts"],
	strength: "strong",
	effort: "Small",
	dependencies,
	conflicts: [],
	perspectives: ["architecture"],
	issueBody: `Systemic ${id} ownership. Evidence: pinned README.md. Preserve state; verify recovery; no unrelated work.`,
});
function fixture(
	options: {
		workerFailure?: boolean;
		perspectiveFailure?: boolean;
		rejectOnce?: boolean;
		cycleOnce?: boolean;
		empty?: boolean;
		longReviewedPlan?: boolean;
	} = {},
) {
	const home = mkdtempSync(join(tmpdir(), "improve-blocks-"));
	homes.push(home);
	const git = (...args: string[]) =>
		execFileSync("git", ["-C", home, ...args], {
			encoding: "utf8",
			stdio: "pipe",
		}).trim();
	git("init", "-b", "main");
	git("config", "user.name", "Fixture");
	git("config", "user.email", "fixture@example.invalid");
	git("config", "commit.gpgsign", "false");
	git("config", "core.hooksPath", "/dev/null");
	writeFileSync(join(home, "README.md"), "Pinned architecture evidence\n");
	git("add", "README.md");
	git("commit", "-m", "Fixture");
	const revision = git("rev-parse", "HEAD");
	const calls: {
			key: string;
			input: Record<string, any>;
			prompt: string;
			model?: string;
		}[] = [],
		filed: string[] = [],
		deliveries = new Map<string, () => void>();
	let checks = 0,
		active = 0,
		peak = 0;
	const child = WorkflowSchema.parse({
		id: "factory",
		name: "Controlled Factory delivery",
		stepConfigVersion: "step-config-v1",
		allowedTriggers: ["manual", "workflow"],
		steps: [
			{
				id: "publish",
				name: "Publish controlled PR",
				type: "tool",
				tool: "draft-pr",
				next: "finish",
			},
			{
				id: "finish",
				name: "Confirm controlled merge",
				type: "tool",
				tool: "merge",
				next: "end",
			},
		],
	});
	const hooks = {
		agent: async (context: ExecutionContext) => {
			const input = stepBindings(context) as Record<string, any>;
			const key = context.stepKey!;
			const access = await pinReadOnlyAccess(context);
			expect(access.repositories.map((r) => r.revision)).toEqual([revision]);
			expect(context.step.access).toBe("read-only");
			calls.push({
				key,
				input: structuredClone(input),
				prompt: context.step.prompt!,
				model: context.step.model ?? context.run.model,
			});
			active++;
			peak = Math.max(peak, active);
			await new Promise((r) => setImmediate(r));
			active--;
			let value: unknown;
			switch (
				context.step.output && "format" in context.step.output
					? context.step.output.format
					: ""
			) {
				case "research-context-v1":
					value = {
						summary: "Shared map",
						focus: input.focus ?? "",
						context: "Pinned module and lifecycle map",
						limitations: [],
					};
					break;
				case "research-plan-v1":
					if (
						options.perspectiveFailure &&
						input.perspective.id === "operations"
					)
						throw new Error("Controlled perspective unavailable");
					value = {
						summary: input.perspective.brief,
						assignments: [
							{
								id: "one",
								question: `Inspect ${input.perspective.name}`,
								scope: ["README.md"],
							},
							{
								id: "two",
								question: "Inspect recovery seam",
								scope: ["README.md"],
							},
						],
					};
					break;
				case "research-result-v1":
					if (input.assignment) {
						if (
							options.workerFailure &&
							input.perspective.id === "security" &&
							input.assignment.id === "two"
						)
							throw new Error("Controlled worker unavailable");
						value = {
							summary: input.assignment.question,
							findings: [],
							limitations: input.execution.limitations,
						};
					} else
						value = {
							summary: `Verified ${input.perspective.id}`,
							findings: [],
							limitations: [
								...Object.values(input.workers.results).flatMap(
									(r: any) => r.worker.limitations,
								),
								...input.workers.summary.limitations,
							],
						};
					break;
				case "follow-up-v1":
					value = {
						itemId: input.question.itemId,
						answer: `Targeted answer: ${input.question.comment}`,
						evidence: ["README.md"],
						limitations: [],
					};
					break;
				case "proposals-v1":
					value = {
						summary: input.followUps
							? "Re-consolidated after targeted answer"
							: "Initial consolidated proposals",
						opportunities: options.empty
							? []
							: [
									opportunity("a"),
									opportunity("b", ["a"]),
									opportunity("later"),
									opportunity("skip"),
								],
						limitations: [
							"No step model is configured; this agent inherits the accepted run model.",
							...input.reports.summary.limitations,
						],
					};
					break;
				case "plan-package-v1":
					value = {
						id: input.item.id,
						itemIds: [input.item.id],
						title: input.item.title,
						// Criteria and paths deliberately exist only in their structured fields.
						plan: `${input.item.plan}\nAccepted baseline ${revision}\nNon-goals: no unrelated work.\n${input.feedback ? "Addressed independent review feedback." : "First refinement."}`.padEnd(
							options.longReviewedPlan ? 7980 : 0,
							".",
						),
						criteria: input.item.criteria,
						dependencies:
							options.cycleOnce &&
							input.item.id === "a" &&
							!input.dependencyFeedback
								? ["b"]
								: input.item.dependencies,
						paths: input.item.paths,
					};
					break;
				case "plan-check-v1": {
					if (context.step.id === "security") checks++;
					const approved = !(
						options.rejectOnce &&
						context.step.id === "security" &&
						checks === 1
					);
					value = {
						approved,
						feedback: approved
							? []
							: ["Add explicit recovery boundary validation"],
					};
					break;
				}
				default:
					throw new Error(`Unexpected agent ${key}`);
			}
			return parseStepOutputAsync(context.step, value);
		},
		tool: async (c: ExecutionContext) => {
			const proof = {
				url: `https://forge.test/pull/${c.run.recipeParent!.itemId}`,
				headSha: revision,
			};
			if (c.step.tool === "draft-pr") return proof;
			if (c.step.tool !== "merge")
				throw new Error(`Unexpected tool ${c.step.tool}`);
			await new Promise<void>((resolve, reject) => {
				deliveries.set(c.run.id, resolve);
				c.signal.addEventListener("abort", () => reject(c.signal.reason), {
					once: true,
				});
			});
			return { ...proof, merged: true };
		},
		script: async () => {
			throw new Error("Unexpected script");
		},
		issueDestinations: async () => ({
			options: [
				{
					name: "Controlled tracker",
					destination: {
						provider: "taskbot" as const,
						instance: "https://tracker.test",
						server: "fixture",
						project: "fixture",
					},
				},
			],
			limitations: [],
		}),
		fileIssue: async (_r: FactoryRun, issue: { itemId: string }) => {
			filed.push(issue.itemId);
			return { id: "71", url: "https://tracker.test/p/fixture/t/71" };
		},
		prepare: async (r: FactoryRun) => {
			if (r.recipeParent) {
				r.workspace = home;
				r.repositories!.forEach((repo) => {
					repo.workspace = home;
				});
			}
		},
	};
	const runtime = new WorkflowRuntime(join(home, "state"), hooks);
	instances.push(runtime);
	const definitions = defaultWorkflows.map((w) =>
		w.id === "factory" ? child : w,
	);
	const workflow = definitions.find((w) => w.id === "improve-codebase")!;
	const run = runtime.create(
		{
			id: "survey",
			triggerOrigin: {
				type: "manual",
				workflowId: workflow.id,
				at: new Date().toISOString(),
			},
			repositoryId: "fixture",
			workspace: home,
			repositories: [
				{
					id: "fixture",
					name: "Fixture",
					repositoryPath: home,
					workspace: home,
					baseBranch: "main",
				},
			],
			input: "Architectural survey",
			launchInputs: { focus: "Recovery" },
			runner: "codex",
			model: "accepted-model",
			workflow,
			workflowDefinitions: definitions,
		},
		{ workflow, workflowDefinitions: definitions, trigger: "manual" },
	);
	return {
		home,
		runtime,
		run,
		definitions,
		calls,
		filed,
		deliveries,
		revision,
		hooks,
		peak: () => peak,
		confirm: async (id: string, owner = runtime) => {
			const child = owner.get(id);
			child.humanDecisions = [
				{
					reviewId: "controlled-explicit-human",
					decision: "approve",
					headSha: revision,
					at: new Date().toISOString(),
				},
			];
			deliveries.get(id)!();
			await waitForRuntime(() => expect(child.status).toBe("completed"));
		},
	};
}
async function waiting(
	f: ReturnType<typeof fixture>,
	kind: string,
	old?: string,
) {
	await waitForRuntime(
		() => {
			expect(f.run.error).toBeUndefined();
			expect(
				f.run.viewDecision?.kind,
				JSON.stringify({
					status: f.run.status,
					step: f.run.step,
					calls: f.calls.slice(-2).map((c) => c.key),
					events: f.run.events.slice(-2).map((e) => e.message),
				}),
			).toBe(kind);
			expect(f.run.status).toBe("waiting");
			if (old) expect(f.run.viewDecision!.id).not.toBe(old);
		},
		{ timeout: 20000 },
	);
	return f.run.viewDecision!;
}
const request = (run: FactoryRun, extra: Record<string, unknown>) => ({
	batchId: run.viewDecision!.id,
	digest: run.viewDecision!.digest,
	accepted: true,
	...extra,
});
async function choose(f: ReturnType<typeof fixture>, ask = false) {
	const r = request(f.run, {
		choices: f.run.viewDecision!.items!.map((item) => ({
			itemId: item.id,
			action:
				item.id === "a" && ask
					? "ask"
					: item.id === "later"
						? "issue"
						: item.id === "skip"
							? "skip"
							: "fix",
			...(item.id === "a" && ask
				? { comment: "Which recovery boundary?" }
				: {}),
		})),
	});
	await f.runtime.answerView(f.run.id, r);
}

describe("Improve is an ordinary composed recipe", () => {
	it("executes nested research, targeted Ask, refine/check loop, exact approval and dependency-tracked actions", async () => {
		const f = fixture({
			workerFailure: true,
			perspectiveFailure: true,
			rejectOnce: true,
			cycleOnce: true,
			longReviewedPlan: true,
		});
		void f.runtime.launch(f.run);
		const first = await waiting(f, "decide");
		const research = f.calls.filter((c) => /perspectives\//.test(c.key));
		expect(research.filter((c) => c.key.endsWith("/coordinate"))).toHaveLength(
			8,
		);
		expect(research.filter((c) => c.key.endsWith("/worker"))).toHaveLength(14);
		expect(f.peak()).toBeLessThanOrEqual(4);
		expect(
			f.run.foreach?.perspectives?.items.filter(
				(i) => i.status === "completed",
			),
		).toHaveLength(7);
		const initial = structuredClone(f.run.outputs.consolidate);
		await choose(f, true);
		await waiting(f, "decide", first.id);
		expect(f.calls.filter((c) => /perspectives\//.test(c.key))).toHaveLength(
			research.length,
		);
		expect(f.calls.filter((c) => c.key.endsWith("/answer"))).toHaveLength(1);
		expect(f.calls.filter((c) => c.key.endsWith("/proposals"))).toHaveLength(2);
		expect(
			f.run.history.filter((h) => h.step === "consolidate")[0]!.output,
		).toEqual(initial);
		await expect(
			f.runtime.answerView(f.run.id, {
				batchId: first.id,
				digest: first.digest,
				accepted: true,
				choices: [],
			}),
		).rejects.toThrow();
		await choose(f);
		const approval = await waiting(f, "approve");
		expect(f.calls.filter((c) => c.key.endsWith("/plan"))).toHaveLength(6);
		expect(
			f.calls
				.filter((c) => c.key.endsWith("/plan"))
				.slice(4)
				.every((c) => c.input.feedback.passed === false),
		).toBe(true);
		const graphFailure = f.run.history.find(
			(h) =>
				h.step === "plan-dependencies" && (h.output as any)?.passed === false,
		)!;
		expect(graphFailure.output).toEqual({
			passed: false,
			ids: ["a", "b"],
			dependencies: [["b"], ["a"]],
		});
		expect(
			f.calls
				.filter((c) => c.key.endsWith("/plan"))
				.slice(2, 4)
				.map((c) => c.input.dependencyFeedback),
		).toEqual([graphFailure.output, graphFailure.output]);
		expect(
			f.calls.filter((c) =>
				["architecture", "security", "dependencies"].includes(
					c.key.split("/").at(-1)!,
				),
			),
		).toHaveLength(6);
		expect(
			approval.view.components.find((c) => c.id === "plans")!.data,
		).toEqual({
			items: expect.arrayContaining([
				expect.objectContaining({
					id: "a",
					body: expect.stringContaining(f.revision),
				}),
				expect.objectContaining({ id: "b" }),
			]),
		});
		expect(f.filed).toEqual([]);
		expect(
			[...f.runtime.runs.values()].filter((r) => r.recipeParent),
		).toHaveLength(0);
		// Request changes returns through ordinary Decide; completed research remains retained.
		await f.runtime.answerView(
			f.run.id,
			request(f.run, {
				approved: false,
				feedback: "Keep the accepted recovery boundary explicit",
			}),
		);
		await waiting(f, "decide");
		await choose(f);
		const revised = await waiting(f, "approve", approval.id);
		expect(f.calls.filter((c) => /perspectives\//.test(c.key))).toHaveLength(
			research.length,
		);
		expect(
			f.calls
				.filter((c) => c.key.endsWith("/plan"))
				.slice(-2)
				.every(
					(c) =>
						c.input.requestedChanges.feedback ===
						"Keep the accepted recovery boundary explicit",
				),
		).toBe(true);
		const callsBeforeRestart = f.calls.length;
		await f.runtime.shutdown();
		f.runtime = new WorkflowRuntime(join(f.home, "state"), f.hooks);
		instances.push(f.runtime);
		f.run = f.runtime.get(f.run.id);
		f.runtime.resumeAll();
		await waiting(f, "approve");
		expect(f.run.viewDecision).toEqual(revised);
		expect(f.calls).toHaveLength(callsBeforeRestart);
		const exact = structuredClone(
			f.run.viewRecords!.find((record) => record.snapshot.id === revised.id)!
				.snapshot,
		);
		await f.runtime.answerView(f.run.id, request(f.run, { approved: true }));
		await waitForRuntime(() => expect(f.filed).toEqual(["later"]));
		await waitForRuntime(() =>
			expect(
				[...f.runtime.runs.values()].filter((r) => r.recipeParent),
			).toHaveLength(1),
		);
		const batch = Object.values(f.run.launchActions!)[0]!;
		const a = batch.accepted.items.find((i) => i.id === "a")!,
			b = batch.accepted.items.find((i) => i.id === "b")!;
		const cards = exact.view.components.find(
			(component) => component.type === "itemCards",
		)!;
		if (cards.type !== "itemCards")
			throw new Error("Missing approved plan cards");
		const reviewed = new Map(cards.data.items.map((item) => [item.id, item]));
		const canonical = (id: string) => {
			const item = reviewed.get(id)!;
			expect(item.body).not.toContain(
				"MUST retain pending obligations across restart.",
			);
			expect(item.body).not.toContain("src/owner.ts");
			expect(item.details).toEqual([
				{
					label: "Acceptance criteria",
					value: "- MUST retain pending obligations across restart.",
				},
				{ label: "Dependencies", value: id === "b" ? "a" : "None" },
				{ label: "Paths", value: "src/owner.ts" },
			]);
			const text = `${item.body}\n\nAcceptance criteria:\n${item.details![0]!.value}\n\nDependencies: ${item.details![1]!.value}\nPaths: ${item.details![2]!.value}`;
			expect(text.length).toBeGreaterThan(8000);
			return text;
		};
		for (const item of [a, b]) expect(item.plan).toBe(canonical(item.id));
		const acceptedLaunch = structuredClone(batch.accepted);
		const assertChildInput = (item: typeof a) => {
			const child = f.runtime.get(item.runId);
			expect(child.input).toBe(
				`${item.prompt}\n\n## Plan\n${canonical(item.id)}`,
			);
			expect(child.launchInputs).toEqual({
				prompt: item.prompt,
				plan: canonical(item.id),
			});
			expect(child.recipeParent).toMatchObject({
				itemId: item.id,
				runId: f.run.id,
			});
		};
		assertChildInput(a);
		expect(a.dependencies).toEqual([]);
		expect(b.dependencies).toEqual(["a"]);
		await waitForRuntime(() => {
			expect(f.runtime.get(a.runId).error).toBeUndefined();
			expect(f.deliveries.has(a.runId)).toBe(true);
		});
		expect(f.runtime.runs.has(b.runId)).toBe(false);
		// This explicit test action supplies both the simulated human decision and provider merge.
		await f.confirm(a.runId, f.runtime);
		await waitForRuntime(() => expect(f.deliveries.has(b.runId)).toBe(true));
		assertChildInput(b);
		await f.confirm(b.runId, f.runtime);
		await waitForRuntime(() => expect(f.run.status).toBe("completed"));
		expect(batch.accepted).toEqual(acceptedLaunch);
		expect(
			f.run.viewRecords!.find((v) => v.snapshot.id === exact.id)!.snapshot,
		).toEqual(exact);
		expect(
			f.run.viewRecords!.find((record) => record.snapshot.id === exact.id)!
				.answer!.output,
		).toMatchObject({ approved: true, digest: exact.digest });
		expect(
			f.run.history.filter((h) => h.step === "dispatch/0/issues"),
		).toHaveLength(1);
		expect(
			f.run.history.filter((h) => h.step === "dispatch/1/launch"),
		).toHaveLength(1);
		expect(Object.values(f.run.launchActions!)[0]!.progress).toMatchObject({
			a: { status: "merged" },
			b: { status: "merged" },
		});
	}, 180000);
	it("forks the reachable closure and uses an edited perspective, prompt and renamed role", {
		timeout: 120000,
	}, async () => {
		const f = fixture();
		const fork = f.runtime.forkWorkflow("improve-codebase");
		const definitions = f.runtime.listWorkflows();
		const copied = definitions.find((w) => w.id === fork.id)!;
		const perspectives = copied.steps.find((s) => s.type === "foreach")!;
		if (!perspectives.items || !("values" in perspectives.items))
			throw new Error("Missing inline perspectives");
		(perspectives.items.values[0] as { brief: string }).brief =
			"Inspect only the EDITED seam";
		const researchId = perspectives.body![0]!.workflow!;
		const research = definitions.find((w) => w.id === researchId)!;
		research.steps[0]!.prompt =
			"EDITED coordinator prompt: return the bounded research-plan-v1 shape.";
		research.steps[0]!.id = "renamed-coordinator";
		research.steps[0]!.next = "assignments";
		const assignment = research.steps.find((s) => s.type === "foreach")!;
		assignment.items = { from: "/renamed-coordinator/assignments" };
		research.steps.find((s) => s.id === "verify")!.reads!.coordination =
			"renamed-coordinator";
		f.runtime.updateWorkflows(definitions);
		const accepted = f.runtime.listWorkflows().find((w) => w.id === fork.id)!;
		const run = f.runtime.create({
			id: "fork-survey",
			triggerOrigin: {
				type: "manual",
				workflowId: accepted.id,
				at: new Date().toISOString(),
			},
			repositoryId: "fixture",
			workspace: f.home,
			repositories: f.run.repositories,
			input: "Forked survey",
			launchInputs: { focus: "Edited focus" },
			runner: "codex",
			model: "accepted-model",
			workflow: accepted,
			workflowDefinitions: f.runtime.listWorkflows(),
		});
		void f.runtime.launch(run);
		await waitForRuntime(
			() => {
				expect(run.error).toBeUndefined();
				expect(run.viewDecision?.kind).toBe("decide");
			},
			{ timeout: 80000 },
		);
		expect(
			f.calls.filter((c) => c.key.endsWith("/renamed-coordinator")),
		).toHaveLength(8);
		expect(
			f.calls.find((c) => c.input.perspective?.id === "changes")!.input
				.perspective.brief,
		).toBe("Inspect only the EDITED seam");
		expect(
			f.calls
				.filter((c) => c.key.endsWith("/renamed-coordinator"))
				.every((c) => c.prompt.startsWith("EDITED")),
		).toBe(true);
		expect(
			f.calls
				.filter((c) => c.input.assignment)
				.every(
					(c) =>
						c.model === "accepted-model" &&
						c.input.execution.modelSource === "run",
				),
		).toBe(true);
	});
});
