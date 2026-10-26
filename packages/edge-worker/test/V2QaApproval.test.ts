import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { runEvidenceChecks } from "../src/factory/EvidenceChecks.js";
import { freshNodeOutput } from "../src/factory/NodeGuarantees.js";
import { parseStepOutputAsync } from "../src/factory/OutputFormats.js";
import { acceptedMedia } from "../src/factory/VerifiedMedia.js";
import { prepareViewAssetCheck } from "../src/factory/ViewAssets.js";
import { validateWorkflows } from "../src/factory/Workflow.js";
import {
	type ExecutionContext,
	type FactoryRun,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import { DisplayDocumentView } from "../src/factory/web/display.js";
import { FactoryServer } from "./fixtures/authenticated-factory.js";

const mocks = vi.hoisted(() => ({ provider: vi.fn() }));
vi.mock("../src/factory/GitProvider.js", async (original) => ({
	...(await original<object>()),
	resolveGitProvider: mocks.provider,
}));
const resources: {
	home: string;
	runtime: WorkflowRuntime;
	server: FactoryServer;
}[] = [];
afterEach(async () => {
	for (const resource of resources.splice(0)) {
		await resource.server.stop();
		await resource.runtime.shutdown();
		rmSync(resource.home, { recursive: true, force: true });
	}
});
const component = (id: string, type: string, data: unknown) => ({
	id,
	type,
	...(id === "details" ? { title: "Dig deeper" } : {}),
	data: { literal: data },
});
const guideDocument = {
	version: "view-v1",
	components: [
		component("intro", "markdown", {
			text: "## I made your saved settings clearer\nYour choice now stays visible after you save. Here is what changed and how I checked it.",
		}),
		component("change", "beforeAfter", {
			before: "Saving hid your selected preference.",
			after:
				"Your selected preference stays visible, with a clear Saved confirmation.",
		}),
		component("proof", "checklist", {
			items: [
				{
					label: "Your selection survives reload",
					state: "done",
					detail: "Saved dark mode, reloaded, and saw dark mode selected.",
				},
				{
					label: "An unavailable server gives a helpful retry",
					state: "done",
					detail: "Disconnected the fixture server and retried successfully.",
				},
			],
		}),
		component("judgment", "itemCards", {
			items: [
				{
					id: "wording",
					title: "Does the confirmation sound right?",
					body: "I used Saved. We could say Your preference is saved for more detail.",
				},
			],
			comment: true,
			required: false,
		}),
		component("details", "section", {
			collapsed: true,
			components: [
				component("tour", "codeTour", {
					comment: true,
					files: [
						{
							id: "settings",
							path: "screen.ts",
							hunks: ["@@ -1 +1 @@\n-old\n+new"],
							notes: [
								{
									id: "guard",
									line: 1,
									text: "Keep the confirmed value visible when saving succeeds.",
								},
							],
						},
					],
				}),
			],
		}),
		component("decision", "actions", {
			actions: [
				{ id: "approve", label: "Approve" },
				{ id: "request-changes", label: "Request changes" },
			],
		}),
	],
};
const scenarios = ["screen", "other"].map((id) => ({
	id,
	title: `Inspect ${id}`,
	requirementRefs: ["R1"],
	paths: [`${id}.ts`],
	environment: "owned fixture v1",
	preconditions: [],
	actions: ["Open the view"],
	expected: ["The selection remains visible"],
	screenshots: ["Saved"],
	video: { needed: false, required: false, reason: "Still state", steps: [] },
}));
const terminal = (run: FactoryRun) =>
	vi.waitFor(() => expect(run.status, run.error).toBe("completed"), {
		timeout: 20000,
	});
const waiting = (run: FactoryRun) =>
	vi.waitFor(
		() => {
			if (run.status === "failed") throw new Error(run.error);
			expect(run.status, run.error).toBe("waiting");
			expect(run.viewDecision).toBeDefined();
		},
		{ timeout: 20000 },
	);

function fixture(
	id: "v2-qa" | "v2-approval",
	options: {
		failFirst?: boolean;
		captureFailure?: boolean;
		noCodeFix?: boolean;
		alwaysFail?: boolean;
		stalePort?: "review" | "qa";
		needed?: boolean;
		safe?: boolean;
		video?: boolean;
		checksPass?: boolean;
		composed?: boolean;
	} = {},
) {
	const home = mkdtempSync(join(tmpdir(), "f1-c3-"));
	const source = join(home, "source"),
		workspace = join(home, "worktree"),
		remote = join(home, "remote.git");
	mkdirSync(source);
	const gitAt = (cwd: string, ...args: string[]) =>
		execFileSync("git", args, {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
	const git = (...args: string[]) => gitAt(workspace, ...args);
	gitAt(source, "init", "-qb", "main");
	gitAt(source, "config", "user.name", "F1");
	gitAt(source, "config", "user.email", "f1@example.test");
	gitAt(source, "config", "commit.gpgsign", "false");
	gitAt(source, "config", "core.hooksPath", "/dev/null");
	writeFileSync(join(source, "screen.ts"), "old\n");
	writeFileSync(join(source, "other.ts"), "other\n");
	gitAt(source, "add", ".");
	gitAt(source, "commit", "-qm", "Initial [skip ci]");
	gitAt(source, "init", "--bare", remote);
	gitAt(source, "remote", "add", "origin", remote);
	gitAt(source, "push", "-u", "origin", "main");
	gitAt(source, "worktree", "add", "-b", "feature", workspace, "main");
	const head = () => git("rev-parse", "HEAD");
	const commit = (value: string) => {
		writeFileSync(join(workspace, "screen.ts"), `${value}\n`);
		git("add", "screen.ts");
		git("commit", "-qm", "Correction [skip ci]");
	};
	commit("new");
	const url = "https://github.com/team/project/pull/1";
	let draft = true;
	let merged = false;
	const request = () => ({
		url,
		number: 1,
		title: "Settings",
		body: "Fixture",
		headRefName: "feature",
		headRefOid: head(),
		baseRefName: "main",
		state: merged ? "MERGED" : "OPEN",
		...(merged ? { mergeCommitSha: "provider-confirmed-merge" } : {}),
		isDraft: draft,
		isCrossRepository: false,
	});
	const provider = {
		merge: vi.fn(async (_url: string, expected: string) => {
			expect(expected).toBe(head());
			merged = true;
		}),
		list: async () => [{ url, isDraft: draft }],
		view: async () => request(),
		read: async () => ({
			...request(),
			baseSha: git("rev-parse", "origin/main"),
			mergeability: "mergeable",
			reviews: [],
			unresolvedThreads: [],
			reviewComments: [],
			comments: [],
			blockers: [],
			queued: false,
			labels: [],
			checks: [],
		}),
		readiness: async () => ({
			url,
			headSha: head(),
			baseSha: git("rev-parse", "origin/main"),
			checks:
				options.checksPass === false
					? [
							{
								name: "required",
								required: true,
								bucket: "fail",
								state: "FAILURE",
							},
						]
					: [],
		}),
		draft: async (_url: string, value: boolean) => {
			draft = value;
		},
	};
	mocks.provider.mockResolvedValue(provider);
	const calls: string[] = [];
	let reviewRound = 0;
	const captures = new Map<string, number>();
	const scripted = async (ctx: ExecutionContext) => {
		calls.push(ctx.stepKey!);
		if (ctx.step.id === "visual-scope")
			return {
				needed: options.needed !== false,
				reason: "Observed interface change",
				scenarios: options.needed === false ? [] : scenarios,
			};
		if (ctx.step.id === "capture") {
			const item = (ctx.input as any).scenario;
			captures.set(item.id, (captures.get(item.id) ?? 0) + 1);
			const path = join(
				ctx.evidenceDir,
				`${item.id}-${captures.get(item.id)}.png`,
			);
			mkdirSync(ctx.evidenceDir, { recursive: true });
			// The verifier checks actual PNG bytes and the evidence boundary.
			writeFileSync(
				path,
				Buffer.from(
					"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
					"base64",
				),
			);
			const videos: unknown[] = [];
			if (options.video && item.id === "screen") {
				const clip = join(ctx.evidenceDir, "flow.mp4");
				execFileSync("ffmpeg", [
					"-y",
					"-v",
					"error",
					"-f",
					"lavfi",
					"-i",
					"color=c=blue:s=320x240:d=0.5",
					"-c:v",
					"libx264",
					"-pix_fmt",
					"yuv420p",
					clip,
				]);
				videos.push({
					path: clip,
					caption: "Fixture clip",
					transcript: "A blue test frame",
					posterPath: path,
					receipt: "Generated a deterministic media fixture",
				});
			}
			return {
				scenarioId: item.id,
				passed: !(
					item.id === "screen" &&
					options.captureFailure &&
					(options.alwaysFail || captures.get(item.id) === 1)
				),
				observed: "The selection remains visible",
				screenshots: [{ path, caption: "Saved" }],
				videos,
				limitations: [],
			};
		}
		if (ctx.step.id === "visual-review") {
			const failed =
				options.alwaysFail ||
				((options.failFirst || options.captureFailure) && ++reviewRound === 1);
			return {
				passed: options.captureFailure || !failed,
				scenarioIds: scenarios.map((s) => s.id),
				summary: "Inspected both scenarios",
				findings:
					failed && !options.captureFailure
						? [{ scenarioIds: ["screen"], message: "Capture is unreadable" }]
						: [],
			};
		}
		if (ctx.step.id === "visual-fix" || ctx.step.id === "human-fix") {
			if (!options.noCodeFix)
				writeFileSync(join(workspace, "screen.ts"), "fixed\n");
			return {
				summary: "Corrected selection",
				message: "Fix selection [skip ci]",
			};
		}
		if (ctx.step.id === "guide") return guideDocument;
		if (ctx.step.id === "impact")
			return {
				safe: options.safe !== false,
				summary: "Inspected cumulative diff",
				evidence: [
					"Compared original approved head to current head and current checks",
				],
				uncertainty: [],
			};
		throw new Error(`Unexpected agent ${ctx.stepKey}`);
	};
	const runtime = new WorkflowRuntime(home, {
		agent: async (ctx) =>
			runEvidenceChecks(
				ctx,
				await parseStepOutputAsync(ctx.step, await scripted(ctx)),
			),
		script: async (ctx) => JSON.parse(ctx.run.launchInputs![ctx.step.id]!),
		tool: async () => ({}),
	});
	let definitions = validateWorkflows([
		...defaultWorkflows,
		{
			...defaultWorkflows.find((recipe) => recipe.id === "v2-approval")!,
			id: "c3-approval",
			internal: false,
			steps: [
				...["review", "qa"]
					.filter((id) => id !== options.stalePort)
					.map((id) => ({
						id,
						name: id,
						type: "script",
						script: "fixture port",
					})),
				...defaultWorkflows.find((recipe) => recipe.id === "v2-approval")!
					.steps,
			],
		},
	]);
	if (options.composed)
		definitions = validateWorkflows([
			...defaultWorkflows,
			{
				...defaultWorkflows.find((recipe) => recipe.id === "v2-merge")!,
				id: "c3-consumer",
				name: "Consume C3 authorization with C4 Merge",
			},
			{
				id: "c3-revisit",
				name: "Revisit approval",
				engineVersion: "nodes-v1",
				inputs: ["requirements", "plan", "review", "qa", "pr", "completion"],
				steps: [
					...["requirements", "plan", "review", "qa", "pr", "completion"].map(
						(id) => ({
							id,
							name: id,
							type: "script",
							script: "fixture port",
						}),
					),
					{
						id: "approval",
						name: "Approval",
						type: "workflow",
						workflow: "v2-approval",
						bindings: {
							requirements: "requirements",
							plan: "plan",
							review: "review",
							qa: "qa",
							pr: "pr",
						},
						next: "pause",
					},
					{
						id: "pause",
						name: "Later correction",
						type: "display",
						document: {
							version: "view-v1",
							components: [
								component("next", "actions", {
									actions: [
										{ id: "continue", label: "Apply correction" },
										{ id: "finish", label: "Finish" },
									],
								}),
							],
						},
						branches: [
							{
								when: { path: "action", equals: "continue" },
								next: "requirements",
							},
						],
						next: "select-authorization",
					},
					{
						id: "select-authorization",
						name: "Select actual receipt",
						type: "check",
						reads: { result: "approval/outputs/approval" },
						check: {
							results: {
								carried: {
									path: "/inputs/result/authorization",
									equals: "carried",
								},
							},
						},
						branches: [
							{
								when: { path: "passed", equals: true },
								next: "consume-carried",
							},
						],
						next: "consume-explicit",
					},
					{
						id: "consume-explicit",
						name: "Consume explicit receipt",
						type: "workflow",
						workflow: "c3-consumer",
						bindings: {
							approval: "approval/explicit",
							pr: "pr",
							completion: "completion",
						},
						next: "end",
					},
					{
						id: "consume-carried",
						name: "Consume carried receipt",
						type: "workflow",
						workflow: "c3-consumer",
						bindings: {
							approval: "approval/carried",
							pr: "pr",
							completion: "completion",
						},
						next: "end",
					},
				],
			},
		]);
	runtime.updateWorkflows(definitions);
	const server = new FactoryServer(runtime, {
		repositories: () => [{ id: "repo", name: "Fixture" }],
		sessions: () => [],
		entries: () => [],
		stop: (id) => runtime.stop(id),
		start: async () => {
			throw new Error("No unrelated launch");
		},
	});
	resources.push({ home, runtime, server });
	const run = runtime.create({
		title: "C3 scripted drive",
		repositoryId: "repo",
		workspace,
		input: "Keep saved settings visible",
		workflow: definitions.find(
			(r) =>
				r.id ===
				(options.composed
					? "c3-revisit"
					: id === "v2-approval"
						? "c3-approval"
						: id),
		)!,
		workflowDefinitions: definitions,
		repositories: [
			{
				id: "repo",
				name: "Fixture",
				workspace,
				repositoryPath: source,
				githubUrl: "https://github.com/team/project",
				baseBranch: "main",
			},
		],
		launchInputs: {
			completion: JSON.stringify({ final: false }),
			requirements: JSON.stringify({
				summary: "Saved settings",
				requirements: [{ id: "R1", text: "Keep selection visible" }],
				decisions: [],
				outOfScope: [],
			}),
			plan: JSON.stringify({ summary: "Persist selection" }),
			review: JSON.stringify({ approved: true, findings: [], coverage: [] }),
			qa: JSON.stringify({
				needed: false,
				passed: true,
				scenarios: [],
				evidence: [],
			}),
			pr: JSON.stringify({
				repositories: [{ id: "repo", head: head(), url, isDraft: true }],
			}),
		},
		triggerOrigin: {
			type: "manual",
			workflowId: options.composed
				? "c3-revisit"
				: id === "v2-approval"
					? "c3-approval"
					: id,
			at: new Date().toISOString(),
		},
	});
	const answer = async (action: string, choices: unknown[] = []) => {
		const snapshot = run.viewDecision!;
		const result = await server.app.inject({
			method: "POST",
			url: `/api/runs/${run.id}/view-answer`,
			headers: { "x-factory-request": "1" },
			payload: {
				batchId: snapshot.id,
				digest: snapshot.digest,
				documentDigest: snapshot.documentDigest,
				accepted: true,
				action,
				choices,
			},
		});
		expect(result.statusCode, result.body).toBe(200);
	};
	return {
		home,
		runtime,
		run,
		server,
		calls,
		captures,
		workspace,
		commit,
		head,
		answer,
		provider,
		setDraft: (value: boolean) => {
			draft = value;
		},
		setSafe: (safe: boolean) => {
			options.safe = safe;
		},
	};
}

it("skips demonstration for a no-UI change and emits the qa port", async () => {
	const f = fixture("v2-qa", { needed: false });
	await f.runtime.launch(f.run);
	expect(f.run.status, f.run.error).toBe("completed");
	expect(f.run.checkpoint?.outcome).toBe("completed");
	expect(f.run.outputs.qa).toEqual({
		needed: false,
		passed: true,
		scenarios: [],
		evidence: [],
		corrected: false,
	});
	expect(f.calls).toEqual(["visual-scope"]);
});
it("captures, reviews, fixes and publishes, then reuses the unchanged scenario and passes", async () => {
	const f = fixture("v2-qa", { failFirst: true });
	await f.runtime.launch(f.run);
	expect(f.run.status, f.run.error).toBe("completed");
	expect(f.run.checkpoint?.outcome).toBe("to-review");
	expect(Object.fromEntries(f.captures)).toEqual({ screen: 2, other: 1 });
	expect(
		f.run.events.some((e) => e.message === "reused (inputs unchanged)"),
	).toBe(true);
	expect(f.run.outputs.qa).toMatchObject({
		needed: true,
		passed: true,
		corrected: true,
		evidence: [
			{ scenarioId: "screen", kind: "screenshot" },
			{ scenarioId: "other", kind: "screenshot" },
		],
	});
});
it.each([
	true,
	false,
])("recaptures failed=%s evidence without a source change, retaining independent captures", async (captureFailure) => {
	const f = fixture("v2-qa", {
		failFirst: !captureFailure,
		captureFailure,
		noCodeFix: true,
	});
	const originalHead = f.head();
	await f.runtime.launch(f.run);
	expect(f.run.status, f.run.error).toBe("completed");
	expect(f.head()).toBe(originalHead);
	expect(Object.fromEntries(f.captures)).toEqual({ screen: 2, other: 1 });
	expect(f.run.outputs.qa).toMatchObject({ passed: true });
});
it.each([
	true,
	false,
])("stops repeated failed=%s captures at a human display before visit exhaustion", async (captureFailure) => {
	const f = fixture("v2-qa", {
		captureFailure,
		alwaysFail: true,
		noCodeFix: true,
	});
	void f.runtime.launch(f.run);
	await waiting(f.run);
	expect(f.run.viewDecision!.stepKey).toBe("qa-help");
	expect(Object.fromEntries(f.captures)).toEqual({ screen: 3, other: 1 });
	expect(f.run.outputs.qa).toBeUndefined();
	expect(f.run.error).toBeUndefined();
	await f.answer("retry");
	await vi.waitFor(() => expect(f.captures.get("screen")).toBe(4));
	await waiting(f.run);
	expect(f.run.viewDecision!.stepKey).toBe("qa-help");
});
it.each([
	"review",
	"qa",
] as const)("rejects an unstamped %s port before approval", async (stalePort) => {
	const f = fixture("v2-approval", { stalePort });
	await f.runtime.launch(f.run);
	expect(f.run.status, f.run.error).toBe("completed");
	expect(f.run.checkpoint?.outcome).toBe("to-review");
	expect(f.calls).toEqual([]);
});
it("approves an agent-produced guide with item comments through the API", async () => {
	const f = fixture("v2-approval");
	void f.runtime.launch(f.run);
	await waiting(f.run);
	expect(f.run.viewDecision!.stepKey).toBe("approval-display");
	if (process.env.C3_PREVIEW_DIR) {
		const directory = process.env.C3_PREVIEW_DIR;
		mkdirSync(directory, { recursive: true });
		const root = join(process.cwd(), "dist/factory/web");
		const build = join(
			root,
			readdirSync(root).find((name) => name.startsWith("build-"))!,
		);
		const css = readFileSync(
			join(build, readdirSync(build).find((name) => name.endsWith(".css"))!),
			"utf8",
		);
		const body = renderToStaticMarkup(
			createElement(DisplayDocumentView, {
				snapshot: f.run.viewDecision!,
				runId: "",
				onSubmit: async () => {},
			}),
		);
		writeFileSync(
			join(directory, "index.html"),
			`<!doctype html><html data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>C3 approval guide</title><style>${css}</style></head><body><main style="max-width:1000px;margin:32px auto;padding:0 20px"><h1>Review saved settings</h1>${body}</main></body></html>`,
		);
	}

	await f.answer("approve", [
		{ itemId: "wording", action: "comment", comment: "Saved is clear" },
	]);
	await terminal(f.run);
	expect(f.run.outputs.approval).toMatchObject({
		action: "approve",
		comments: { wording: "Saved is clear" },
		bound: ["guide", "published"],
		carriedFrom: null,
	});
	expect((f.run.outputs.approval as any).repositories[0].isDraft).toBe(false);
	expect(f.run.checkpoint?.outcome).toBe("completed");
});
it.each([
	"request-changes",
	"stale",
])("routes %s through human-fix and publication", async (action) => {
	const f = fixture("v2-approval");
	void f.runtime.launch(f.run);
	await waiting(f.run);
	if (action === "stale") f.commit("changed while waiting");
	await f.answer(action === "stale" ? "approve" : action, [
		{
			itemId: "wording",
			action: "comment",
			comment: "Please use a longer confirmation",
		},
	]);
	await terminal(f.run);
	expect(f.run.outputs.approved).toMatchObject({ approved: false });
	expect(f.calls).toContain("human-fix");
	expect(f.run.checkpoint?.outcome).toBe("to-review");
	expect(f.run.outputs.approval).toBeUndefined();
});
it.each([
	true,
	false,
])("revisits an approved call: carry-forward safe=%s", async (safe) => {
	const f = fixture("v2-approval", { composed: true, safe });
	void f.runtime.launch(f.run);
	await waiting(f.run);
	await f.answer("approve");
	await vi.waitFor(
		() => expect(f.run.viewDecision?.stepKey, f.run.error).toBe("pause"),
		{ timeout: 20000 },
	);
	const originalHead = f.head();
	const previousPause = f.run.viewDecision!.id;
	f.commit("minor correction");
	f.setDraft(true);
	await f.answer("continue");
	await vi.waitFor(() => expect(f.calls).toContain("approval/impact"), {
		timeout: 20000,
	});
	if (!safe) {
		await vi.waitFor(
			() =>
				expect(f.run.viewDecision?.stepKey, f.run.error).toBe(
					"approval/approval-display",
				),
			{ timeout: 20000 },
		);
		expect(f.calls.filter((s) => s === "approval/guide")).toHaveLength(2);
		await f.answer("approve");
	}
	await vi.waitFor(
		() => {
			expect(f.run.viewDecision?.stepKey, f.run.error).toBe("pause");
			expect(f.run.viewDecision?.id).not.toBe(previousPause);
		},
		{ timeout: 20000 },
	);
	const result = (f.run.outputs.approval as any).outputs.approval;
	expect(result.action).toBe("approve");
	expect(result.repositories[0].isDraft).toBe(safe);
	const authorization = `approval/${result.authorization}`;
	expect(
		await freshNodeOutput(
			{
				run: f.run,
				step: f.run.workflow.steps.at(-1)!,
				stepKey: "pause",
				outputs: f.run.outputs,
				input: {},
				signal: new AbortController().signal,
				log: () => {},
				evidenceDir: "",
			},
			`/${authorization}`,
		),
	).toBe(true);

	if (safe) {
		expect(result.carriedFrom.approvedRepositories[0].head).toBe(originalHead);
		expect(result.decision.safe).toBe(true);
		const pause = f.run.viewDecision!.id;
		f.commit("another minor correction");
		await f.answer("continue");
		await vi.waitFor(() => {
			expect(f.run.viewDecision?.stepKey, f.run.error).toBe("pause");
			expect(f.run.viewDecision?.id).not.toBe(pause);
		});
		const repeated = (f.run.outputs.approval as any).outputs.approval;
		expect(repeated.approvedRepositories[0].head).toBe(originalHead);
		expect(repeated.carriedFrom.approvedRepositories[0].head).toBe(
			originalHead,
		);
		expect(repeated.repositories[0].head).toBe(f.head());
		expect(f.calls.filter((s) => s === "approval/impact")).toHaveLength(2);
	} else expect(result.carriedFrom).toBeNull();
	// The carry-forward fixture re-drafts the PR; restore provider readiness before merge.
	f.setDraft(false);
	await f.answer("finish");
	await terminal(f.run);
	expect(
		(f.run.outputs[safe ? "consume-carried" : "consume-explicit"] as any)
			.outputs["approval-current"],
	).toMatchObject({ approved: true });
	expect(f.provider.merge).toHaveBeenCalledExactlyOnceWith(
		"https://github.com/team/project/pull/1",
		f.head(),
		undefined,
	);
	expect(
		(f.run.outputs[safe ? "consume-carried" : "consume-explicit"] as any)
			.outputs.merge.repositories,
	).toEqual([
		{
			repositoryId: "repo",
			merged: true,
			sha: "provider-confirmed-merge",
			url: "https://github.com/team/project/pull/1",
		},
	]);
});
it("returns to-ci when required provider checks fail", async () => {
	const f = fixture("v2-approval", { checksPass: false });
	await f.runtime.launch(f.run);
	expect(f.run.status, f.run.error).toBe("completed");
	expect(f.run.checkpoint?.outcome).toBe("to-ci");
	expect(f.calls).toEqual([]);
});

it("serves node-verified screenshots and video in Display, then rejects stale or replaced bytes", async () => {
	const f = fixture("v2-qa", { video: true });
	await f.runtime.launch(f.run);
	expect(f.run.status, f.run.error).toBe("completed");
	const media = acceptedMedia(f.run),
		image = media.find(
			(a) => a.kind === "image" && a.stepKey.includes("screen"),
		)!,
		video = media.find((a) => a.kind === "video")!;
	expect(image).toBeDefined();
	expect(video?.video?.transcript).toBe("A blue test frame");
	const view = {
		version: "view-v1" as const,
		components: [
			{
				id: "image",
				type: "screenshots" as const,
				data: {
					items: [
						{
							index: image.index,
							sha256: image.sha256,
							alt: "Saved preference",
						},
					],
				},
			},
			{
				id: "video",
				type: "video" as const,
				data: {
					taskId: video.id,
					sha256: video.sha256,
					label: "Saved flow",
					transcript: video.video!.transcript,
				},
			},
		],
	};
	await expect(
		prepareViewAssetCheck(f.runtime.directory, f.run, view),
	).resolves.toBeTypeOf("function");
	const imageUrl = `/api/runs/${f.run.id}/view-screenshots/${image.index}?v=${image.sha256}`;
	const videoUrl = `/api/runs/${f.run.id}/videos/${video.id}/media?v=${video.sha256}`;
	expect(
		(await f.server.app.inject({ method: "GET", url: imageUrl })).statusCode,
	).toBe(200);
	const streamed = await f.server.app.inject({
		method: "GET",
		url: videoUrl,
		headers: { range: "bytes=0-15" },
	});
	expect(streamed.statusCode, streamed.body).toBe(206);
	expect(streamed.rawPayload.length).toBe(16);
	const restarted = new WorkflowRuntime(f.home, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
	});
	try {
		const loaded = restarted.get(f.run.id);
		expect(acceptedMedia(loaded)).toEqual(media);
		await expect(
			prepareViewAssetCheck(restarted.directory, loaded, view),
		).resolves.toBeTypeOf("function");
	} finally {
		await restarted.shutdown();
	}
	writeFileSync(image.path, "replaced");
	await expect(
		prepareViewAssetCheck(f.runtime.directory, f.run, view),
	).rejects.toThrow();
	f.commit("new behavior");
	expect(
		(await f.server.app.inject({ method: "GET", url: videoUrl })).statusCode,
	).toBe(409);
});

it("requires renewed approval after a human rejects a revisited guide", async () => {
	const f = fixture("v2-approval", { composed: true, safe: false });
	void f.runtime.launch(f.run);
	await waiting(f.run);
	await f.answer("approve");
	await vi.waitFor(() => expect(f.run.viewDecision?.stepKey).toBe("pause"));
	f.commit("meaningful correction");
	await f.answer("continue");
	await vi.waitFor(() =>
		expect(f.run.viewDecision?.stepKey, f.run.error).toBe(
			"approval/approval-display",
		),
	);
	await f.answer("request-changes");
	await vi.waitFor(() =>
		expect(f.run.viewDecision?.stepKey, f.run.error).toBe("pause"),
	);
	const impacts = f.calls.filter((s) => s === "approval/impact").length;
	f.setSafe(true);
	await f.answer("continue");
	await vi.waitFor(() =>
		expect(f.run.viewDecision?.stepKey, f.run.error).toBe(
			"approval/approval-display",
		),
	);
	expect(f.calls.filter((s) => s === "approval/impact")).toHaveLength(impacts);
	await f.answer("approve");
	await vi.waitFor(() =>
		expect(f.run.viewDecision?.stepKey, f.run.error).toBe("pause"),
	);
	expect((f.run.outputs.approval as any).outputs.approval.authorization).toBe(
		"explicit",
	);
	await f.answer("finish");
	await terminal(f.run);
});
