import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publishStorageJson, storageDigest } from "bobs-factory-core";
import { afterEach, expect, it, vi } from "vitest";
import {
	conservativeWorkflows,
	defaultWorkflows,
} from "../src/factory/defaultWorkflows.js";
import { validateWorkflows, WorkflowSchema } from "../src/factory/Workflow.js";
import {
	type FactoryRun,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import type { GitService } from "../src/GitService.js";
import { factoryStorage } from "../src/storage/FactoryStorage.js";
import type {
	RetainedWorkspaceProof,
	WorkspaceRetentionSource,
} from "../src/storage/WorktreeArtifacts.js";

// Exercise the complete runtime reference inspection without filesystem/Git
// deletion. The F1 storage routes separately verify the real worktree adapter.
const captured = vi.hoisted(() => ({
	source: undefined as WorkspaceRetentionSource | undefined,
}));
vi.mock("../src/storage/WorktreeArtifacts.js", () => ({
	WorktreeArtifacts: class {
		constructor(source: WorkspaceRetentionSource) {
			captured.source = source;
		}
	},
}));

const homes: string[] = [];
const runtimes: WorkflowRuntime[] = [];
const sources: WorkspaceRetentionSource[] = [];
afterEach(async () => {
	for (const source of sources.splice(0)) await source.close?.();
	for (const runtime of runtimes.splice(0)) await runtime.shutdown();
	for (const home of homes.splice(0))
		await rm(home, { recursive: true, force: true });
});

async function fixture(legacy = false) {
	const home = await realpath(
		await mkdtemp(join(tmpdir(), "factory-storage-references-")),
	);
	homes.push(home);
	const workspace = join(home, "workspace");
	await mkdir(workspace);
	const stock = structuredClone(
		defaultWorkflows.find((w) => w.id === "factory")!,
	);
	stock.id = "retention-fork";
	stock.name = "Retention fork";
	stock.steps.push(
		{
			id: "assess-impact",
			name: "Generic root data",
			type: "agent",
			prompt: "Ordinary data",
			output: { schema: { type: "object" } },
			maxVisits: 8,
			branches: [],
			next: "end",
		},
		{
			id: "sibling",
			name: "Other pipeline",
			type: "workflow",
			workflow: "factory-pipeline",
			maxVisits: 8,
			branches: [],
			next: "end",
		},
	);
	const definitions = validateWorkflows([...defaultWorkflows, stock]);
	const runtime = new WorkflowRuntime(home, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
	});
	runtimes.push(runtime);
	const run = runtime.create({
		id: "run",
		repositoryId: "repo",
		workspace,
		input: "Retained delivery",
		workflow: definitions.at(-1)!,
		workflowDefinitions: definitions,
		triggerOrigin: {
			type: "manual",
			workflowId: stock.id,
			at: new Date().toISOString(),
		},
	});
	if (legacy) {
		// A persisted old stock definition is normalized in memory, never rewritten.
		const oldDefinitions = structuredClone(conservativeWorkflows);
		// Conservative stock predates impact. Frozen impact-v1 runs added these
		// flag-shaped records before configurable presets replaced the flags.
		const oldPipeline = oldDefinitions.find(
			(w) => w.id === "factory-pipeline",
		)!;
		oldPipeline.steps.unshift(
			{
				id: "assess-impact",
				name: "Assess changed work and retained evidence",
				type: "agent",
				prompt: "Assess impact",
				impactContract: "impact-v1",
				impact: {
					inventory: "review-inventory",
					fanout: "specialist-review",
					maxUnchangedCycles: 3,
				},
				askQuestions: true,
				next: "impact-checks",
				branches: [],
				maxVisits: 8,
			},
			{
				id: "impact-checks",
				name: "Run selected checks",
				type: "tool",
				tool: "impact-checks",
				impactSource: "assess-impact",
				next: "review-inventory",
				branches: [],
				maxVisits: 8,
			},
		);
		run.workflow = WorkflowSchema.parse(
			oldDefinitions.find((w) => w.id === "factory")!,
		);
		run.workflowDefinitions = oldDefinitions.map((w) =>
			WorkflowSchema.parse(w),
		);
	}
	run.status = "completed";
	run.checkpoint = { current: "end", visits: {} };
	run.humanDecisions = [
		{
			decision: "approve",
			reviewId: "review",
			headSha: "head",
			url: "https://github.com/selected/project/pull/1",
			at: new Date().toISOString(),
		},
	];
	await publishStorageJson(
		join(
			home,
			"storage-retention",
			"workspaces",
			`${storageDigest(workspace)}.json`,
		),
		{
			recordId: "fixture",
			issueIdentifier: "FIX-1",
			repositories: [
				{
					id: "repo",
					path: workspace,
					repository: join(home, "repository"),
					root: home,
					creator: "fixture",
				},
			],
		},
	);
	const verify = vi.fn(async () => true);
	factoryStorage(runtime, {} as GitService, {
		protection: () => [],
		verifyDelivery: verify,
	});
	const source = captured.source!;
	sources.push(source);
	const impact = {
		at: new Date().toISOString(),
		snapshot: {
			schemaVersion: 1,
			digest: "accepted",
			key: "pipeline/specialist-review",
			repositories: [{ repositoryId: "repo", workspace, headSha: "head" }],
		},
		checkResults: [
			{ id: "build", exitCode: 0, evidence: `> build ${workspace}\npassed` },
		],
	};
	run.impactDecisions = [
		structuredClone(impact),
	] as unknown as FactoryRun["impactDecisions"];
	const checks = { checks: structuredClone(impact.checkResults) };
	const inspect = async () => {
		for (let i = 0; i < 20; i++) {
			const result = await source.inspect(workspace, undefined, {
				maxEntries: 10_000,
				deadline: performance.now() + 5000,
			});
			if (Array.isArray(result)) return result;
			if (result.complete) return result.proofs;
		}
		throw new Error("Reference inspection did not complete");
	};
	return { run, impact, checks, inspect, verify, workspace };
}

