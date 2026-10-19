import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { FactoryServer } from "../src/factory/FactoryServer.js";
import { WorkflowSchema } from "../src/factory/Workflow.js";
import { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";
import { MachineCapacity } from "../src/MachineCapacity.js";
import { UpdateManager } from "../src/updates/UpdateManager.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const close of cleanups.splice(0)) await close();
});

async function fixture() {
	const home = mkdtempSync(join(tmpdir(), "factory-config-projection-"));
	const runtime = new WorkflowRuntime(home, {
		agent: vi.fn(),
		script: vi.fn(),
		tool: vi.fn(),
	});
	const capacity = new MachineCapacity(4, join(home, "machine-capacity"));
	await capacity.ready();
	const onboarding = {
		summary: vi.fn(() => ({ available: true, required: false })),
		status: vi.fn(() => ({
			available: true,
			required: false,
			gitInstalled: true,
			agents: [{ id: "codex", installed: true }],
		})),
		configure: vi.fn(),
		connectGithub: vi.fn(),
	};
	const updates = new UpdateManager(home);
	const server = new FactoryServer(
		runtime,
		{
			capacity,
			onboarding,
			updates,
			repositories: () => [{ id: "project", name: "Project" }],
			sessions: () => [],
			entries: () => [],
			start: vi.fn(),
			stop: vi.fn(),
		},
		{ origins: ["http://localhost", "https://factory.example.test"] },
	);
	const headers = {
		host: "localhost",
		origin: "http://localhost",
		"x-factory-request": "1",
	};
	cleanups.push(async () => {
		await server.stop();
		await runtime.shutdown();
		await capacity.shutdown();
		rmSync(home, { recursive: true, force: true });
	});
	return { runtime, capacity, onboarding, updates, server, headers };
}

it("loads dashboard configuration without setup probes, capacity reconciliation or retained-run scans", async () => {
	const f = await fixture();
	const capacity = vi.spyOn(f.capacity, "snapshot");
	const updates = vi.spyOn(f.updates, "status");
	const git = vi.spyOn(f.runtime.gitSettings, "status");
	const consumers = vi.spyOn(f.runtime.runs, "values");
	const response = await f.server.app.inject({
		url: "/api/config?view=dashboard",
		headers: f.headers,
	});
	expect(response.statusCode).toBe(200);
	const config = response.json();
	expect(config.onboarding).toEqual({ available: true, required: false });
	expect(f.onboarding.summary).toHaveBeenCalledOnce();
	expect(f.onboarding.status).not.toHaveBeenCalled();
	expect(capacity).not.toHaveBeenCalled();
	expect(updates).not.toHaveBeenCalled();
	expect(git).not.toHaveBeenCalled();
	expect(consumers).not.toHaveBeenCalled();
	for (const key of [
		"capacity",
		"updates",
		"gitSettings",
		"workflowConfiguration",
		"executionConsumers",
	])
		expect(config).not.toHaveProperty(key);
	const legacy = await f.server.app.inject({
		url: "/api/config",
		headers: f.headers,
	});
	expect(legacy.statusCode).toBe(200);
	expect(config.configRevision).toBe(legacy.json().configRevision);
	expect(response.rawPayload.byteLength).toBeLessThan(
		legacy.rawPayload.byteLength / 3,
	);
});

