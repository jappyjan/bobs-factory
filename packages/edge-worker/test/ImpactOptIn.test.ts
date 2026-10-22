import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { resourceScopes } from "../src/factory/DeliveryCoordination.js";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { FactoryTools } from "../src/factory/FactoryTools.js";
import {
	assertCurrentImpact,
	effectiveApproval,
	selectedChecks,
} from "../src/factory/Impact.js";
import { QaExecutionSchema } from "../src/factory/Qa.js";
import { qaReuseContext, stampQaCriteria } from "../src/factory/QaReuse.js";
import { consumesImpact } from "../src/factory/StepConfig.js";
import { validateWorkflows } from "../src/factory/Workflow.js";
import {
	type ExecutionContext,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";

const directories: string[] = [],
	runtimes: WorkflowRuntime[] = [];
afterEach(async () => {
	for (const runtime of runtimes.splice(0)) await runtime.shutdown();
	for (const directory of directories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});
function fixture(action = "merge") {
	const directory = mkdtempSync(join(tmpdir(), "impact-opt-in-"));
	directories.push(directory);
	const definitions = validateWorkflows([
		...defaultWorkflows,
		{
			id: "plain-impact-read",
			name: "Ordinary data read",
			stepConfigVersion: "step-config-v1",
			allowedTriggers: ["manual"],
			steps: [
				{ id: "data", name: "Data", type: "agent", prompt: "Return data" },
				{
					id: "action",
					name: "Action",
					type: "tool",
					tool: action,
					reads: { impact: "data", draftPr: "data", ci: "data" },
					checks: [],
					next: "end",
				},
			],
		},
	]);
	const runtime = new WorkflowRuntime(directory, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async (context) =>
			new FactoryTools({ postComment: async () => {} }).tool(context),
	});
	runtimes.push(runtime);
	const run = runtime.create({
		repositoryId: "repo",
		workspace: directory,
		input: "Read ordinary data",
		workflow: definitions.at(-1)!,
		workflowDefinitions: definitions,
		triggerOrigin: { type: "manual", workflowId: "plain-impact-read" },
	});
	run.outputs.data = { message: "Ordinary data, not an impact assessment" };
	const context: ExecutionContext = {
		run,
		step: run.workflow.steps[1]!,
		stepKey: "action",
		reviewKey: "unrelated-frame",
		impactKey: "unrelated-frame",
		input: {},
		outputs: run.outputs,
		evidenceDir: directory,
		signal: new AbortController().signal,
		log: () => {},
	};
	return { ...context, runtime };
}
it("does not demand an impact assessment for an ordinary named read, while explicit checks retain the demand", async () => {
	const context = fixture();
	expect(consumesImpact(context.step)).toBe(false);
	await expect(assertCurrentImpact(context)).resolves.toBeUndefined();
	const stock = fixture();
	stock.step = stock.run
		.workflowDefinitions!.find((workflow) => workflow.id === "merge-work")!
		.steps.find((step) => step.tool === "merge")!;
	expect(consumesImpact(stock.step)).toBe(true);
	await expect(assertCurrentImpact(stock)).rejects.toThrow(
		"independent impact assessment",
	);
});
it("does not consult stale approval continuations without opting into the protocol", async () => {
	const context = fixture();
	const original = {
		reviewId: "approval",
		headSha: "approved-head",
		decision: "approve" as const,
		at: "then",
	};
	context.run.humanDecisions = [original];
	context.run.approvalContinuations = [
		{
			originalReviewId: original.reviewId,
			decisionDigest: "stale",
			headSha: "other-head",
			at: "then",
		},
	];
	await expect(effectiveApproval(context)).resolves.toEqual(original);
});
it("ordinary merge reads retain the real human approval guard without demanding unrelated impact evidence", async () => {
	const context = fixture();
	const tools = new FactoryTools({
		postComment: async () => {},
		command: vi.fn(),
	});
	await expect(tools.tool(context)).rejects.toThrow(
		"Explicit human approval required before merge",
	);
});
it("does not schedule selected checks from persisted impact state without an explicit check", async () => {
	const context = fixture("impact-checks");
	const execute = vi.fn();
	await expect(selectedChecks(context, execute)).resolves.toEqual({
		questions: [],
		checks: [],
	});
	expect(execute).not.toHaveBeenCalled();
});
it("never reads or mutates persisted QA reuse obligations without opting in", () => {
	const context = fixture();
	Object.defineProperty(context.run, "impactDecisions", {
		get: () => {
			throw new Error(
				"An ordinary read must not inspect impact protocol state",
			);
		},
		configurable: true,
	});
	const execution = QaExecutionSchema.parse({
		qaContract: "qa-v1",
		results: [],
		findings: [],
		observations: [],
	});
	expect(qaReuseContext(context)).toEqual({ criteria: [] });
	expect(stampQaCriteria(context, execution)).toBe(execution);
});

it("allows an ordinary impact-checks read through native resource admission and runtime execution", async () => {
	const context = fixture("impact-checks");
	expect(resourceScopes(context)).toEqual([]);
	await context.runtime.launch(context.run);
	expect(context.run.status, context.run.error).toBe("completed");
	expect(context.run.outputs.action).toEqual({ questions: [], checks: [] });
	expect(context.run.impactDecisions).toBeUndefined();
});
it.each([
	false,
	true,
])("keeps ordinary CI feedback on its normal correction route without enabling impact (grouped=%s)", async (grouped) => {
	const context = fixture("ci");
	const provider = {
		type: "custom" as const,
		repositoryUrl: "https://forge.example/team/project",
		command: "fixture-forge",
		args: [],
	};
	const url = `${provider.repositoryUrl}/pulls/1`;
	context.run.gitProvider = provider;
	if (grouped) {
		context.run.repositories = ["repo", "other"].map((id) => ({
			id,
			name: id,
			workspace: context.run.workspace,
			repositoryPath: context.run.workspace,
			baseBranch: "main",
			providerSnapshot: provider,
		}));
		context.run.outputs.data = {
			scopeVersion: 1,
			deliveries: context.run.repositories.map((repository) => ({
				repositoryId: repository.id,
				name: repository.name,
				output: { url, headSha: "head", baseSha: "base" },
			})),
		};
	} else context.run.outputs.data = { url, headSha: "head" };
	const command = vi.fn(
		async (_context: ExecutionContext, executable: string, args: string[]) => {
			if (executable === "git") return args[0] === "rev-parse" ? "head" : "";
			expect(executable).toBe("fixture-forge");
			expect(args[0]).toBe("readiness");
			const request = JSON.parse(readFileSync(args.at(-1)!, "utf8"));
			expect(request.input.url).toBe(url);
			return JSON.stringify({
				headSha: "head",
				baseSha: "base",
				url,
				state: "OPEN",
				isDraft: false,
				approved: true,
				reviewReady: true,
				fix: false,
				blockers: [],
				checks: [],
				threads: [],
				comments: [
					{
						id: "review-comment",
						body: "Please fix the unsafe access check",
						user: { login: "reviewer" },
					},
				],
				reviews: [],
				queued: false,
				mergeMethod: "squash",
			});
		},
	);
	const output = await new FactoryTools({
		postComment: async () => {},
		command,
	}).tool(context);
	expect(output).toMatchObject({ fix: true });
	expect(output).not.toHaveProperty("impactRequired", true);
	expect(context.run.impactDecisions).toBeUndefined();
	const deliveries = grouped
		? (
				output as { deliveries: { output: Record<string, unknown> }[] }
			).deliveries.map((delivery) => delivery.output)
		: [output];
	for (const delivery of deliveries) {
		expect(delivery).toMatchObject({
			fix: true,
			unassessedComments: [{ id: "review-comment" }],
		});
		expect(delivery).not.toHaveProperty("impactRequired", true);
	}
});