function expectReleased(proofs: RetainedWorkspaceProof[]) {
	expect(proofs).toHaveLength(1);
	expect(proofs[0]!.protection).toEqual([]);
	expect(proofs[0]!.mergeConfirmed).toBe(true);
}
function expectRetained(proofs: RetainedWorkspaceProof[]) {
	expect(proofs).toHaveLength(1);
	expect(proofs[0]!.protection).toContain(
		"Retained input, output or evidence references this workspace",
	);
	expect(proofs[0]!.mergeConfirmed).toBe(false);
}

it("releases only exact configured impact identities and enrolled command receipts", async () => {
	const { run, impact, checks, inspect, verify } = await fixture();
	run.outputs["pipeline/assess-impact"] = structuredClone(impact);
	run.outputs["pipeline/impact-checks"] = structuredClone(checks);
	run.history.push(
		{
			step: "pipeline/assess-impact",
			output: structuredClone(impact),
			at: impact.at,
		},
		{
			step: "pipeline/impact-checks",
			output: structuredClone(checks),
			at: impact.at,
		},
	);
	expectReleased(await inspect());
	expect(verify).toHaveBeenCalledWith(
		run,
		"repo",
		{ url: "https://github.com/selected/project/pull/1", headSha: "head" },
		expect.any(AbortSignal),
	);
});

it("qualifies frozen review and active called-checkpoint output maps by their accepted frame", async () => {
	const { run, impact, checks, inspect } = await fixture();
	run.reviewRounds = [
		{
			key: "pipeline/specialist-review",
			context: {
				workspace: run.workspace,
				outputs: {
					"assess-impact": structuredClone(impact),
					"impact-checks": structuredClone(checks),
				},
			},
		},
	] as FactoryRun["reviewRounds"];
	run.checkpoint = {
		current: "pipeline",
		visits: {},
		active: {
			phase: "result",
			children: [
				{
					current: "end",
					visits: {},
					outputs: {
						"assess-impact": structuredClone(impact),
						"impact-checks": structuredClone(checks),
					},
				},
			],
		},
	};
	expectReleased(await inspect());
});

it.each([
	"assess-impact",
	"sibling/assess-impact",
	"sibling/impact-checks",
])("retains copied impact paths in unrelated producer %s", async (key) => {
	const { run, impact, checks, inspect } = await fixture();
	run.outputs[key] = structuredClone(
		key.endsWith("impact-checks") ? checks : impact,
	);
	expectRetained(await inspect());
});

it("does not promote an unqualified modern child alias to its configured producer", async () => {
	const { run, checks, inspect } = await fixture();
	run.outputs["impact-checks"] = structuredClone(checks);
	expectRetained(await inspect());
});

it("retains copied evidence in an unaccepted historical context frame", async () => {
	const { run, impact, inspect } = await fixture();
	run.reviewRounds = [
		{
			key: "unknown/specialist-review",
			context: {
				outputs: { "pipeline/assess-impact": structuredClone(impact) },
			},
		},
	] as FactoryRun["reviewRounds"];
	expectRetained(await inspect());
});

it("keeps old stock shared-leaf records compatible through legacy normalization", async () => {
	const { run, impact, checks, inspect } = await fixture(true);
	run.outputs["assess-impact"] = structuredClone(impact);
	run.outputs["impact-checks"] = structuredClone(checks);
	expectReleased(await inspect());
});

it.each([
	"assessor",
	"checks",
])("does not activate exemptions for a schema or reads without the %s evidence protocol", async (role) => {
	const { run, impact, checks, inspect } = await fixture();
	const pipeline = run.workflowDefinitions!.find(
		(w) => w.id === "factory-pipeline",
	)!;
	const step = pipeline.steps.find(
		(s) => s.id === (role === "assessor" ? "assess-impact" : "impact-checks"),
	)!;
	step.checks = [];
	run.outputs[
		role === "assessor" ? "pipeline/assess-impact" : "pipeline/impact-checks"
	] = structuredClone(role === "assessor" ? impact : checks);
	expectRetained(await inspect());
});

it("retains mismatching snapshots, receipt content and actual output dependencies", async () => {
	const { run, impact, checks, inspect, workspace } = await fixture();
	run.outputs["pipeline/assess-impact"] = {
		...structuredClone(impact),
		dependency: join(workspace, "still-needed"),
	};
	run.outputs["pipeline/impact-checks"] = {
		checks: [{ ...checks.checks[0], evidence: `another command ${workspace}` }],
	};
	expectRetained(await inspect());
});
