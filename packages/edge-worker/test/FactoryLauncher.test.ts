import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { Composer } from "../src/factory/web/launcher.js";

const state = vi.hoisted(() => ({
	values: [] as unknown[],
	index: 0,
	mutate: vi.fn(async (_request: any) => ({ id: "run" })),
	preview: vi.fn(),
}));
vi.mock("../src/factory/web/form-state.js", () => ({
	useFormState: (_context: string, initial: unknown) => [
		state.values[state.index++] ?? initial,
		vi.fn(),
	],
	useCurrentForm: () => () => true,
}));
vi.mock("../src/factory/web/client.js", () => ({
	useAction: () => ({ mutateAsync: state.mutate }),
}));
vi.mock("react-router-dom", async (original) => ({
	...(await original<typeof import("react-router-dom")>()),
	useNavigate: () => vi.fn(),
}));
vi.mock("../src/factory/web/ui.js", () => ({
	useToast: () => vi.fn(),
	Modal: ({ open, children, description }: any) =>
		open ? createElement("dialog", null, description, children) : null,
	Button: ({ children }: any) =>
		createElement("button", { type: "button" }, children),
}));
vi.mock("../src/factory/web/execution.js", () => ({
	ExecutionSelectors: (props: any) => {
		state.preview(props);
		return createElement("div", null, "Identity profile", "Tool profile");
	},
}));
vi.mock("../src/factory/web/launch-uploads.js", () => ({
	useLaunchUploads: () => ({
		selection: {},
		carryOver: vi.fn(),
		reset: vi.fn(),
	}),
	AttachButton: () => null,
	AttachmentChips: () => null,
}));
const overrides = {
	runner: "codex",
	model: "test-model",
	reasoningEffort: "high",
	modelVariant: "custom",
	serviceTier: "fast",
};
const config = {
	repositories: [{ id: "repo", name: "Repo", repositoryIds: ["repo"] }],
	defaultWorkflow: "simple",
	defaultRunner: "codex",
	reasoningLevels: { codex: ["low", "high"] },
	serviceTierRunners: ["codex", "claude"],
	workflows: ["simple", "factory", "takeover", "custom"].map((id) => ({
		id,
		name: id === "custom" ? "Simple" : id,
		allowedTriggers: ["manual"],
		launchFields: [{ name: "prompt", type: "textarea", required: true }],
	})),
};
function find(
	node: ReactNode,
	predicate: (element: ReactElement<any>) => boolean,
): ReactElement<any> | undefined {
	if (!node || typeof node !== "object") return;
	if (Array.isArray(node))
		return node.map((child) => find(child, predicate)).find(Boolean);
	const element = node as ReactElement<any>;
	return predicate(element)
		? element
		: find(element.props?.children, predicate);
}
function composer(
	workflow: string,
	options: { settings?: object; execution?: object; config?: any } = {},
) {
	state.index = 0;
	state.values = [
		workflow,
		"repo",
		{ prompt: "Task" },
		options.settings ?? overrides,
		options.execution ?? {},
		true,
		false,
	];
	const tree = Composer({
		config: options.config ?? config,
		onStarted: vi.fn(),
	});
	const html = renderToStaticMarkup(createElement(MemoryRouter, null, tree));
	return { tree, html };
}
beforeEach(() => vi.clearAllMocks());
it.each([
	"factory",
	"takeover",
	"custom",
	"unknown",
])("hides agent controls and ignores all retained settings for %s", async (workflow) => {
	const { tree, html } = composer(workflow);
	expect(html).not.toMatch(/aria-label="(?:Agent|Reasoning)"/);
	expect(html).not.toMatch(
		/<label>(?:Agent|Model|Reasoning|Model variant|Service tier)[< ]/,
	);
	expect(html).toContain(
		"Configure agents, models and reasoning for each workflow step in Recipes.",
	);
	expect(html).toContain("Identity profile");
	expect(html).not.toContain("launcher-divider");
	expect(
		find(tree, (el) => el.props["aria-label"] === "Run settings")!.props[
			"data-active"
		],
	).toBeUndefined();
	expect(state.preview.mock.lastCall![0]).toMatchObject({
		runner: undefined,
		model: undefined,
	});
	await find(tree, (el) => el.type === "form")!.props.onSubmit({
		preventDefault() {},
	});
	// The handler intentionally launches asynchronously.
	await Promise.resolve();
	if (workflow === "unknown") expect(state.mutate).not.toHaveBeenCalled();
	else
		expect(state.mutate).toHaveBeenCalledWith({
			path: "/api/runs",
			body: {
				repositoryId: "repo",
				repositoryIds: ["repo"],
				workflow,
				inputs: { prompt: "Task" },
				attachments: {},
				attachmentDraft: undefined,
				execution: {},
			},
		});
});
it.each([
	{ enabled: false },
	{ unavailable: ["missing tool"] },
	{ allowedTriggers: ["workflow"] },
])("hides controls for an unlaunchable Simple selection: %j", (restriction) => {
	const restricted = {
		...config,
		workflows: config.workflows.map((w) =>
			w.id === "simple" ? { ...w, ...restriction } : w,
		),
	};
	const { html } = composer("simple", { config: restricted });
	expect(html).not.toMatch(/aria-label="(?:Agent|Reasoning)"/);
	expect(state.preview.mock.lastCall![0]).toMatchObject({
		runner: undefined,
		model: undefined,
	});
});
it("preserves Simple controls, overrides and preview selection", async () => {
	const settings = {
		runner: "codex",
		model: "test-model",
		reasoningEffort: "high",
		serviceTier: "fast",
	};
	const { tree, html } = composer("simple", { settings });
	expect(html).toContain('aria-label="Agent"');
	expect(html).toContain('aria-label="Reasoning"');
	expect(html).toContain("Model");
	expect(html).toContain("Service tier");
	expect(
		find(tree, (el) => el.props["aria-label"] === "Run settings")!.props[
			"data-active"
		],
	).toBe(true);
	expect(state.preview.mock.lastCall![0]).toMatchObject({
		runner: "codex",
		model: "test-model",
	});
	await find(tree, (el) => el.type === "form")!.props.onSubmit({
		preventDefault() {},
	});
	await Promise.resolve();
	expect(state.mutate.mock.lastCall![0].body).toMatchObject(settings);
});
it("keeps the customization indicator for independent execution profiles", () => {
	const { tree } = composer("factory", { execution: { toolProfile: "tools" } });
	expect(
		find(tree, (el) => el.props["aria-label"] === "Run settings")!.props[
			"data-active"
		],
	).toBe(true);
});

it("preserves Simple OpenCode model variants", async () => {
	const settings = {
		runner: "opencode",
		model: "fixture/model",
		modelVariant: "custom-review",
	};
	const { tree, html } = composer("simple", { settings });
	expect(html).toContain("Model variant");
	expect(html).not.toContain("Service tier");
	await find(tree, (el) => el.type === "form")!.props.onSubmit({
		preventDefault() {},
	});
	await Promise.resolve();
	expect(state.mutate.mock.lastCall![0].body).toMatchObject(settings);
});
