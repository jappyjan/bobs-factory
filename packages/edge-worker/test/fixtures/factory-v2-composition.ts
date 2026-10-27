import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, vi } from "vitest";
import { defaultWorkflows } from "../../src/factory/defaultWorkflows.js";
import { parseStepOutputAsync } from "../../src/factory/OutputFormats.js";
import { fileTicketIO } from "../../src/factory/RepositoryTicketIO.js";
import { workflowClosure } from "../../src/factory/WorkflowCatalog.js";
import {
	type ExecutionContext,
	WorkflowRuntime,
} from "../../src/factory/WorkflowRuntime.js";
import { FactoryServer } from "./authenticated-factory.js";
import { waitForRuntime } from "./runtime-wait.js";
import { plan, requirements } from "./v2-planning.js";

const hoisted = vi.hoisted(() => ({
	command: vi.fn(),
	provider: vi.fn(),
}));
export const mocks = hoisted;
vi.mock("../../src/factory/nodes/execute/command.js", async (original) => ({
	...(await original<object>()),
	executeCommand: hoisted.command,
}));
vi.mock("../../src/factory/GitProvider.js", async (original) => ({
	...(await original<object>()),
	resolveGitProvider: hoisted.provider,
}));
export const owned: {
	home: string;
	runtime: WorkflowRuntime;
	server?: FactoryServer;
}[] = [];
afterEach(async () => {
	for (const f of owned.splice(0)) {
		await f.runtime.shutdown();
		await f.server?.stop();
		rmSync(f.home, { recursive: true, force: true });
	}
	vi.clearAllMocks();
});
const url = "https://github.com/test/repo/pull/1";
const specialists = [
	"security-review",
	"architecture-review",
	"integration-review",
	"simplicity-review",
	"correctness-review",
	"requirements-review",
];
const guide = {
	version: "view-v1",
	components: [
		{
			id: "summary",
			type: "markdown",
			data: {
				literal: { text: "Implemented and verified the accepted requirement." },
			},
		},
		{
			id: "judgment",
			type: "itemCards",
			data: {
				literal: {
					items: [
						{
							id: "wording",
							title: "Does this fit?",
							body: "The accepted behavior is implemented.",
						},
					],
					comment: true,
					required: false,
				},
			},
		},
		{
			id: "feedback",
			type: "form",
			data: {
				literal: {
					fields: [
						{ id: "feedback", label: "Requested changes", type: "textarea" },
					],
				},
			},
		},
		{
			id: "decision",
			type: "actions",
			data: {
				literal: {
					actions: [
						{ id: "approve", label: "Approve" },
						{ id: "request-changes", label: "Request changes" },
					],
				},
			},
		},
	],
};
export function fixture(
	mode: string,
	id = "factory",
	options: {
		empty?: boolean;
		revision?: boolean;
		carry?: boolean;
		externalRevision?: boolean;
	} = {},
) {
	const home = mkdtempSync(join(tmpdir(), "factory-composition-")),
		repo = join(home, "repo"),
		remote = join(home, "remote.git");
	mkdirSync(repo);
	const git = (...args: string[]) =>
		execFileSync("git", args, {
			cwd: repo,
			encoding: "utf8",
			stdio: "pipe",
		}).trim();
	git("init", "-qb", "main");
	git("config", "user.name", "Fixture");
	git("config", "user.email", "fixture@example.invalid");
	git("config", "commit.gpgsign", "false");
	git("config", "core.hooksPath", "/dev/null");
	writeFileSync(join(repo, "file.ts"), "export const value = 1;\n");
	git("add", ".");
	git("commit", "-qm", "initial");
	git("clone", "-q", "--bare", repo, remote);
	git("remote", "add", "origin", remote);
	git("fetch", "-q", "origin");
	git("checkout", "-qb", "feature");
	const base = git("rev-parse", "HEAD");
	const workspace = join(home, "worktree");
	git("checkout", "-q", "main");
	git("worktree", "add", "-q", workspace, "feature");
	const state = {
		head: base,
		draft: true,
		merged: false,
		exists: id === "takeover",
		title: "Existing",
		body: "Existing",
		moved: false,
		currentStep: "",
		mergedHeads: [] as string[],
		implementations: 0,
		plans: 0,
		scopes: 0,
		revised: false,
		externalRevised: false,
	};
	const checks = [
		{ name: "build", required: true, state: "SUCCESS", bucket: "pass" },
	];
	const view = async () => ({
		url,
		number: 1,
		title: state.title,
		body: state.body,
		headRefName: "feature",
		headRefOid: state.head,
		baseRefName: "main",
		state: state.merged ? "MERGED" : "OPEN",
		isDraft: state.draft,
		isCrossRepository: false,
		...(state.merged ? { mergeCommitSha: "confirmed-merge" } : {}),
	});
	const provider = {
		view: vi.fn(async () => {
			if (
				options.carry &&
				!state.moved &&
				state.currentStep.endsWith("/merge")
			) {
				state.moved = true;
				writeFileSync(join(workspace, "file.ts"), "export const value = 99;\n");
				for (const args of [
					["add", "."],
					["commit", "-qm", "fix: small correction [skip ci]"],
					["push", "-q", "origin", "HEAD"],
				])
					execFileSync("git", args, { cwd: workspace });
				state.head = execFileSync("git", ["rev-parse", "HEAD"], {
					cwd: workspace,
					encoding: "utf8",
				}).trim();
			}
			return view();
		}),
		read: vi.fn(async () => ({
			...(await view()),
			baseSha: base,
			mergeability: "mergeable",
			providerMergeability: "CLEAN",
			mergeStateStatus: "CLEAN",
			reviewDecision: "APPROVED",
			comments: [],
			reviewComments: [],
			unresolvedThreads: [],
			reviews: [],
			blockers: [],
			checks,
			queued: false,
		})),
		list: vi.fn(async () => (state.exists ? [{ url }] : [])),
		create: vi.fn(async (input) => {
			state.exists = true;
			state.title = input.title;
			state.body = input.body;
			return url;
		}),
		update: vi.fn(async (_url, input) => {
			Object.assign(state, input);
		}),
		draft: vi.fn(async (_url, draft) => {
			state.draft = draft;
		}),
		readiness: vi.fn(async () => ({
			url,
			headSha: state.head,
			baseSha: base,
			checks,
			mergeMethod: "squash",
		})),
		merge: vi.fn(async (_url, expected) => {
			expect(expected).toBe(state.head);
			state.mergedHeads.push(expected);
			state.merged = true;
		}),
	};
	hoisted.provider.mockImplementation(async (ctx: ExecutionContext) => {
		state.currentStep = ctx.stepKey ?? ctx.step.id;
		return provider;
	});
	hoisted.command.mockImplementation(
		async (_ctx: ExecutionContext, exe: string, args: string[]) => {
			expect(exe).toBe("git");
			const result = execFileSync("git", args, {
				cwd: workspace,
				encoding: "utf8",
				stdio: "pipe",
			}).trim();
			if (args[0] === "push")
				state.head = execFileSync("git", ["rev-parse", "HEAD"], {
					cwd: workspace,
					encoding: "utf8",
				}).trim();
			return result;
		},
	);
	mkdirSync(join(home, "tickets"));
	writeFileSync(
		join(home, "tickets", "origin.json"),
		JSON.stringify({
			id: "origin",
			url: "https://tickets.test/p/test/t/1",
			title: "Before",
			description: "Before",
			state: { type: "started" },
			comments: [],
			attachments: [],
		}),
	);
	const ticket = fileTicketIO(join(home, "tickets"), "origin"),
		setStatus = vi.spyOn(ticket, "setStatus");
	const visits: string[] = [];
	const agent = vi.fn(async (ctx: ExecutionContext) => {
		visits.push(ctx.stepKey!);
		let value: unknown;
		switch (ctx.step.id) {
			case "clarify":
				value = { ...requirements, status: "ready" };
				break;
			case "plan":
				state.plans++;
				value = ctx.stepKey?.startsWith("external-planning-")
					? {
							...plan,
							summary: "Only remaining external operations",
							deliveryMode: "external",
							repositories: [],
						}
					: { ...plan, deliveryMode: mode };
				break;
			case "plan-review":
				value = { approved: true, feedback: [] };
				break;
			case "assess-existing":
				value = {
					requirements,
					plan: { ...plan, deliveryMode: mode },
					completed: ["Existing work"],
					remaining: ["Finish"],
					risks: [],
					assets: [],
				};
				break;
			case "architecture":
				if (options.revision && !state.revised) {
					state.revised = true;
					value = {
						meaningful: true,
						rationale: "Revise scope",
						decisions: [],
						display: guide,
						planChanges: { ...plan, deliveryMode: mode },
					};
				} else
					value = {
						meaningful: false,
						rationale: "Established pattern",
						decisions: [],
					};
				break;
			case "implement":
				state.implementations++;
				if (!options.empty)
					writeFileSync(
						join(workspace, "file.ts"),
						`export const value = ${state.implementations + 1};\n`,
					);
				value = {
					status: "completed",
					architectureRevision: false,
					title: "Implement requirement",
					summary: "Implemented",
					checks: ["Tested"],
				};
				break;
			case "assess-impact":
				value = {
					summary: "Review all",
					architectureRevision: false,
					readinessOnly: false,
					reviewers: Object.fromEntries(
						specialists.map((s) => [s, { paths: [":/"], corrections: [] }]),
					),
				};
				break;
			case "visual-scope":
				state.scopes++;
				value = { needed: false, reason: "Backend only", scenarios: [] };
				break;
			case "guide":
				value = ctx.stepKey?.startsWith("approval/")
					? guide
					: { summary: "Verified external update" };
				break;
			case "human-fix":
				writeFileSync(
					join(workspace, "file.ts"),
					"export const value = 100;\n",
				);
				value = {
					summary: "Applied feedback",
					message: "fix: feedback [skip ci]",
				};
				break;
			case "impact":
				value = {
					safe: true,
					summary: "Small correction",
					evidence: ["Inspected cumulative diff"],
					uncertainty: [],
				};
				break;
			case "apply":
				if (options.externalRevision && !state.externalRevised) {
					state.externalRevised = true;
					value = {
						applied: false,
						revisePlan: true,
						summary: "External target needs replanning",
						receipts: [],
					};
					break;
				}
				expect(setStatus).not.toHaveBeenCalled();
				if (mode === "mixed") {
					expect(state.merged).toBe(true);
					const kind = options.carry ? "carried" : "explicit";
					expect(ctx.run.outputs[`merge-${kind}/merge`]).toMatchObject({
						repositories: [{ merged: true }],
					});
					expect(ctx.run.outputs[`approval/${kind}`]).toMatchObject({
						action: "approve",
					});
				}
				await ticket.update({ title: "Applied" });
				value = {
					applied: true,
					revisePlan: false,
					summary: "Applied",
					receipts: [{ before: "Before", after: "Applied" }],
				};
				break;
			case "verify":
				value = {
					verified: true,
					summary: "Verified",
					ticketUrl: "https://tickets.test/p/test/t/1",
					observations: [await ticket.read()],
				};
				break;
			case "final-verify":
				value = { unchanged: true, reason: "Targets unchanged" };
				break;
			default:
				if (!specialists.includes(ctx.step.id))
					throw new Error(`Unexpected agent ${ctx.stepKey}`);
				value = {
					reviewer: ctx.step.id,
					status: "completed",
					summary: "Approved",
					findings: [],
					coverage:
						ctx.step.id === "requirements-review"
							? [
									{
										requirementId: "R1",
										status: "met",
										evidence: "Observed test",
										reason: "Requirement exercised",
										decisionId: "",
									},
								]
							: [],
				};
		}
		return parseStepOutputAsync(
			ctx.step,
			value,
			undefined,
			ctx.signal,
			ctx.fresh,
		);
	});
	const hooks = {
		agent,
		script: async () => {
			throw new Error("Unexpected script");
		},
		tool: async () => {
			throw new Error("Unexpected legacy tool");
		},
		ticketIO: async () => ticket,
	};
	const runtime = new WorkflowRuntime(join(home, "state"), hooks);
	runtime.updateWorkflows(defaultWorkflows);
	owned.push({ home, runtime });
	const workflow = defaultWorkflows.find((w) => w.id === id)!;
	const run = runtime.create({
		repositoryId: "fixture",
		workspace,
		repositories: [
			{
				id: "fixture",
				name: "Fixture",
				repositoryPath: repo,
				workspace,
				baseBranch: "main",
				githubUrl: "https://github.com/test/repo",
			},
		],
		input: "Implement the requirement",
		launchInputs: {
			prompt: "Implement the requirement",
			...(id === "takeover" ? { source: url } : {}),
		},
		ticketReference: {
			provider: "taskbot",
			server: "taskbot",
			instance: "https://tickets.test",
			project: "test",
			id: 1,
			url: "https://tickets.test/p/test/t/1",
		},
		ticketSnapshot: {
			id: "1",
			identifier: "T-1",
			url: "https://tickets.test/p/test/t/1",
			title: "Task",
			comments: [],
		},
		workflow,
		workflowDefinitions: workflowClosure(workflow, defaultWorkflows),
		triggerOrigin: {
			type: "manual",
			workflowId: id,
			at: new Date().toISOString(),
		},
	});
	if (id === "takeover") run.takeoverSource = { url };
	return {
		home,
		repo,
		runtime,
		run,
		state,
		provider,
		ticket,
		setStatus,
		visits,
		hooks,
		agent,
	};
}
export async function drive(
	f: ReturnType<typeof fixture>,
	options: { reject?: boolean; restart?: boolean; stopExternal?: boolean } = {},
) {
	const server = () => {
		const server = new FactoryServer(f.runtime, {
			repositories: () => [],
			sessions: () => [],
			entries: () => [],
			stop: (id) => f.runtime.stop(id),
			start: async () => {
				void f.runtime.launch(f.run);
				return f.run;
			},
		});
		owned.at(-1)!.server = server;
		return server;
	};
	let api = server();
	const created = await api.app.inject({
		method: "POST",
		url: "/api/runs",
		headers: { "x-factory-request": "1" },
		payload: {
			repositoryId: "fixture",
			workflow: f.run.workflow.id,
			inputs: f.run.launchInputs,
		},
	});
	expect(created.statusCode, created.body).toBe(202);
	let rejected = false,
		restarted = false,
		previousDecision = "";
	for (let i = 0; i < 10; i++) {
		await waitForRuntime(
			() =>
				expect(
					["completed", "failed"].includes(f.run.status) ||
						(f.run.status === "waiting" &&
							!!f.run.viewDecision &&
							f.run.viewDecision.id !== previousDecision),
				).toBe(true),
			{ timeout: 180000 },
		);
		expect(f.run.error).toBeUndefined();
		if (f.run.status === "completed") {
			const activity = await api.app.inject({
				method: "GET",
				url: `/api/runs/${f.run.id}/activity?limit=100`,
			});
			expect(activity.statusCode, activity.body).toBe(200);
			expect(activity.json().events.length).toBeGreaterThan(0);
			expect(
				activity
					.json()
					.events.every(
						(event: { step: string; at: string; message: string }) =>
							event.step && event.at && event.message,
					),
			).toBe(true);
			return;
		}
		await waitForRuntime(() => expect(f.run.viewDecision).toBeDefined());
		if (options.restart && !restarted) {
			restarted = true;
			await api.stop();
			await f.runtime.shutdown();
			f.runtime = new WorkflowRuntime(join(f.home, "state"), f.hooks);
			owned.at(-1)!.runtime = f.runtime;
			f.run = f.runtime.get(f.run.id);
			f.runtime.resumeAll();
			api = server();
			await waitForRuntime(() => {
				expect(f.runtime.isExecuting(f.run.id)).toBe(true);
				expect(f.run.status, f.run.error).toBe("waiting");
				expect(f.run.viewDecision).toBeDefined();
			});
		}
		const d = f.run.viewDecision!;
		const action = f.run.step.startsWith("external-replan-")
			? options.stopExternal
				? "stop"
				: "replan"
			: f.run.step === "approval/approval-display"
				? options.reject && !rejected
					? "request-changes"
					: "approve"
				: "accept";
		if (action === "request-changes") rejected = true;
		const answered = await api.app.inject({
			method: "POST",
			url: `/api/runs/${f.run.id}/view-answer`,
			headers: { "x-factory-request": "1" },
			payload: {
				batchId: d.id,
				digest: d.digest,
				documentDigest: d.documentDigest,
				accepted: true,
				action,
				values: action === "request-changes" ? { feedback: "Fix wording" } : {},
			},
		});
		expect(answered.statusCode, answered.body).toBe(200);
		previousDecision = d.id;
	}
	throw new Error(`Did not finish: ${f.run.step}`);
}
