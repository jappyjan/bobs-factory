import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { Composer, runAgentOverrides } from "../src/factory/web/launcher.js";

vi.mock("../src/factory/web/client.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/factory/web/client.js")>()),
	useAction: () => ({ isPending: false, isBlocked: false, error: null }),
}));
vi.mock("../src/factory/web/form-state.js", () => ({
	useFormState: (_context: string, initial: unknown) => [
		typeof initial === "function" ? initial() : initial,
		vi.fn(),
	],
	useCurrentForm: () => () => true,
}));
vi.mock("../src/factory/web/launch-uploads.js", () => ({
	AttachButton: () => null,
	AttachmentChips: () => null,
	uploadLimitsHint: "",
	useLaunchUploads: () => ({ selection: {}, blocked: false }),
}));
vi.mock("../src/factory/web/execution.js", () => ({
	ExecutionSelectors: () => null,
}));
vi.mock("../src/factory/web/ui.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/factory/web/ui.js")>()),
	Button: () => null,
	Modal: ({ children }: { children: unknown }) => children,
	useToast: () => vi.fn(),
}));

const workflow = (id: string) => ({
	id,
	name: id,
	allowedTriggers: ["manual"],
	launchFields: [],
});
const render = (defaultWorkflow: string) =>
	renderToStaticMarkup(
		createElement(
			MemoryRouter,
			null,
			createElement(Composer, {
				onStarted: () => undefined,
				config: {
					repositories: [{ id: "repo", name: "Repo", repositoryIds: ["repo"] }],
					workflows: [workflow("simple"), workflow("factory")],
					defaultWorkflow,
					defaultRunner: "claude",
					reasoningLevels: { claude: ["low", "high"] },
				},
			}),
		),
	);

it("shows the agent and reasoning choice only for Simple", () => {
	const simple = render("simple");
	expect(simple).toContain('aria-label="Agent"');
	expect(simple).toContain('aria-label="Reasoning"');
	expect(simple).toContain("agent-settings");
	const other = render("factory");
	expect(other).not.toContain('aria-label="Agent"');
	expect(other).not.toContain('aria-label="Reasoning"');
	expect(other).not.toContain("agent-settings");
});

it("sends model and reasoning overrides only for Simple", () => {
	const chosen = { runner: "codex", model: "gpt", reasoningEffort: "high" };
	expect(runAgentOverrides("simple", chosen)).toEqual(chosen);
	expect(runAgentOverrides("factory", chosen)).toEqual({});
});
