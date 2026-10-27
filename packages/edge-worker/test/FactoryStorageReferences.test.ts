import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publishStorageJson, storageDigest } from "bobs-factory-core";
import { afterEach, expect, it, vi } from "vitest";
import { digest } from "../src/factory/EvidenceDigest.js";
import { WorkflowSchema } from "../src/factory/Workflow.js";
import { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";
import type { GitService } from "../src/GitService.js";
import { factoryStorage } from "../src/storage/FactoryStorage.js";
import type { WorkspaceRetentionSource } from "../src/storage/WorktreeArtifacts.js";

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
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function fixture() {
	const home = await realpath(
			await mkdtemp(join(tmpdir(), "factory-retention-")),
		),
		workspace = join(home, "workspace");
	await mkdir(workspace);
	const runtime = new WorkflowRuntime(home, { agent: async () => ({}) });
	const workflow = WorkflowSchema.parse({
		id: "retention",
		name: "Retention",
		engineVersion: "nodes-v1",
		steps: [{ id: "confirmed", name: "Merge", type: "merge" }],
	});
	const run = runtime.create({
		id: "retained",
		repositoryId: "repo",
		workspace,
		input: "Completed work",
		workflow,
		triggerOrigin: { type: "manual", workflowId: workflow.id, at: "" },
	});
	run.status = "completed";
	run.checkpoint = { current: "end", visits: {} };
	const output = {
		repositories: [
			{
				repositoryId: "repo",
				merged: true,
				sha: "merge-sha",
				url: "https://github.com/selected/project/pull/1",
			},
		],
	};
	run.history.push({
		step: "confirmed",
		output,
		at: run.updatedAt,
		inputDigest: digest({}),
		guarantee: {
			version: 1,
			revisions: { repo: { headSha: "head" } },
			boundDigests: {},
			scope: { outputs: {}, historyLength: 0 },
			outputDigest: digest(output),
		},
	});
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
	cleanups.push(async () => {
		await source.close?.();
		await runtime.shutdown();
		await rm(home, { recursive: true, force: true });
	});
	const inspect = async () => {
		for (let i = 0; i < 20; i++) {
			const r = await source.inspect(workspace, undefined, {
				maxEntries: 10000,
				deadline: performance.now() + 5000,
			});
			if (Array.isArray(r)) return r;
			if (r.complete) return r.proofs;
		}
		throw Error("Inspection did not finish");
	};
	return { run, workspace, inspect, verify };
}
it("releases a completed workspace only after stamped merge evidence and provider revalidation", async () => {
	const f = await fixture();
	const proofs = await f.inspect();
	expect(proofs[0]!.protection).toEqual([]);
	expect(proofs[0]!.mergeConfirmed).toBe(true);
	expect(f.verify).toHaveBeenCalledWith(
		f.run,
		"repo",
		{ url: "https://github.com/selected/project/pull/1", headSha: "head" },
		expect.any(AbortSignal),
	);
});
it.each([
	"unstamped",
	"altered",
	"agent",
])("retains a workspace with %s completion claims", async (kind) => {
	const f = await fixture();
	if (kind === "unstamped") delete f.run.history[0]!.guarantee;
	else if (kind === "altered") f.run.history[0]!.output = { repositories: [] };
	else
		f.run.workflow.steps[0] = {
			...f.run.workflow.steps[0],
			type: "agent",
			prompt: "Claim merge",
		} as any;
	const proofs = await f.inspect();
	expect(proofs[0]!.mergeConfirmed).toBe(false);
	expect(f.verify).not.toHaveBeenCalled();
});
it("retains actual content dependencies even after a confirmed merge", async () => {
	const f = await fixture();
	f.run.outputs.evidence = { path: join(f.workspace, "needed.txt") };
	expect((await f.inspect())[0]!.protection).toContain(
		"Retained input, output or evidence references this workspace",
	);
});
it("retains old completion history without interpreting its human decision fields", async () => {
	const f = await fixture();
	f.run.history = [
		{ step: "merge", output: { merged: true }, at: f.run.updatedAt },
	];
	Object.assign(f.run, {
		humanDecisions: [{ decision: "approve", headSha: "head" }],
	});
	expect((await f.inspect())[0]!.mergeConfirmed).toBe(false);
	expect(f.verify).not.toHaveBeenCalled();
});
