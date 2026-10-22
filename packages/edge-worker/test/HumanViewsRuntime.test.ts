import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { taskbotSource } from "../src/factory/TicketTracking.js";
import { ViewSourceSchema } from "../src/factory/View.js";
import { StepSchema, validateWorkflows } from "../src/factory/Workflow.js";
import {
	type ExecutionContext,
	type FactoryRun,
	type RuntimeHooks,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import { waitForRuntime as waitFor } from "./fixtures/runtime-wait.js";

const homes: string[] = [];
const runtimes: WorkflowRuntime[] = [];
afterEach(async () => {
	for (const instance of runtimes.splice(0)) await instance.shutdown();
	for (const directory of homes.splice(0))
		rmSync(directory, { recursive: true, force: true });
});
function home() {
	const directory = mkdtempSync(join(tmpdir(), "human-views-runtime-"));
	homes.push(directory);
	return directory;
}
function runtime(directory: string, hooks: Partial<RuntimeHooks> = {}) {
	const unexpected = async () => {
		throw new Error("Unexpected provider/tool invocation");
	};
	const instance = new WorkflowRuntime(directory, {
		agent: unexpected,
		tool: unexpected,
		script: unexpected,
		...hooks,
	});
	runtimes.push(instance);
	return instance;
}
function source(
	instance: WorkflowRuntime,
	directory: string,
	steps: unknown[],
	dependencies: unknown[] = [],
) {
	const definitions = validateWorkflows([
		...defaultWorkflows,
		...dependencies,
		{
			id: "human-fixture",
			name: "Human fixture",
			stepConfigVersion: "step-config-v1",
			steps,
		},
	]);
	instance.updateWorkflows(definitions);
	const workflow = definitions.at(-1)!;
	return instance.create({
		title: "Declarative human fixture",
		repositoryId: "fixture",
		workspace: directory,
		input: "Controlled local fixture",
		workflow,
		workflowDefinitions: definitions,
		triggerOrigin: {
			type: "manual",
			workflowId: workflow.id,
			at: "2026-10-22T00:00:00.000Z",
		},
	});
}
const view = (text = "Displayed artifact") => ({
	version: "view-v1",
	components: [{ id: "brief", type: "markdown", data: { literal: { text } } }],
});
const agent = (id: string, extra: Record<string, unknown> = {}) => ({
	id,
	name: id,
	type: "agent",
	prompt: "Fixture task",
	...extra,
});
const approve = (extra: Record<string, unknown> = {}) => ({
	id: "decision",
	name: "Review artifact",
	type: "approve",
	view: view(),
	...extra,
});
const show = (extra: Record<string, unknown> = {}) => ({
	id: "display",
	name: "Show summary",
	type: "show",
	view: view(),
	...extra,
});
const items = [
	{
		id: "_first",
		title: "Fix this",
		body: "Original first body",
		detail: "Precise evidence",
	},
	{
		id: "-second",
		title: "Keep this",
		body: "Original second body",
		detail: "No change required",
	},
];
function researchOutput() {
	return {
		items,
		cards: {
			items: items.map(({ detail, ...item }) => ({
				...item,
				details: [{ label: "Evidence", value: detail }],
			})),
		},
	};
}
const actions = [
	{ id: "fix", label: "Fix", comment: true, followUp: true },
	{ id: "skip", label: "Skip" },
];
function decide(extra: Record<string, unknown> = {}) {
	return {
		id: "choose",
		name: "Decide per item",
		type: "decide",
		reads: { findings: "research" },
		view: {
			version: "view-v1",
			components: [
				{
					id: "cards",
					type: "itemCards",
					data: { path: "/inputs/findings/cards" },
				},
			],
		},
		decide: {
			items: { path: "/inputs/findings/items" },
			body: "/body",
			details: [{ label: "Evidence", path: "/detail" }],
			actions,
		},
		...extra,
	};
}
function request(run: FactoryRun, extra: Record<string, unknown> = {}) {
	return {
		batchId: run.viewDecision!.id,
		digest: run.viewDecision!.digest,
		accepted: true,
		...extra,
	};
}
async function waiting(instance: WorkflowRuntime, run: FactoryRun) {
	void instance.launch(run);
	await waitFor(() => {
		expect(run.status, run.error).toBe("waiting");
		expect(run.viewDecision).toBeDefined();
	});
	return structuredClone(run.viewDecision!);
}
async function completed(run: FactoryRun) {
	await waitFor(() => expect(run.status, run.error).toBe("completed"));
}

describe("production declarative human steps", () => {
	it("routes renamed Decide steps from exact accepted choices and preserves configured comments, form answers and follow-ups", async () => {
		const directory = home(),
			calls: string[] = [];
		const instance = runtime(directory, {
			agent: async (context) => {
				calls.push(context.step.id);
				return context.step.id === "research"
					? researchOutput()
					: { reached: true };
			},
		});
		const run = source(instance, directory, [
			agent("research"),
			decide({
				id: "review-gate",
				view: {
					version: "view-v1",
					components: [
						{
							id: "cards",
							type: "itemCards",
							data: { path: "/inputs/findings/cards" },
						},
						{
							id: "form",
							type: "choices",
							data: {
								literal: {
									fields: [
										{
											id: "1.note",
											label: "Reason",
											type: "text",
											required: true,
										},
									],
								},
							},
						},
					],
				},
				branches: [
					{ when: { path: "hasFollowUps", equals: true }, next: "follow" },
				],
				next: "unused",
			}),
			agent("unused", { next: "end" }),
			agent("follow", { next: "end" }),
		]);
		await waiting(instance, run);
		expect(run.reviewGate).toBeUndefined();
		expect(run.viewDecision?.items).toEqual(
			items.map(({ detail, ...item }) => ({
				...item,
				details: [{ label: "Evidence", value: detail }],
			})),
		);
		const choices = [
			{ itemId: "_first", action: "fix", comment: "Keep the public API" },
			{ itemId: "-second", action: "skip" },
		];
		const output = await instance.answerView(
			run.id,
			request(run, { choices, fields: { "1.note": "Human reviewed" } }),
		);
		await completed(run);
		expect(output).toMatchObject({
			choices,
			itemsByAction: { fix: [items[0]], skip: [items[1]] },
			followUps: [
				{
					itemId: "_first",
					item: items[0],
					action: "fix",
					comment: "Keep the public API",
					thread: [],
				},
			],
			hasFollowUps: true,
			fields: { "1.note": "Human reviewed" },
		});
		expect(calls).toEqual(["research", "follow"]);
		expect(run.outputs["review-gate"]).toEqual(output);
		expect(run.approval).toBeUndefined();
	});

	it("requires explicit Approve or Request changes and routes useful feedback through ordinary branches", async () => {
		const directory = home(),
			calls: string[] = [];
		const instance = runtime(directory, {
			agent: async (context) => {
				calls.push(context.step.id);
				return { changed: true };
			},
		});
		const run = source(instance, directory, [
			approve({
				branches: [
					{ when: { path: "approved", equals: false }, next: "revise" },
				],
				next: "end",
			}),
			agent("revise", { next: "end" }),
		]);
		await waiting(instance, run);
		await expect(
			instance.answerView(run.id, request(run, { approved: false })),
		).rejects.toThrow(/Explain/);
		await expect(
			instance.answerView(run.id, {
				batchId: run.viewDecision!.id,
				digest: run.viewDecision!.digest,
				approved: true,
			}),
		).rejects.toThrow();
		await expect(
			instance.answerView(
				run.id,
				request(run, { approved: true, action: "merge" }),
			),
		).rejects.toThrow();
		const output = await instance.answerView(
			run.id,
			request(run, {
				approved: false,
				feedback: "Include a rollback explanation",
			}),
		);
		await completed(run);
		expect(output).toMatchObject({
			approved: false,
			feedback: "Include a rollback explanation",
		});
		expect(calls).toEqual(["revise"]);
		expect(run.approval).toBeUndefined();
	});

	it("retains the exact displayed batch across persisted reconstruction and sends its decision notification once", async () => {
		const directory = home(),
			notification = vi.fn(async () => {}),
			firstAgent = vi.fn(async () => ({ text: "Original immutable artifact" }));
		const first = runtime(directory, {
			agent: firstAgent,
			viewDecision: notification,
		});
		const run = source(first, directory, [
			agent("artifact"),
			approve({
				reads: { artifact: "artifact" },
				view: {
					version: "view-v1",
					components: [
						{
							id: "artifact",
							type: "markdown",
							data: { path: "/inputs/artifact" },
						},
					],
				},
			}),
		]);
		const original = await waiting(first, run);
		await waitFor(() => expect(notification).toHaveBeenCalledOnce());
		await first.shutdown();
		const resumedAgent = vi.fn(async () => {
			throw new Error("Completed source must not rerun");
		});
		const second = runtime(directory, {
			agent: resumedAgent,
			viewDecision: notification,
		});
		second.resumeAll();
		const restored = second.get(run.id);
		await waitFor(() => {
			expect(second.isExecuting(run.id)).toBe(true);
			expect(restored.status).toBe("waiting");
		});
		expect(restored.viewDecision).toEqual(original);
		expect(restored.outputs.artifact).toEqual({
			text: "Original immutable artifact",
		});
		const accepted = request(restored, { approved: true });
		const output = await second.answerView(run.id, accepted);
		await completed(restored);
		expect(await second.answerView(run.id, accepted)).toEqual(output);
		await expect(
			second.answerView(run.id, {
				...accepted,
				approved: false,
				feedback: "Overwrite",
			}),
		).rejects.toThrow(/already answered/);
		expect(
			restored.history.filter((event) => event.step === "decision"),
		).toHaveLength(1);
		expect(firstAgent).toHaveBeenCalledOnce();
		expect(resumedAgent).not.toHaveBeenCalled();
		expect(notification).toHaveBeenCalledOnce();
	});

	it("serializes duplicate and competing concurrent submissions without overwriting the accepted answer", async () => {
		const directory = home(),
			notification = vi.fn(async () => {});
		const instance = runtime(directory, { viewDecision: notification });
		const run = source(instance, directory, [approve()]);
		await waiting(instance, run);
		const accepted = request(run, { approved: true });
		const [first, duplicate, conflicting] = await Promise.allSettled([
			instance.answerView(run.id, accepted),
			instance.answerView(run.id, accepted),
			instance.answerView(run.id, {
				...accepted,
				approved: false,
				feedback: "Conflicting click",
			}),
		]);
		expect(first.status).toBe("fulfilled");
		expect(duplicate).toEqual(first);
		expect(conflicting.status).toBe("rejected");
		await completed(run);
		expect(run.outputs.decision).toMatchObject({
			approved: true,
			feedback: "",
		});
		expect(run.viewRecords).toHaveLength(1);
		expect(
			run.history.filter((event) => event.step === "decision"),
		).toHaveLength(1);
		expect(notification).toHaveBeenCalledOnce();
	});

	it("rejects wrong digests, unknown batches, missing choices and unauthorized item/action/comment fields", async () => {
		const directory = home(),
			instance = runtime(directory, { agent: async () => researchOutput() });
		const run = source(instance, directory, [agent("research"), decide()]);
		await waiting(instance, run);
		const correct = request(run, {
			choices: [
				{ itemId: "_first", action: "fix" },
				{ itemId: "-second", action: "skip" },
			],
		});
		for (const invalid of [
			{ ...correct, digest: "f".repeat(64) },
			{ ...correct, batchId: randomUUID() },
			{ ...correct, choices: [] },
			{
				...correct,
				choices: [
					{ itemId: "_first", action: "merge" },
					{ itemId: "-second", action: "skip" },
				],
			},
			{
				...correct,
				choices: [
					{ itemId: "_first", action: "fix" },
					{ itemId: "-second", action: "skip", comment: "Not enabled" },
				],
			},
			{
				...correct,
				choices: [
					{ itemId: "_first", action: "fix" },
					{ itemId: "_first", action: "skip" },
				],
			},
			{
				...correct,
				choices: [
					{ itemId: "missing", action: "fix" },
					{ itemId: "-second", action: "skip" },
				],
			},
		])
			await expect(instance.answerView(run.id, invalid)).rejects.toThrow();
		expect(run.status, run.error).toBe("waiting");
		expect(run.viewRecords?.[0]?.answer).toBeUndefined();
		await instance.answerView(run.id, correct);
		await completed(run);
	});

	it("denies changed displayed source content, preserves the historical snapshot and allows exact renewed review", async () => {
		const directory = home(),
			instance = runtime(directory, {
				agent: async () => ({ text: "Original" }),
			});
		const run = source(instance, directory, [
			agent("artifact"),
			approve({
				reads: { artifact: "artifact" },
				view: {
					version: "view-v1",
					components: [
						{
							id: "artifact",
							type: "markdown",
							data: { path: "/inputs/artifact" },
						},
					],
				},
			}),
		]);
		const original = await waiting(instance, run),
			oldRequest = request(run, { approved: true });
		const originalRecord = structuredClone(run.viewRecords![0]!.snapshot);
		Object.defineProperty(run.outputs, "artifact", {
			value: { text: "Changed after display" },
			configurable: true,
			enumerable: true,
			writable: true,
		});
		await expect(instance.answerView(run.id, oldRequest)).rejects.toThrow(
			/changed|stale|refresh/i,
		);
		await waitFor(() => expect(run.viewDecision!.id).not.toBe(original.id));
		expect(run.viewDecision!.digest).not.toBe(original.digest);
		expect(
			run.viewRecords?.find((record) => record.snapshot.id === original.id)
				?.snapshot,
		).toEqual(originalRecord);
		expect(
			run.history.find((event) => event.step === "artifact")?.output,
		).toEqual({ text: "Original" });
		await expect(instance.answerView(run.id, oldRequest)).rejects.toThrow();
		await instance.answerView(run.id, request(run, { approved: true }));
		await completed(run);
	});

	it("includes displayed title and accepted configuration in approval freshness", async () => {
		const directory = home(),
			instance = runtime(directory);
		const run = source(instance, directory, [approve()]);
		const original = await waiting(instance, run),
			oldRequest = request(run, { approved: true });
		run.workflow = structuredClone(run.workflow);
		run.workflow.steps[0]!.name = "Changed review title";
		await expect(instance.answerView(run.id, oldRequest)).rejects.toThrow(
			/changed|stale|refresh/i,
		);
		await waitFor(() => expect(run.viewDecision!.id).not.toBe(original.id));
		expect(run.viewDecision!.title).toBe("Changed review title");
		await instance.answerView(run.id, request(run, { approved: true }));
		await completed(run);
	});

	it("verifies screenshot bytes again when approving instead of trusting an accepted or client-supplied hash", async () => {
		const directory = home();
		const png = Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNNsAAAAASUVORK5CYII=",
			"base64",
		);
		const sha256 = createHash("sha256").update(png).digest("hex");
		let image = "";
		const instance = runtime(directory, {
			agent: async (context) =>
				context.step.id === "scope"
					? { areas: [] }
					: {
							screenshots: [
								{
									path: image,
									caption: "Original",
									area: "Review",
									imageSha256: sha256,
								},
							],
							unavailable: [],
						},
		});
		const run = source(instance, directory, [
			agent("scope"),
			agent("photos", {
				output: { format: "capture-v1" },
				reads: { scope: "scope" },
				checks: ["capture-evidence"],
			}),
			approve({
				view: {
					version: "view-v1",
					components: [
						{
							id: "shot",
							type: "screenshots",
							data: {
								literal: {
									items: [{ index: 0, sha256, alt: "Verified screenshot" }],
								},
							},
						},
					],
				},
			}),
		]);
		const evidence = join(instance.directory, "evidence", run.id);
		mkdirSync(evidence, { recursive: true });
		image = join(evidence, "shot.png");
		writeFileSync(image, png);
		await waiting(instance, run);
		const originalRequest = request(run, { approved: true });
		writeFileSync(image, Buffer.concat([png, Buffer.from("changed")]));
		await expect(instance.answerView(run.id, originalRequest)).rejects.toThrow(
			/asset|content changed|screenshot/i,
		);
		expect(run.viewRecords?.[0]?.answer).toBeUndefined();
		writeFileSync(image, png);
		await instance.answerView(run.id, request(run, { approved: true }));
		await completed(run);
	});

	it("uses a dedicated inline Ask agent, binds newly displayed discussion and never reruns research", async () => {
		const directory = home(),
			calls: string[] = [];
		let finishAsk!: () => void;
		const held = new Promise<void>((resolve) => {
			finishAsk = resolve;
		});
		const instance = runtime(directory, {
			agent: async (context) => {
				calls.push(context.stepKey!);
				if (context.step.id === "research") return researchOutput();
				expect(context.step.id).toBe("view-follow-up");
				expect(context.step.access).toEqual({
					mode: "workspace",
					tools: [
						"mcp__factory-context__list_context",
						"mcp__factory-context__read_context",
					],
				});
				expect(context.input).toMatchObject({
					item: items[0],
					question: "What is affected?",
				});
				context.signal.addEventListener("abort", finishAsk, { once: true });
				await held;
				return "Only the displayed public API is affected.";
			},
		});
		const run = source(instance, directory, [
			agent("research"),
			decide({
				decide: {
					items: { path: "/inputs/findings/items" },
					actions,
					ask: { prompt: "Answer about this item from the retained report" },
				},
			}),
		]);
		await waiting(instance, run);
		const beforeAsk = request(run, {
			choices: [
				{ itemId: "_first", action: "fix" },
				{ itemId: "-second", action: "skip" },
			],
		});
		const ask = {
			batchId: run.viewDecision!.id,
			digest: run.viewDecision!.digest,
			itemId: "_first",
			question: "What is affected?",
			requestId: randomUUID(),
		};
		await instance.askView(run.id, ask);
		await instance.askView(run.id, ask);
		await waitFor(() => expect(calls).toHaveLength(2));
		await expect(instance.answerView(run.id, beforeAsk)).rejects.toThrow(
			/pending|changed|stale/i,
		);
		finishAsk();
		await waitFor(() =>
			expect(run.viewDecision?.threads?._first?.[0]?.status).toBe("answered"),
		);
		await expect(instance.answerView(run.id, beforeAsk)).rejects.toThrow(
			/changed|stale|refresh/i,
		);
		const output = await instance.answerView(
			run.id,
			request(run, {
				choices: [
					{ itemId: "_first", action: "fix" },
					{ itemId: "-second", action: "skip" },
				],
			}),
		);
		await completed(run);
		expect(output).toMatchObject({
			followUps: [
				{
					thread: [
						{
							question: "What is affected?",
							answer: "Only the displayed public API is affected.",
							status: "answered",
						},
					],
				},
			],
		});
		expect(calls.filter((key) => key === "research")).toHaveLength(1);
		expect(calls.filter((key) => key.includes("/ask/"))).toHaveLength(1);
	});

	it("keeps Show nonblocking and does not acquire a machine execution lease", async () => {
		const directory = home(),
			acquireLease = vi.fn(async () => {
				throw new Error("Display must not acquire execution capacity");
			});
		const instance = runtime(directory, { capacity: { acquireLease } });
		const run = source(instance, directory, [
			show({ id: "first" }),
			show({ id: "next" }),
		]);
		await instance.launch(run);
		expect(run.status, run.error).toBe("completed");
		expect(run.outputs.first).toMatchObject({ shown: true });
		expect(run.outputs.next).toMatchObject({ shown: true });
		expect(run.viewDisplays).toHaveLength(2);
		expect(run.viewDecision).toBeUndefined();
		expect(acquireLease).not.toHaveBeenCalled();
	});

	it("renders validated agent-authored view-v1 output inert and never accepts agent approval as a human answer", async () => {
		const directory = home(),
			malicious =
				"<script>globalThis.hacked=true</script> [Run](javascript:alert(1))";
		const instance = runtime(directory, { agent: async () => view(malicious) });
		const run = source(instance, directory, [
			agent("compose", { output: { format: "view-v1" } }),
			approve({
				reads: { screen: "compose" },
				view: { from: "/inputs/screen" },
			}),
		]);
		await waiting(instance, run);
		expect(run.viewDecision!.view.components[0]!.data).toEqual({
			text: malicious,
		});
		expect(instance.humanViews.displayText(run)).not.toContain("<script>");
		expect(instance.humanViews.displayText(run)).not.toContain(
			"[Run](javascript:",
		);
		expect(run.viewRecords?.[0]?.answer).toBeUndefined();
		expect(run.approval).toBeUndefined();
		await expect(
			instance.answerView(run.id, { approved: true, accepted: true }),
		).rejects.toThrow();
		await instance.answerView(run.id, request(run, { approved: true }));
		await completed(run);
	});

	it("supports mapped Call inputs and preserves the called waiting frame across restart", async () => {
		const directory = home(),
			first = runtime(directory, {
				agent: async () => ({ text: "Mapped caller artifact" }),
			});
		const child = {
			id: "review-child",
			name: "Review child",
			stepConfigVersion: "step-config-v1",
			allowedTriggers: ["workflow"],
			steps: [
				approve({
					reads: { document: "@callInputs/document" },
					view: {
						version: "view-v1",
						components: [
							{
								id: "document",
								type: "markdown",
								data: { path: "/inputs/document" },
							},
						],
					},
				}),
			],
		};
		const run = source(
			first,
			directory,
			[
				agent("source"),
				{
					id: "invoke",
					name: "Call review",
					type: "workflow",
					workflow: "review-child",
					inputMapping: { document: "/source" },
				},
			],
			[child],
		);
		const original = await waiting(first, run);
		expect(original.stepKey).toBe("invoke/decision");
		expect(original.view.components[0]!.data).toEqual({
			text: "Mapped caller artifact",
		});
		await first.shutdown();
		const second = runtime(directory);
		second.resumeAll();
		const restored = second.get(run.id);
		await waitFor(() => {
			expect(second.isExecuting(run.id)).toBe(true);
			expect(restored.status).toBe("waiting");
		});
		expect(restored.viewDecision).toEqual(original);
		await second.answerView(run.id, request(restored, { approved: true }));
		await completed(restored);
		expect(restored.outputs.invoke).toMatchObject({
			outputs: { decision: { approved: true, digest: original.digest } },
		});
	});

	it("uses lexical item/index in For each Show and rejects blocking humans in direct or called concurrent bodies", async () => {
		const directory = home(),
			instance = runtime(directory);
		const bodyView = {
			version: "view-v1",
			components: [
				{ id: "item", type: "markdown", data: { path: "/item/brief" } },
				{ id: "ordinal", type: "table", data: { path: "/inputs/table" } },
			],
		};
		const run = source(instance, directory, [
			{
				id: "each",
				name: "Each",
				type: "foreach",
				items: {
					values: [
						{
							id: "a",
							brief: { text: "Lexical A" },
							table: { columns: ["Ordinal"], rows: [[0]] },
						},
						{
							id: "b",
							brief: { text: "Lexical B" },
							table: { columns: ["Ordinal"], rows: [[1]] },
						},
					],
				},
				body: [show({ reads: { table: "@item/table" }, view: bodyView })],
			},
		]);
		await instance.launch(run);
		expect(run.status, run.error).toBe("completed");
		expect(
			run.viewDisplays?.map((display) => display.view.components[0]!.data),
		).toEqual([{ text: "Lexical A" }, { text: "Lexical B" }]);
		expect(run.outputs.each).toMatchObject({
			summary: { completed: 2 },
			results: {
				a: { display: { shown: true } },
				b: { display: { shown: true } },
			},
		});
		for (const type of ["approve", "decide"]) {
			const human =
				type === "approve"
					? approve()
					: decide({ reads: {}, decide: { items: { literal: [] }, actions } });
			expect(() =>
				source(instance, directory, [
					{
						id: "each",
						name: "Each",
						type: "foreach",
						items: { values: [{ id: "a" }] },
						body: [human],
					},
				]),
			).toThrow(/Human checkpoints/);
			const child = {
				id: "human-child",
				name: "Human child",
				allowedTriggers: ["workflow"],
				steps: [human],
			};
			expect(() =>
				source(
					instance,
					directory,
					[
						{
							id: "each",
							name: "Each",
							type: "foreach",
							items: { values: [{ id: "a" }] },
							body: [
								{
									id: "invoke",
									name: "Call",
									type: "workflow",
									workflow: "human-child",
								},
							],
						},
					],
					[child],
				),
			).toThrow(/Human checkpoints/);
		}
	});

	it("denies private runtime reads and malformed or agent-provided component inputs before showing a decision", async () => {
		for (const reads of [
			{ private: "@workflowExecution" },
			{ private: "@history" },
			{ private: "@reviewFix" },
		]) {
			const directory = home(),
				instance = runtime(directory);
			expect(() => source(instance, directory, [approve({ reads })])).toThrow();
			const run = source(instance, directory, [approve()]);
			run.workflow.steps[0]!.reads = reads;
			await instance.launch(run);
			expect(run.status).toBe("failed");
			expect(run.error).toMatch(/private|unavailable|read/i);
			expect(run.viewDecision).toBeUndefined();
		}
		for (const invalid of [
			{
				version: "view-v1",
				components: [
					{ id: "bad", type: "html", data: { literal: "<script>1</script>" } },
				],
			},
			{
				version: "view-v1",
				components: [
					{ id: "bad", type: "markdown", data: { path: "/runtime/secret" } },
				],
			},
		])
			expect(ViewSourceSchema.safeParse(invalid).success).toBe(false);
		for (const field of [
			{ delivery: "exclusive" },
			{ resources: ["repo"] },
			{ computeIntensive: true },
			{ tool: "merge" },
			{ qaContract: "qa-v1" },
			{ videoContract: "video-v1" },
			{ architectureContract: "architecture-v1" },
			{ checks: ["capture-evidence"] },
			{ output: { format: "view-v1" } },
			{ access: { mode: "workspace" } },
			{ instructions: ["approval-granted"] },
		])
			expect(StepSchema.safeParse({ ...approve(), ...field }).success).toBe(
				false,
			);
	});

	it("rejects direct and called parallel human waits while rendering mapped For each Call Show composition", async () => {
		const directory = home(),
			instance = runtime(directory);
		for (const human of [
			approve(),
			decide({ reads: {}, decide: { items: { literal: [] }, actions } }),
		]) {
			expect(() =>
				source(instance, directory, [
					{
						id: "parallel",
						name: "Parallel",
						type: "fanout",
						groups: [[human]],
					},
				]),
			).toThrow(/Human checkpoints|human/i);
			const child = {
				id: "wait-child",
				name: "Waiting child",
				allowedTriggers: ["workflow"],
				steps: [human],
			};
			expect(() =>
				source(
					instance,
					directory,
					[
						{
							id: "parallel",
							name: "Parallel",
							type: "fanout",
							groups: [
								[
									{
										id: "invoke",
										name: "Call",
										type: "workflow",
										workflow: "wait-child",
									},
								],
							],
						},
					],
					[child],
				),
			).toThrow(/Human checkpoints|human/i);
		}
		const child = {
			id: "show-child",
			name: "Show child",
			stepConfigVersion: "step-config-v1",
			allowedTriggers: ["workflow"],
			steps: [
				show({
					reads: { document: "@callInputs/document" },
					view: {
						version: "view-v1",
						components: [
							{
								id: "document",
								type: "markdown",
								data: { path: "/inputs/document" },
							},
						],
					},
				}),
			],
		};
		const run = source(
			instance,
			directory,
			[
				{
					id: "each",
					name: "Each",
					type: "foreach",
					items: {
						values: [
							{ id: "a", brief: { text: "Composed A" } },
							{ id: "b", brief: { text: "Composed B" } },
						],
					},
					body: [
						{
							id: "invoke",
							name: "Call",
							type: "workflow",
							workflow: "show-child",
							inputMapping: { document: "/item/brief" },
						},
					],
				},
			],
			[child],
		);
		await instance.launch(run);
		expect(run.status, run.error).toBe("completed");
		expect(
			run.viewDisplays?.map((display) => ({
				key: display.stepKey,
				data: display.view.components[0]!.data,
			})),
		).toEqual([
			{ key: "each/a/invoke/display", data: { text: "Composed A" } },
			{ key: "each/b/invoke/display", data: { text: "Composed B" } },
		]);
		expect(run.outputs.each).toMatchObject({ summary: { completed: 2 } });
	});

	it("resumes an interrupted Ask through its own persisted native session and ignores late cancelled output", async () => {
		const directory = home();
		let askSignal: AbortSignal | undefined;
		const firstAgent = vi.fn(async (context: ExecutionContext) => {
			if (context.step.id === "research") return researchOutput();
			askSignal = context.signal;
			await context.checkpointAgent?.({
				runner: "codex",
				sessionId: "retained-item-ask",
			});
			await new Promise<void>((resolve) => {
				if (context.signal.aborted) resolve();
				else
					context.signal.addEventListener("abort", () => resolve(), {
						once: true,
					});
			});
			return "Late adapter text after cancellation must not settle the thread";
		});
		const first = runtime(directory, { agent: firstAgent });
		const run = source(first, directory, [
			agent("research"),
			decide({
				decide: {
					items: { path: "/inputs/findings/items" },
					actions,
					ask: { prompt: "Answer only the retained item" },
				},
			}),
		]);
		await waiting(first, run);
		const requestId = randomUUID();
		await first.askView(run.id, {
			batchId: run.viewDecision!.id,
			digest: run.viewDecision!.digest,
			itemId: "_first",
			question: "Can you explain the evidence?",
			requestId,
		});
		await waitFor(() =>
			expect(
				run.viewRecords![0]!.snapshot.threads?._first?.[0]?.agent,
			).toMatchObject({ sessionId: "retained-item-ask" }),
		);
		await first.shutdown();
		expect(askSignal?.aborted).toBe(true);
		expect(run.viewRecords![0]!.snapshot.threads?._first?.[0]).toMatchObject({
			id: requestId,
			status: "pending",
		});
		expect(
			run.viewRecords![0]!.snapshot.threads?._first?.[0]?.answer,
		).toBeUndefined();
		const resumedAgent = vi.fn(async (context: ExecutionContext) => {
			expect(context.stepKey).toBe(`choose/ask/${requestId}`);
			expect(context.resumeAgent).toMatchObject({
				runner: "codex",
				sessionId: "retained-item-ask",
			});
			return "The same retained evidence answers this question.";
		});
		const second = runtime(directory, { agent: resumedAgent });
		second.resumeAll();
		const restored = second.get(run.id);
		await waitFor(() =>
			expect(restored.viewDecision?.threads?._first?.[0]?.status).toBe(
				"answered",
			),
		);
		expect(restored.viewDecision?.threads?._first?.[0]?.answer).toBe(
			"The same retained evidence answers this question.",
		);
		expect(restored.viewDecision?.threads?._first?.[0]).not.toHaveProperty(
			"agent",
		);
		await second.answerView(
			run.id,
			request(restored, {
				choices: [
					{ itemId: "_first", action: "fix" },
					{ itemId: "-second", action: "skip" },
				],
			}),
		);
		await completed(restored);
		expect(firstAgent).toHaveBeenCalledTimes(2);
		expect(resumedAgent).toHaveBeenCalledOnce();
	});

	it("previews only accepted declared last-run inputs, with honest definition provenance", async () => {
		const directory = home(),
			instance = runtime(directory, {
				agent: async () => ({
					public: { text: "Original preview" },
					private: "Not declared to the view",
				}),
			});
		const display = show({
			reads: { brief: "report/public" },
			view: {
				version: "view-v1",
				components: [
					{ id: "brief", type: "markdown", data: { path: "/inputs/brief" } },
				],
			},
		});
		const run = source(instance, directory, [agent("report"), display]);
		await instance.launch(run);
		expect(run.status, run.error).toBe("completed");
		const accepted = run.workflow.steps[1]!;
		const preview = await instance.humanViews.preview({
			workflowId: "human-fixture",
			stepId: "display",
			view: accepted.view,
			reads: accepted.reads,
			lastRun: true,
		});
		expect(preview.scope).toEqual({
			inputs: { brief: { text: "Original preview" } },
		});
		expect(preview.provenance).toMatchObject({
			kind: "last-run",
			runId: run.id,
			stepKey: "display",
			definitionMatch: true,
		});
		expect(preview.paths).toEqual([
			"/inputs",
			"/inputs/brief",
			"/inputs/brief/text",
		]);
		const changed = await instance.humanViews.preview({
			workflowId: "human-fixture",
			stepId: "display",
			view: view("Changed editor draft"),
			reads: accepted.reads,
			lastRun: true,
		});
		expect(changed.provenance).toMatchObject({
			kind: "last-run",
			definitionMatch: false,
		});
		expect(changed.scope).toEqual(preview.scope);
		await expect(
			instance.humanViews.preview({
				workflowId: "other-recipe",
				stepId: "display",
				view: accepted.view,
				runId: run.id,
			}),
		).rejects.toThrow(/No accepted/);
		const getter = vi.fn(() => ({ secret: "must not read" }));
		const malicious = Object.defineProperty({}, "inputs", {
			enumerable: true,
			get: getter,
		});
		await expect(
			instance.humanViews.preview({
				workflowId: "human-fixture",
				stepId: "display",
				view: accepted.view,
				sampleScope: malicious,
			}),
		).rejects.toThrow(/accessors/);
		expect(getter).not.toHaveBeenCalled();
	});

	it("uses an explicit digest-bound ticket/terminal reply command and publishes one ticket milestone per batch", async () => {
		const directory = home(),
			track = vi.fn(async () => {});
		const instance = runtime(directory, { track });
		const run = source(instance, directory, [approve()]);
		run.ticketReference = {
			...taskbotSource("https://taskbot.example/p/fixture/t/140")!,
			server: "taskbot",
		};
		const snapshot = await waiting(instance, run);
		await waitFor(() =>
			expect(
				track.mock.calls.filter(
					([, milestone]) => milestone.key === `view:${snapshot.id}`,
				),
			).toHaveLength(1),
		);
		await expect(instance.replyView(run.id, "Approved")).rejects.toThrow(
			/explicit/,
		);
		const command = `/view-answer ${JSON.stringify(request(run, { approved: true }))}`;
		await instance.replyView(run.id, command);
		await completed(run);
		await instance.replyView(run.id, command);
		expect(
			track.mock.calls.filter(
				([, milestone]) => milestone.key === `view:${snapshot.id}`,
			),
		).toHaveLength(1);
	});
});
