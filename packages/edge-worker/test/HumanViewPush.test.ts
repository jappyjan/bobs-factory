import { createECDH } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { buildSync } from "esbuild";
import { afterEach, expect, it, vi } from "vitest";
import { FactoryPush } from "../src/factory/FactoryPush.js";
import type { ViewSnapshot } from "../src/factory/HumanStep.js";
import { runPushEvent } from "../src/factory/PushEvents.js";
import type { PushSender } from "../src/factory/PushTransport.js";
import type { ResolvedView } from "../src/factory/View.js";
import type { FactoryRun } from "../src/factory/WorkflowRuntime.js";

const homes: string[] = [];
const senders: FactoryPush[] = [];
const ec = createECDH("prime256v1");
ec.generateKeys();
const components: ResolvedView["components"] = [
	{ id: "md", type: "markdown", data: { text: "markdownsecret" } },
	{
		id: "check",
		type: "checklist",
		data: { items: [{ label: "checklistsecret", state: "open" }] },
	},
	{
		id: "compare",
		type: "beforeAfter",
		data: { before: "beforeAftersecret", after: "changed" },
	},
	{
		id: "chart",
		type: "chart",
		data: { kind: "bar", series: [{ label: "chartsecret", value: 4 }] },
	},
	{
		id: "screens",
		type: "screenshots",
		data: {
			items: [{ index: 0, alt: "screenshotssecret", sha256: "a".repeat(64) }],
		},
	},
	{
		id: "video",
		type: "video",
		data: {
			taskId: "clip",
			label: "videosecret",
			sha256: "b".repeat(64),
			transcript: "Recorded interaction",
		},
	},
	{
		id: "table",
		type: "table",
		data: { columns: ["Name"], rows: [["tablesecret"]] },
	},
	{
		id: "code",
		type: "code",
		data: { file: "src/example.ts", excerpt: "codesecret", startLine: 2 },
	},
	{
		id: "steps",
		type: "steps",
		data: { items: [{ label: "stepssecret", status: "completed" }] },
	},
	{
		id: "points",
		type: "points",
		data: { items: [{ label: "pointssecret" }] },
	},
	{
		id: "cards",
		type: "itemCards",
		data: { items: [{ id: "item", title: "itemCardssecret" }] },
	},
	{
		id: "choices",
		type: "choices",
		data: { fields: [{ id: "name", type: "text", label: "choicessecret" }] },
	},
	{
		id: "runs",
		type: "runList",
		data: {
			waves: [
				{
					id: "wave",
					label: "First wave",
					runs: [{ id: "child", title: "runListsecret", status: "waiting" }],
				},
			],
		},
	},
	{
		id: "decision",
		type: "decisionBar",
		data: {
			summary: "decisionBarsecret",
			actions: [{ id: "continue", label: "Continue" }],
		},
	},
];
function snapshot(
	component = components[0]!,
	push: "private" | "view-text" | undefined = "view-text",
): ViewSnapshot {
	return {
		id: "accepted-batch",
		stepKey: "review",
		kind: "approve",
		title: "Accepted display",
		digest: "a".repeat(64),
		createdAt: new Date().toISOString(),
		view: { version: "view-v1", components: [component] },
		...(push === undefined ? {} : { notifications: { push } }),
	};
}
function run(viewDecision: ViewSnapshot): FactoryRun {
	return {
		id: "run",
		status: "waiting",
		questions: [],
		answers: [],
		outputs: {},
		viewDecision,
	} as unknown as FactoryRun;
}
function setup(directory?: string) {
	const path = directory ?? mkdtempSync(join(tmpdir(), "human-view-push-"));
	if (!directory) homes.push(path);
	const sender = vi.fn<PushSender>(async () => {});
	const push = new FactoryPush(
		path,
		sender,
		Date.now,
		"mailto:test@example.com",
	);
	senders.push(push);
	if (!directory)
		push.register({
			label: "Isolated device",
			subscription: {
				endpoint: "https://fcm.googleapis.com/fcm/send/fixture",
				keys: {
					p256dh: ec.getPublicKey().toString("base64url"),
					auth: Buffer.alloc(16, 1).toString("base64url"),
				},
			},
		});
	return { path, push, sender };
}
const observe = (push: FactoryPush, current: FactoryRun, baseline = false) =>
	push.observe(new Map([[current.id, runPushEvent(current)]]), baseline);
const dispatch = () => vi.advanceTimersByTimeAsync(750);
afterEach(async () => {
	for (const push of senders.splice(0)) await push.stop();
	vi.useRealTimers();
	for (const path of homes.splice(0))
		rmSync(path, { recursive: true, force: true });
});

