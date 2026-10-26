import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { registerResearchTools } from "../../mcp-tools/src/factoryResearch.js";
import { digest } from "../src/factory/EvidenceDigest.js";
import {
	captureRepositorySnapshot,
	snapshotForRead,
	snapshotOutput,
} from "../src/factory/RepositorySnapshot.js";
import {
	outputRevisionBinding,
	pinReadOnlyAccess,
	sameOutputBinding,
} from "../src/factory/RevisionBinding.js";
import type {
	ExecutionContext,
	FactoryRun,
} from "../src/factory/WorkflowRuntime.js";

const homes: string[] = [];
afterEach(() => {
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});
const signal = () => new AbortController().signal;
function fixture() {
	const home = mkdtempSync(join(tmpdir(), "repository-snapshot-"));
	homes.push(home);
	const repository = (name: string) => {
		const root = join(home, name);
		mkdirSync(root);
		const git = (...args: string[]) =>
			execFileSync("git", ["-C", root, ...args], {
				encoding: "utf8",
				stdio: "pipe",
			}).trim();
		git("init", "-b", "main");
		git("config", "user.name", "Fixture");
		git("config", "user.email", "fixture@example.invalid");
		git("config", "commit.gpgsign", "false");
		git("config", "core.hooksPath", "/dev/null");
		writeFileSync(join(root, "README.md"), `${name} original`);
		writeFileSync(join(root, ".env"), "PRIVATE_TRACKED_SECRET");
		symlinkSync("/etc/passwd", join(root, "escape"));
		git("add", "--force", ".");
		git("commit", "-m", "Fixture");
		return { root, git };
	};
	const one = repository("one"),
		two = repository("two");
	const run = {
		id: "parent",
		repositoryId: "one",
		workspace: one.root,
		repositories: [one, two].map((repo, index) => ({
			id: index ? "two" : "one",
			name: index ? "Two" : "One",
			repositoryPath: repo.root,
			workspace: repo.root,
			baseBranch: "main",
		})),
		workflow: {
			engineVersion: "nodes-v1",
			id: "research",
			steps: [
				{ id: "baseline", type: "snapshot" },
				{
					id: "inspect",
					type: "agent",
					access: "read-only",
					revision: "bound",
					reads: { snapshot: "baseline" },
				},
			],
		},
		workflowDefinitions: [],
		outputs: {},
		history: [],
		answers: [],
		questions: [],
		status: "running",
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	} as unknown as FactoryRun;
	const context = {
		run,
		step: run.workflow.steps[1]!,
		stepKey: "inspect",
		input: {},
		signal: signal(),
		evidenceDir: home,
		log: () => {},
	} as ExecutionContext;
	return { home, one, two, run, context };
}
it("pins every scoped tracked revision, retains the original snapshot after HEAD drift, and serves only immutable safe Git blobs", async () => {
	const { one, two, run, context } = fixture();
	const receipt = await captureRepositorySnapshot(
		run,
		"snapshot-identity",
		{},
		[run],
		signal(),
		{ key: "baseline" },
	);
	run.repositorySnapshots = { [receipt.actionId]: receipt };
	const output = snapshotOutput(receipt);
	run.outputs.baseline = output;
	run.history.push({ step: "baseline", output, at: receipt.observedAt });
	const binding = await outputRevisionBinding(context);
	for (const repo of [one, two]) {
		writeFileSync(join(repo.root, "README.md"), "Later tracked revision");
		repo.git("add", "README.md");
		repo.git("commit", "-m", "Later");
		writeFileSync(join(repo.root, "untracked.txt"), "UNTRACKED_SECRET");
	}
	expect(sameOutputBinding(binding, await outputRevisionBinding(context))).toBe(
		true,
	);
	const access = await pinReadOnlyAccess(context);
	expect(access.maxCalls).toBe(200);
	expect(access.repositories.map((repo) => repo.revision)).toEqual(
		receipt.repositories.map((repo) => repo.revision),
	);
	const tools = new Map<
		string,
		(args: Record<string, unknown>) => Promise<{ content: { text: string }[] }>
	>();
	registerResearchTools(
		{
			registerTool: (
				name: string,
				_config: unknown,
				invoke: (
					args: Record<string, unknown>,
				) => Promise<{ content: { text: string }[] }>,
			) => tools.set(name, invoke),
		} as unknown as Parameters<typeof registerResearchTools>[0],
		access,
	);
	const read = tools.get("read_repository")!;
	const result = await read({
		repositoryId: "one",
		path: "README.md",
		offset: 0,
	});
	expect(JSON.parse(result.content[0]!.text)).toEqual({
		revision: receipt.repositories[0]!.revision,
		path: "README.md",
		offset: 0,
		text: "one original",
		total: 12,
		nextOffset: null,
	});
	for (const path of [
		".env",
		"escape",
		"untracked.txt",
		"../README.md",
		"/etc/passwd",
		":(glob)*",
		".git/config",
	])
		await expect(
			read({ repositoryId: "one", path, offset: 0 }),
		).rejects.toThrow();
	await expect(
		read({ repositoryId: "foreign", path: "README.md", offset: 0 }),
	).rejects.toThrow("outside");
	expect(JSON.stringify(output)).not.toContain(one.root);
	expect(JSON.stringify(output)).not.toContain("PRIVATE_TRACKED_SECRET");
});
it("collects only dated complete-scope run metadata, redacts errors, and freezes history with honest sample limits", async () => {
	const { run } = fixture();
	const prior = structuredClone(run);
	prior.id = "prior";
	prior.status = "failed";
	prior.error = "timeout token=PRIVATE_TOKEN person@example.invalid";
	prior.capacityLeaves = { wait: { phase: "waiting-human" } };
	prior.events = [
		{ at: new Date().toISOString(), step: "agent", message: "PRIVATE_LOG" },
	];
	const unrelated = structuredClone(prior);
	unrelated.id = "unrelated";
	unrelated.repositories = unrelated.repositories!.slice(0, 1);
	const old = structuredClone(prior);
	old.id = "old";
	old.updatedAt = "2000-01-01T00:00:00.000Z";
	const receipt = await captureRepositorySnapshot(
		run,
		"s",
		{ history: { lookbackDays: 30, maxRuns: 1 } },
		[prior, unrelated, old, run],
		signal(),
		{ key: "baseline" },
	);
	expect(receipt.history).toMatchObject({
		total: 1,
		sampled: false,
		records: [
			{
				id: "prior",
				status: "failed",
				wait: ["waiting-human"],
				error: "timeout",
			},
		],
	});
	prior.error = "Updated raw failure";
	prior.status = "completed";
	expect(receipt.history!.records[0]!.status).toBe("failed");
	const serialized = JSON.stringify(receipt.history);
	for (const secret of [
		"PRIVATE_TOKEN",
		"person@example.invalid",
		"PRIVATE_QUESTION",
		"PRIVATE_LOG",
	])
		expect(serialized).not.toContain(secret);
	const another = structuredClone(prior);
	another.id = "another";
	const sampled = await captureRepositorySnapshot(
		run,
		"s2",
		{ history: { lookbackDays: 30, maxRuns: 1 } },
		[prior, another],
		signal(),
	);
	expect(sampled.history).toMatchObject({ total: 2, sampled: true });
	expect(sampled.history!.records).toHaveLength(1);
});
it("safely snapshots optional history from older retained runs without a questions array", async () => {
	const { run } = fixture();
	const legacy = structuredClone(run);
	legacy.id = "retained-before-question-arrays";
	legacy.status = "failed";
	legacy.error = "Credential denied PRIVATE_CREDENTIAL person@example.invalid";
	legacy.input = "PRIVATE_OPERATOR_PROMPT";
	legacy.outputs = { raw: "PRIVATE_AGENT_OUTPUT" };
	legacy.events = [
		{ at: legacy.updatedAt, step: "inspect", message: "PRIVATE_RAW_LOG" },
	];
	Reflect.deleteProperty(legacy, "questions");
	const receipt = await captureRepositorySnapshot(
		run,
		"legacy-history-snapshot",
		{ history: { lookbackDays: 30, maxRuns: 100 } },
		[legacy],
		signal(),
		{ key: "baseline" },
	);
	expect(JSON.parse(JSON.stringify(receipt.history))).toEqual({
		observedAt: receipt.observedAt,
		lookbackDays: 30,
		total: 1,
		sampled: false,
		records: [
			{
				id: legacy.id,
				workflow: legacy.workflow.id,
				status: "failed",
				createdAt: legacy.createdAt,
				updatedAt: legacy.updatedAt,
				wait: [],
				transitions: [],
				attempts: [],
				error: "access",
			},
		],
	});
	expect(Object.hasOwn(legacy, "questions")).toBe(false);
});
it("rejects copied agent receipts, wrong repository scopes, other lexical frames, and changed iteration ownership", async () => {
	const { run, context } = fixture();
	const receipt = await captureRepositorySnapshot(
		run,
		"s",
		{},
		[run],
		signal(),
		{ key: "baseline" },
	);
	run.repositorySnapshots = { s: receipt };
	run.outputs.baseline = snapshotOutput(receipt);
	run.history.push({
		step: "baseline",
		output: run.outputs.baseline,
		at: receipt.observedAt,
	});
	expect(snapshotForRead(context)?.digest).toBe(receipt.digest);
	context.step.reads = { snapshot: "inspect" };
	run.outputs.inspect = run.outputs.baseline;
	expect(() => snapshotForRead(context)).toThrow("runtime-produced");
	context.step.reads = { snapshot: "baseline" };
	run.repositories = run.repositories!.slice(0, 1);
	await expect(pinReadOnlyAccess(context)).rejects.toThrow("scope differs");
	const iteration = {
		frame: "loop",
		id: "a",
		index: 0,
		itemDigest: digest({ id: "a" }),
	};
	const nested = {
		...receipt,
		producer: { key: "loop/a/baseline", iteration },
	};
	run.repositorySnapshots.s = nested;
	run.workflow.steps = [
		{
			id: "loop",
			type: "foreach",
			body: [{ id: "baseline", type: "snapshot" }],
		},
	] as FactoryRun["workflow"]["steps"];
	run.foreach = {
		loop: { items: [{ id: "a", index: 0 }] },
	} as FactoryRun["foreach"];
	run.history[0] = {
		step: nested.producer.key,
		iteration: { ...iteration, itemDigest: "wrong" },
		output: run.outputs.baseline,
		at: receipt.observedAt,
	};
	context.stepKey = "loop/b/inspect";
	expect(() => snapshotForRead(context)).toThrow("runtime-produced");
	run.history[0]!.iteration = iteration;
	expect(() => snapshotForRead(context)).toThrow("another workflow frame");
});
