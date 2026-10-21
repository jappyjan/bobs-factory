import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, expect, it, vi } from "vitest";
import { TodayApp } from "./app.js";
import { FactoryClient } from "./client.js";
import { AnswerForm, LaunchForm } from "./forms.js";
import { tuiPort } from "./index.js";
import {
	conversation,
	launchableWorkflows,
	type RunItem,
	stepStrip,
	today,
	toolSummary,
} from "./model.js";
import {
	KeyParser,
	parseKeys,
	Screen,
	sanitize,
	TextInput,
	width,
	wrap,
} from "./terminal.js";
import { ansi256, tokens } from "./theme.js";

const servers: Server[] = [];
afterEach(() => {
	vi.restoreAllMocks();
	for (const server of servers.splice(0)) server.close();
});

const at = (minutes: number) =>
	new Date(Date.now() - minutes * 60000).toISOString();
const run = (
	id: string,
	status: string,
	extra: Partial<RunItem> = {},
): RunItem => ({
	id,
	title: id,
	status,
	createdAt: at(10),
	updatedAt: at(1),
	...extra,
});

it("groups Today like the dashboard: questions, stuck, reviews first; settled out", () => {
	// Equal-age fixtures must have equal timestamps for stable tie ordering.
	vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-14T12:00:00Z"));
	const runs = [
		run("working", "running"),
		run("review", "waiting", { reviewGate: { status: "pending" } }),
		run("stuck", "failed"),
		run("question", "waiting"),
		run("settled", "completed", { viewState: { settledAt: at(1) } }),
		run("stopped", "stopped"),
		run("brought-back", "stopped", { viewState: { keptOpen: true } }),
	];
	const { needsYou, working, settled } = today(runs);
	expect(needsYou.map((r) => r.id)).toEqual([
		"question",
		"stuck",
		"brought-back",
		"review",
	]);
	expect(working.map((r) => r.id)).toEqual(["working"]);
	expect(settled.map((r) => r.id).sort()).toEqual(["settled", "stopped"]);
});

it("builds a conversation with step markers, tool results and chat messages", () => {
	const lines = conversation(
		{
			entries: [
				{
					type: "user",
					content: "Build it",
					metadata: { timestamp: at(9) },
					activityStep: "plan",
				},
				{
					type: "assistant",
					content: "",
					metadata: {
						timestamp: at(8),
						toolUseId: "1",
						toolName: "Bash",
						toolInput: { command: "pnpm  test" },
					},
					activityStep: "plan",
				},
				{
					type: "user",
					content: "boom",
					metadata: { timestamp: at(7), toolUseId: "1", toolResultError: true },
					activityStep: "plan",
				},
				{
					type: "assistant",
					content: "Done.",
					metadata: { timestamp: at(6) },
					activityStep: "implement",
				},
				{
					type: "result",
					content: "Done.",
					metadata: { timestamp: at(5) },
					activityStep: "implement",
				},
			],
			events: [
				{
					at: at(4),
					step: "implement",
					message: "Finished Implement",
					source: "workflow",
				},
			],
		},
		[
			{ text: "Build it", at: at(9) },
			{ text: "Also add docs", at: at(3), step: "implement" },
		],
	);
	expect(
		lines.map((line) =>
			[line.kind, line.text, line.detail, line.status].filter(Boolean),
		),
	).toEqual([
		["step", "plan"],
		["you", "Build it"],
		["tool", "Bash", "pnpm test", "error"],
		["step", "implement"],
		["response", "Done."],
		["system", "Finished Implement"],
		["you", "Also add docs"],
	]);
	expect(toolSummary("mcp__linear__get_issue", { query: "BOB-1" })).toEqual({
		label: "linear · get_issue",
		detail: "BOB-1",
	});
});

