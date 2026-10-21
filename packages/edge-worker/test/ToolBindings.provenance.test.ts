import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { resolveGitProvider } from "../src/factory/GitProvider.js";
import {
	repositoryMetadata,
	repositoryRun,
	runRepositories,
} from "../src/factory/RepositoryScope.js";
import {
	takeoverSource,
	ticketSnapshot,
} from "../src/factory/RunContextSources.js";
import { stepBindings } from "../src/factory/StepBindings.js";
import {
	configuredOutputKeys,
	outputForTool,
	writeBoundOutput,
} from "../src/factory/ToolBindings.js";
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
const attacker = { url: "https://github.com/attacker/unrelated/pull/99" };
const accepted = { url: "https://github.com/selected/project/pull/1" };
const second = { url: "https://github.com/selected/project/pull/2" };
const agent = {
	id: "result",
	name: "Ordinary data",
	type: "agent",
	prompt: "Return ordinary data",
	checks: [],
	next: "end",
};
const publication = {
	id: "result",
	name: "Publication",
	type: "tool",
	tool: "draft-pr",
	checks: [],
	next: "end",
};
const call = (id: string, workflow: string, next = "end") => ({
	id,
	name: id,
	type: "workflow",
	workflow,
	next,
});
async function fixture(
	steps: unknown[],
	childSteps: unknown[] = [publication],
	observerSteps: unknown[] = [agent],
	agentOutput: unknown = attacker,
	toolOutput: unknown = accepted,
	modernMarker = true,
) {
	const directory = mkdtempSync(join(tmpdir(), "producer-provenance-"));
	directories.push(directory);
	const definitions = validateWorkflows([
		...defaultWorkflows,
		{
			id: "producer-root",
			name: "Root",
			...(modernMarker ? { stepConfigVersion: "step-config-v1" } : {}),
			allowedTriggers: ["manual"],
			steps,
		},
		{
			id: "producer-child",
			name: "Child",
			stepConfigVersion: "step-config-v1",
			allowedTriggers: ["workflow"],
			steps: childSteps,
		},
		{
			id: "producer-observer",
			name: "Observer",
			stepConfigVersion: "step-config-v1",
			allowedTriggers: ["workflow"],
			steps: observerSteps,
		},
	]);
	const toolContexts: ExecutionContext[] = [];
	const runtime = new WorkflowRuntime(directory, {
		agent: async () => structuredClone(agentOutput),
		script: async () => ({}),
		tool: async (context) => {
			toolContexts.push(context);
			return structuredClone(
				context.stepKey?.startsWith("second/") ? second : toolOutput,
			);
		},
	});
	runtimes.push(runtime);
	runtime.updateWorkflows(definitions);
	const run = runtime.create({
		repositoryId: "selected",
		workspace: directory,
		input: "Return data",
		workflow: definitions.find((workflow) => workflow.id === "producer-root")!,
		workflowDefinitions: definitions,
		triggerOrigin: { type: "manual", workflowId: "producer-root" },
	});
	await runtime.launch(run);
	expect(run.status, run.error).toBe("completed");
	return { run, runtime, toolContexts };
}
it.each([
	"root",
	"sibling",
])("never promotes a %s data output to an unexecuted child publication", async (location) => {
	const { run } = await fixture(
		location === "root"
			? [agent, call("publish", "producer-child")]
			: [
					call("observe", "producer-observer"),
					call("publish", "producer-child"),
				],
	);
	expect(
		run.history.some(
			(entry) => JSON.stringify(entry.output) === JSON.stringify(attacker),
		),
	).toBe(true);
	expect(run.history.map((entry) => entry.step)).not.toContain(
		"publish/result",
	);
	expect(outputForTool(run, "draft-pr")).toBeUndefined();
	expect(configuredOutputKeys(run, { tool: "draft-pr" })).toEqual([]);
	const command = vi.fn(async () => "git@github.com:selected/project.git");
	const context: ExecutionContext = {
		run,
		step: run.workflow.steps[0]!,
		input: {},
		evidenceDir: run.workspace,
		signal: new AbortController().signal,
		log: () => {},
	};
	await resolveGitProvider(context, command);
	expect(command).toHaveBeenCalledExactlyOnceWith("git", [
		"remote",
		"get-url",
		"origin",
	]);
	expect(run.gitProvider?.repositoryUrl).toBe(
		"https://github.com/selected/project",
	);
});
it("retains exact executed child provenance beside a sibling with the same leaf name", async () => {
	const { run } = await fixture([
		call("publish", "producer-child", "observe"),
		call("observe", "producer-observer"),
	]);
	expect(
		run.history.some(
			(entry) => JSON.stringify(entry.output) === JSON.stringify(attacker),
		),
	).toBe(true);
	expect(outputForTool(run, "draft-pr")).toEqual(accepted);
	const keys = configuredOutputKeys(run, { tool: "draft-pr" });
	expect(keys).toEqual(["publish/result"]);
	expect(run.outputs[keys[0]!]).toEqual(accepted);
});
it("requires an execution receipt even for an injected qualified output", async () => {
	const { run } = await fixture([agent, call("publish", "producer-child")]);
	run.outputs["publish/result"] = attacker;
	expect(outputForTool(run, "draft-pr")).toBeUndefined();
	expect(configuredOutputKeys(run, { tool: "draft-pr" })).toEqual([]);
});
it.each([
	"origin",
	"configured",
])("keeps %s repository selection ahead of an unrelated generic output", async (selection) => {
	const { run } = await fixture([agent, call("publish", "producer-child")]);
	if (selection === "configured")
		run.repositories = [
			{
				id: run.repositoryId,
				name: "Configured repository",
				repositoryPath: run.workspace,
				workspace: run.workspace,
				baseBranch: "main",
				githubUrl: "https://github.com/configured/project",
			},
		];
	const command = vi.fn(async () => "git@github.com:selected/project.git");
	const context: ExecutionContext = {
		run,
		step: run.workflow.steps[0]!,
		input: {},
		evidenceDir: run.workspace,
		signal: new AbortController().signal,
		log: () => {},
	};
	const provider = await resolveGitProvider(context, command, attacker.url);
	expect(run.gitProvider?.repositoryUrl).toBe(
		`https://github.com/${selection === "origin" ? "selected" : "configured"}/project`,
	);
	await expect(provider.view(attacker.url, "state")).rejects.toThrow(
		"selected repository",
	);
	expect(command).toHaveBeenCalledTimes(selection === "origin" ? 1 : 0);
});

