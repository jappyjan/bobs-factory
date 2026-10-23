import { join } from "node:path";
import { expect, it } from "vitest";
import { collectImpactSnapshot } from "../src/factory/Impact.js";
import { stepForRun } from "../src/factory/ToolBindings.js";
import { validateWorkflows } from "../src/factory/Workflow.js";
import type { ExecutionContext } from "../src/factory/WorkflowRuntime.js";
import {
	definitions,
	reviewKey,
	roles,
	setupReplay,
} from "./fixtures/composed-impact.js";

it("binds composed assessment to arbitrary mapped inputs at an unchanged revision", async () => {
	const fixture = setupReplay("provider-recovery", "js");
	try {
		const { run } = fixture;
		const fanout = stepForRun(run, reviewKey)!;
		const context: ExecutionContext = {
			run,
			step: fanout,
			stepKey: reviewKey,
			input: { originalInput: run.input },
			currentScope: () => ({ originalInput: run.input }),
			callInputs: { customerScope: "accepted-v1" },
			signal: new AbortController().signal,
			evidenceDir: join(fixture.home, "evidence"),
			log: () => {},
		};
		const first = await collectImpactSnapshot(context, fanout, reviewKey);
		context.callInputs = { customerScope: "accepted-v2" };
		const second = await collectImpactSnapshot(context, fanout, reviewKey);
		expect(first.reuseVersion).toBe("composed-v1");
		expect(second.repositories).toEqual(first.repositories);
		expect(second.sourceDigest).toBe(first.sourceDigest);
		expect(second.environmentDigest).toBe(first.environmentDigest);
		expect(second.inputDigest).not.toBe(first.inputDigest);
		expect(second.digest).not.toBe(first.digest);
	} finally {
		await fixture.cleanup();
	}
});

it("retains opted-in Parallel conversations and visit counts without recipe Return outcomes", async () => {
	const fixture = setupReplay("small-correction", "js");
	try {
		const configured = definitions();
		const audit = structuredClone(
			configured.find((workflow) => workflow.id === "composed-audit")!,
		);
		const delivery = configured.find(
			(workflow) => workflow.id === "composed-delivery",
		)!;
		const assessor = audit.steps.find((step) => step.id === roles.assessor)!;
		assessor.branches = assessor.branches.filter(
			(branch) => branch.next !== "integrate",
		);
		const route = audit.steps.find((step) => step.id === roles.disposition)!;
		route.check = {
			results: {
				edit: {
					count: "/inputs/history",
					where: { path: "/step", equals: roles.edit },
					max: 0,
				},
			},
		};
		route.branches = [
			{ when: { path: "edit", equals: true }, next: roles.edit },
		];
		route.next = "end";
		const edit = structuredClone(
			delivery.steps.find((step) => step.id === roles.edit)!,
		);
		edit.next = roles.assessor;
		const standalone = {
			...audit,
			id: "standalone-review",
			name: "Standalone review",
			inputs: undefined,
			outcomes: undefined,
			allowedTriggers: ["manual"],
			steps: [...audit.steps, edit],
		};
		const all = validateWorkflows([...configured, standalone]);
		fixture.runtime.updateWorkflows(all);
		const workflow = all.find((workflow) => workflow.id === standalone.id)!;
		const run = fixture.runtime.create({
			title: "Standalone review continuity",
			input: fixture.run.input,
			repositoryId: fixture.run.repositoryId,
			workspace: fixture.workspace,
			repositories: fixture.run.repositories,
			workflow,
			triggerOrigin: { type: "manual", workflowId: workflow.id },
		});
		await fixture.runtime.launch(run);
		expect(run.status, run.error).toBe("completed");
		expect(run.workflow.outcomes).toBeUndefined();
		for (const role of [roles.assessor, roles.inventory]) {
			expect(
				fixture.calls
					.filter((call) => call.role === role)
					.map((call) => call.resume),
			).toEqual([undefined, `synthetic-${role}`]);
		}
		const calls = fixture.calls.filter((call) => call.role === roles.quality);
		expect(calls.map((call) => call.resume)).toEqual([
			undefined,
			`synthetic-${roles.panel}/4/${roles.quality}`,
		]);
		expect(
			run.checkpoint!.branches![roles.panel]![4]!.visits[roles.quality],
		).toBe(2);
	} finally {
		await fixture.cleanup();
	}
});