it("marks visited, current and failed steps in the strip", () => {
	expect(
		stepStrip({
			...run("r", "failed", { step: "implement" }),
			workflow: {
				id: "w",
				name: "W",
				steps: [
					{ id: "plan", name: "Plan" },
					{ id: "implement" },
					{ id: "verify" },
				],
			},
			history: [{ step: "plan", at: at(5) }],
		}),
	).toEqual([
		{ name: "Plan", state: "done" },
		{ name: "implement", state: "failed" },
		{ name: "verify", state: "pending" },
	]);
});

it("parses keys, pastes and multi-byte text", () => {
	expect(parseKeys("\x1b[A\x1b[Bab\r\x7f\x1b")).toEqual([
		{ name: "up" },
		{ name: "down" },
		{ name: "text", text: "ab" },
		{ name: "enter" },
		{ name: "backspace" },
		{ name: "escape" },
	]);
	expect(parseKeys("\x1b[200~line 1\r\nline 2\x1b[201~")).toEqual([
		{ name: "paste", text: "line 1\nline 2" },
	]);
	expect(parseKeys("\x03\x1d😀")).toEqual([
		{ name: "ctrl-c" },
		{ name: "ctrl-]" },
		{ name: "text", text: "😀" },
	]);
});

it("holds fragmented terminal keys and pastes without interpreting pasted newlines as submission", () => {
	const parser = new KeyParser();
	expect(parser.push("\x1b[")).toEqual([]);
	expect(parser.push("A")).toEqual([{ name: "up" }]);
	expect(parser.push("\x1b[20")).toEqual([]);
	expect(parser.push("0~fix\r\n")).toEqual([]);
	expect(parser.push("the bug\x1b[201")).toEqual([]);
	expect(parser.push("~\r")).toEqual([
		{ name: "paste", text: "fix\nthe bug" },
		{ name: "enter" },
	]);
	expect(parser.push("\x1b")).toEqual([]);
	expect(parser.flushEscape()).toEqual([{ name: "escape" }]);
});

it("uses the saved recipe default and keeps the focused launch field visible at 60×16", () => {
	const form = new LaunchForm({
		repositories: [{ id: "r", name: "Repo" }],
		defaultWorkflow: "chosen",
		workflows: [
			{ id: "other", name: "Other", allowedTriggers: ["manual"] },
			{
				id: "chosen",
				name: "Chosen",
				allowedTriggers: ["manual"],
				launchFields: [
					{ name: "prompt", label: "Task", type: "textarea", required: true },
				],
			},
		],
	});
	form.key({ name: "text", text: "Fix it" });
	form.key({ name: "tab" });
	form.key({ name: "tab" });
	form.key({ name: "text", text: "my-model" });
	const screen = new Screen(60, 16, tokens("dark").base);
	form.render(screen, tokens("dark"));
	expect(screen.cursor).toBeDefined();
	expect(screen.cursor!.y).toBeLessThan(13);
	expect(screen.cells.join("")).toContain("my-model");
	expect(form.request().body).toMatchObject({
		workflow: "chosen",
		inputs: { prompt: "Fix it" },
		model: "my-model",
	});
});

it("keeps a long focused question and its answer inside a short terminal", () => {
	const form = new AnswerForm({
		...run("questions", "waiting"),
		questions: ["word ".repeat(200), "Second question"],
		questionRecommendations: [{ questionIndex: 0, answer: "Yes" }],
	});
	form.key({ name: "text", text: "My answer" });
	const screen = new Screen(60, 16, tokens("light").base);
	form.render(screen, tokens("light"));
	expect(screen.cursor!.y).toBeLessThan(13);
	expect(screen.cells.join("")).toContain("My answer");
	form.key({ name: "tab" });
	form.key({ name: "text", text: "Second answer" });
	const next = new Screen(60, 16, tokens("light").base);
	form.render(next, tokens("light"));
	expect(next.cells.join("")).toContain("Second answer");
	expect(next.cursor!.y).toBeLessThan(13);
});

