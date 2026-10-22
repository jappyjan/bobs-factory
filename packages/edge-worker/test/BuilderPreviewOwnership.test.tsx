import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { decisionItems } from "../src/factory/HumanStep.js";
import { resolveView } from "../src/factory/View.js";
import { StepSchema } from "../src/factory/Workflow.js";
import { HumanStepDecision } from "../src/factory/web/declarative-view.js";
import {
	HumanPreviewSession,
	HumanStepSettings,
	humanPreviewConfiguration,
	type LastRunPreview,
} from "../src/factory/web/human-step-settings.js";

const makeStep = () =>
	StepSchema.parse({
		id: "decide",
		name: "Choose findings",
		type: "decide",
		reads: { research: "source" },
		view: {
			version: "view-v1",
			components: [
				{
					id: "intro",
					type: "markdown",
					data: { path: "/inputs/research/summary" },
				},
			],
		},
		decide: {
			items: { path: "/inputs/research/items" },
			itemId: "/id",
			title: "/title",
			actions: [{ id: "fix", label: "Fix", followUp: true }],
			ask: { prompt: "Answer this question only." },
		},
	});

const result = (
	runId = "accepted-run",
	workflowId = "recipe",
): LastRunPreview => {
	const scope = {
		inputs: {
			research: {
				summary: { text: `Accepted inputs from ${runId}` },
				items: [{ id: "cache", title: "Keep accepted cache inputs" }],
			},
		},
	};
	return {
		scope,
		provenance: {
			kind: "last-run",
			runId,
			workflowId,
			definitionMatch: true,
		},
		paths: ["/inputs/research/summary"],
		view: resolveView(makeStep().view, scope),
	};
};

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: Error) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

