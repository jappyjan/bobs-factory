import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	type Architecture,
	ArchitectureReviewSchema,
	ArchitectureSchema,
	assertRevisionChanges,
	snapshotProposal,
	verifyProposal,
} from "../src/factory/Architecture.js";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { validateFactoryResult } from "../src/factory/FactoryResults.js";
import { validateReviewFix } from "../src/factory/ReviewRecovery.js";
import {
	StepSchema,
	validateWorkflows,
	type Workflow,
} from "../src/factory/Workflow.js";
import { WorkflowCatalog } from "../src/factory/WorkflowCatalog.js";
import {
	type FactoryRun,
	type RuntimeHooks,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import { proposal } from "./fixtures/architecture.js";
import { FactoryServer } from "./fixtures/authenticated-factory.js";
import { waitForRuntime as waitFor } from "./fixtures/runtime-wait.js";

const homes: string[] = [];
afterEach(() => {
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});

function migrate(definitions: Workflow[]) {
	const home = mkdtempSync(join(tmpdir(), "architecture-migration-"));
	homes.push(home);
	const directory = join(home, "factory");
	mkdirSync(directory);
	writeFileSync(
		join(directory, "workflows.json"),
		JSON.stringify({ workflows: definitions, defaultWorkflow: "factory" }),
	);
	const catalog = new WorkflowCatalog(directory);
	return {
		catalog,
		pipeline: catalog
			.list()
			.find(
				(w) =>
					w.id ===
					(catalog.read().migration!.mappings["factory-pipeline"] ??
						"factory-pipeline"),
			)!,
	};
}

function setup(
	classification: Architecture["classification"] = "meaningful",
	extra: Partial<RuntimeHooks> = {},
	decisionArguments: Record<string, unknown> = {},
	implementationId = "implement",
) {
	const home = mkdtempSync(join(tmpdir(), "architecture-test-"));
	homes.push(home);
	const implemented: unknown[] = [];
	const hooks: RuntimeHooks = {
		agent: async (c) => {
			if (c.step.architectureContract === "architecture-v1")
				return proposal(classification);
			if (c.step.architectureContract === "architecture-review-v1")
				return { approved: true, feedback: [] };
			if (c.step.id === "question-explanation")
				return {
					questions: [
						"This keeps design approval separate from PR approval. Accept the displayed version or request changes; an explanation is not acceptance.",
					],
				};
			implemented.push(c.input);
			return {
				status: "completed",
				summary: "done",
				checks: [],
				questions: [],
			};
		},
		script: async () => ({}),
		tool: async () => ({}),
		...extra,
	};
	const runtime = new WorkflowRuntime(home, hooks);
	const steps = [
		{
			id: "design",
			name: "Design",
			type: "agent",
			prompt: "Design",
			architectureContract: "architecture-v1",
		},
		{
			id: "candidate-review",
			name: "Review",
			type: "agent",
			prompt: "Review",
			architectureContract: "architecture-review-v1",
			architectureSource: "design",
			branches: [{ when: { path: "approved", equals: false }, next: "design" }],
		},
		{
			id: "decision",
			name: "Decision",
			type: "tool",
			tool: "architecture-decision",
			arguments: {
				proposal: "design",
				review: "candidate-review",
				planOutput: "plan",
				revise: "design",
				approval: "meaningful",
				...decisionArguments,
			},
		},
		{
			id: implementationId,
			name: "Implement",
			type: "agent",
			prompt: "Implement",
			inputs: ["plan"],
			askQuestions: true,
		},
	];
	const definition = validateWorkflows([
		...defaultWorkflows,
		{ id: "test", name: "Test", steps },
	]).at(-1)!;
	const run = runtime.create({
		title: "Architecture",
		repositoryId: "repo",
		workspace: home,
		workflow: definition,
		input: "PRIVATE TICKET",
		triggerOrigin: {
			type: "manual",
			workflowId: "test",
			at: new Date().toISOString(),
		},
	});
	const running = runtime.launch(run);
	return { runtime, run, home, hooks, implemented, running };
}
async function waiting(run: FactoryRun) {
	await waitFor(() => expect(run.status).toBe("waiting"));
}
function decide(
	runtime: WorkflowRuntime,
	run: FactoryRun,
	decision = "accept",
	feedback?: string,
) {
	const p = run.architectureProposals!.at(-1)!;
	runtime.decideArchitecture(run.id, {
		proposalId: p.id,
		version: p.version,
		digest: p.digest,
		decision,
		feedback,
	});
}
async function finished(runtime: WorkflowRuntime, run: FactoryRun) {
	await waitFor(() => expect(run.status).toBe("completed"));
	await runtime.shutdown();
}

describe("architecture authorization boundary", () => {
	it.each([
		"code-fix",
		"visual-fix",
	])("routes a validated %s handback through the configured proposal and fresh acceptance", async (fixer) => {
		let fixes = 0;
		const finding = {
			id: "boundary-correction",
			rating: 3,
			status: "open",
			summary: "The accepted boundary needs correction.",
			evidence: "A focused probe shows the current boundary is insufficient.",
		};
		const gate = fixer === "visual-fix" ? "visual-gate" : "review-gate";
		const { runtime, run, running } = setup(
			"meaningful",
			{
				agent: async (context) => {
					if (context.step.architectureContract === "architecture-v1") {
						const candidate = proposal();
						if (fixes) {
							candidate.candidate.plan += "\nRevise the security boundary.";
							candidate.changes = [
								{ text: "Revise the security boundary.", from: "bob" },
							];
						}
						return candidate;
					}
					if (context.step.architectureContract === "architecture-review-v1")
						return { approved: true, feedback: [] };
					fixes++;
					context.run.outputs[gate] = { approved: false, findings: [finding] };
					const output = validateFactoryResult(
						fixer,
						fixes === 1
							? {
									status: "blocked",
									architectureRevision: true,
									summary: "Revise the accepted security boundary first.",
									dispositions: [],
									questions: [],
								}
							: {
									summary:
										"The accepted correction is ready for independent review.",
									dispositions: [
										{
											id: finding.id,
											status: "fixed",
											reason: "Updated after exact proposal acceptance.",
										},
									],
									questions: [],
								},
					);
					validateReviewFix(context, output);
					return output;
				},
			},
			{ approval: "always" },
			fixer,
		);
		try {
			await waiting(run);
			expect(fixes).toBe(0);
			const first = run.architectureProposals![0]!;
			decide(runtime, run);
			await waitFor(() => expect(run.architectureProposals).toHaveLength(2));
			await waiting(run);
			expect(run.error).toBeUndefined();
			expect(fixes).toBe(1);
			expect(run.outputs[fixer]).toMatchObject({ architectureRevision: true });
			expect(run.outputs[gate]).toEqual({
				approved: false,
				findings: [finding],
			});
			expect(run.architectureDecisions).toHaveLength(1);
			expect(run.architectureProposals![1]!.status).toBe("pending");
			expect(() =>
				runtime.decideArchitecture(run.id, {
					proposalId: first.id,
					version: first.version,
					digest: first.digest,
					decision: "accept",
				}),
			).toThrow();
			decide(runtime, run);
			await running;
			expect(run.status).toBe("completed");
			expect(fixes).toBe(2);
			expect(run.architectureDecisions).toHaveLength(2);
			expect(run.outputs[gate]).toEqual({
				approved: false,
				findings: [finding],
			});
		} finally {
			await runtime.shutdown();
		}
	});
	it("rejects absent and empty HTTP assets before approval or implementation", async () => {
		const server = createServer((request, response) => {
			response.statusCode = request.url === "/absent" ? 204 : 200;
			response.end(request.url === "/success" ? "remote specification" : "");
		});
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		const address = server.address();
		if (!address || typeof address === "string")
			throw new Error("No HTTP port");
		try {
			for (const path of ["absent", "empty", "success"]) {
				const value = proposal();
				value.candidate.assets = [
					{
						path: `http://127.0.0.1:${address.port}/${path}`,
						purpose: "specification",
					},
				];
				const { runtime, run, running, implemented } = setup("meaningful", {
					agent: async (context) =>
						context.step.architectureContract === "architecture-v1"
							? value
							: { approved: true, feedback: [] },
				});
				try {
					if (path === "success") {
						await waiting(run);
						expect(
							readFileSync(
								run.architectureProposals![0]!.content.candidate.assets[0]!
									.path,
								"utf8",
							),
						).toBe("remote specification");
					} else {
						await running;
						expect(run.status).toBe("failed");
						expect(run.error).toMatch(/no body/);
						expect(run.architectureProposals).toEqual([]);
						expect(run.architectureGate).toBeUndefined();
					}
					expect(implemented).toEqual([]);
				} finally {
					await runtime.shutdown();
				}
			}
		} finally {
			await new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			);
		}
	});
	it("deduplicates architecture explanation ticket notifications through restart and notifies a revised proposal", async () => {
		const notifications: string[] = [];
		const { runtime, run, home, hooks, implemented } = setup("meaningful", {
			track: async (tracked, milestone) => {
				const receipt = tracked.ticketSync?.receipts.find(
					(item) => item.key === milestone.key,
				);
				if (receipt && !receipt.delivered) {
					receipt.delivered = true;
					if (milestone.key.startsWith("questions:"))
						notifications.push(milestone.key);
				}
			},
		});
		run.ticketReference = {
			provider: "taskbot",
			instance: "https://taskbot.test",
			project: "test",
			id: 1,
			url: "https://taskbot.test/p/test/t/1",
			server: "taskbot",
		};
		await waiting(run);
		const first = run.architectureProposals![0]!;
		const batch = run.questionBatchId;
		await waitFor(() => expect(notifications).toHaveLength(1));
		for (let count = 1; count <= 2; count++) {
			decide(runtime, run, "explain", "Why separate approval?");
			await waitFor(() =>
				expect(
					first.feedback.filter((item) => item.kind === "explanation"),
				).toHaveLength(count),
			);
			await waiting(run);
			expect(run.questionBatchId).toBe(batch);
			await waitFor(() => expect(notifications).toHaveLength(1));
		}
		await runtime.shutdown();
		const restored = new WorkflowRuntime(home, hooks);
		const resumed = restored.get(run.id);
		try {
			restored.resumeAll();
			await waiting(resumed);
			expect(resumed.questionBatchId).toBe(batch);
			await waitFor(() => expect(notifications).toHaveLength(1));
			expect(implemented).toEqual([]);
			decide(restored, resumed, "revise", "Retain the existing interface");
			await waitFor(() =>
				expect(resumed.architectureProposals).toHaveLength(2),
			);
			await waiting(resumed);
			expect(resumed.questionBatchId).not.toBe(batch);
			await waitFor(() => expect(notifications).toHaveLength(2));
			expect(implemented).toEqual([]);
			decide(restored, resumed);
			await finished(restored, resumed);
			expect(implemented).toHaveLength(1);
		} finally {
			await restored.shutdown();
		}
	});
	it("rejects malformed maps, missing rationale, meaningful proposals without a map or decisions, and model-authored approval", () => {
		const value = proposal();
		expect(
			ArchitectureSchema.safeParse({ ...value, accepted: true }).success,
		).toBe(false);
		expect(
			ArchitectureSchema.safeParse({ ...value, rationale: "" }).success,
		).toBe(false);
		expect(
			ArchitectureSchema.safeParse({ ...value, map: undefined }).success,
		).toBe(false);
		expect(
			ArchitectureSchema.safeParse({ ...value, decisions: [] }).success,
		).toBe(false);
		const badPick = proposal();
		badPick.decisions[0]!.pick = "missing";
		expect(ArchitectureSchema.safeParse(badPick).success).toBe(false);
		const pickedOpen = proposal();
		pickedOpen.decisions[0]!.status = "open";
		pickedOpen.decisions[0]!.why = "Depends on your team.";
		expect(ArchitectureSchema.safeParse(pickedOpen).success).toBe(false);
		const badPreview = proposal();
		badPreview.decisions[0]!.options[1]!.preview!.hide = ["missing"];
		expect(ArchitectureSchema.safeParse(badPreview).success).toBe(false);
		expect(() => assertRevisionChanges(proposal(), 1)).toThrow("changed");
		expect(() => assertRevisionChanges(proposal(), 0)).not.toThrow();
		value.map!.links[0]!.to = "missing";
		expect(ArchitectureSchema.safeParse(value).success).toBe(false);
		expect(
			validateFactoryResult(
				"renamed",
				proposal(),
				undefined,
				undefined,
				"architecture-v1",
			),
		).toEqual(proposal());
	});
	it("waits, rejects stale and duplicate acceptance, then hands off the exact candidate without ticket/history", async () => {
		const { runtime, run, implemented } = setup();
		await waiting(run);
		expect(implemented).toEqual([]);
		const p = run.architectureProposals![0]!;
		expect(() =>
			runtime.decideArchitecture(run.id, {
				proposalId: p.id,
				version: 999,
				digest: p.digest,
				decision: "accept",
			}),
		).toThrow("changed");
		decide(runtime, run);
		expect(() => decide(runtime, run)).toThrow("not waiting");
		await finished(runtime, run);
		expect(implemented).toEqual([{ plan: p.content.candidate, answers: [] }]);
		expect(run.humanDecisions).toBeUndefined();
	});
	it("regenerates after rejection/discussion; explanation retains pending identity without implementing", async () => {
		const { runtime, run, implemented } = setup();
		await waiting(run);
		const first = run.architectureProposals![0]!;
		decide(runtime, run, "explain", "Why separate approval?");
		await waitFor(() =>
			expect(run.questions[0]).toMatch(/keeps design approval/),
		);
		await waiting(run);
		expect(run.architectureGate?.proposalId).toBe(first.id);
		expect(first.status).toBe("pending");
		expect(implemented).toEqual([]);
		decide(runtime, run, "revise", "Use the existing checkpoint");
		await waiting(run);
		await waitFor(() => expect(run.architectureProposals).toHaveLength(2));
		await waiting(run);
		expect(first.status).toBe("rejected");
		expect(() =>
			runtime.decideArchitecture(run.id, {
				proposalId: first.id,
				version: first.version,
				digest: first.digest,
				decision: "accept",
			}),
		).toThrow("changed");
		runtime.answer(
			run.id,
			"Explain the alternatives in a revised proposal",
			"answer",
		);
		await waitFor(() => expect(run.architectureProposals).toHaveLength(3));
		await waiting(run);
		decide(runtime, run);
		await finished(runtime, run);
		expect(implemented).toHaveLength(1);
	});
	it("records routine bypass and never fabricates human acceptance", async () => {
		const { runtime, run, implemented } = setup("routine");
		await finished(runtime, run);
		expect(implemented).toHaveLength(1);
		expect(run.architectureProposals![0]!.status).toBe("routine");
		expect(run.architectureDecisions ?? []).toEqual([]);
		expect(run.outputs.decision).toMatchObject({
			decision: "routine",
			reason: proposal().rationale,
		});
	});
	it("continues cumulative independently reviewed revisions from one exact human acceptance", async () => {
		let implementations = 0;
		const { runtime, run, running } = setup(
			"meaningful",
			{
				agent: async (context) => {
					if (context.step.architectureContract === "architecture-v1") {
						const value = proposal();
						value.changes = [
							{ text: "Include the required caller tests.", from: "bob" },
						];
						return value;
					}
					if (context.step.architectureContract === "architecture-review-v1") {
						const accepted = context.run.architectureDecisions?.find(
							(d) => d.decision === "accept",
						);
						return {
							approved: true,
							feedback: [],
							...(accepted
								? {
										continuation: {
											proposalId: accepted.proposalId,
											version: accepted.version,
											digest: accepted.digest,
											reason:
												"Only caller tests were added; requirements, boundaries and exclusions match the accepted architecture.",
										},
									}
								: {}),
						};
					}
					implementations++;
					return implementations < 3
						? {
								status: "blocked",
								architectureRevision: true,
								summary: "Discovered a caller test.",
								checks: [],
								questions: [],
							}
						: {
								status: "completed",
								summary: "All caller tests updated.",
								checks: [],
								questions: [],
							};
				},
			},
			{ continueAccepted: true },
		);
		try {
			await waiting(run);
			expect(implementations).toBe(0);
			decide(runtime, run);
			await running;
			expect(run.error).toBeUndefined();
			expect(run.status).toBe("completed");
			expect(implementations).toBe(3);
			expect(run.architectureDecisions).toHaveLength(1);
			const accepted = run.architectureDecisions![0]!;
			for (const p of run.architectureProposals!.slice(1)) {
				expect(p.status).toBe(
					p === run.architectureProposals!.at(-1) ? "routine" : "superseded",
				);
				expect(p.continuation).toMatchObject({
					proposalId: accepted.proposalId,
					digest: accepted.digest,
				});
			}
			expect(run.outputs.plan).toEqual(
				run.architectureProposals!.at(-1)!.content.candidate,
			);
		} finally {
			await runtime.shutdown();
		}
	});
	it.each([
		"disabled",
		"always",
		"missing",
		"stale",
		"open",
		"revoked",
	])("retains the architecture gate when continuation is %s", async (mode) => {
		let implementations = 0;
		const { runtime, run } = setup(
			"meaningful",
			{
				agent: async (context) => {
					if (context.step.architectureContract === "architecture-v1") {
						const value = proposal();
						value.changes = [{ text: "Revised candidate.", from: "bob" }];
						if (implementations && mode === "open")
							Object.assign(value.decisions[0]!, {
								status: "open",
								pick: undefined,
								decidedBy: undefined,
								why: "Requires a scope decision.",
							});
						return value;
					}
					if (context.step.architectureContract === "architecture-review-v1") {
						const accepted = context.run.architectureDecisions?.find(
							(d) => d.decision === "accept",
						);
						return {
							approved: true,
							feedback: [],
							...(accepted && mode !== "missing"
								? {
										continuation: {
											proposalId: accepted.proposalId,
											version: accepted.version,
											digest: mode === "stale" ? "stale" : accepted.digest,
											reason: "Only test wiring changed.",
										},
									}
								: {}),
						};
					}
					implementations++;
					if (mode === "revoked")
						context.run.architectureDecisions!.push({
							...context.run.architectureDecisions![0]!,
							decision: "revise",
							feedback: "Change the boundary.",
							at: new Date().toISOString(),
						});
					return {
						status: "blocked",
						architectureRevision: true,
						summary: "Changed design.",
						checks: [],
						questions: [],
					};
				},
			},
			{
				continueAccepted: mode !== "disabled",
				...(mode === "always" ? { approval: "always" } : {}),
			},
		);
		try {
			await waiting(run);
			decide(runtime, run);
			await waitFor(() => expect(run.architectureProposals).toHaveLength(2));
			await waiting(run);
			expect(implementations).toBe(1);
			expect(run.architectureProposals!.at(-1)!.status).toBe("pending");
			expect(run.architectureGate?.proposalId).toBe(
				run.architectureProposals!.at(-1)!.id,
			);
		} finally {
			await runtime.shutdown();
		}
	});
	it("blocks approval and bypass while a decision is open, then accepts the version that answers it", async () => {
		let versions = 0;
		const open = (): Architecture => {
			const value = proposal();
			if (versions++ > 0) {
				value.changes = [{ text: "Used your answer.", from: "you" }];
				value.decisions[0]!.decidedBy = "you";
				return value;
			}
			Object.assign(value.decisions[0]!, {
				status: "open",
				pick: undefined,
				decidedBy: undefined,
				why: "Depends on how your team reviews.",
			});
			return value;
		};
		const { runtime, run, implemented } = setup("routine", {
			agent: async (c) => {
				if (c.step.architectureContract === "architecture-v1") return open();
				if (c.step.architectureContract === "architecture-review-v1")
					return { approved: true, feedback: [] };
				implemented.push(c.input);
				return {
					status: "completed",
					summary: "done",
					checks: [],
					questions: [],
				};
			},
		});
		// A routine classification never bypasses an open decision.
		await waiting(run);
		expect(run.architectureProposals![0]!.status).toBe("pending");
		expect(implemented).toEqual([]);
		await runtime.shutdown();
		versions = 0;
		const second = setup("meaningful", {
			agent: async (c) => {
				if (c.step.architectureContract === "architecture-v1") return open();
				if (c.step.architectureContract === "architecture-review-v1")
					return { approved: true, feedback: [] };
				second.implemented.push(c.input);
				return {
					status: "completed",
					summary: "done",
					checks: [],
					questions: [],
				};
			},
		});
		await waiting(second.run);
		expect(() => decide(second.runtime, second.run)).toThrow("open questions");
		decide(second.runtime, second.run, "revise", "Use the run checkpoint.");
		await waitFor(() =>
			expect(second.run.architectureProposals).toHaveLength(2),
		);
		await waiting(second.run);
		decide(second.runtime, second.run);
		await finished(second.runtime, second.run);
		expect(second.implemented).toHaveLength(1);
	});
	it("retains waiting identity and accepted handoff through restart", async () => {
		const { runtime, run, home, hooks, implemented } = setup();
		await waiting(run);
		const identity = run.architectureProposals![0]!.id;
		await runtime.shutdown();
		const restored = new WorkflowRuntime(home, hooks);
		restored.resumeAll();
		const resumed = restored.get(run.id);
		await waiting(resumed);
		expect(resumed.architectureProposals![0]!.id).toBe(identity);
		decide(restored, resumed);
		await finished(restored, resumed);
		const again = new WorkflowRuntime(home, hooks);
		again.resumeAll();
		expect(again.get(run.id).outputs.plan).toEqual(
			resumed.architectureProposals![0]!.content.candidate,
		);
		expect(implemented).toHaveLength(1);
		await again.shutdown();
	});
	it("stop prevents acceptance; explicit resume restores the same proposal", async () => {
		const { runtime, run, implemented, running } = setup();
		await waiting(run);
		const identity = run.architectureProposals![0]!.id;
		runtime.stop(run.id);
		expect(() => decide(runtime, run)).toThrow("not waiting");
		await waitFor(() => expect(run.status).toBe("stopped"));
		await running;
		runtime.retry(run.id);
		await waiting(run);
		expect(run.architectureProposals![0]!.id).toBe(identity);
		decide(runtime, run);
		await finished(runtime, run);
		expect(implemented).toHaveLength(1);
	});
	it("snapshots assets and refuses changed snapshot bytes", async () => {
		const { home, runtime } = setup("routine");
		await runtime.shutdown();
		const path = join(home, "input.txt");
		writeFileSync(path, "original");
		const value = proposal();
		value.candidate.assets = [{ path, purpose: "spec" }];
		value.candidate.plan = `Implement the specification at ${path}`;
		const p = await snapshotProposal(
			value,
			"design",
			1,
			home,
			new AbortController().signal,
		);
		writeFileSync(path, "changed original");
		verifyProposal(p);
		expect(
			p.content.candidate.plan.split("## Accepted asset snapshots")[0],
		).toContain(
			`Implement the specification at ${p.content.candidate.assets[0]!.path}`,
		);
		expect(readFileSync(p.content.candidate.assets[0]!.path, "utf8")).toBe(
			"original",
		);
		writeFileSync(p.content.candidate.assets[0]!.path, "changed snapshot");
		expect(() => verifyProposal(p)).toThrow("asset changed");
	});
	it("rejects outside files, sibling-prefix paths, traversal and symlink escapes", async () => {
		const home = mkdtempSync(join(tmpdir(), "architecture-scope-"));
		homes.push(home);
		const allowed = join(home, "allowed");
		const sibling = join(home, "allowed-other");
		mkdirSync(allowed);
		mkdirSync(sibling);
		const secret = join(sibling, "secret.txt");
		writeFileSync(secret, "restricted");
		symlinkSync(sibling, join(allowed, "escape"));
		for (const path of [
			secret,
			`${allowed}/../allowed-other/secret.txt`,
			join(allowed, "escape", "secret.txt"),
		]) {
			const value = proposal();
			value.candidate.assets = [{ path, purpose: "spec" }];
			await expect(
				snapshotProposal(
					value,
					"design",
					1,
					allowed,
					new AbortController().signal,
				),
			).rejects.toThrow("outside authorized directories");
		}
		const spec = join(allowed, "spec.txt");
		writeFileSync(spec, "authorized");
		symlinkSync(spec, join(allowed, "linked.txt"));
		const value = proposal();
		value.candidate.assets = [
			{ path: join(allowed, "linked.txt"), purpose: "spec" },
		];
		const frozen = await snapshotProposal(
			value,
			"design",
			1,
			allowed,
			new AbortController().signal,
		);
		expect(readFileSync(frozen.content.candidate.assets[0]!.path, "utf8")).toBe(
			"authorized",
		);
	});
	it("uses the shared stock path and preserves operator-customized planning", () => {
		const pipeline = defaultWorkflows.find((w) => w.id === "factory-pipeline")!;
		expect(
			pipeline.steps.find((s) => s.id === "architecture")?.architectureContract,
		).toBe("architecture-v1");
		const custom = structuredClone(defaultWorkflows);
		custom
			.find((w) => w.id === "factory-pipeline")!
			.steps.find((s) => s.id === "architecture")!.prompt = "Custom design";
		expect(
			migrate(custom).pipeline.steps.find((s) => s.id === "architecture")!
				.prompt,
		).toBe("Custom design");
	});
	it("stops the workflow when the proposal tries to snapshot a restricted file", async () => {
		const outside = mkdtempSync(join(tmpdir(), "architecture-restricted-"));
		homes.push(outside);
		const path = join(outside, "secret.txt");
		writeFileSync(path, "restricted");
		const value = proposal();
		value.candidate.assets = [{ path, purpose: "spec" }];
		const { runtime, run, running, implemented } = setup("meaningful", {
			agent: async () => value,
		});
		await running;
		expect(run.status).toBe("failed");
		expect(run.architectureProposals).toEqual([]);
		expect(implemented).toEqual([]);
		await runtime.shutdown();
	});
});