it("strips terminal control sequences from untrusted text and measures wide glyphs", () => {
	expect(sanitize("ok\x1b]52;c;cHduZWQ=\x07 \x1b[2Jdone\x07")).toBe("ok done");
	expect(width("日本😀a")).toBe(7);
	expect(wrap("one two three", 7)).toEqual(["one two", "three"]);
	const screen = new Screen(4, 1, {});
	screen.put(0, 0, "a日b");
	expect(screen.cells).toEqual(["a", "日", "", "b"]);
	screen.put(1, 0, "x");
	expect(screen.cells).toEqual(["a", "x", " ", "b"]);
});

it("edits single- and multi-line input", () => {
	const input = new TextInput("", true);
	for (const key of parseKeys("hello world")) input.handle(key);
	input.handle({ name: "ctrl-w" });
	input.handle({ name: "alt-enter" });
	input.handle({ name: "paste", text: "x\ty" });
	expect(input.value).toBe("hello \nx  y");
	const single = new TextInput();
	single.handle({ name: "paste", text: "a\nb" });
	expect(single.value).toBe("a b");
	expect(single.layout(10).cursor).toEqual({ row: 0, col: 3 });
});

it("maps the palette to xterm-256 for terminals without truecolor", () => {
	expect(ansi256("#000000")).toBe(16);
	expect(ansi256("#ffffff")).toBe(231);
	expect(ansi256("#7b61ff")).toBe(99);
});

it("resolves the dashboard port and rejects a disabled dashboard", () => {
	expect(tuiPort(undefined, {})).toBe(3457);
	expect(tuiPort(undefined, { BOBS_FACTORY_FACTORY_PORT: "4000" })).toBe(4000);
	expect(tuiPort("5000", { BOBS_FACTORY_FACTORY_PORT: "4000" })).toBe(5000);
	expect(() => tuiPort(undefined, { BOBS_FACTORY_FACTORY_PORT: "0" })).toThrow(
		"disabled",
	);
});

it("requests a new terminal session once when the server forgets it, and sends write headers", async () => {
	const seen: Record<string, string | undefined>[] = [];
	const server = createServer((request, response) => {
		seen.push({
			host: request.headers.host,
			auth: request.headers.authorization,
			origin: request.headers.origin,
			action: request.headers["x-factory-request"] as string | undefined,
		});
		const ok = request.headers.authorization === "Bearer second";
		response.writeHead(ok ? 200 : 401, { "Content-Type": "application/json" });
		response.end(JSON.stringify(ok ? { ok: true } : { error: "Sign in" }));
	});
	servers.push(server);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = (server.address() as AddressInfo).port;
	const tokens = ["first", "second", "third"];
	const client = new FactoryClient({
		port,
		home: "/home",
		requestSession: () => tokens.shift()!,
	});
	await expect(client.post("/api/runs/x/stop")).resolves.toEqual({ ok: true });
	expect(seen).toEqual([
		{
			host: `localhost:${port}`,
			auth: "Bearer first",
			origin: `http://localhost:${port}`,
			action: "1",
		},
		{
			host: `localhost:${port}`,
			auth: "Bearer second",
			origin: `http://localhost:${port}`,
			action: "1",
		},
	]);
	await expect(client.get("/api/runs")).resolves.toEqual({ ok: true });
	expect(seen[2]!.origin).toBeUndefined();
	tokens.push("fourth");
	server.removeAllListeners("request");
	server.on("request", (_request, response) => {
		response.writeHead(401);
		response.end("{}");
	});
	await expect(client.get("/api/runs")).rejects.toThrow("same home (/home)");
});