it("preserves launch fields and nested step names without sending executable definitions or credential references", async () => {
	const f = await fixture();
	const workflow = WorkflowSchema.parse({
		id: "local-display",
		name: "Local display",
		launchFields: [
			{ name: "prompt", label: "Task", type: "textarea", required: true },
			{ name: "files", label: "References", type: "files" },
		],
		steps: [
			{
				id: "prepare",
				name: "Prepare",
				type: "agent",
				prompt: "Private prompt",
			},
			{ id: "check", name: "Check", type: "script", script: "private-script" },
			{
				id: "ci",
				name: "CI",
				type: "tool",
				tool: "ci",
				arguments: { private: "tool args" },
			},
			{
				id: "parallel",
				name: "Parallel",
				type: "fanout",
				groups: [
					[
						{
							id: "child",
							name: "Child",
							type: "workflow",
							workflow: "local-child",
						},
					],
				],
			},
		],
	});
	f.runtime.updateWorkflows([
		...f.runtime.listWorkflows(),
		WorkflowSchema.parse({
			id: "local-child",
			name: "Local child",
			internal: true,
			steps: [
				{
					id: "child-agent",
					name: "Child agent",
					type: "agent",
					prompt: "Child prompt",
				},
			],
		}),
		workflow,
	]);
	f.runtime.updateExecutionProfiles(
		{
			schemaVersion: 1,
			revision: 0,
			identities: [
				{
					id: "owner",
					name: "Owner",
					revision: 1,
					author: { mode: "share" },
					committer: { mode: "share" },
					signing: { format: "share" },
					repositories: [],
					runners: {},
				},
			],
			tools: [
				{
					id: "tools",
					name: "Tools",
					revision: 1,
					mode: "factory-only",
					mcp: {
						private: {
							type: "stdio",
							command: "private-command",
							env: {
								PRIVATE_TOKEN: {
									source: "env",
									name: "PRIVATE_TOKEN",
									version: "v1",
									owner: "Owner",
								},
							},
						},
					},
				},
			],
			defaults: { identityProfile: "owner" },
			repositories: { project: { toolProfile: "tools" } },
		},
		0,
	);
	const dashboard = await f.server.app.inject({
		url: "/api/config?view=dashboard",
		headers: f.headers,
	});
	expect(dashboard.statusCode).toBe(200);
	const config = dashboard.json();
	const summary = config.workflows.find(
		(item: { id: string }) => item.id === workflow.id,
	);
	expect(summary.launchFields).toEqual(workflow.launchFields);
	expect(summary.steps).toEqual([
		{ id: "prepare", name: "Prepare", type: "agent" },
		{ id: "check", name: "Check", type: "script" },
		{ id: "ci", name: "CI", type: "tool", tool: "ci" },
		{
			id: "parallel",
			name: "Parallel",
			type: "fanout",
			groups: [
				[
					{
						id: "child",
						name: "Child",
						type: "workflow",
						workflow: "local-child",
					},
				],
			],
		},
	]);
	expect(config.executionProfiles).toEqual({
		revision: 1,
		defaults: { identityProfile: "owner" },
		repositories: { project: { toolProfile: "tools" } },
		identities: [{ id: "owner", name: "Owner", revision: 1 }],
		tools: [{ id: "tools", name: "Tools", revision: 1 }],
	});
	const recipes = await f.server.app.inject({
		url: "/api/config?view=recipes",
		headers: f.headers,
	});
	expect(recipes.statusCode).toBe(200);
	const editable = recipes
		.json()
		.workflows.find((item: { id: string }) => item.id === workflow.id);
	expect(editable.steps).toEqual(workflow.steps);
	expect(recipes.json()).not.toHaveProperty("executionProfiles");
	expect(recipes.json()).not.toHaveProperty("gitSettings");
	expect(recipes.json()).not.toHaveProperty("executionConsumers");
	const settings = await f.server.app.inject({
		url: "/api/config?view=settings",
		headers: f.headers,
	});
	expect(settings.statusCode).toBe(200);
	expect(settings.json().executionProfiles.tools[0].mcp.private.command).toBe(
		"private-command",
	);
	expect(settings.json().configRevision).toBe(config.configRevision);
	expect(recipes.json().configRevision).toBe(config.configRevision);
	for (const view of [settings.json(), recipes.json()]) {
		expect(view).not.toHaveProperty("onboarding");
		expect(view).not.toHaveProperty("capacity");
		expect(view).not.toHaveProperty("updates");
	}
	expect(settings.json()).not.toHaveProperty("workflows");
	expect(settings.json()).not.toHaveProperty("workflowConfiguration");
	expect(f.onboarding.status).not.toHaveBeenCalled();
});