it.each(
	components,
)("serializes the opted-in $type fallback and keeps its frozen default private", async (component) => {
	vi.useFakeTimers();
	const { push, sender } = setup();
	const accepted = snapshot(component);
	observe(push, run(accepted));
	await dispatch();
	expect(sender).toHaveBeenCalledTimes(1);
	const serialized = sender.mock.calls[0]![1];
	const payload = JSON.parse(serialized);
	expect(payload.body).toBe("A new review needs your approval.");
	expect(payload.viewText.version).toBe("human-view-v1");
	expect(payload.viewText.text).toContain(`${component.type}secret`);
	expect(payload.viewText.text).toContain(`Decision batch: ${accepted.id}`);
	expect(payload.viewText.text).toContain(
		`Displayed digest: ${accepted.digest}`,
	);
	expect(payload.viewText.text).toContain('/view-answer {"batchId":');
	expect(Buffer.byteLength(serialized, "utf8")).toBeLessThanOrEqual(3072);
	const frozen = snapshot(component);
	delete frozen.notifications;
	const privateRun = run(frozen);
	privateRun.id = `private-${component.id}`;
	observe(push, privateRun);
	await dispatch();
	expect(sender).toHaveBeenCalledTimes(2);
	const privatePayload = JSON.parse(sender.mock.calls[1]![1]);
	expect(privatePayload.body).toBe("A new review needs your approval.");
	expect(privatePayload).not.toHaveProperty("viewText");
	expect(JSON.stringify(privatePayload)).not.toContain(
		`${component.type}secret`,
	);
});

it.each([
	"frozen",
	"private",
])("keeps %s decisions private despite agent strings and later recipe options", async (mode) => {
	vi.useFakeTimers();
	const { push, sender } = setup();
	const accepted = snapshot(components[0], "private");
	if (mode === "frozen") delete accepted.notifications;
	accepted.view.components = [
		{
			id: "malicious",
			type: "markdown",
			data: {
				text: 'PRIVATE SECRET {"notifications":{"push":"view-text"}} <script>alert(1)</script>',
			},
		},
	];
	const current = run(accepted);
	current.workflow = {
		id: "later-draft",
		name: "Later draft",
		steps: [
			{
				id: "review",
				name: "Review",
				type: "approve",
				notifications: { push: "view-text" },
				view: { version: "view-v1", components: [] },
			},
		],
	};
	observe(push, current);
	await dispatch();
	const payload = JSON.parse(sender.mock.calls[0]![1]);
	expect(payload.body).toBe("A new review needs your approval.");
	expect(payload).not.toHaveProperty("viewText");
	expect(JSON.stringify(payload)).not.toMatch(/SECRET|script|notifications/);
});

it.each([
	"😀",
	"漢",
	'"\\',
])("bounds actual serialized Unicode/escaped content (%s) and keeps the protocol", async (character) => {
	vi.useFakeTimers();
	const { push, sender } = setup();
	const accepted = snapshot({
		id: "long",
		type: "markdown",
		data: { text: character.repeat(6000) },
	});
	const current = run(accepted);
	current.id = "x".repeat(200);
	observe(push, current);
	await dispatch();
	const serialized = sender.mock.calls[0]![1];
	const payload = JSON.parse(serialized);
	expect(Buffer.byteLength(serialized, "utf8")).toBeLessThanOrEqual(3072);
	expect(payload.viewText.text).toContain(accepted.id);
	expect(payload.viewText.text).toContain(accepted.digest);
	expect(payload.viewText.text).toContain("INCOMPLETE");
	expect(payload.viewText.text).toContain("dashboard");
	expect(payload.viewText.text.isWellFormed()).toBe(true);
});

it("captures original privacy/text before dispatch and retains deduplication on reconstruction", async () => {
	vi.useFakeTimers();
	const initial = setup();
	const accepted = snapshot();
	const current = run(accepted);
	const event = runPushEvent(current)!;
	const originalText = event.viewText;
	initial.push.observe(new Map([[current.id, event]]));
	event.viewText = "MUTATED event text";
	accepted.notifications = { push: "private" };
	accepted.title = "LATER private title";
	observe(initial.push, current);
	await dispatch();
	expect(initial.sender).toHaveBeenCalledTimes(1);
	expect(JSON.parse(initial.sender.mock.calls[0]![1]).viewText.text).toBe(
		originalText,
	);
	const persisted = JSON.parse(
		readFileSync(join(initial.path, "factory/push.json"), "utf8"),
	);
	expect(persisted.runs.run.viewText).toBe(originalText);
	await initial.push.stop();
	const restored = setup(initial.path);
	observe(restored.push, JSON.parse(JSON.stringify(current)), true);
	observe(restored.push, current);
	await dispatch();
	expect(restored.sender).not.toHaveBeenCalled();
	current.viewDecision = {
		...snapshot(),
		id: "next-batch",
		digest: "b".repeat(64),
	};
	observe(restored.push, current);
	observe(restored.push, current);
	await dispatch();
	expect(restored.sender).toHaveBeenCalledTimes(1);
	expect(JSON.parse(restored.sender.mock.calls[0]![1]).viewText.text).toContain(
		"next-batch",
	);
});