it("selects terminal choices explicitly, preserves mode drafts and submits in option order", () => {
	const form = new AnswerForm({
		...run("choices", "waiting"),
		questions: ["Platforms?", "Strategy?"],
		questionChoices: [
			{
				questionIndex: 0,
				selection: "multiple",
				options: [
					{ id: "a", answer: "Alpha" },
					{ id: "b", answer: "Beta" },
				],
			},
			{
				questionIndex: 1,
				selection: "single",
				options: [
					{ id: "one", answer: "Explain via examples" },
					{ id: "two", answer: "Use text" },
				],
				preselectedOptionIds: ["one"],
			},
		],
	});
	expect(form.request().body).toBeUndefined();
	form.key({ name: "down" });
	form.key({ name: "text", text: " " });
	form.key({ name: "up" });
	form.key({ name: "text", text: " " });
	expect(form.answers()).toEqual(["- Alpha\n- Beta", "Explain via examples"]);
	expect(form.key({ name: "text", text: "unhandled" })).toBeUndefined();
	form.key({ name: "down" });
	form.key({ name: "down" });
	form.key({ name: "text", text: " " });
	expect(form.request().body).toBeUndefined();
	form.key({ name: "text", text: "Custom platform" });
	expect(form.answers()[0]).toBe("Custom platform");
	const screen = new Screen(60, 16, tokens("light").base);
	form.render(screen, tokens("light"));
	expect(screen.cells.join("")).toContain("Custom platform");
	expect(screen.cursor!.y).toBeLessThan(13);
	form.key({ name: "ctrl-space" });
	expect(form.answers()[0]).toBe("- Alpha\n- Beta");
	form.key({ name: "tab" });
	form.key({ name: "down" });
	form.key({ name: "text", text: " " });
	expect(form.answers()[1]).toBe("Use text");
	expect(form.request().body?.kind).toBe("answer");
	expect(form.key({ name: "ctrl-s" })).toBe("submit");
});

it("scrolls to late options in a short terminal and sanitizes their labels", () => {
	const options = Array.from({ length: 20 }, (_, i) => ({
		id: String(i),
		answer:
			`Option ${i + 1} with a long readable label` +
			(i === 19 ? "\x1b[2J" : ""),
	}));
	const form = new AnswerForm({
		...run("long-choices", "waiting"),
		questions: ["Choose a platform"],
		questionChoices: [{ questionIndex: 0, selection: "single", options }],
	});
	for (let i = 0; i < 19; i++) form.key({ name: "down" });
	const screen = new Screen(60, 12, tokens("light").base);
	form.render(screen, tokens("light"));
	expect(screen.cells.join("")).toContain("Option 20");
	expect(screen.cells.join("")).toContain("ctrl-s send");
	expect(screen.cells.join("")).not.toContain("\x1b");
	form.key({ name: "text", text: " " });
	expect(form.answers()[0]).toContain("Option 20");
});

it("shows multiline and wrapped question context above terminal choices", () => {
	const question =
		"Should we run real-agent tests?\nThey use provider credits and the cost is unknown. " +
		"The remaining tests confirm agents resume after your reply and generate suitable suggestions.";
	const form = new AnswerForm({
		...run("question-context", "waiting"),
		questions: [question],
		questionChoices: [
			{
				questionIndex: 0,
				selection: "single",
				options: [
					{ id: "run", answer: "Run real-agent tests" },
					{ id: "wait", answer: "Wait" },
				],
			},
		],
	});
	const screen = new Screen(100, 30, tokens("light").base);
	form.render(screen, tokens("light"));
	const text = screen.cells.join("");
	for (const line of wrap(question, 90)) expect(text).toContain(line);
	expect(text).toContain("Run real-agent tests");
	expect(text).toContain("Custom answer");
	expect(text).toContain("ctrl-s send");
});

