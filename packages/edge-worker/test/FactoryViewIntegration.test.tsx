import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import type { ViewSnapshot } from "../src/factory/HumanStep.js";
import { resolveView } from "../src/factory/View.js";
import { StepSchema, validateWorkflows } from "../src/factory/Workflow.js";
import {
	FocusCard,
	GenericHumanDecision,
	RunViewDisplays,
} from "../src/factory/web/focus.js";
import { bodyProblem } from "../src/factory/web/foreach-step-settings.js";
import {
	draftProblems,
	kindOf,
	newStep,
	type Recipe,
	type Step,
} from "../src/factory/web/recipe-graph.js";

const fixture = vi.hoisted(() => ({ run: undefined as any }));
vi.mock("../src/factory/web/client.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/factory/web/client.js")>()),
	useRun: () => ({ data: fixture.run, isLoading: false }),
	useAction: () => ({
		isPending: false,
		isBlocked: false,
		mutateAsync: vi.fn(),
	}),
}));

const recipe = (steps: Step[], id = "custom-view"): Recipe => ({
	id,
	stepConfigVersion: "step-config-v1",
	name: "Custom view recipe",
	description: "",
	labels: [],
	allowedTriggers: ["manual", "workflow"],
	steps,
});
const snapshot = (kind: "decide" | "approve" | "show"): ViewSnapshot => ({
	id: "dec8de11-7383-403a-915c-443b0ef956ec",
	stepKey: "renamed-call/renamed-human",
	kind,
	title:
		kind === "decide"
			? "Choose next work"
			: kind === "approve"
				? "Approve the artifact"
				: "Recipe summary",
	digest: "a".repeat(64),
	view: resolveView(newStep("show", "summary").view!, {}),
	...(kind === "decide"
		? {
				items: [{ id: "first", title: "Retain this decision", details: [] }],
				actions: [
					{ id: "keep", label: "Keep", comment: true },
					{ id: "skip", label: "Skip" },
				],
			}
		: {}),
	createdAt: "2026-10-22T00:00:00.000Z",
});
const render = (element: ReturnType<typeof createElement>) =>
	renderToStaticMarkup(createElement(MemoryRouter, {}, element));

describe("generic view authoring integration", () => {
	it("creates schema-valid, independently named human and display blocks", () => {
		for (const type of ["decide", "approve", "show"] as const) {
			const step = StepSchema.parse(newStep(type, `arbitrary-${type}`));
			expect(kindOf(step).label).toBeTruthy();
			expect(draftProblems(recipe([step]))).toEqual([]);
			expect(resolveView(step.view!, {}).components).toHaveLength(1);
			expect(
				validateWorkflows([...defaultWorkflows, recipe([step])]).at(-1)!
					.steps[0]!.type,
			).toBe(type);
		}
	});

	it("blocks invalid views and action contracts even when their editor is closed", () => {
		const step = newStep("decide", "pick");
		const malformed = {
			...step,
			view: {
				version: "view-v1",
				components: [
					{
						id: "code",
						type: "code",
						data: {
							literal: { file: "/private/credential", excerpt: "secret" },
						},
					},
				],
			},
		} as Step;
		expect(draftProblems(recipe([malformed])).join(" ")).toMatch(
			/repository-relative/,
		);
		const unknown = {
			...step,
			view: { from: "/runtime/private/evidence" },
		} as Step;
		expect(draftProblems(recipe([unknown])).join(" ")).toMatch(/\/inputs/);
		const repeatedActions = {
			...step,
			decide: {
				...step.decide!,
				actions: [
					{ id: "same", label: "First" },
					{ id: "same", label: "Second" },
				],
			},
		};
		expect(draftProblems(recipe([repeatedActions])).join(" ")).toMatch(
			/unique IDs/,
		);
	});

	it("permits Show in concurrent bodies and prevents hidden blocking decisions through called recipes", () => {
		const loop = newStep("foreach", "each");
		loop.body = [newStep("show", "display")];
		expect(bodyProblem(loop.body)).toBeUndefined();
		expect(draftProblems(recipe([loop]))).toEqual([]);
		for (const type of ["decide", "approve"] as const) {
			expect(bodyProblem([newStep(type, "blocked")])).toMatch(
				/cannot run inside For each/,
			);
			const child = recipe([newStep(type, "decision")], "child");
			loop.body = [newStep("workflow", "nested", child.id)];
			const caller = recipe([loop]);
			expect(draftProblems(caller, [caller, child]).join(" ")).toMatch(
				/including called recipes/,
			);
			expect(() =>
				validateWorkflows([...defaultWorkflows, caller, child]),
			).toThrow(/Human checkpoints/);
		}
	});
});

describe("generic run view integration", () => {
	it("opens the actual generic decision before legacy question controls", () => {
		fixture.run = {
			id: "custom-run",
			title: "Custom run",
			status: "waiting",
			questions: ["Old-shaped question must not replace this view"],
			viewDecision: snapshot("decide"),
		};
		const html = render(
			createElement(FocusCard, {
				summary: fixture.run,
				config: { repositories: [], workflows: [] },
				full: true,
				onInspect: () => {},
				onSettled: () => {},
			}),
		);
		expect(html).toContain("Choose next work");
		expect(html).toContain("Retain this decision");
		expect(html).toContain("Save decisions");
		expect(html).not.toContain(
			"Old-shaped question must not replace this view",
		);
	});

	it("keeps accepted decisions read-only while subsequent recipe work progresses", () => {
		const retained = {
			...snapshot("approve"),
			answer: {
				approved: true,
				feedback: "Exact content accepted",
				fields: {},
			},
		};
		const html = render(
			createElement(GenericHumanDecision, {
				run: { id: "run", status: "running", viewDecision: retained },
			}),
		);
		expect(html).toContain("Approved.");
		expect(html).toContain("This content is read-only.");
		expect(html).not.toContain('type="submit"');
	});

	it("keeps nonblocking Show content visible after completion without creating decision controls", () => {
		const display = snapshot("show");
		display.title = "<script>inert title</script>";
		const original = structuredClone(display);
		const html = render(
			createElement(RunViewDisplays, {
				run: { id: "completed", status: "completed", viewDisplays: [display] },
			}),
		);
		expect(html).toContain("&lt;script&gt;inert title&lt;/script&gt;");
		expect(html).toContain(
			"The recipe continues after displaying this summary.",
		);
		expect(html).not.toContain("Save decisions");
		expect(html).not.toContain('type="submit"');
		expect(display).toEqual(original);
	});
});