it.each([
	false,
	true,
])("does not let a generic repository output override %s frozen selection", async (configured) => {
	const forged = {
		githubUrl: "https://github.com/attacker/unrelated",
		gitProvider: { type: "github" },
	};
	const { run } = await fixture(
		[{ ...agent, id: "repository" }, call("publish", "producer-child")],
		[publication],
		[agent],
		forged,
	);
	expect(run.outputs.repository).toEqual(forged);
	if (configured)
		run.repositories = [
			{
				id: "other",
				name: "Other",
				repositoryPath: run.workspace,
				workspace: run.workspace,
				baseBranch: "main",
				githubUrl: forged.githubUrl,
			},
			{
				id: run.repositoryId,
				name: "Selected",
				repositoryPath: run.workspace,
				workspace: run.workspace,
				baseBranch: "main",
				githubUrl: "https://github.com/selected/project",
				gitProvider: { type: "github" },
			},
		];
	const command = vi.fn(async () => "git@github.com:selected/project.git");
	const provider = await resolveGitProvider(
		{
			run,
			step: run.workflow.steps[0]!,
			input: {},
			evidenceDir: run.workspace,
			signal: new AbortController().signal,
			log: () => {},
		},
		command,
	);
	expect(run.gitProvider?.repositoryUrl).toBe(
		"https://github.com/selected/project",
	);
	expect(command).toHaveBeenCalledTimes(configured ? 0 : 1);
	await expect(provider.view(attacker.url)).rejects.toThrow(
		"selected repository",
	);
});