it("lets every long question line be read without changing answer drafts", () => {
	const lines = Array.from({ length: 35 }, (_, i) => `Context line ${i + 1}.`);
	const form = new AnswerForm({
		...run("scroll-question", "waiting"),
		questions: [lines.join("\n"), "Second question"],
		questionChoices: [0, 1].map((questionIndex) => ({
			questionIndex,
			selection: "single" as const,
			options: [
				{ id: "yes", answer: "Proceed" },
				{ id: "no", answer: "Wait" },
			],
			preselectedOptionIds: ["yes"],
		})),
	});
	const seen = new Set<string>();
	const render = (w = 60, h = 16) => {
		const screen = new Screen(w, h, tokens("light").base);
		form.render(screen, tokens("light"));
		return screen.cells.join("");
	};
	for (let page = 0; page < lines.length; page++) {
		const text = render();
		for (const line of lines) if (text.includes(line)) seen.add(line);
		expect(text).toContain("PgUp/PgDn scroll");
		expect(text).toContain("ctrl-s send");
		form.key({ name: "pagedown" });
	}
	expect([...seen]).toEqual(lines);
	expect(form.answers()).toEqual(["Proceed", "Proceed"]);
	// Scroll controls still work while editing custom text and after a resize.
	form.key({ name: "down" });
	form.key({ name: "down" });
	form.key({ name: "text", text: " " });
	form.key({ name: "text", text: "Custom response" });
	expect(render(80, 24)).toContain("Context line 35.");
	for (let page = 0; page < lines.length; page++) {
		form.key({ name: "pageup" });
		render();
	}
	expect(render()).toContain("Context line 1.");
	expect(form.answers()).toEqual(["Custom response", "Proceed"]);
	form.key({ name: "tab" });
	expect(render()).toContain("Second question");
	form.key({ name: "shift-tab" });
	expect(render()).toContain("Context line 1.");
});

it("offers only enabled manual workflows with available dependencies", () => {
	expect(
		launchableWorkflows({
			repositories: [],
			defaultWorkflow: "factory",
			workflows: [
				{ id: "factory", name: "Factory", enabled: false },
				{ id: "takeover", name: "Takeover", unavailable: ["factory-pipeline"] },
				{ id: "internal", name: "Internal", allowedTriggers: ["workflow"] },
				{ id: "local", name: "Local", allowedTriggers: ["manual"] },
			],
		}).map((w) => w.id),
	).toEqual(["local"]);
});

it("shows the blocked reason and resumes only eligible runs from the terminal", async () => {
	const blocked = run("blocked", "blocked", {
		workflowBlock: {
			reason: "Workflow disabled: simple. Saved progress retained.",
		},
	});
	let eligible = false;
	let frame = "";
	let changed: (change: { ids: string[]; config: boolean }) => void;
	const post = vi.fn(async () => ({}));
	const client = {
		origin: "http://localhost:3457",
		get: vi.fn(async (path: string) => {
			if (path === "/api/config?view=dashboard")
				return { repositories: [], workflows: [] };
			if (path === "/api/runs") return [blocked];
			return { ...blocked, resumeEligible: eligible };
		}),
		post,
		events: (callback: typeof changed) => {
			changed = callback;
			return () => {};
		},
	} as unknown as FactoryClient;
	const app = new TodayApp({
		client,
		theme: "dark",
		sgr: () => "",
		write: (value) => {
			frame = value;
		},
		size: () => ({ columns: 120, rows: 32 }),
		openUrl: async () => {},
		quit: () => {},
	});
	app.start();
	try {
		await vi.waitFor(() => expect(frame).toContain("Resume unavailable"));
		expect(frame).toContain(blocked.workflowBlock!.reason);
		expect(frame).not.toContain("c retry step");
		app.key({ name: "text", text: "c" });
		expect(post).not.toHaveBeenCalled();
		eligible = true;
		changed!({ ids: [], config: true });
		await vi.waitFor(() => expect(frame).toContain("c resume"));
		app.key({ name: "text", text: "c" });
		await vi.waitFor(() =>
			expect(post).toHaveBeenCalledExactlyOnceWith("/api/runs/blocked/resume"),
		);
	} finally {
		app.stop();
	}
});

