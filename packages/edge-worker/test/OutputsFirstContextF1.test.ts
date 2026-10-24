import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createFactoryContextServerFromSnapshot,
	prepareFactoryContextAsync,
	transcriptAccessPath,
} from "bobs-factory-mcp-tools";
import { expect, it } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { roleProgress } from "../src/factory/Incremental.js";
import { OperatorGrants } from "../src/factory/OperatorGrants.js";
import { OperatorServer } from "../src/factory/OperatorServer.js";
import { OperatorService } from "../src/factory/OperatorService.js";
import {
	roleAgentContext,
	roleContextAccess,
} from "../src/factory/RoleContext.js";
import { validateWorkflows } from "../src/factory/Workflow.js";
import {
	type ExecutionContext,
	type RuntimeHooks,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import { waitForRuntime } from "./fixtures/runtime-wait.js";

const sdk = createRequire(
	new URL("../../mcp-tools/package.json", import.meta.url),
);
const { Client } = await import(
	sdk.resolve("@modelcontextprotocol/sdk/client/index.js")
);
const { InMemoryTransport } = await import(
	sdk.resolve("@modelcontextprotocol/sdk/inMemory.js")
);

async function contextClient(context: ExecutionContext) {
	const access = roleContextAccess(context)!;
	const prepared = await prepareFactoryContextAsync(
		roleAgentContext(context),
		undefined,
		undefined,
		{ cacheDirectory: access.directory, access },
	);
	const server = createFactoryContextServerFromSnapshot(
		prepared.config.args.at(-1)!,
	);
	const client = new Client({
		name: "mocked-outputs-first-role",
		version: "1",
	});
	const [a, b] = InMemoryTransport.createLinkedPair();
	await server.connect(a);
	await client.connect(b);
	return {
		client,
		prepared,
		close: async () => {
			await client.close();
			await server.close();
			prepared.cleanup();
		},
	};
}

it("drives fresh/reconstructed renamed Call/Parallel/For each roles from explicit artifacts with zero predecessor transcript downloads", async () => {
	const home = mkdtempSync(join(tmpdir(), "f1-outputs-first149-"));
	const runtimes: WorkflowRuntime[] = [];
	const repo = join(home, "repo");
	const git = (...args: string[]) =>
		execFileSync("git", args, {
			cwd: repo,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
	execFileSync("git", ["init", "-b", "integration", repo], { stdio: "ignore" });
	writeFileSync(
		join(repo, "contract.txt"),
		"Preserve unresolved findings and exact scope\n",
	);
	git("add", ".");
	git(
		"-c",
		"user.name=Controlled F1",
		"-c",
		"user.email=f1@example.invalid",
		"-c",
		"commit.gpgsign=false",
		"commit",
		"-m",
		"test: outputs-first fixture [skip ci]",
	);
	git("update-ref", "refs/remotes/origin/integration", "HEAD");
	const definitions = validateWorkflows([
		...defaultWorkflows,
		{
			id: "reader",
			name: "Arbitrary callable recipe",
			allowedTriggers: ["workflow"],
			steps: [
				{
					id: "parallel",
					name: "Independent output consumers",
					type: "fanout",
					groups: [
						[
							{
								id: "perspective-a",
								name: "First",
								type: "agent",
								prompt:
									"Consume the explicit role inputs and preserve required evidence",
								reads: {
									accepted: "@callInputs/declaration",
									raw: "@transcripts",
								},
							},
						],
						[
							{
								id: "perspective-b",
								name: "Second",
								type: "agent",
								prompt:
									"Consume the explicit role inputs and preserve required evidence",
								reads: {
									accepted: "@callInputs/declaration",
									raw: "@transcripts",
								},
							},
						],
					],
				},
			],
		},
		{
			id: "long-lived",
			name: "Long-lived nested custom work",
			steps: [
				{
					id: "clarify",
					name: "Explicit clarification",
					type: "agent",
					prompt:
						"Consume the explicit role inputs and preserve required evidence",
					askQuestions: true,
				},
				{
					id: "requirements",
					name: "Accepted structured handoff",
					type: "agent",
					prompt:
						"Consume the explicit role inputs and preserve required evidence",
				},
				{
					id: "rounds",
					name: "Retained structured rounds",
					type: "foreach",
					items: {
						values: Array.from({ length: 24 }, (_, index) => ({
							id: `r${index}`,
							index,
						})),
					},
					concurrency: 1,
					body: [
						{
							id: "write",
							name: "Retained findings and rationale",
							type: "agent",
							prompt:
								"Consume the explicit role inputs and preserve required evidence",
						},
					],
				},
				{
					id: "items",
					name: "Separate accepted work items",
					type: "foreach",
					items: { values: [{ id: "north" }, { id: "south" }] },
					concurrency: 1,
					body: [
						{
							id: "nested",
							name: "Call arbitrary reader",
							type: "workflow",
							workflow: "reader",
							bindings: {},
							reads: { declaration: "requirements" },
							inputMapping: { declaration: "/inputs/declaration" },
						},
					],
				},
			],
		},
	]);
	const proof: unknown[] = [];
	try {
		for (const mode of ["fresh", "reconstructed"] as const) {
			let intercepted = false,
				nativeLoads = 0;
			const paused: string[] = [];
			const roles: string[] = [];
			let completedSibling:
				| { step: string; output: unknown; at: string }
				| undefined;
			const counters = {
				pages: 0,
				utf8Bytes: 0,
				transcriptBytes: 0,
				toolCalls: 0,
				refusedCalls: 0,
			};
			const state = join(home, mode);
			const hooks: RuntimeHooks = {
				transcriptEntries: () => {
					nativeLoads++;
					throw new Error("ordinary role loaded a predecessor buffer");
				},
				agent: async (context) => {
					if (context.step.id === "clarify")
						return context.run.answers.length
							? {
									summary: "Compatibility accepted",
									questions: [],
									constraints: [context.run.answers[0]!.answer],
								}
							: { questions: ["Keep existing clients compatible?"] };
					if (context.step.id === "requirements")
						return {
							requirements: [
								{
									id: "compatibility",
									text: "Keep existing clients compatible",
									source: "/answers/0",
								},
							],
							artifact: {
								id: "contract",
								path: "contract.txt",
								evidence: "synthetic://artifact/contract",
							},
						};
					if (context.step.id === "write") {
						const index = (context.iteration!.value as { index: number }).index;
						return {
							summary: `Structured round ${index}`,
							findings:
								index === 0
									? [
											{
												id: "old-unresolved",
												status: "open",
												evidence: "synthetic://evidence/old-failure",
												reason: "Missing independent external final proof",
											},
										]
									: [],
							observations:
								index === 1
									? [
											{
												id: "rejection",
												reason:
													"Rejected the suggested shortcut because original evidence remains missing",
												source: "synthetic://decision/rejection",
											},
										]
									: [],
						};
					}
					if (mode === "reconstructed" && !intercepted) {
						intercepted = true;
						await context.checkpointAgent!({
							runner: "codex",
							sessionId: "synthetic-native-resume149",
						});
						paused.push(context.stepKey!);
						await new Promise<void>((resolve) =>
							context.signal.addEventListener("abort", () => resolve(), {
								once: true,
							}),
						);
						context.signal.throwIfAborted();
					}
					if (context.resumeAgent)
						expect(context.resumeAgent.sessionId).toBe(
							"synthetic-native-resume149",
						);
					context.progress = await roleProgress(context);
					const connection = await contextClient(context);
					try {
						const read = async (path: string) => {
							counters.toolCalls++;
							const result = await connection.client.callTool({
								name: "read_context",
								arguments: {
									path,
									view: path.startsWith("/contextMemory") ? "compact" : "full",
									limit: 16000,
								},
							});
							expect(result.isError, `${context.stepKey} ${path}`).not.toBe(
								true,
							);
							const data = result.structuredContent!;
							expect(data.nextOffset).toBeNull();
							return data.encoding === "text"
								? data.text
								: JSON.parse(data.text as string);
						};
						const answer = (await read("/handoff/answers/0/value")) as {
							answer: string;
						};
						expect(answer.answer).toBe(
							"Keep old clients compatible; original evidence is required",
						);
						const accepted = (await read("/accepted")) as {
							requirements: { id: string }[];
						};
						expect(accepted.requirements[0]!.id).toBe("compatibility");
						const revision = (await read(
							"/handoff/progress/currentRevision",
						)) as { headSha: string; dirty: boolean };
						expect(revision.headSha).toBe(git("rev-parse", "HEAD"));
						expect(revision.dirty).toBe(false);
						expect(readFileSync(join(repo, "contract.txt"), "utf8")).toBe(
							"Preserve unresolved findings and exact scope\n",
						);
						const ledger = await read("/contextMemory/reviewLedger");
						expect(JSON.stringify(ledger)).toContain("old-unresolved");
						expect(JSON.stringify(ledger)).toContain(
							"Rejected the suggested shortcut",
						);
						const gaps = await read("/handoff/gaps");
						expect(gaps).toEqual([]);
						counters.toolCalls++;
						const denied = await connection.client.callTool({
							name: "read_context",
							arguments: { path: "/raw", view: "full" },
						});
						expect(denied.isError).toBe(true);
						counters.refusedCalls++;
						const measured = connection.prepared.counters();
						counters.pages += measured.pages;
						counters.utf8Bytes += measured.utf8Bytes;
					} finally {
						await connection.close();
					}
					roles.push(context.stepKey!);
					return {
						outcome: "needs-evidence",
						unresolved: ["old-unresolved"],
						reason: "Original independent final proof is still missing",
					};
				},
				script: async () => {
					throw new Error("No script is authorized in this drive");
				},
				tool: async () => {
					throw new Error("No provider action is authorized in this drive");
				},
			};
			let runtime = new WorkflowRuntime(state, hooks);
			runtimes.push(runtime);
			const run = runtime.create({
				id: `controlled-${mode}`,
				workflow: definitions.find((workflow) => workflow.id === "long-lived")!,
				workflowDefinitions: definitions,
				triggerOrigin: { type: "manual", workflowId: "long-lived" },
				input:
					"Evaluate accepted scope from explicit artifacts; never call missing proof accepted",
				repositoryId: "fixture",
				workspace: repo,
			});
			void runtime.launch(run);
			await waitForRuntime(() =>
				expect(runtime.get(run.id).status).toBe("waiting"),
			);
			runtime.answer(
				run.id,
				"Keep old clients compatible; original evidence is required",
			);
			if (mode === "reconstructed") {
				await waitForRuntime(() => expect(paused.length).toBeGreaterThan(0), {
					timeout: 15000,
				});
				await waitForRuntime(
					() => {
						completedSibling = runtime
							.get(run.id)
							.history.find(
								(entry) =>
									entry.step.startsWith(
										`${paused[0]!.split("/parallel/")[0]}/parallel/`,
									) &&
									entry.step !== paused[0] &&
									/perspective-[ab]$/.test(entry.step),
							);
						expect(completedSibling).toBeDefined();
					},
					{ timeout: 15000 },
				);
				completedSibling = structuredClone(completedSibling!);
				await runtime.flush(run.id);
				runtime.stop(run.id);
				await runtime.shutdown();
				runtime = new WorkflowRuntime(state, hooks);
				runtimes.push(runtime);
				runtime.resume(run.id);
			}
			await waitForRuntime(
				() => {
					expect(["completed", "failed"]).toContain(runtime.get(run.id).status);
				},
				{ timeout: 15000 },
			);
			const saved = runtime.get(run.id);
			expect([saved.status, saved.error]).toEqual(["completed", undefined]);
			expect(roles).toHaveLength(4);
			if (completedSibling) {
				expect(
					saved.history.find((entry) => entry.step === completedSibling!.step),
				).toEqual(completedSibling);
				expect(
					roles.filter((key) => key === completedSibling!.step),
				).toHaveLength(1);
			}
			expect(nativeLoads).toBe(0);
			expect(
				saved.history.filter((item) => item.step.endsWith("/write")),
			).toHaveLength(24);
			expect(saved.humanDecisions ?? []).toEqual([]);
			expect(saved.reviewGate).toBeUndefined();
			proof.push({
				mode,
				roles,
				historyEntries: saved.history.length,
				answers: saved.answers,
				context: counters,
				nativeBufferLoads: nativeLoads,
				completedSiblingRetained: completedSibling
					? completedSibling.step
					: "fresh execution",
				outcome: "needs-evidence",
				nativeResume:
					mode === "reconstructed"
						? "same synthetic identity through supported checkpoint/resume"
						: "not resumed",
				providerCalls: 0,
			});
			await runtime.shutdown();
		}
		if (process.env.F1_OUTPUTS_FIRST_RESULT)
			writeFileSync(
				process.env.F1_OUTPUTS_FIRST_RESULT,
				JSON.stringify({ mode: "mock", proof }, null, 2),
			);
	} finally {
		for (const runtime of runtimes) await runtime.shutdown();
		rmSync(home, { recursive: true, force: true });
	}
});

it("uses the authenticated existing operator retry for a bounded exact-counter extension without approval or global transcript access", async () => {
	const home = mkdtempSync(join(tmpdir(), "f1-context149-operator-"));
	let runtime: WorkflowRuntime | undefined, server: OperatorServer | undefined;
	let attempts = 0;
	try {
		const workflows = validateWorkflows([
			...defaultWorkflows,
			{
				id: "diagnostic",
				name: "Scoped diagnostic",
				steps: [
					{
						id: "analysis",
						name: "Recover one response",
						type: "agent",
						prompt:
							"Consume the explicit role inputs and preserve required evidence",
						reads: { raw: "@transcripts/roles/original/0/entry/content" },
						context: {
							mode: "outputs-first",
							transcripts: {
								purpose: "Diagnose one recorded failure",
								ranges: [{ role: "original", start: 0, end: 1 }],
								pages: 1,
								utf8Bytes: 1024,
								extension: { pages: 1, utf8Bytes: 1024 },
							},
						},
					},
				],
			},
		]);
		const workflow = workflows.find(
			(workflow) => workflow.id === "diagnostic",
		)!;
		const hooks: RuntimeHooks = {
			transcriptEntries: () => [
				{
					type: "assistant",
					content: "synthetic failure",
					codexSessionId: "synthetic-original",
					metadata: { factoryStepKey: "original", timestamp: 1 },
				},
			],
			agent: async (ctx) => {
				attempts++;
				const c = await contextClient(ctx);
				try {
					const result = await c.client.callTool({
						name: "read_context",
						arguments: { path: "/raw" },
					});
					if (attempts === 1) {
						expect(result.isError).not.toBe(true);
						const denied = await c.client.callTool({
							name: "read_context",
							arguments: { path: "/raw" },
						});
						expect(denied.isError).toBe(true);
						throw new Error(
							"Scoped transcript allowance exhausted; request its configured extension",
						);
					}
					expect(result.isError).not.toBe(true);
					return { outcome: "diagnosed", approval: false };
				} finally {
					await c.close();
				}
			},
			script: async () => ({}),
			tool: async () => ({}),
		};
		runtime = new WorkflowRuntime(home, hooks);
		const run = runtime.create({
			id: "operator149",
			workflow: workflow!,
			workflowDefinitions: workflows,
			triggerOrigin: { type: "manual", workflowId: workflow!.id },
			input: "Diagnose the original response without approving delivery",
			repositoryId: "fixture",
			workspace: home,
		});
		await runtime.launch(run);
		expect(run.status).toBe("failed");
		const grants = new OperatorGrants(home);
		const inspect = grants.issue("synthetic inspect", ["inspect"]),
			operate = grants.issue("synthetic operate", ["inspect", "operate"]);
		const service = new OperatorService(
			runtime,
			{ stop: (id) => runtime!.stop(id) },
			grants.instance(),
		);
		server = new OperatorServer(grants, service);
		await server.app.ready();
		const request = async (
			credentialFile: string | undefined,
			name: string,
			args: unknown,
		) => {
			const credential = credentialFile
				? JSON.parse(readFileSync(credentialFile, "utf8"))
				: undefined;
			return server!.app.inject({
				method: "POST",
				url: "/call",
				headers: credential
					? {
							authorization: `Bearer ${credential.token}`,
							"x-factory-instance": credential.instance,
							"x-factory-grant": credential.id,
						}
					: {},
				payload: { name, arguments: args },
			});
		};
		expect(
			(await request(undefined, "inspect_run", { runId: run.id })).statusCode,
		).toBe(401);
		const revision = (
			await request(inspect.credentialFile, "inspect_run", { runId: run.id })
		).json().result.revision;
		const access = roleContextAccess({
			run,
			step: workflow!.steps[0]!,
			stepKey: "analysis",
			factoryHome: home,
		})!;
		const receipt = JSON.parse(
			readFileSync(transcriptAccessPath(access), "utf8"),
		);
		const mutation = {
			runId: run.id,
			expectedRevision: revision,
			transcriptExtension: {
				work: "analysis",
				reason: "Inspect the same original failure once more",
				expectedPages: receipt.pages,
				expectedUtf8Bytes: receipt.utf8Bytes,
				expectedGrants: 0,
			},
		};
		expect(
			(await request(inspect.credentialFile, "retry_run", mutation)).json(),
		).toMatchObject({ ok: false, error: { code: "insufficient_scope" } });
		expect(
			(
				await request(operate.credentialFile, "retry_run", {
					...mutation,
					expectedRevision: "stale",
				})
			).json(),
		).toMatchObject({ ok: false, error: { code: "stale_state" } });
		expect(
			(await request(operate.credentialFile, "retry_run", mutation)).json().ok,
		).toBe(true);
		await waitForRuntime(() =>
			expect(runtime!.get(run.id).status).toBe("completed"),
		);
		const final = JSON.parse(
			readFileSync(transcriptAccessPath(access), "utf8"),
		);
		expect(final.grants).toHaveLength(1);
		expect(final.pages).toBe(2);
		expect(attempts).toBe(2);
		expect(run.humanDecisions ?? []).toEqual([]);
		expect(run.reviewGate).toBeUndefined();
	} finally {
		await server?.stop();
		await runtime?.shutdown();
		rmSync(home, { recursive: true, force: true });
	}
});