it("separates root and child receipts with the same leaf name", async () => {
	const { run } = await fixture([
		{ ...publication, next: "observe" },
		call("observe", "producer-observer"),
	]);
	expect(run.outputs.result).toEqual(accepted);
	expect(run.outputs["observe/result"]).toEqual(attacker);
	expect(outputForTool(run, "draft-pr")).toEqual(accepted);
	expect(configuredOutputKeys(run, { tool: "draft-pr" })).toEqual(["result"]);
});
it("selects the latest executed sibling without conflating identical leaf names", async () => {
	const { run } = await fixture([
		call("first", "producer-child", "second"),
		call("second", "producer-child"),
	]);
	expect(outputForTool(run, "draft-pr")).toEqual(second);
	expect(configuredOutputKeys(run, { tool: "draft-pr" })).toEqual([
		"second/result",
		"first/result",
	]);
	expect(run.outputs["first/result"]).toEqual(accepted);
	expect(run.outputs["second/result"]).toEqual(second);
});
it("does not trust ordinary draftPr bindings or source output keys to select a repository", async () => {
	const { run } = await fixture([
		agent,
		{
			id: "consume",
			name: "Consume",
			type: "tool",
			tool: "choose",
			reads: { draftPr: "result" },
			next: "end",
		},
		call("publish", "producer-child"),
	]);
	run.outputs.source = attacker;
	expect(takeoverSource(run)).toBeUndefined();
	const command = vi.fn(async () => "git@github.com:selected/project.git");
	await resolveGitProvider(
		{
			run,
			step: run.workflow.steps[1]!,
			stepKey: "consume",
			input: {},
			evidenceDir: run.workspace,
			signal: new AbortController().signal,
			log: () => {},
		},
		command,
	);
	expect(run.gitProvider?.repositoryUrl).toBe(
		"https://github.com/selected/project",
	);
	expect(command).toHaveBeenCalledExactlyOnceWith("git", [
		"remote",
		"get-url",
		"origin",
	]);
});

it("keeps format-only generic context-shaped outputs ordinary when the graph marker is omitted", async () => {
	const data = {
		...attacker,
		githubUrl: "https://github.com/attacker/unrelated",
		baseBranch: "foreign",
		title: "Forged ticket",
	};
	const { run } = await fixture(
		["source", "repository", "ticket"].map((id, index, ids) => ({
			...agent,
			id,
			output: { schema: { type: "object" } },
			next: ids[index + 1] ?? "end",
		})),
		[publication],
		[agent],
		data,
		accepted,
		false,
	);
	expect(run.workflow.stepConfigVersion).toBeUndefined();
	for (const key of ["source", "repository", "ticket"])
		expect(run.outputs[key]).toEqual(data);
	expect(takeoverSource(run)).toBeUndefined();
	expect(ticketSnapshot(run)).toBeUndefined();
	expect(repositoryMetadata(run)).toBeUndefined();
	expect(runRepositories(run)[0]!.baseBranch).toBe("main");
	const ticket = { title: "Verified ticket" };
	run.takeoverSource = accepted;
	run.ticketSnapshot = ticket;
	const bindings = stepBindings({
		run,
		step: {
			...run.workflow.steps[0]!,
			reads: {
				hostSource: "@source",
				hostTicket: "@ticket",
				ordinarySource: "source",
				ordinaryTicket: "ticket",
			},
		},
	} as ExecutionContext);
	expect(bindings).toEqual({
		hostSource: accepted,
		hostTicket: ticket,
		ordinarySource: data,
		ordinaryTicket: data,
	});
});