it("protects remote architecture decisions, rejects stale tabs, and routes chat feedback through regeneration", async () => {
	const { runtime, run, implemented } = setup();
	await waiting(run);
	const server = new FactoryServer(
		runtime,
		{
			repositories: () => [],
			sessions: () => [],
			entries: () => [],
			start: async () => {
				throw new Error("unused");
			},
			stop: (id) => runtime.stop(id),
		},
		"https://architecture.example.test",
	);
	const p = run.architectureProposals![0]!;
	const body = {
		proposalId: p.id,
		version: p.version,
		digest: p.digest,
		decision: "accept",
	};
	try {
		const denied = await server.app.inject({
			method: "POST",
			remoteAddress: "203.0.113.1",
			url: `/api/runs/${run.id}/architecture-decision`,
			headers: { cookie: "", "x-factory-request": "1" },
			payload: body,
		});
		expect(denied.statusCode).toBe(401);
		const stale = await server.app.inject({
			method: "POST",
			remoteAddress: "203.0.113.1",
			url: `/api/runs/${run.id}/architecture-decision`,
			headers: { "x-factory-request": "1" },
			payload: { ...body, digest: "stale" },
		});
		expect(stale.statusCode).toBe(409);
		expect(implemented).toHaveLength(0);
		const chat = await server.app.inject({
			method: "POST",
			remoteAddress: "203.0.113.1",
			url: `/api/runs/${run.id}/messages`,
			headers: { "x-factory-request": "1" },
			payload: { text: "Keep inherited Takeover work in the revised plan" },
		});
		expect(chat.statusCode).toBe(202);
		await waitFor(() => expect(run.architectureProposals).toHaveLength(2));
		await waiting(run);
		const next = run.architectureProposals!.at(-1)!;
		const accepted = await server.app.inject({
			method: "POST",
			remoteAddress: "203.0.113.1",
			url: `/api/runs/${run.id}/architecture-decision`,
			headers: { "x-factory-request": "1" },
			payload: {
				...body,
				proposalId: next.id,
				version: next.version,
				digest: next.digest,
			},
		});
		expect(accepted.statusCode).toBe(202);
		const duplicate = await server.app.inject({
			method: "POST",
			remoteAddress: "203.0.113.1",
			url: `/api/runs/${run.id}/architecture-decision`,
			headers: { "x-factory-request": "1" },
			payload: body,
		});
		expect(duplicate.statusCode).toBe(409);
		await finished(runtime, run);
		expect(implemented).toHaveLength(1);
	} finally {
		await runtime.shutdown();
		await server.stop();
	}
});
it("never advances an exhausted failed candidate-review loop", async () => {
	const { runtime, run, implemented } = setup("meaningful", {
		agent: async (c) =>
			c.step.architectureContract === "architecture-v1"
				? proposal()
				: { approved: false, feedback: ["Resolve the boundary"] },
	});
	await waitFor(() => expect(run.status).toBe("failed"), { timeout: 15000 });
	expect(run.error).toMatch(/Iteration limit/);
	expect(implemented).toEqual([]);
	expect(run.architectureDecisions ?? []).toEqual([]);
	await runtime.shutdown();
});

