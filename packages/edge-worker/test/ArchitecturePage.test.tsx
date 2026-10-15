import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	ArchitectureBrief,
	ArchitecturePage,
} from "../src/factory/web/architecture.js";
import { proposal } from "./fixtures/architecture.js";

const fixture = vi.hoisted(() => ({
	run: undefined as any,
	selectedVersion: undefined as number | undefined,
	stateCalls: 0,
	submitted: [] as any[],
}));

vi.mock("react", async (importOriginal) => {
	const actual = await importOriginal<typeof import("react")>();
	return {
		...actual,
		useEffect: (() => {}) as typeof actual.useEffect,
		useRef: (() => ({ current: null })) as typeof actual.useRef,
		useState: ((initial: unknown) => {
			if (fixture.stateCalls++ === 0)
				return [
					fixture.selectedVersion,
					(next: number | undefined) => {
						fixture.selectedVersion = next;
					},
				];
			return [initial, () => {}];
		}) as typeof actual.useState,
	};
});

vi.mock("@tanstack/react-query", () => ({
	useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
}));

vi.mock("react-router-dom", () => ({
	Link: "a",
	useParams: () => ({ id: "architecture-review" }),
}));

vi.mock("../src/factory/RunAttention.js", () => ({
	active: (status: string) => ["waiting", "running"].includes(status),
}));

vi.mock("../src/factory/web/client.js", () => ({
	useRun: () => ({ data: fixture.run, isLoading: false }),
	useAction: () => ({
		isPending: false,
		mutateAsync: async (request: unknown) => {
			fixture.submitted.push(request);
		},
	}),
}));

vi.mock("../src/factory/web/form-state.js", () => ({
	useFormState: (_context: string, initial: unknown) => [initial, () => {}],
}));

vi.mock("../src/factory/web/ui.js", () => ({
	Button: "button",
	Markdown: "Markdown",
}));

function elements(root: unknown): any[] {
	if (!root || typeof root !== "object") return [];
	if (Array.isArray(root)) return root.flatMap(elements);
	const element = root as { props?: { children?: unknown } };
	return [element, ...elements(element.props?.children)];
}

function elementWithText(tree: unknown, type: unknown, text: string) {
	return elements(tree).find(
		(element) =>
			element.type === type &&
			(Array.isArray(element.props?.children)
				? element.props.children.join("")
				: element.props?.children) === text,
	);
}

function renderPage() {
	fixture.stateCalls = 0;
	return elements(ArchitecturePage());
}

beforeEach(() => {
	fixture.selectedVersion = undefined;
	fixture.stateCalls = 0;
	fixture.submitted = [];
	const first = proposal();
	first.title = "Version one design";
	first.candidate.plan = "Implement plan one";
	const second = structuredClone(first);
	second.title = "Version two design";
	second.candidate.plan = "Implement plan two";
	fixture.run = {
		id: "architecture-review",
		title: "Architecture review",
		status: "waiting",
		architectureGate: { proposalId: "proposal-2" },
		architectureProposals: [
			{
				id: "proposal-1",
				version: 1,
				digest: "digest-1",
				status: "rejected",
				content: first,
				feedback: [],
				at: "2026-10-11T00:00:00Z",
			},
			{
				id: "proposal-2",
				version: 2,
				digest: "digest-2",
				status: "pending",
				content: second,
				feedback: [],
				at: "2026-10-11T00:00:01Z",
			},
		],
	};
});

afterEach(() => {
	vi.clearAllMocks();
});

it("requires the displayed proposal version before accepting it", async () => {
	const latestTree = renderPage();
	const versionOne = elementWithText(latestTree, "button", "v1");
	expect(versionOne).toBeDefined();
	versionOne.props.onClick();

	const historicalTree = renderPage();
	const oldBrief = historicalTree.find(
		(element) => element.type?.name === "ArchitectureBrief",
	);
	expect(oldBrief.props.content.title).toBe("Version one design");
	expect(oldBrief.props.content.candidate.plan).toBe("Implement plan one");
	const historicalApproval = elementWithText(
		historicalTree,
		"button",
		"Approve version 2",
	);
	expect(historicalApproval.props.disabled).toBe(true);

	// The callback guard also protects an already captured or programmatic click.
	await historicalApproval.props.onClick();
	expect(fixture.submitted).toEqual([]);

	const returnToLatest = elementWithText(
		historicalTree,
		"button",
		"Back to version 2",
	);
	returnToLatest.props.onClick();
	const currentTree = renderPage();
	const currentBrief = currentTree.find(
		(element) => element.type?.name === "ArchitectureBrief",
	);
	expect(currentBrief.props.content.title).toBe("Version two design");
	expect(currentBrief.props.content.candidate.plan).toBe("Implement plan two");
	const currentApproval = elementWithText(
		currentTree,
		"button",
		"Approve version 2",
	);
	expect(currentApproval.props.disabled).toBe(false);
	await currentApproval.props.onClick();
	expect(fixture.submitted).toEqual([
		{
			path: "/api/runs/architecture-review/architecture-decision",
			body: {
				proposalId: "proposal-2",
				version: 2,
				digest: "digest-2",
				decision: "accept",
			},
		},
	]);
});

it("exposes review substance and file operations without expanding the implementation plan", () => {
	const content = proposal();
	content.candidate.steps[0]!.traces!.push({
		added: "Retain a restart check to protect accepted work.",
	});
	const html = renderToStaticMarkup(<ArchitectureBrief content={content} />);
	expect(html).toContain("Today");
	expect(html).toContain(content.problem![0]!.observation);
	expect(html).toContain(content.criteria![0]!.text);
	expect(html).toContain(content.candidate.steps[0]!.what);
	expect(html).toContain('class="arch-file-operation">edit');
	expect(html).toContain("Retain a restart check to protect accepted work.");
	expect(html).toContain(content.nonGoals![0]);
	expect(html).toContain(content.acceptance![0]);
	// All reviewer-facing content is outside the optional implementer details.
	expect(html.split('<details class="arch-full-plan">')[0]).toContain(
		"src/factory/WorkflowRuntime.ts",
	);
	const fullPlan = html.indexOf('<details class="arch-full-plan">');
	const endDetails = html.indexOf("</details>", fullPlan);
	expect(html.slice(fullPlan, endDetails)).not.toContain(
		content.criteria![0]!.text,
	);
});
