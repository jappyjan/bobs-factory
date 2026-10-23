import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createFactoryContextServerFromSnapshot,
	prepareFactoryContextAsync,
} from "bobs-factory-mcp-tools";
import { afterEach, expect, it } from "vitest";
import {
	conservativeWorkflows,
	defaultWorkflows,
} from "../src/factory/defaultWorkflows.js";
import { resolveStepConfig } from "../src/factory/StepConfig.js";
import { validateWorkflows } from "../src/factory/Workflow.js";
import {
	type ExecutionContext,
	type RuntimeHooks,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import { waitForRuntime } from "./fixtures/runtime-wait.js";

// The existing MCP package owns the SDK; this drive uses that prepared dependency.
const sdk = createRequire(
	new URL("../../mcp-tools/package.json", import.meta.url),
);
const { Client } = await import(
	sdk.resolve("@modelcontextprotocol/sdk/client/index.js")
);
const { InMemoryTransport } = await import(
	sdk.resolve("@modelcontextprotocol/sdk/inMemory.js")
);

const homes: string[] = [];
const runtimes: WorkflowRuntime[] = [];
afterEach(async () => {
	for (const runtime of runtimes.splice(0)) await runtime.shutdown();
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});

it("drives configured review Calls through For each, bounded MCP, saved stop and reconstruction", async () => {
	const home = mkdtempSync(join(tmpdir(), "f1-context144-"));
	homes.push(home);
	const repo = join(home, "repo");
	execFileSync("git", ["init", "-b", "integration", repo], { stdio: "ignore" });
	const git = (...args: string[]) =>
		execFileSync("git", args, {
			cwd: repo,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
	git("config", "user.name", "Controlled F1");
	git("config", "user.email", "f1@example.invalid");
	git("config", "commit.gpgsign", "false");
	writeFileSync(join(repo, "contract.txt"), "Retain original receipts\n");
	git("add", ".");
	git("commit", "-m", "test: generic context baseline [skip ci]");
	git("update-ref", "refs/remotes/origin/integration", "HEAD");
	const source = conservativeWorkflows.find(
		(workflow) => workflow.id === "factory-pipeline",
	)!;
	const names: Record<string, string> = {
		"extract-requirements": "catalog",
		"specialist-review": "perspectives",
		"review-gate": "decision",
	};
	const rename = (value: unknown): unknown => {
		if (typeof value === "string") return names[value] ?? value;
		if (Array.isArray(value)) return value.map(rename);
		if (!value || typeof value !== "object") return value;
		return Object.fromEntries(
			Object.entries(value).map(([key, child]) => [
				key,
				key === "tool" ? child : rename(child),
			]),
		);
	};
	const steps = source.steps
		.filter((step) => Object.hasOwn(names, step.id))
		.map((step) => ({
			...step,
			askQuestions: step.askQuestions,
			next: undefined,
			branches: [],
		}));
	const parallel = steps.find((step) => step.type === "fanout")!;
	parallel.groups = parallel.groups!.filter(
		(group, index) =>
			index === 0 ||
			group.some(
				(step) => resolveStepConfig(step).output?.format === "coverage-v1",
			),
	);
	const rounds = 24;
	const definitions = validateWorkflows([
		...defaultWorkflows,
		{
			id: "controlled-review",
			name: "Configured review",
			allowedTriggers: ["workflow"],
			steps: rename(steps),
		},
		{
			id: "controlled-reader",
			name: "Declared reader",
			allowedTriggers: ["workflow"],
			steps: [
				{
					id: "read",
					name: "Read scoped input",
					type: "agent",
					prompt: "Read the declared current dependency",
					reads: { accepted: "@callInputs/dependency", retained: "@history" },
				},
			],
		},
		{
			id: "controlled-context",
			name: "Long-lived context",
			steps: [
				...Array.from({ length: rounds }, (_, index) => ({
					id: `r${index}`,
					name: `Review ${index}`,
					type: "workflow",
					workflow: "controlled-review",
					bindings: {},
					reads: { dependency: "@launchInputs/dependency" },
					inputMapping: { dependency: "/inputs/dependency" },
				})),
				{
					id: "items",
					name: "Scoped readers",
					type: "foreach",
					concurrency: 1,
					items: {
						values: [
							{ id: "north", dependency: "original" },
							{ id: "south", dependency: "changed" },
						],
					},
					body: [
						{
							id: "nested",
							name: "Called reader",
							type: "workflow",
							workflow: "controlled-reader",
							bindings: {},
							inputMapping: { dependency: "/item/dependency" },
						},
					],
				},
			],
		},
	]);
	const receipts: unknown[] = [];
	for (const mode of ["fresh", "restart"] as const) {
		const state = join(home, mode);
		const executed: string[] = [],
			paused: string[] = [];
		let intercepted = false;
		let contextCalls = 0,
			contextCharacters = 0;
		const hooks: RuntimeHooks = {
			agent: async (context: ExecutionContext) => {
				if (
					mode === "restart" &&
					!intercepted &&
					context.stepKey!.split("/").includes("r12") &&
					context.step.id === "catalog"
				) {
					intercepted = true;
					await context.checkpointAgent({
						runner: "codex",
						sessionId: "synthetic-retained-session",
					});
					paused.push(context.stepKey!);
					await new Promise<void>((resolve) =>
						context.signal.addEventListener("abort", () => resolve(), {
							once: true,
						}),
					);
					context.signal.throwIfAborted();
				}
				const prepared = await prepareFactoryContextAsync(
					context.input,
					undefined,
					undefined,
					{ cacheDirectory: join(state, "context-cache") },
				);
				const server = createFactoryContextServerFromSnapshot(
					prepared.config.args.at(-1)!,
				);
				const [clientTransport, serverTransport] =
					InMemoryTransport.createLinkedPair();
				const client = new Client({ name: "mocked-f1-role", version: "1" });
				try {
					await server.connect(serverTransport);
					await client.connect(clientTransport);
					const page = await client.callTool({
						name: "read_context",
						arguments: { path: "", limit: 12000 },
					});
					expect(page.isError).not.toBe(true);
					const text = page.content.find((part) => part.type === "text")!;
					if (text.type !== "text") throw new Error("Missing context response");
					contextCalls++;
					contextCharacters += text.text.length;
					const data = JSON.parse(text.text);
					if (data.projection) expect(data.nextOffset).toBeNull();
				} finally {
					await client.close();
					await server.close();
					prepared.cleanup();
				}
				executed.push(context.stepKey!);
				const format = resolveStepConfig(context.step).output?.format;
				if (format === "inventory-v1")
					return {
						schemaVersion: 1,
						requirements: [
							{
								id: "R1",
								criterion: "Retain original receipts",
								classification: "active",
								sources: [
									{ source: "originalInput", reference: "/acceptance/0" },
								],
							},
						],
						decisions: [],
						conflicts: [],
						questions: [],
						sourceReceipt: {
							considered: [
								{ source: "originalInput", reference: "/acceptance/0" },
							],
							unavailable: [],
						},
					};
				return {
					status: "completed",
					blockers: [],
					summary: "Review of the unchanged declared dependency",
					findings: [],
					disagreements: [],
					...(format === "coverage-v1"
						? {
								coverage: [
									{
										requirementId: "R1",
										status: "met",
										evidence: ["contract.txt:1 at frozen revision"],
										reason: "Controlled receipt verified",
									},
								],
							}
						: {}),
				};
			},
			tool: async () => {
				throw new Error("Unexpected side-effect tool");
			},
			script: async () => {
				throw new Error("Unexpected script");
			},
		};
		let runtime = new WorkflowRuntime(state, hooks);
		runtimes.push(runtime);
		runtime.updateWorkflows(definitions);
		let run = runtime.create({
			title: "Controlled long-lived context",
			input: "Retain original receipts",
			repositoryId: "fixture",
			workspace: repo,
			workflow: definitions.at(-1)!,
			launchInputs: { dependency: "original" },
			repositories: [
				{
					id: "fixture",
					name: "Fixture",
					workspace: repo,
					baseBranch: "integration",
				},
			],
			triggerOrigin: {
				type: "manual",
				workflowId: definitions.at(-1)!.id,
				at: "2026-10-23T00:00:00Z",
			},
		});
		if (mode === "restart") {
			const running = runtime.launch(run);
			await waitForRuntime(() => expect(paused).toHaveLength(1), {
				timeout: 60000,
			});
			runtime.stop(run.id);
			await running;
			await runtime.shutdown();
			runtime = new WorkflowRuntime(state, hooks);
			runtimes.push(runtime);
			run = runtime.get(run.id);
			expect(JSON.stringify(run.checkpoint)).toMatch(
				/synthetic-retained-session/,
			);
		}
		await runtime.launch(run);
		expect(run.status, run.error).toBe("completed");
		expect(run.reviewRounds).toHaveLength(rounds);
		expect(new Set(executed).size).toBe(executed.length);
		const gates = run.history.filter(({ step }) => step.endsWith("/decision"));
		expect(gates).toHaveLength(rounds);
		expect(
			gates.every(({ output }) => (output as { approved: boolean }).approved),
		).toBe(true);
		expect(run.humanDecisions ?? []).toEqual([]);
		receipts.push({
			mode,
			rounds: run.reviewRounds!.length,
			executed,
			paused,
			gates: gates.map(({ step, output }) => ({
				step,
				approved: (output as { approved: boolean }).approved,
			})),
			contextCalls,
			contextCharacters,
			baselineBytes: Buffer.byteLength(JSON.stringify(run.reviewRounds)),
			nativeSessionRetained: mode === "restart",
			finalDeliveryClaim: false,
		});
		await runtime.shutdown();
	}
	if (process.env.TASKBOT144_DRIVE_RECEIPT)
		writeFileSync(
			process.env.TASKBOT144_DRIVE_RECEIPT,
			JSON.stringify(
				{
					scope:
						"Mocked production runtime/Call/For each/Parallel/review Check/context MCP; no live provider or delivery",
					receipts,
				},
				null,
				2,
			),
		);
}, 120000);