describe("builder accepted-input preview ownership", () => {
	it("retains accepted inputs but immediately withdraws match after consequential configuration edits", async () => {
		const original = makeStep();
		let configuration = humanPreviewConfiguration("recipe", original);
		const session = new HumanPreviewSession(
			() => configuration,
			async () => result(),
		);
		await session.load();
		expect(session.presentation().definitionMatch).toBe(true);
		const edits = [
			{ ...original, name: "Changed title" },
			{
				...original,
				view: {
					version: "view-v1" as const,
					components: [
						{
							id: "new",
							type: "markdown" as const,
							data: { literal: { text: "Edited draft content" } },
						},
					],
				},
			},
			{
				...original,
				decide: {
					...original.decide!,
					actions: [{ id: "fix", label: "Repair this", followUp: true }],
				},
			},
			{
				...original,
				decide: {
					...original.decide!,
					actions: [{ id: "fix", label: "Fix", followUp: false }],
				},
			},
			{
				...original,
				decide: {
					...original.decide!,
					ask: { prompt: "Use a changed dedicated follow-up prompt." },
				},
			},
			{
				...original,
				notifications: { push: "view-text" as const },
			},
		];
		for (const edited of edits) {
			configuration = humanPreviewConfiguration("recipe", edited);
			// No effect/cleanup is needed before the current render is safe.
			expect(session.presentation().definitionMatch).toBe(false);
			expect(session.presentation().lastRun?.scope).toEqual(result().scope);
		}
		configuration = humanPreviewConfiguration("recipe", original, {
			name: "Changed full workflow",
		});
		expect(session.presentation().definitionMatch).toBe(false);
		expect(session.presentation().lastRun?.provenance.runId).toBe(
			"accepted-run",
		);
	});

	it("renders the current actions and view against retained accepted inputs", async () => {
		const step = makeStep();
		let configuration = humanPreviewConfiguration("recipe", step);
		const session = new HumanPreviewSession(
			() => configuration,
			async () => result(),
		);
		await session.lastRun();
		const edited = {
			...step,
			decide: {
				...step.decide!,
				actions: [
					{ id: "fix", label: "Repair accepted item", followUp: false },
				],
				ask: undefined,
			},
		};
		configuration = humanPreviewConfiguration("recipe", edited);
		const presentation = session.presentation();
		const scope = presentation.lastRun!.scope;
		const html = renderToStaticMarkup(
			createElement(HumanStepDecision, {
				runId: presentation.lastRun!.provenance.runId!,
				snapshot: {
					id: "preview",
					stepKey: edited.id,
					kind: "decide",
					title: edited.name,
					digest: "preview-only",
					view: resolveView(edited.view, scope),
					items: decisionItems(edited.decide, scope),
					actions: edited.decide.actions,
					askAvailable: false,
					createdAt: "preview",
				},
				onSubmit: vi.fn(),
			}),
		);
		expect(presentation.definitionMatch).toBe(false);
		expect(html).toContain("Accepted inputs from accepted-run");
		expect(html).toContain("Keep accepted cache inputs");
		expect(html).toContain("Repair accepted item");
		expect(html).not.toContain(">Ask</button>");
		expect(html).not.toContain("Follow-up</");
	});

	it.each([
		"workflow",
		"step",
		"reads",
	])("never displays another %s owner's loaded inputs, even before cleanup", async (changed) => {
		const step = makeStep();
		let configuration = humanPreviewConfiguration("recipe", step);
		const session = new HumanPreviewSession(
			() => configuration,
			async () => result(),
		);
		await session.load();
		configuration = humanPreviewConfiguration(
			changed === "workflow" ? "another-recipe" : "recipe",
			{
				...step,
				...(changed === "step" ? { id: "another-step" } : {}),
				...(changed === "reads" ? { reads: { research: "elsewhere" } } : {}),
			},
		);
		expect(session.presentation().lastRun).toBeUndefined();
		expect(session.presentation().definitionMatch).toBe(false);
		session.configurationChanged();
		expect(session.getSnapshot().loaded).toBeUndefined();
	});

	it.each([
		"resolve",
		"reject",
	])("ignores an obsolete request's delayed %s without changing a newer pending request", async (settlement) => {
		let configuration = humanPreviewConfiguration("recipe", makeStep());
		const first = deferred<LastRunPreview>();
		const second = deferred<LastRunPreview>();
		const transport = vi
			.fn()
			.mockReturnValueOnce(first.promise)
			.mockReturnValueOnce(second.promise);
		const session = new HumanPreviewSession(() => configuration, transport);
		const oldRequest = session.load();
		configuration = humanPreviewConfiguration("recipe", {
			...makeStep(),
			name: "Changed while request was pending",
		});
		const currentRequest = session.load();
		expect(transport.mock.calls[0][1].aborted).toBe(true);
		if (settlement === "resolve") first.resolve(result("obsolete"));
		else first.reject(new Error("obsolete error"));
		await oldRequest;
		expect(session.presentation()).toMatchObject({
			loading: true,
			lastRun: undefined,
			loadError: "",
		});
		second.resolve(result("current"));
		await currentRequest;
		expect(session.presentation()).toMatchObject({
			loading: false,
			definitionMatch: true,
			loadError: "",
		});
		expect(session.presentation().lastRun?.provenance.runId).toBe("current");
	});

	it("does not commit a reply after an edit, even before the effect aborts it", async () => {
		let configuration = humanPreviewConfiguration("recipe", makeStep());
		const reply = deferred<LastRunPreview>();
		const session = new HumanPreviewSession(
			() => configuration,
			() => reply.promise,
		);
		const pending = session.load();
		configuration = humanPreviewConfiguration("recipe", {
			...makeStep(),
			name: "New draft",
		});
		reply.resolve(result("obsolete"));
		await pending;
		expect(session.presentation().lastRun).toBeUndefined();
		expect(session.presentation().loading).toBe(false);
	});

	it("does not let an old same-configuration request replace a newer reply", async () => {
		const configuration = humanPreviewConfiguration("recipe", makeStep());
		const first = deferred<LastRunPreview>();
		const second = deferred<LastRunPreview>();
		const transport = vi
			.fn()
			.mockReturnValueOnce(first.promise)
			.mockReturnValueOnce(second.promise);
		const session = new HumanPreviewSession(() => configuration, transport);
		const oldRequest = session.load();
		const currentRequest = session.load();
		second.resolve(result("newest"));
		await currentRequest;
		first.resolve(result("old"));
		await oldRequest;
		expect(session.presentation().lastRun?.provenance.runId).toBe("newest");
	});

	it("keeps Sample data selected after cancellation, unmount, and late response", async () => {
		const configuration = humanPreviewConfiguration("recipe", makeStep());
		const reply = deferred<LastRunPreview>();
		const session = new HumanPreviewSession(
			() => configuration,
			() => reply.promise,
		);
		const pending = session.load();
		session.sample();
		session.dispose();
		reply.resolve(result());
		await pending;
		expect(session.presentation()).toMatchObject({
			mode: "sample",
			lastRun: undefined,
			loading: false,
			loadError: "",
		});
	});

	it("rejects a response for another recipe and preserves server-reported mismatch", async () => {
		const configuration = humanPreviewConfiguration("recipe", makeStep());
		const session = new HumanPreviewSession(
			() => configuration,
			async () => result("private-other", "another-recipe"),
		);
		await session.load();
		expect(session.presentation().lastRun).toBeUndefined();
		expect(session.presentation().loadError).toBe(
			"Preview response belongs to another recipe.",
		);
		const mismatch = result();
		mismatch.provenance.definitionMatch = false;
		const mismatched = new HumanPreviewSession(
			() => configuration,
			async () => mismatch,
		);
		await mismatched.load();
		expect(mismatched.presentation().definitionMatch).toBe(false);
	});

	it.each([
		undefined,
		"private",
		"view-text",
	] as const)("shows explicit push text consent without silently opting in old/private recipes (%s)", (push) => {
		const step = makeStep();
		if (push) step.notifications = { push };
		const html = renderToStaticMarkup(
			createElement(HumanStepSettings, {
				step,
				readOnly: false,
				onChange: vi.fn(),
				onError: vi.fn(),
				workflowId: "recipe",
			}),
		);
		expect(html).toContain("Include bounded view text in push notifications");
		expect(html).toContain("Private notices are the default.");
		expect(html).toContain("lock screen");
		const checkbox = html.match(/<input[^>]*type="checkbox"[^>]*>/)?.[0];
		expect(checkbox).toBeDefined();
		expect(checkbox?.includes('checked=""')).toBe(push === "view-text");
		expect(
			JSON.parse(humanPreviewConfiguration("recipe", step).body),
		).toMatchObject(
			push ? { notifications: { push } } : { workflowId: "recipe" },
		);
	});
});
