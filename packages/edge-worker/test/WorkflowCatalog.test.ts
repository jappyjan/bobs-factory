import { createHash } from "node:crypto";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { StepSchema, WorkflowSchema } from "../src/factory/Workflow.js";
import {
	WorkflowCatalog,
	workflowRoles,
} from "../src/factory/WorkflowCatalog.js";
import {
	type RuntimeHooks,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import { SessionSemaphore } from "../src/RunnerConcurrency.js";
import { FactoryServer } from "./fixtures/authenticated-factory.js";
import { preCompositionWorkflows } from "./fixtures/pre-composition.js";

const roots: string[] = [];
const runtimes: WorkflowRuntime[] = [];
afterEach(async () => {
	for (const runtime of runtimes.splice(0)) await runtime.shutdown();
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
function fixture(hooks: Partial<RuntimeHooks> = {}) {
	const home = mkdtempSync(join(tmpdir(), "catalog-129-"));
	roots.push(home);
	const runtime = new WorkflowRuntime(home, {
		agent: async () => ({}),
		...hooks,
	});
	runtimes.push(runtime);
	return { runtime, home, path: join(home, "factory", "workflows.json") };
}
const legacy = () => structuredClone(preCompositionWorkflows);

function local(
	runtime: WorkflowRuntime,
	id = "custom",
	steps: unknown[] = [
		{ id: "work", name: "Work", type: "agent", prompt: "Execute fixture" },
	],
) {
	const workflow = WorkflowSchema.parse({
		id,
		name: id,
		engineVersion: "nodes-v1",
		steps,
	});
	runtime.updateWorkflows([...runtime.listWorkflows(), workflow]);
	return workflow;
}
function create(
	runtime: WorkflowRuntime,
	workflow = runtime.selectWorkflow([], "manual", "factory"),
) {
	return runtime.create({
		workflow,
		triggerOrigin: {
			type: "manual",
			workflowId: workflow.id,
			at: new Date().toISOString(),
		},
		repositoryId: "repo",
		workspace: "/tmp",
		input: "Fixture",
	});
}

it("preserves genuine custom graph behavior, private dependencies and default intent", () => {
	const { home, runtime, path } = fixture();
	const definitions = legacy();
	definitions.find((w) => w.id === "factory-pipeline")!.steps[0]!.prompt =
		"A genuinely different prompt";
	writeFileSync(
		path,
		JSON.stringify({ workflows: definitions, defaultWorkflow: "factory" }),
	);
	const migrated = new WorkflowRuntime(home, (runtime as any).hooks),
		mapping = migrated.catalog.read().migration!.mappings;
	expect(migrated.getDefaultWorkflow()).toBe(mapping.factory);
	expect(mapping["factory-pipeline"]).toBeUndefined();
	expect(() => migrated.selectWorkflow([], "manual", mapping.factory)).toThrow(
		"Fork again from current bundled recipe",
	);
	const root = migrated.listWorkflows().find((w) => w.id === mapping.factory)!;
	expect(root.steps[0]!.workflow).not.toBe("factory-pipeline");
	const child = migrated
		.listWorkflows()
		.find((w) => w.id === root.steps[0]!.workflow)!;
	expect(child.steps[0]!.prompt).toBe("A genuinely different prompt");
	expect(
		migrated.listWorkflows().find((w) => w.id === "factory-pipeline")!.steps[0]!
			.prompt,
	).toBe(child.steps[0]!.prompt);
	const count = migrated.listWorkflows().length;
	expect(new WorkflowCatalog(join(home, "factory")).list()).toHaveLength(count);
});
it("retains unknown Simple behavior as a routing conflict with recoverable bytes", () => {
	const { home, runtime, path } = fixture();
	const definitions = structuredClone(defaultWorkflows);
	definitions[0]!.description = "Custom native behavior";
	definitions[0]!.labels = ["custom-simple"];
	const bytes = JSON.stringify({
		workflows: definitions,
		defaultWorkflow: "factory",
	});
	writeFileSync(path, bytes);
	const migrated = new WorkflowRuntime(home, (runtime as any).hooks);
	expect(() => migrated.selectWorkflow(["custom-simple"], "manual")).toThrow(
		"unavailable",
	);
	expect(migrated.selectWorkflow([], "manual").id).toBe("factory");
	const state = migrated.catalog.read();
	expect(readFileSync(state.migration!.backup, "utf8")).toBe(bytes);
	expect(
		state.locals.some((w) => state.provenance[w.id]?.source === "simple"),
	).toBe(false);
	migrated.catalog.resolveSimpleConflict();
	expect(migrated.selectWorkflow(["custom-simple"], "manual").id).toBe(
		"simple",
	);
});
it("rejects stock behavior edits, internal identity collisions and native Simple fork/import bypasses", () => {
	const { runtime, path } = fixture();
	const bytes = readFileSync(path, "utf8");
	const modified = runtime.listWorkflows();
	modified.find((w) => w.id === "v2-clarify-plan")!.steps[0]!.prompt =
		"Injected";
	expect(() => runtime.updateWorkflows(modified)).toThrow("read-only");
	expect(readFileSync(path, "utf8")).toBe(bytes);
	expect(() => runtime.forkWorkflow("simple")).toThrow("cannot be forked");
	const imported = runtime.catalog.read();
	imported.locals.push({ ...defaultWorkflows[1]!, id: "v2-ci" });
	expect(() => runtime.catalog.import(imported)).toThrow("reserved");
	const native = runtime.catalog.read();
	native.locals.push({ ...defaultWorkflows[0]!, id: "native-alias" });
	expect(() => runtime.catalog.import(native)).toThrow("needs steps");
});
it("creates independent private fork graphs and keeps standards authoritative at new-run acceptance", () => {
	const { runtime } = fixture();
	const first = runtime.forkWorkflow("factory"),
		second = runtime.forkWorkflow("factory");
	expect(first.steps[0]!.workflow).not.toBe(second.steps[0]!.workflow);
	expect(first.labels).toEqual([]);
	expect(runtime.getDefaultWorkflow()).toBe("simple");
	const definitions = runtime.listWorkflows(),
		privateChild = definitions.find((w) => w.id === first.steps[0]!.workflow)!;
	privateChild.steps[0]!.prompt = "Only first fork";
	runtime.updateWorkflows(definitions);
	expect(
		runtime.listWorkflows().find((w) => w.id === second.steps[0]!.workflow)!
			.steps[0]!.prompt,
	).not.toBe("Only first fork");
	const forged = {
		...defaultWorkflows.find((w) => w.id === "factory")!,
		steps: [
			StepSchema.parse({
				id: "inject",
				name: "Injection",
				type: "agent",
				prompt: "Unauthorized",
			}),
		],
	};
	expect(create(runtime, forged).workflow).toEqual(
		runtime.listWorkflows().find((w) => w.id === "factory"),
	);
});

it("leaves malformed legacy input recoverable and recovers interrupted atomic staging", () => {
	const { home, runtime, path } = fixture();
	writeFileSync(path, "{bad");
	expect(() => new WorkflowRuntime(home, (runtime as any).hooks)).toThrow();
	expect(readFileSync(path, "utf8")).toBe("{bad");
	const bytes = JSON.stringify(legacy());
	writeFileSync(path, bytes);
	writeFileSync(`${path}.tmp`, "invalid staged data");
	const migrated = new WorkflowRuntime(home, (runtime as any).hooks);
	expect(existsSync(migrated.catalog.read().migration!.backup)).toBe(true);
	expect(migrated.catalog.read().locals.length).toBeGreaterThan(0);
});
it("blocks exact accepted dependencies, keeps private forks eligible, and preserves individual Resume across restart", async () => {
	const calls: string[] = [];
	const { home, runtime } = fixture({
		agent: async (ctx) => {
			calls.push(ctx.step.id);
			return {};
		},
	});
	const fork = runtime.forkWorkflow("factory");
	runtime.setWorkflowEnabled("v2-review-loop", false);
	expect(() => runtime.selectWorkflow([], "manual", "factory")).toThrow(
		"v2-review-loop",
	);
	expect(runtime.selectWorkflow([], "manual", fork.id).id).toBe(fork.id);
	runtime.setWorkflowEnabled("v2-review-loop", true);
	const workflow = local(runtime, "wait", [
		{
			id: "work",
			name: "Work",
			type: "display",
			document: {
				version: "view-v1",
				components: [
					{
						id: "choice",
						type: "form",
						data: {
							literal: {
								fields: [
									{ id: "choice", type: "text", label: "Which choice?" },
								],
							},
						},
					},
				],
			},
		},
	]);
	(runtime as any).hooks.agent = async () => ({ questions: ["Which choice?"] });
	const run = create(runtime, workflow),
		accepted = structuredClone(run.workflow),
		execution = runtime.launch(run);
	await vi.waitFor(() => expect(run.status).toBe("waiting"));
	runtime.setWorkflowEnabled("wait", false);
	await execution;
	expect(run.status).toBe("blocked");
	expect(runtime.listRuns().find((item) => item.id === run.id)).toMatchObject({
		status: "blocked",
		workflowBlock: run.workflowBlock,
	});
	expect(run.viewDecision?.view.components[0]?.id).toBe("choice");
	expect(() => runtime.requireRunAvailable(run)).toThrow("disabled");
	runtime.setWorkflowEnabled("wait", true);
	expect(() => runtime.retry(run.id)).toThrow("disabled");
	const restarted = new WorkflowRuntime(home, (runtime as any).hooks);
	restarted.resumeAll();
	expect(restarted.get(run.id).status).toBe("blocked");
	expect(restarted.listRuns().find((item) => item.id === run.id)).toMatchObject(
		{
			status: "blocked",
			workflowBlock: restarted.get(run.id).workflowBlock,
		},
	);
	expect(restarted.get(run.id).workflow).toEqual(accepted);
	restarted.resume(run.id);
	await vi.waitFor(() => expect(restarted.get(run.id).status).toBe("waiting"));
	expect(restarted.get(run.id).viewDecision?.view.components[0]?.id).toBe(
		"choice",
	);
	restarted.stop(run.id);
	await restarted.shutdown();
});
it("interrupts executing work and rejects late results and preparation after disabling", async () => {
	let finish!: () => void;
	let started!: () => void;
	const start = new Promise<void>((resolve) => (started = resolve));
	const subsequent = vi.fn();
	const { runtime } = fixture({
		agent: async (ctx) => {
			if (ctx.step.id === "later") return subsequent();
			started();
			await new Promise<void>((resolve) => {
				finish = resolve;
				ctx.signal.addEventListener("abort", resolve, { once: true });
			});
			return { summary: "late" };
		},
		script: subsequent,
	});
	const workflow = local(runtime, "active", [
		{ id: "work", name: "Work", type: "agent", prompt: "Wait" },
		{ id: "later", name: "Later", type: "agent", prompt: "Later" },
	]);
	const run = create(runtime, workflow),
		execution = runtime.launch(run);
	await start;
	runtime.setWorkflowEnabled("active", false);
	expect(() => runtime.resume(run.id)).toThrow("finished stopping");
	finish();
	await execution;
	expect(run.status).toBe("blocked");
	expect(run.history).toEqual([]);
	expect(subsequent).not.toHaveBeenCalled();
});
it("cancels queued leaves and releases capacity without invoking the disabled tool", async () => {
	const capacity = new SessionSemaphore(1),
		lease = await capacity.acquireLease(),
		invoke = vi.fn();
	const { runtime } = fixture({
		capacity,
		agent: async (ctx) => {
			const queued = await capacity.acquireLease(ctx.signal);
			try {
				ctx.signal.throwIfAborted();
				return invoke();
			} finally {
				await queued.release();
			}
		},
	});
	const workflow = local(runtime, "queued", [
		{
			id: "work",
			name: "Work",
			type: "agent",
			prompt: "Queued fixture",
		},
	]);
	const run = create(runtime, workflow),
		execution = runtime.launch(run);
	await vi.waitFor(() => expect(capacity.waiting).toBe(1));
	runtime.setWorkflowEnabled("queued", false);
	await execution;
	expect(capacity.waiting).toBe(0);
	await lease.release();
	expect(capacity.active).toBe(0);
	expect(invoke).not.toHaveBeenCalled();
});
it("binds disable confirmation to current configuration and affected runs through the protected API", async () => {
	const { runtime, home } = fixture();
	const server = new FactoryServer(runtime, {
		repositories: () => [],
		sessions: () => [],
		entries: () => [],
		start: async () => create(runtime),
		stop: (id) => runtime.stop(id),
	});
	try {
		const inject = (options: any) =>
			server.app.inject({ ...options, headers: { "x-factory-request": "1" } });
		const before = (
			await inject({ url: "/api/workflows/factory/availability" })
		).json();
		expect(
			(
				await inject({
					url: "/api/workflows/factory/availability",
					method: "PUT",
					payload: { enabled: false },
				})
			).statusCode,
		).toBe(409);
		create(runtime);
		expect(
			(
				await inject({
					url: "/api/workflows/factory/availability",
					method: "PUT",
					payload: { enabled: false, confirm: true, token: before.token },
				})
			).statusCode,
		).toBe(409);
		const current = (
			await inject({ url: "/api/workflows/factory/availability" })
		).json();
		expect(current.runs).toHaveLength(1);
		expect(
			(
				await inject({
					url: "/api/workflows/factory/availability",
					method: "PUT",
					payload: { enabled: false, confirm: true, token: current.token },
				})
			).statusCode,
		).toBe(200);
		expect(
			(await inject({ url: "/api/config" }))
				.json()
				.workflows.find((w: any) => w.id === "factory"),
		).toMatchObject({ ownership: "bundled", enabled: false });
		expect(
			new WorkflowCatalog(join(home, "factory")).read().enabled.factory,
		).toBe(false);
	} finally {
		await runtime.shutdown();
		await server.stop();
	}
});

it("saves dashboard-resolved agent preferences without admitting launch-field edits", async () => {
	const { runtime } = fixture();
	const server = new FactoryServer(runtime, {
		repositories: () => [],
		sessions: () => [],
		entries: () => [],
		start: async () => create(runtime),
		stop: (id) => runtime.stop(id),
	});
	try {
		const config = (await server.app.inject({ url: "/api/config" })).json();
		const pipeline = config.workflows.find(
			(w: any) => w.id === "v2-review-loop",
		);
		const role = workflowRoles(pipeline.steps).find(
			(r) => r.role === "specialist-review/security-review",
		)!;
		role.step.model = "gpt-6-sol";
		const saved = await server.app.inject({
			url: "/api/workflows",
			method: "PUT",
			headers: { "x-factory-request": "1" },
			payload: {
				workflows: config.workflows,
				defaultWorkflow: config.defaultWorkflow,
			},
		});
		expect(saved.statusCode, saved.body).toBe(200);
		expect(
			runtime.catalog.read().preferences["v2-review-loop"]![role.role]!.model,
		).toBe("gpt-6-sol");
		config.workflows.find((w: any) => w.id === "simple").launchFields[0].label =
			"Changed bundled field";
		expect(
			(
				await server.app.inject({
					url: "/api/workflows",
					method: "PUT",
					headers: { "x-factory-request": "1" },
					payload: {
						workflows: config.workflows,
						defaultWorkflow: config.defaultWorkflow,
					},
				})
			).statusCode,
		).toBe(409);
	} finally {
		await runtime.shutdown();
		await server.stop();
	}
});

it("removes disabled fork graphs with their metadata and preserves export/import", () => {
	const { runtime } = fixture();
	const fork = runtime.forkWorkflow("factory");
	const privateIds = new Set([
		fork.id,
		...Object.values(runtime.catalog.read().provenance[fork.id]!.dependencies),
	]);
	runtime.setWorkflowEnabled(fork.id, false);
	runtime.updateWorkflows(
		runtime.listWorkflows().filter((w) => !privateIds.has(w.id)),
	);
	const exported = runtime.catalog.read();
	expect(exported.enabled[fork.id]).toBeUndefined();
	expect(exported.provenance[fork.id]).toBeUndefined();
	runtime.importWorkflows(exported);
	expect(runtime.listWorkflows().some((w) => privateIds.has(w.id))).toBe(false);
});
it.each([
	"partial",
	"staging",
])("recovers migration after interruption at %s backup creation", (boundary) => {
	const { home, runtime, path } = fixture();
	const bytes = JSON.stringify({
		workflows: legacy(),
		defaultWorkflow: "factory",
	});
	writeFileSync(path, bytes);
	const hash = createHash("sha256").update(bytes).digest("hex");
	// Match the digest-named backup path used by the migration receipt.
	const realBackup = `${path}.backup-${hash}`;
	const name =
		boundary === "partial" ? realBackup : `${realBackup}.abandoned.tmp`;
	writeFileSync(name, bytes.slice(0, 101));
	const recovered = new WorkflowRuntime(home, (runtime as any).hooks);
	expect(readFileSync(recovered.catalog.read().migration!.backup, "utf8")).toBe(
		bytes,
	);
	expect(recovered.catalog.read().locals.length).toBeGreaterThan(0);
	expect(
		new WorkflowRuntime(home, (runtime as any).hooks).catalog.read(),
	).toEqual(recovered.catalog.read());
});

it("preserves original config and a genuinely conflicting migration backup", () => {
	const { home, runtime, path } = fixture();
	const bytes = JSON.stringify({
		workflows: legacy(),
		defaultWorkflow: "factory",
	});
	writeFileSync(path, bytes);
	const hash = createHash("sha256").update(bytes).digest("hex");
	const backup = `${path}.backup-${hash}`;
	writeFileSync(backup, "unrelated configuration");
	expect(() => new WorkflowRuntime(home, (runtime as any).hooks)).toThrow(
		"backup collision",
	);
	expect(readFileSync(path, "utf8")).toBe(bytes);
	expect(readFileSync(backup, "utf8")).toBe("unrelated configuration");
});

it("forks every bundled callable/root recipe except Simple with an independent reachable closure", () => {
	for (const bundled of defaultWorkflows.filter((w) => w.id !== "simple")) {
		const { runtime } = fixture();
		const fork = runtime.forkWorkflow(bundled.id);
		const mapping = runtime.catalog.read().provenance[fork.id]!.dependencies;
		expect(mapping[bundled.id]).toBe(fork.id);
		expect(Object.keys(mapping)).not.toContain("simple");
		expect(
			runtime.catalog
				.read()
				.locals.filter((w) => Object.values(mapping).includes(w.id)),
		).toHaveLength(Object.keys(mapping).length);
		expect(
			runtime.listWorkflows().find((w) => w.id === fork.id)!.steps,
		).not.toBe(bundled.steps);
	}
});

it("preserves disabled stored legacy tool graphs while saving current recipes and defaults", async () => {
	const { runtime, home, path } = fixture();
	const state = runtime.catalog.read();
	const legacy = {
		id: "legacy-tool-fork",
		name: "Historical fork",
		labels: [],
		description: "Retained verbatim",
		steps: [
			{ id: "old", name: "Old tool", type: "tool", tool: "retired-tool" },
		],
		oldExtension: { evidence: "preserve" },
	};
	runtime.importWorkflows({
		...state,
		locals: [legacy],
		order: [...state.order, legacy.id],
	});
	const server = new FactoryServer(runtime, {
		repositories: () => [],
		sessions: () => [],
		entries: () => [],
		start: async () => create(runtime),
		stop: (id) => runtime.stop(id),
	});
	try {
		const workflow = structuredClone(
			runtime.listWorkflows().find((w) => w.id === "v2-review-loop")!,
		);
		const role = workflowRoles(workflow.steps)[0]!;
		role.step.model = "gpt-6-sol";
		const patch = await server.app.inject({
			method: "PATCH",
			url: "/api/workflows",
			headers: { "x-factory-request": "1" },
			payload: { workflows: [workflow] },
		});
		expect(patch.statusCode, patch.body).toBe(200);
		expect(
			runtime.catalog.read().preferences[workflow.id]![role.role]!.model,
		).toBe("gpt-6-sol");
		const savedDefault = await server.app.inject({
			method: "PUT",
			url: "/api/workflows/default",
			headers: { "x-factory-request": "1" },
			payload: { defaultWorkflow: "factory" },
		});
		expect(savedDefault.statusCode, savedDefault.body).toBe(200);
		expect(runtime.getDefaultWorkflow()).toBe("factory");
		expect(runtime.catalog.metadata(legacy.id).enabled).toBe(false);
		expect(new WorkflowCatalog(join(home, "factory")).read().locals).toEqual([
			legacy,
		]);
		const bytes = readFileSync(path, "utf8");
		const current = runtime.listWorkflows();
		expect(() =>
			runtime.catalog.save(
				current.map((w) => (w.id === legacy.id ? { ...w, name: "Edited" } : w)),
			),
		).toThrow("Unknown node type: tool");
		expect(() =>
			runtime.catalog.save([...current, { ...legacy, id: "new-legacy" }]),
		).toThrow("Unknown node type: tool");
		expect(() => runtime.catalog.save([...current, legacy])).toThrow(
			"Duplicate workflow",
		);
		expect(readFileSync(path, "utf8")).toBe(bytes);
	} finally {
		await server.stop();
	}
});