it("persists an architecture review question across restart and still requires acceptance of the revised proposal", async () => {
	let drafts = 0,
		reviews = 0,
		implementations = 0;
	const f = setup("meaningful", {
		agent: async (context) => {
			if (context.step.architectureContract === "architecture-v1") {
				drafts++;
				return proposal();
			}
			if (context.step.architectureContract === "architecture-review-v1") {
				reviews++;
				return reviews === 1
					? {
							approved: false,
							feedback: ["Record the privacy choice"],
							questions: [
								"May eligible users browse minimal supervisor names?",
							],
						}
					: { approved: true, feedback: [] };
			}
			implementations++;
			return {
				status: "completed",
				summary: "Implemented accepted design",
				checks: [],
				questions: [],
			};
		},
	});
	await waiting(f.run);
	expect(f.run.step).toBe("candidate-review");
	expect(drafts).toBe(1);
	expect(reviews).toBe(1);
	expect(f.run.architectureGate).toBeUndefined();
	expect(f.run.architectureDecisions ?? []).toEqual([]);
	await f.runtime.shutdown();
	const restored = new WorkflowRuntime(f.home, f.hooks);
	const run = restored.get(f.run.id);
	void restored.launch(run);
	await waiting(run);
	expect(drafts).toBe(1);
	expect(reviews).toBe(1);
	restored.answer(run.id, "Allow eligible users to browse minimal names");
	await waitFor(() => expect(run.architectureGate).toBeDefined());
	await waiting(run);
	expect(drafts).toBe(2);
	expect(reviews).toBe(2);
	expect(run.answers.at(-1)?.answer).toBe(
		"Allow eligible users to browse minimal names",
	);
	expect(implementations).toBe(0);
	expect(run.architectureDecisions ?? []).toEqual([]);
	decide(restored, run);
	await finished(restored, run);
	expect(implementations).toBe(1);
});
it("cannot approve an architecture review while asking an unresolved human question", () => {
	expect(() =>
		ArchitectureReviewSchema.parse({
			approved: true,
			feedback: [],
			questions: ["Which privacy policy?"],
		}),
	).toThrow("unanswered questions");
});

