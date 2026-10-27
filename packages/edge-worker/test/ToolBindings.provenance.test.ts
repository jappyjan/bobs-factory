import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { resolveGitProvider } from "../src/factory/GitProvider.js";
import {
	repositoryMetadata,
	runRepositories,
} from "../src/factory/RepositoryScope.js";
import {
	takeoverSource,
	ticketSnapshot,
} from "../src/factory/RunContextSources.js";
import { stepBindings } from "../src/factory/StepBindings.js";
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
const _second = { url: "https://github.com/selected/project/pull/2" };
const agent = {
	id: "result",
	name: "Ordinary data",
	type: "agent",
	prompt: "Return ordinary data",
	next: "end",
};
const publication = {
	id: "result",
	name: "Publication",
	type: "agent",
	prompt: "Publish",
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
	_toolOutput: unknown = accepted,
	modernMarker = true,
) {
	const directory = mkdtempSync(join(tmpdir(), "producer-provenance-"));
	directories.push(directory);
	const definitions = validateWorkflows([
		...defaultWorkflows,
		{
			engineVersion: "nodes-v1",
			id: "producer-root",
			name: "Root",
			...(modernMarker ? { stepConfigVersion: "step-config-v1" } : {}),
			allowedTriggers: ["manual"],
			steps,
		},
		{
			engineVersion: "nodes-v1",
			id: "producer-child",
			name: "Child",
			stepConfigVersion: "step-config-v1",
			allowedTriggers: ["workflow"],
			steps: childSteps,
		},
		{
			engineVersion: "nodes-v1",
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

it("does not trust ordinary draftPr bindings or source output keys to select a repository", async () => {
	const { run } = await fixture([
		agent,
		{
			id: "consume",
			name: "Consume",
			type: "agent",
			prompt: "Read ordinary data",
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
