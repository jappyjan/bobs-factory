import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	ArchitecturePage,
	BobsNotes,
} from "../src/factory/web/architecture.js";
import { CheckIn } from "../src/factory/web/checkin.js";
import {
	checkinTalk,
	feedbackMessage,
	seenVersions,
	sinceLastSeen,
} from "../src/factory/web/checkin-model.js";
import { checkin, proposal } from "./fixtures/architecture.js";

const fixture = vi.hoisted(() => ({
	run: undefined as any,
	selectedVersion: undefined as number | undefined,
	stateCalls: 0,
	draft: "",
	reactions: {} as Record<string, unknown>,
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
	useFormState: (_context: string, initial: unknown) => [
		initial === ""
			? fixture.draft
			: initial && typeof initial === "object" && !Array.isArray(initial)
				? fixture.reactions
				: initial,
		() => {},
	],
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
	fixture.draft = "";
	fixture.reactions = {};
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

const textOf = (element: any): string =>
	element === null || element === undefined || typeof element === "boolean"
		? ""
		: typeof element !== "object"
			? String(element)
			: Array.isArray(element)
				? element.map(textOf).join("")
				: textOf(element.props?.children);
const buttonWith = (tree: any[], text: string) =>
	tree.find((e) =>
		e.type?.name === "Button" || e.type === "button"
			? textOf(e).includes(text)
			: false,
	);

it("keeps earlier versions read-only and says go ahead to the exact latest version", async () => {
	const latestTree = renderPage();
	const versionOne = elementWithText(latestTree, "button", "v1");
	expect(versionOne).toBeDefined();
	versionOne.props.onClick();

	const historicalTree = renderPage();
	const oldCheckIn = historicalTree.find((e) => e.type === CheckIn);
	expect(oldCheckIn.props.content.title).toBe("Version one design");
	expect(oldCheckIn.props.onReact).toBeUndefined();
	expect(buttonWith(historicalTree, "Go ahead")).toBeUndefined();

	elementWithText(
		historicalTree,
		"button",
		"Back to version 2",
	).props.onClick();
	const currentTree = renderPage();
	const current = currentTree.find((e) => e.type === CheckIn);
	expect(current.props.content.title).toBe("Version two design");
	expect(current.props.onReact).toBeDefined();
	const go = buttonWith(currentTree, "Go ahead, build it");
	expect(go.props.disabled).toBe(false);
	await go.props.onClick();
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

it("turns flagged points into one message to Bob and never approves with notes", async () => {
	fixture.reactions = {
		understood: { ok: false, choice: 1, text: "Also cover shared links" },
		size: { ok: true, choice: 0, text: "" },
	};
	fixture.draft = "Thanks!";
	const tree = renderPage();
	expect(buttonWith(tree, "Go ahead")).toBeUndefined();
	const send = buttonWith(tree, "Send 1 note to Bob");
	await send.props.onClick();
	const summary = fixture.run.architectureProposals[1].content.summary;
	expect(fixture.submitted).toEqual([
		{
			path: "/api/runs/architecture-review/architecture-decision",
			body: {
				proposalId: "proposal-2",
				version: 2,
				digest: "digest-2",
				decision: "revise",
				feedback: `About “What I think you want” (“${summary}”):\nAlso cover shared links\n\nThanks!`,
			},
		},
	]);
	fixture.submitted = [];
	fixture.reactions = { understood: { ok: false, choice: 1, text: " " } };
	const blocked = buttonWith(renderPage(), "Send 1 note to Bob");
	expect(blocked.props.disabled).toBe(true);
});

it("tells the check-in in plain words and keeps the reviewer's evidence in Bob's notes", () => {
	const content = checkin();
	content.candidate.steps[0]!.traces!.push({
		added: "Retain a restart check to protect accepted work.",
	});
	const talk = renderToStaticMarkup(<CheckIn content={content} />);
	for (const said of [
		content.talk!.understood,
		content.talk!.plan,
		"Bob checks it with you",
		content.talk!.notice[0]!.what,
		content.talk!.checks[0]!.say,
		content.talk!.checks[0]!.instead,
		content.talk!.size,
		content.nonGoals![0]!,
	])
		expect(talk).toContain(said);
	expect(talk).not.toContain("src/factory/WorkflowRuntime.ts");
	const notes = renderToStaticMarkup(
		<BobsNotes content={content} drafts={3} />,
	);
	expect(notes).toContain("Bob’s reviewer sent this back 3 times");
	expect(notes).toContain(content.criteria![0]!.text);
	expect(notes).toContain('class="ci-op edit">edit');
	expect(notes).toContain("Retain a restart check to protect accepted work.");
	expect(notes).toContain(content.acceptance![0]);
});

it("retells older proposals and counts drafts that never reached the human", () => {
	const older = proposal();
	const talk = checkinTalk(older);
	expect(talk.retold).toBe(true);
	expect(talk.understood).toBe(older.summary);
	expect(talk.checks[0]!.say).toContain("Next to the run checkpoint");
	const p = (version: number, extra = {}) =>
		({
			id: `p${version}`,
			version,
			status: "superseded",
			feedback: [],
			at: `2026-10-20T0${version}:00:00Z`,
			...extra,
		}) as any;
	const proposals = [
		p(1),
		p(2),
		p(3, { shownAt: "x" }),
		p(4),
		p(5),
		p(6, { status: "pending" }),
	];
	// An answer while version 4 was the latest shows the human saw it.
	const { seen, drafts } = seenVersions(proposals, [
		{ at: "2026-10-20T04:30:00Z" },
	]);
	expect(seen.map((x) => x.version)).toEqual([3, 4, 6]);
	expect(drafts).toBe(3);
	// A note handled in a draft the reviewer sent back still reaches the human.
	proposals[3]!.content = {
		changes: [{ text: "Kept usernames only", from: "you" }],
	};
	proposals[4]!.content = {
		changes: [{ text: "Named the restart limit", from: "bob" }],
	};
	proposals[5]!.content = {
		changes: [{ text: "Tidied the plan", from: "bob" }],
	};
	expect(sinceLastSeen(proposals, seen, proposals[5]!)).toEqual({
		version: 4,
		asked: [],
		changed: ["Named the restart limit", "Tidied the plan"],
	});
	expect(
		sinceLastSeen(proposals, [proposals[2]!, proposals[5]!], proposals[5]!),
	).toEqual({
		version: 3,
		asked: ["Kept usernames only"],
		changed: ["Named the restart limit", "Tidied the plan"],
	});
	const open = checkin();
	open.decisions[0]!.status = "open";
	expect(
		feedbackMessage(open, [{ decision: "boundary", option: "pr" }], [], "Go"),
	).toBe("Answers:\nWhere should the approval live? → Reuse PR approval\n\nGo");
});