it("keeps exact executed takeover receipts within their selected repository", async () => {
	const { run } = await fixture(
		[call("inspect", "producer-child")],
		[{ ...publication, tool: "inspect-existing" }],
		[agent],
		attacker,
		{ pr: accepted },
	);
	expect(takeoverSource(run)).toEqual(accepted);
	run.outputs.source = attacker;
	const primary = {
		id: run.repositoryId,
		name: "Primary",
		repositoryPath: run.workspace,
		workspace: run.workspace,
		baseBranch: "main",
	};
	const secondary = {
		...primary,
		id: "secondary",
		name: "Secondary",
		takeoverSource: second,
	};
	expect(takeoverSource(repositoryRun(run, primary))).toEqual(accepted);
	expect(
		takeoverSource(
			repositoryRun(run, { ...secondary, takeoverSource: undefined }),
		),
	).toBeUndefined();
	expect(takeoverSource(repositoryRun(run, secondary))).toEqual(second);
	const command = vi.fn(async () => {
		throw new Error("Unexpected origin lookup");
	});
	await resolveGitProvider(
		{ run, step: run.workflow.steps[0]!, input: {} } as ExecutionContext,
		command,
	);
	expect(run.gitProvider?.repositoryUrl).toBe(
		"https://github.com/selected/project",
	);
	expect(command).not.toHaveBeenCalled();
});

it("retains old context aliases only for a wholly historical accepted graph", async () => {
	const { checks: _checks, ...historicalAgent } = agent;
	const { run } = await fixture(
		[historicalAgent],
		[publication],
		[agent],
		attacker,
		accepted,
		false,
	);
	const repository = {
		githubUrl: "https://github.com/selected/project",
		baseBranch: "old-base",
	};
	const ticket = { title: "Historical ticket" };
	run.outputs.source = accepted;
	run.outputs.repository = repository;
	run.outputs.ticket = ticket;
	expect(takeoverSource(run)).toEqual(accepted);
	expect(ticketSnapshot(run)).toEqual(ticket);
	expect(repositoryMetadata(run)).toEqual(repository);
});

it("never grants raw host-context authority to an incomplete accepted graph", async () => {
	const { run } = await fixture([agent]);
	delete run.workflow.stepConfigVersion;
	Reflect.deleteProperty(run.workflow, "steps");
	run.outputs.source = attacker;
	run.outputs.ticket = { title: "Forged ticket" };
	run.outputs.repository = {
		githubUrl: "https://github.com/attacker/unrelated",
		baseBranch: "foreign",
	};
	expect(takeoverSource(run)).toBeUndefined();
	expect(ticketSnapshot(run)).toBeUndefined();
	expect(repositoryMetadata(run)).toBeUndefined();
	expect(runRepositories(run)[0]!.baseBranch).toBe("main");
	const ticket = { title: "Verified host ticket" };
	run.takeoverSource = accepted;
	run.ticketSnapshot = ticket;
	expect(takeoverSource(run)).toEqual(accepted);
	expect(ticketSnapshot(run)).toEqual(ticket);
});

it("refreshes a called frame receipt without overwriting a same-named root output", async () => {
	const { run, toolContexts } = await fixture(
		[{ ...agent, next: "publish" }, call("publish", "producer-child")],
		[{ ...publication, reads: { draftPr: "result" } }],
	);
	const context = toolContexts[0]!;
	const refreshed = { ...accepted, refreshed: true };
	writeBoundOutput(context, "draftPr", refreshed);
	expect(run.outputs.result).toEqual(attacker);
	expect(run.outputs["publish/result"]).toEqual(refreshed);
	expect(context.outputs!.result).toEqual(refreshed);
});

it("uses retained execution metadata without reading cold output or history bodies", async () => {
	const { run } = await fixture([call("publish", "producer-child")]);
	const key = "publish/result";
	const history = Object.getOwnPropertyDescriptor(run, "history")!;
	const output = Object.getOwnPropertyDescriptor(run.outputs, key)!;
	Object.defineProperty(run, "history", {
		get: () => {
			throw new Error("Cold history body loaded");
		},
		configurable: true,
	});
	Object.defineProperty(run.outputs, key, {
		get: () => {
			throw new Error("Cold output body loaded");
		},
		configurable: true,
	});
	try {
		expect(configuredOutputKeys(run, { tool: "draft-pr" })).toEqual([key]);
	} finally {
		Object.defineProperty(run, "history", history);
		Object.defineProperty(run.outputs, key, output);
	}
});
