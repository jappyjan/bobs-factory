import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { AskView } from "../src/factory/web/ask-view.js";

vi.mock("../src/factory/web/client.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/factory/web/client.js")>()),
	useAction: () => ({
		isPending: false,
		isBlocked: false,
		mutateAsync: vi.fn(),
	}),
}));

vi.mock("../src/factory/web/pwa.js", async (importOriginal) => {
	const original =
		await importOriginal<typeof import("../src/factory/web/pwa.js")>();
	return { ...original, usePwa: () => original.pwaState() };
});

const run = {
	id: "questions",
	step: "clarify",
	status: "waiting",
	questionBatchId: "current-batch",
	questions: ["Legacy question?"],
	questionRecommendations: [
		{
			questionIndex: 0,
			answer: "Legacy recommendation",
			reason: "Legacy reason",
		},
	],
};

it("renders the declared question choices instead of unrelated run fields", () => {
	const html = renderToStaticMarkup(
		createElement(AskView, {
			run,
			data: {
				questions: ["Current choice?"],
				questionChoices: [
					{
						questionIndex: 0,
						selection: "single",
						options: [
							{ id: "current", answer: "Current option" },
							{ id: "later", answer: "Later option" },
						],
						preselectedOptionIds: ["current"],
					},
				],
			},
		}),
	);
	expect(html).toContain("Current choice?");
	expect(html).toContain("Current option");
	expect(html).toContain("Later option");
	expect(html).not.toContain("Legacy question?");
	expect(html).not.toContain("Legacy recommendation");
});

it("does not restore a run recommendation omitted by the declared question data", () => {
	const html = renderToStaticMarkup(
		createElement(AskView, {
			run,
			data: { questions: ["Current question without a suggestion?"] },
		}),
	);
	expect(html).toContain("Current question without a suggestion?");
	expect(html).toContain("Type your answer…");
	expect(html).not.toContain("Use recommendation");
	expect(html).not.toContain("Legacy recommendation");
});

it("keeps the original run-field input for compatibility callers without data", () => {
	const html = renderToStaticMarkup(createElement(AskView, { run }));
	expect(html).toContain("Legacy question?");
	expect(html).toContain("Use recommendation");
	expect(html).toContain("Legacy recommendation");
	expect(html).toContain("Legacy reason");
});