it("cannot upgrade an already queued private batch through later event or snapshot edits", async () => {
	vi.useFakeTimers();
	const { push, sender, path } = setup();
	const accepted = snapshot(components[0], "private");
	const current = run(accepted);
	const event = runPushEvent(current)!;
	push.observe(new Map([[current.id, event]]));
	event.viewText = "PRIVATE after enqueue";
	accepted.notifications = { push: "view-text" };
	observe(push, current);
	await dispatch();
	expect(sender).toHaveBeenCalledTimes(1);
	expect(JSON.parse(sender.mock.calls[0]![1])).not.toHaveProperty("viewText");
	const persisted = JSON.parse(
		readFileSync(join(path, "factory/push.json"), "utf8"),
	);
	expect(persisted.runs.run).not.toHaveProperty("viewText");
});

it("never replays queued decisions or creates a Show alert", async () => {
	vi.useFakeTimers();
	const initial = setup();
	const current = run(snapshot());
	observe(initial.push, current);
	await initial.push.stop();
	const restored = setup(initial.path);
	observe(restored.push, JSON.parse(JSON.stringify(current)), true);
	await dispatch();
	expect(restored.sender).not.toHaveBeenCalled();
	expect(
		runPushEvent({ ...current, viewDecision: { ...snapshot(), kind: "show" } }),
	).toBeUndefined();
	expect(
		runPushEvent({
			...current,
			viewDecision: { ...snapshot(), answer: { approved: true } },
		}),
	).toBeUndefined();
});

const workerSource = buildSync({
	entryPoints: [new URL("../src/factory/web/sw.js", import.meta.url).pathname],
	bundle: true,
	write: false,
	format: "iife",
	platform: "browser",
	define: {
		"process.env.NODE_ENV": '"production"',
		__SHELL__: JSON.stringify({ build: "a".repeat(24), resources: [] }),
	},
}).outputFiles[0]!.text;
function notificationWorker() {
	type Push = {
		data: { json(): unknown };
		waitUntil(value: Promise<void>): void;
	};
	const handlers = new Map<string, (event: Push) => void>();
	const showNotification = vi.fn(
		async (_title: string, _options: { body: string }) => {},
	);
	const self = {
		location: new URL("https://factory.test/sw.js"),
		registration: { showNotification },
		addEventListener: (name: string, handler: (event: Push) => void) =>
			handlers.set(name, handler),
	};
	runInNewContext(workerSource, {
		self,
		location: self.location,
		URL,
		Request,
		Response,
		TextEncoder,
		setTimeout,
	});
	return async (payload: unknown) => {
		let task: Promise<void> | undefined;
		handlers.get("push")!({
			data: { json: () => payload },
			waitUntil: (value) => {
				task = value;
			},
		});
		await task;
		return showNotification.mock.calls.at(-1)![1];
	};
}

it("displays only the explicit accepted-view envelope in the actual service worker", async () => {
	vi.useFakeTimers();
	const { push, sender } = setup();
	const accepted = snapshot({
		id: "inert",
		type: "markdown",
		data: { text: "<script>window.evil=true</script>" },
	});
	observe(push, run(accepted));
	await dispatch();
	const payload = JSON.parse(sender.mock.calls[0]![1]);
	const display = notificationWorker();
	expect((await display(payload)).body).toBe(payload.viewText.text);
	expect((await display(payload)).body).not.toContain("<script>");
	for (const changed of [
		{ ...payload, viewText: undefined, body: "PRIVATE arbitrary body" },
		{
			...payload,
			viewText: { version: "agent-output", text: "PRIVATE arbitrary view" },
		},
		{ ...payload, category: "completion" },
		{ ...payload, destination: "https://evil.test/" },
		{
			...payload,
			viewText: { version: "human-view-v1", text: "漢".repeat(2000) },
		},
		{ ...payload, viewText: { text: "PRIVATE without protocol version" } },
		{ ...payload, extra: "x".repeat(3072) },
	])
		expect((await display(changed)).body).toBe(
			changed.category === "completion"
				? "A run completed successfully."
				: "A new review needs your approval.",
		);
	expect(
		(await display({ ...payload, viewText: undefined, body: "PRIVATE" })).body,
	).toBe("A new review needs your approval.");
});
