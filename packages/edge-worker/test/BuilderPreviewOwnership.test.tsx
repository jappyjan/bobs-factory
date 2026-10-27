import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { resolveView } from "../src/factory/View.js";
import { StepSchema } from "../src/factory/Workflow.js";
import { DisplayDocumentView } from "../src/factory/web/display.js";
import {
	HumanPreviewSession,
	humanPreviewConfiguration,
	type LastRunPreview,
} from "../src/factory/web/display-editor.js";

const makeStep = () =>
	StepSchema.parse({
		id: "display",
		name: "Choose findings",
		type: "display",
		reads: { research: "source" },
		document: {
			version: "view-v1",
			components: [
				{
					id: "intro",
					type: "markdown",
					data: { path: "/inputs/research/summary" },
				},
			],
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
		view: resolveView(makeStep().document!, scope),
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
				document: {
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
			{ ...original, bind: ["source"] },
			{ ...original, notifications: { push: "view-text" as const } },
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

	it("renders the current Display against retained accepted inputs", async () => {
		const step = makeStep();
		let configuration = humanPreviewConfiguration("recipe", step);
		const session = new HumanPreviewSession(
			() => configuration,
			async () => result(),
		);
		await session.lastRun();
		const edited = { ...step, name: "Changed Display" };
		configuration = humanPreviewConfiguration("recipe", edited);
		const presentation = session.presentation(),
			scope = presentation.lastRun!.scope;
		const html = renderToStaticMarkup(
			createElement(DisplayDocumentView, {
				runId: "accepted-run",
				snapshot: {
					id: "preview",
					stepKey: edited.id,
					kind: "display",
					title: edited.name,
					digest: "preview",
					documentDigest: "preview",
					view: resolveView(edited.document!, scope),
					createdAt: "preview",
				},
				onSubmit: vi.fn(),
			}),
		);
		expect(presentation.definitionMatch).toBe(false);
		expect(html).toContain("Accepted inputs from accepted-run");
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
});