it("requires fresh acceptance when later requirements change the accepted architecture", async () => {
	let implementations = 0;
	const { runtime, run } = setup("meaningful", {
		agent: async (c) => {
			if (c.step.architectureContract === "architecture-v1") return proposal();
			if (c.step.architectureContract === "architecture-review-v1")
				return { approved: true, feedback: [] };
			implementations++;
			return implementations === 1
				? {
						status: "blocked",
						architectureRevision: true,
						summary:
							"A new requirement changes the boundary; completed work is preserved.",
						checks: [],
						questions: [],
					}
				: {
						status: "completed",
						summary: "Implemented after new acceptance",
						checks: [],
						questions: [],
					};
		},
	});
	await waiting(run);
	const first = run.architectureProposals![0]!;
	decide(runtime, run);
	await waitFor(() => expect(run.architectureProposals).toHaveLength(2));
	await waiting(run);
	expect(implementations).toBe(1);
	expect(first.status).toBe("superseded");
	expect(run.architectureDecisions).toHaveLength(1);
	decide(runtime, run);
	await finished(runtime, run);
	expect(implementations).toBe(2);
});
it("upgrades untouched stock planning, preserving customized model settings and frozen active runs", async () => {
	const { legacyReviewSteps } = await import(
		"../src/factory/defaultWorkflows.js"
	);
	const old = structuredClone(defaultWorkflows);
	old.find((w) => w.id === "factory-pipeline")!.steps = legacyReviewSteps.map(
		(s) => StepSchema.parse(s),
	);
	const upgraded = migrate(old).catalog.list();
	expect(
		upgraded
			.find((w) => w.id === "factory-pipeline")!
			.steps.some((s) => s.architectureContract === "architecture-v1"),
	).toBe(true);
	const customized = structuredClone(defaultWorkflows);
	customized.find((w) => w.id === "factory-pipeline")!.steps =
		legacyReviewSteps.map((s) => StepSchema.parse(s));
	customized
		.find((w) => w.id === "factory-pipeline")!
		.steps.find((s) => s.id === "plan-review")!.model = "operator-selected";
	expect(
		migrate(customized).pipeline.steps.some((s) => s.architectureContract),
	).toBe(true);
	expect(
		migrate(customized).pipeline.steps.find((s) => s.id === "plan-review")!
			.model,
	).toBe("operator-selected");
	const { runtime, run, home, hooks } = setup();
	await waiting(run);
	const frozen = structuredClone(run.workflowDefinitions);
	await runtime.shutdown();
	writeFileSync(
		join(home, "factory", "workflows.json"),
		JSON.stringify({ workflows: customized, defaultWorkflow: "factory" }),
	);
	const restored = new WorkflowRuntime(home, hooks);
	expect(restored.get(run.id).workflowDefinitions).toEqual(frozen);
	await restored.shutdown();
});

it("recovers acceptance saved immediately before shutdown without asking again or advancing twice", async () => {
	const { runtime, run, home, hooks, implemented } = setup();
	await waiting(run);
	const candidate = structuredClone(
		run.architectureProposals![0]!.content.candidate,
	);
	decide(runtime, run);
	// Abort in the same call stack, before the resolved wait can advance the graph.
	await runtime.shutdown();
	expect(implemented).toHaveLength(0);
	const restored = new WorkflowRuntime(home, hooks);
	const resumed = restored.get(run.id);
	restored.resumeAll();
	await finished(restored, resumed);
	expect(implemented).toEqual([{ plan: candidate, answers: [] }]);
	expect(resumed.architectureDecisions).toHaveLength(1);
	expect(resumed.architectureProposals![0]!.status).toBe("accepted");
});