it("rechecks a waiting role with its exact question context instead of submitting an answer", async () => {
	const waiting = run("waiting", "waiting", { step: "pipeline/code-fix" });
	const context = {
		step: waiting.step,
		questionBatchId: "current-batch",
		questions: ["Restore access"],
	};
	const post = vi.fn(async () => ({}));
	let frame = "";
	const client = {
		origin: "http://localhost:3457",
		get: vi.fn(async (path: string) => {
			if (path === "/api/config?view=dashboard")
				return { repositories: [], workflows: [] };
			if (path === "/api/runs") return [waiting];
			return { ...waiting, ...context, recheckAvailable: true };
		}),
		post,
		events: () => () => {},
	} as unknown as FactoryClient;
	const app = new TodayApp({
		client,
		theme: "dark",
		sgr: () => "",
		write: (value) => {
			frame = value;
		},
		size: () => ({ columns: 120, rows: 32 }),
		openUrl: async () => {},
		quit: () => {},
	});
	app.start();
	try {
		await vi.waitFor(() => expect(frame).toContain("c check again"));
		app.key({ name: "text", text: "c" });
		await vi.waitFor(() =>
			expect(post).toHaveBeenCalledExactlyOnceWith(
				"/api/runs/waiting/recheck",
				{ context },
			),
		);
	} finally {
		app.stop();
	}
});

it("shares terminal startup reads and coalesces changes while a run-list read is slow", async () => {
	vi.useFakeTimers();
	const item = run("question", "waiting");
	let reads = 0,
		active = 0,
		peak = 0;
	let release: (() => void) | undefined;
	let frame = "",
		queued = 2;
	let changed: (change: {
		ids: string[];
		config: boolean;
		capacity?: boolean;
	}) => void = () => {};
	const get = vi.fn(async (path: string) => {
		if (path === "/api/config?view=dashboard")
			return { repositories: [], workflows: [] };
		if (path === "/api/capacity")
			return { capacity: { limit: 4, active: 1, queued } };
		if (path === "/api/runs") {
			reads++;
			active++;
			peak = Math.max(peak, active);
			if (reads === 1 || reads === 3)
				await new Promise<void>((resolve) => {
					release = resolve;
				});
			active--;
			return [item];
		}
		return { ...item, questions: ["Continue?"] };
	});
	const client = {
		origin: "http://localhost:3457",
		get,
		events: (callback: typeof changed, live: (connected: boolean) => void) => {
			changed = callback;
			live(true);
			return () => {};
		},
	} as unknown as FactoryClient;
	const app = new TodayApp({
		client,
		theme: "dark",
		sgr: () => "",
		write: (value) => {
			frame = value;
		},
		size: () => ({ columns: 100, rows: 30 }),
		openUrl: async () => {},
		quit: () => {},
	});
	try {
		app.start();
		await vi.advanceTimersByTimeAsync(0);
		expect(reads).toBe(1);
		expect(
			get.mock.calls.filter(([path]) => path.startsWith("/api/config")),
		).toHaveLength(1);
		// One event during the initial independent read still gets a fresh result.
		changed({ ids: [item.id], config: false });
		await vi.advanceTimersByTimeAsync(151);
		expect(reads).toBe(1);
		release!();
		await vi.advanceTimersByTimeAsync(0);
		expect(reads).toBe(2);
		expect(frame).toContain("1/4 +2 queued");
		changed({ ids: [item.id], config: false });
		await vi.advanceTimersByTimeAsync(151);
		expect(reads).toBe(3);
		changed({ ids: [item.id], config: false });
		changed({ ids: [item.id], config: false });
		await vi.advanceTimersByTimeAsync(500);
		expect(reads).toBe(3);
		release!();
		await vi.advanceTimersByTimeAsync(151);
		expect(reads).toBe(4);
		expect(peak).toBe(1);
		queued = 3;
		changed({ ids: [], config: false, capacity: true });
		await vi.advanceTimersByTimeAsync(151);
		expect(frame).toContain("1/4 +3 queued");
		expect(reads).toBe(4);
		expect(
			get.mock.calls.filter(([path]) => path.startsWith("/api/config")),
		).toHaveLength(1);
	} finally {
		release?.();
		app.stop();
		vi.useRealTimers();
	}
});