it("serves capacity counts separately and rejects configuration edits based on an old dashboard revision", async () => {
	const f = await fixture();
	const capacity = await f.server.app.inject({
		url: "/api/capacity",
		headers: f.headers,
	});
	expect(capacity.statusCode).toBe(200);
	expect(capacity.json()).toEqual({
		capacity: {
			limit: 4,
			active: 0,
			stopping: 0,
			queued: 0,
			defaultLimit: 4,
		},
	});
	const config = (
		await f.server.app.inject({
			url: "/api/config?view=dashboard",
			headers: f.headers,
		})
	).json();
	f.runtime.updateTitleSettings({ runner: "codex", model: "updated" });
	const edit = await f.server.app.inject({
		method: "PUT",
		url: "/api/title-settings",
		headers: { ...f.headers, "x-factory-config": config.configRevision },
		payload: { runner: "claude" },
	});
	expect(edit.statusCode).toBe(409);
	expect(f.runtime.getTitleSettings()).toEqual({
		runner: "codex",
		model: "updated",
	});
});

it("changes the default with its ID while retaining every recipe definition", async () => {
	const f = await fixture();
	const definitions = f.runtime.listWorkflows();
	const { configRevision } = (
		await f.server.app.inject({
			url: "/api/config?view=dashboard",
			headers: f.headers,
		})
	).json();
	const response = await f.server.app.inject({
		method: "PUT",
		url: "/api/workflows/default",
		headers: { ...f.headers, "x-factory-config": configRevision },
		payload: { defaultWorkflow: "factory" },
	});
	expect(response.statusCode).toBe(200);
	expect(response.json()).toEqual({
		defaultWorkflow: "factory",
		configRevision: expect.any(String),
		workflowConfigurationPatch: { defaultWorkflow: "factory" },
	});
	expect(response.rawPayload.byteLength).toBeLessThan(256);
	expect(f.runtime.getDefaultWorkflow()).toBe("factory");
	expect(f.runtime.listWorkflows()).toEqual(definitions);
	const stale = await f.server.app.inject({
		method: "PUT",
		url: "/api/workflows/default",
		headers: { ...f.headers, "x-factory-config": configRevision },
		payload: { defaultWorkflow: "simple" },
	});
	expect(stale.statusCode).toBe(409);
	expect(f.runtime.getDefaultWorkflow()).toBe("factory");
});

it("upserts only changed recipes atomically, rejecting invalid dependencies and duplicate IDs before saving", async () => {
	const f = await fixture();
	const initial = f.runtime.listWorkflows();
	const recipe = WorkflowSchema.parse({
		id: "local-patch",
		name: "Local patch",
		steps: [{ id: "work", name: "Work", type: "agent", prompt: "Task" }],
	});
	const revision = async () =>
		(
			await f.server.app.inject({
				url: "/api/config?view=recipes",
				headers: f.headers,
			})
		).json().configRevision;
	const patch = async (workflows: unknown[]) =>
		f.server.app.inject({
			method: "PATCH",
			url: "/api/workflows",
			headers: { ...f.headers, "x-factory-config": await revision() },
			payload: { workflows },
		});
	const response = await patch([recipe]);
	expect(response.statusCode).toBe(200);
	expect(
		response
			.json()
			.updatedWorkflows.map((workflow: { id: string }) => workflow.id),
	).toEqual([recipe.id]);
	expect(response.json().updatedWorkflows[0].steps).toEqual(recipe.steps);
	expect(response.json()).not.toHaveProperty("workflows");
	expect(f.runtime.listWorkflows()).toEqual([...initial, recipe]);
	expect(f.runtime.getDefaultWorkflow()).toBe("simple");
	const saved = f.runtime.listWorkflows();
	const invalid = await patch([
		{ ...recipe, name: "Should not save" },
		{
			id: "bad-reference",
			name: "Bad reference",
			steps: [
				{
					id: "call",
					name: "Call",
					type: "workflow",
					workflow: "missing",
				},
			],
		},
	]);
	expect(invalid.statusCode).toBe(409);
	expect(f.runtime.listWorkflows()).toEqual(saved);
	const duplicate = await patch([recipe, { ...recipe, name: "Ambiguous" }]);
	expect(duplicate.statusCode).toBeGreaterThanOrEqual(400);
	expect(f.runtime.listWorkflows()).toEqual(saved);
});
