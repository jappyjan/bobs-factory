import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { runEvidenceChecks } from "../src/factory/EvidenceChecks.js";
import { StepSchema, validateWorkflows } from "../src/factory/Workflow.js";
import {
	type ExecutionContext,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import { FactoryServer } from "./fixtures/authenticated-factory.js";
import { waitForRuntime } from "./fixtures/runtime-wait.js";

const homes: string[] = [];
const runtimes: WorkflowRuntime[] = [];
afterEach(async () => {
	for (const runtime of runtimes.splice(0)) await runtime.shutdown();
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});

const checks = [
	{ check: "files-exist", path: "/inputs/data/files/*" },
	{ check: "code-refs-valid", path: "/inputs/data/references/*" },
	{
		check: "ids-resolve",
		path: "/inputs/data/ids/*",
		source: "catalog",
		ids: "/requirements/*/id",
	},
	{ check: "media-valid", path: "/inputs/data/images/*", kind: "image" },
];

function setup(
	selected: unknown[] = checks,
	alter?: (data: Record<string, unknown>, context: ExecutionContext) => void,
	bound = true,
) {
	const workspace = mkdtempSync(join(tmpdir(), "check-evidence-workspace-"));
	const state = mkdtempSync(join(tmpdir(), "check-evidence-state-"));
	homes.push(workspace, state);
	const git = (...args: string[]) =>
		execFileSync("git", args, { cwd: workspace, encoding: "utf8" }).trim();
	git("init", "-b", "main");
	git("config", "user.name", "Fixture");
	git("config", "user.email", "fixture@example.test");
	writeFileSync(join(workspace, "proof.ts"), "first\nsecond\n");
	git("add", ".");
	git("commit", "-m", "fixture");
	git("update-ref", "refs/remotes/origin/main", "HEAD");
	const runtime = new WorkflowRuntime(state, {
		agent: async () => {
			throw new Error("Check cannot invoke an agent");
		},
		tool: async () => {
			throw new Error("Check cannot invoke an action");
		},
		script: async (context) => {
			if (context.step.id === "catalog")
				return { requirements: [{ id: "R1" }] };
			const image = join(context.evidenceDir, "capture.png");
			writeFileSync(
				image,
				Buffer.from(
					"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNNsAAAAASUVORK5CYII=",
					"base64",
				),
			);
			const data = {
				ok: true,
				files: ["proof.ts"],
				references: ["proof.ts:2"],
				ids: ["R1"],
				images: [image],
			};
			alter?.(data, context);
			return data;
		},
	});
	runtimes.push(runtime);
	const workflows = validateWorkflows([
		...defaultWorkflows,
		{
			id: "selector-fixture",
			name: "Selector fixture",
			stepConfigVersion: "step-config-v1",
			steps: [
				{ id: "catalog", name: "Catalog", type: "script", script: "fixture" },
				{ id: "data", name: "Data", type: "script", script: "fixture" },
				{
					id: "verify",
					name: "Verify evidence",
					type: "check",
					reads: { data: "data", catalog: "catalog" },
					...(bound ? { revision: "bound" } : {}),
					checks: selected,
					check: {
						results: { ordinary: { path: "/inputs/data/ok", equals: true } },
					},
				},
			],
		},
	]);
	runtime.updateWorkflows(workflows);
	const run = runtime.create({
		workflow: workflows.at(-1)!,
		title: "Fixed Check evidence",
		repositoryId: "fixture",
		workspace,
		input: "Fixture",
		triggerOrigin: {
			type: "manual",
			workflowId: "selector-fixture",
			at: "2026-10-21T12:00:00.000Z",
		},
	});
	return { runtime, run, workspace, state, git };
}

it("executes declared file, reference, named-ID and media checks before ordinary rules and retains verified facts", async () => {
	const { runtime, run } = setup();
	await runtime.launch(run);
	expect(run.status, run.error).toBe("completed");
	expect(run.outputs.verify).toEqual({ passed: true, ordinary: true });
	expect(
		run.history.find((entry) => entry.step === "verify")?.evidence,
	).toEqual({
		"files-exist": { verified: true },
		"code-refs-valid": { verified: true },
		"ids-resolve": { verified: true },
		"media-valid": { verified: true },
	});
	expect(run.boundOutputs?.verify?.repositories).toHaveLength(1);
});

it.each([
	[
		checks[0]!,
		"missing file",
		(data: Record<string, unknown>) => {
			data.files = ["missing.ts"];
		},
	],
	[
		checks[0]!,
		"uncommitted file",
		(data: Record<string, unknown>, context: ExecutionContext) => {
			writeFileSync(
				join(context.run.workspace, "uncommitted.ts"),
				"uncommitted",
			);
			data.files = ["uncommitted.ts"];
		},
	],
	[
		checks[1]!,
		"stale line",
		(data: Record<string, unknown>) => {
			data.references = ["proof.ts:3"];
		},
	],
	[
		checks[2]!,
		"unknown ID",
		(data: Record<string, unknown>) => {
			data.ids = ["invented"];
		},
	],
	[
		checks[3]!,
		"invalid image",
		(data: Record<string, unknown>, context: ExecutionContext) => {
			const image = join(context.evidenceDir, "invalid.png");
			writeFileSync(image, "not an image");
			data.images = [image];
		},
	],
] as const)("blocks %j %s despite a true ordinary rule", async (check, _label, alter) => {
	const { runtime, run } = setup([check], alter);
	await runtime.launch(run);
	expect(run.status).toBe("failed");
	expect(run.error).toContain(check.check);
	expect(run.outputs.verify).toBeUndefined();
	expect(run.history.some((entry) => entry.step === "verify")).toBe(false);
});

it("bounds selected evidence expansion and stops expensive checks without producing a failed receipt", async () => {
	const limited = setup(
		[checks[0]!],
		(data) => {
			data.files = Array.from({ length: 20001 }, () => "proof.ts");
		},
		false,
	);
	await limited.runtime.launch(limited.run);
	expect(limited.run.status).toBe("failed");
	expect(limited.run.error).toMatch(/evaluation limit|selection.*limit/);
	const cancelled = setup(
		[checks[0]!],
		(data) => {
			data.files = Array.from({ length: 20000 }, () => "proof.ts");
		},
		false,
	);
	const execution = cancelled.runtime.launch(cancelled.run);
	await waitForRuntime(() => expect(cancelled.run.step).toBe("verify"));
	cancelled.runtime.stop(cancelled.run.id);
	await execution;
	expect(cancelled.run.status).toBe("stopped");
	expect(cancelled.run.outputs.verify).toBeUndefined();
});

it("rejects selected getters and propagates evidence cancellation unchanged", async () => {
	const { runtime, run } = setup([checks[0]!], undefined, false);
	const controller = new AbortController();
	const context: ExecutionContext = {
		run,
		step: run.workflow.steps.at(-1)!,
		input: {},
		signal: controller.signal,
		evidenceDir: runtime.directory,
		log: () => {},
	};
	let reads = 0;
	const data = Object.defineProperty({}, "files", {
		enumerable: true,
		get: () => {
			reads++;
			return [];
		},
	});
	await expect(
		runEvidenceChecks(context, { inputs: { data } }),
	).rejects.toThrow("not accessors");
	expect(reads).toBe(0);
	const pending = runEvidenceChecks(context, {
		inputs: {
			data: { files: Array.from({ length: 20000 }, () => "proof.ts") },
		},
	});
	setImmediate(() =>
		controller.abort(new DOMException("Stop evidence", "AbortError")),
	);
	await expect(pending).rejects.toMatchObject({
		name: "AbortError",
		message: "Stop evidence",
	});
});

it("uses the Check's pinned inspected head while preserving agent evidence revision precedence", async () => {
	const { runtime, run, workspace, git } = setup([checks[1]!]);
	const pinned = git("rev-parse", "HEAD");
	writeFileSync(join(workspace, "proof.ts"), "only one current line\n");
	git("add", "proof.ts");
	git("commit", "-m", "advance current evidence");
	const current = git("rev-parse", "HEAD");
	const context: ExecutionContext = {
		run,
		step: run.workflow.steps.at(-1)!,
		input: {},
		signal: new AbortController().signal,
		evidenceDir: runtime.directory,
		log: () => {},
		inspectionBinding: {
			version: 1,
			repositories: [
				{
					id: "fixture",
					headSha: pinned,
					treeSha: git("rev-parse", `${pinned}^{tree}`),
					workspaceDigest: "fixture",
				},
			],
			inputDigest: "fixture",
			historyLength: 0,
		},
		progress: {
			visit: 1,
			changedFiles: [],
			unchangedCode: false,
			uncertain: false,
			newHistory: [],
			currentRevision: {
				headSha: current,
				dirty: false,
				historyLength: 0,
				at: "2026-10-21T12:00:00.000Z",
			},
		},
	};
	const document = { inputs: { data: { references: ["proof.ts:2"] } } };
	await expect(runEvidenceChecks(context, document)).resolves.toEqual(document);
	context.step = {
		...context.step,
		type: "agent",
		prompt: "Verify agent evidence",
	};
	await expect(runEvidenceChecks(context, document)).rejects.toThrow(
		"Code reference exceeds proof.ts",
	);
});

it("requires successful explicit synthetic selector evidence in simulation and rejects unsupported protocols on save", async () => {
	const { runtime } = setup([checks[0]!]);
	const server = new FactoryServer(runtime, {
		repositories: () => [],
		sessions: () => [],
		entries: () => [],
		start: async () => {
			throw new Error("Unexpected launch");
		},
		stop: (id) => runtime.stop(id),
	});
	const step = StepSchema.parse({
		id: "synthetic",
		name: "Synthetic",
		type: "check",
		reads: { data: "data" },
		checks: [checks[0]!],
		check: { results: { ordinary: { path: "/inputs/data/ok", equals: true } } },
	});
	const simulate = (evidence: unknown, configured: unknown = step) =>
		server.app.inject({
			method: "POST",
			url: "/api/workflows/check/simulate",
			headers: { "x-factory-request": "1" },
			payload: {
				step: configured,
				inputs: { data: { ok: true, files: ["not-checked-by-simulation.ts"] } },
				evidence,
			},
		});
	try {
		for (const evidence of [{}, { "files-exist": { verified: false } }]) {
			const rejected = await simulate(evidence);
			expect(rejected.statusCode).toBe(409);
			expect(rejected.json().error).toContain(
				"requires successful synthetic files-exist evidence",
			);
		}
		const accepted = await simulate({ "files-exist": { verified: true } });
		expect(accepted.statusCode).toBe(200);
		expect(accepted.json()).toEqual({
			output: { passed: true, ordinary: true },
			next: "end",
		});
		const unsupported = {
			...step,
			checks: [{ check: "ticket-milestone", kind: "implementation" }],
		};
		const rejected = await simulate({}, unsupported);
		expect(rejected.statusCode).toBe(409);
		expect(rejected.json().error).toContain(
			"not an executable Check evidence protocol",
		);
		const current = (
			await server.app.inject({ url: "/api/config?view=recipes" })
		).json();
		const saved = await server.app.inject({
			method: "PATCH",
			url: "/api/workflows",
			headers: {
				"x-factory-request": "1",
				"x-factory-config": current.configRevision,
			},
			payload: {
				workflows: [
					{
						id: "unsupported-check",
						name: "Unsupported",
						stepConfigVersion: "step-config-v1",
						steps: [unsupported],
					},
				],
			},
		});
		expect(saved.statusCode).toBe(409);
		expect(saved.json().error).toContain(
			"not an executable Check evidence protocol",
		);
	} finally {
		await server.stop();
	}
});
