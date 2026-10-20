// Live F1 driver for Bob's check-in before building: real CLI-platform EdgeWorker,
// real Git worktrees, REAL Codex for the check-in author and its reviewer, a
// deterministic mock implementer. Consumes provider credits.
//   pnpm --filter bobs-factory-edge-worker build && pnpm --filter f1 build
//   F1_AGENT_MODE=live bun apps/f1/test-drives/assets/architecture-checkin.ts
// Set F1_HOLD=1 to keep the dashboard on :3543 until <root>/stop exists.
import assert from "node:assert/strict";
import { execFile as execFileCallback, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { createCLIIssueTracker } from "bobs-factory-core";
import { CodexRunner } from "../../../../packages/codex-runner/dist/index.js";
import {
	architectureContinuationInstructions,
	architectureInstructions,
	checkinInstructions,
	implementationScopeInstructions,
} from "../../../../packages/edge-worker/dist/factory/Architecture.js";
import { defaultWorkflows } from "../../../../packages/edge-worker/dist/factory/defaultWorkflows.js";
import {
	EdgeWorker,
	requestFactoryTerminalSession,
} from "../../../../packages/edge-worker/dist/index.js";
import type { Workflow } from "../../../../packages/edge-worker/src/factory/Workflow.ts";
import type {
	FactoryRun,
	WorkflowRuntime,
} from "../../../../packages/edge-worker/src/factory/WorkflowRuntime.ts";
import { MockAgentRunner } from "../../src/MockAgentRunner.ts";

const execFile = promisify(execFileCallback);
assert.equal(process.env.F1_AGENT_MODE, "live", "this drive runs real Codex");
const root = mkdtempSync("/tmp/bobs-checkin-f1-"),
	home = join(root, "home"),
	repo = join(root, "repo");
mkdirSync(home);
mkdirSync(join(repo, "src"), { recursive: true });
mkdirSync(join(repo, "test"));
const git = (cwd: string, ...args: string[]) =>
	execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
git(repo, "init", "-q", "-b", "main");
git(repo, "config", "user.name", "F1 fixture");
git(repo, "config", "user.email", "f1@example.invalid");
git(repo, "config", "commit.gpgsign", "false");
// A small notes service whose notes are visible to everyone.
writeFileSync(
	join(repo, "README.md"),
	"# Team notes\n\nA tiny HTTP service for team notes. Users sign in with a session cookie.\n",
);
writeFileSync(
	join(repo, "package.json"),
	JSON.stringify(
		{ name: "team-notes", type: "module", scripts: { test: "node --test" } },
		null,
		2,
	),
);
writeFileSync(
	join(repo, "src/store.js"),
	`// In-memory note store; persisted to notes.json on change.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const file = new URL("../notes.json", import.meta.url);
export const notes = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
export function addNote(author, text) {
	const note = { id: notes.length + 1, author, text, createdAt: new Date().toISOString() };
	notes.push(note);
	writeFileSync(file, JSON.stringify(notes));
	return note;
}
`,
);
writeFileSync(
	join(repo, "src/auth.js"),
	`// Resolves the signed-in user from the session cookie, or undefined.
const sessions = new Map([["s-alice", "alice"], ["s-bob", "bob"]]);
export function currentUser(request) {
	const match = /session=([^;]+)/.exec(request.headers.cookie ?? "");
	return match ? sessions.get(match[1]) : undefined;
}
`,
);
writeFileSync(
	join(repo, "src/server.js"),
	`import { createServer } from "node:http";
import { currentUser } from "./auth.js";
import { addNote, notes } from "./store.js";
export const server = createServer(async (request, response) => {
	const user = currentUser(request);
	if (request.method === "GET" && request.url === "/notes") {
		// Everyone, signed in or not, sees every note.
		response.setHeader("content-type", "application/json");
		return response.end(JSON.stringify(notes));
	}
	if (request.method === "POST" && request.url === "/notes") {
		if (!user) return response.writeHead(401).end();
		let body = "";
		for await (const chunk of request) body += chunk;
		response.setHeader("content-type", "application/json");
		return response.end(JSON.stringify(addNote(user, JSON.parse(body).text)));
	}
	response.writeHead(404).end();
});
`,
);
writeFileSync(
	join(repo, "test/server.test.js"),
	`import { test } from "node:test";
import assert from "node:assert/strict";
import { server } from "../src/server.js";
test("lists notes", async () => {
	server.listen(0);
	const { port } = server.address();
	const response = await fetch(\`http://127.0.0.1:\${port}/notes\`);
	assert.equal(response.status, 200);
	server.close();
});
`,
);
writeFileSync(join(repo, ".gitignore"), ".claude/\n.codex/\nnotes.json\n");
git(repo, "add", ".");
git(repo, "commit", "-qm", "Initial notes service");
git(repo, "remote", "add", "origin", repo);
process.env.BOBS_FACTORY_MIGRATION_SOURCE_CAPACITY_DIRECTORY = join(
	root,
	"legacy-capacity",
);
process.env.BOBS_FACTORY_FACTORY_PORT = "3543";
delete process.env.BOBS_FACTORY_FACTORY_ORIGIN;
delete process.env.BOBS_FACTORY_FACTORY_PUBLIC_ORIGIN;

const ticket = `Notes are visible to everyone, even people who are not signed in. Make each note private to its author, and let the author share a note with specific teammates by username.

Done when:
1. Signed-out people see no notes.
2. Signed-in people see only their own notes and notes shared with them.
3. An author can share a note with a username and stop sharing it again.
4. Notes that already exist keep working after the change.`;

// checkin: a new stock run; upgrade: a run frozen on the previous review-v1 stock prompts.
const modes = ["checkin", "upgrade"] as const;
type Mode = (typeof modes)[number];
const stock = defaultWorkflows
	.find((w) => w.id === "factory-pipeline")!
	.steps.filter(
		(s) => s.architectureContract || s.tool === "architecture-decision",
	);
assert.equal(stock.length, 3);
const live = {
	runner: "codex" as const,
	model: "gpt-6.1-sol",
	reasoningEffort: "medium" as const,
};
const previousReviewerPrompt = `Review the architecture candidate and its complete implementation plan against ALL requirements, comments, answers, decisions and inherited Takeover work. Require briefVersion=1, concrete current-state findings, observable deliverables with anticipated files/operations/size estimates and criterion traces, every original acceptance criterion with honest covered/partial/deferred status and reason, justified Bob-added work, explicit non-goals and measurable acceptance checks. ${implementationScopeInstructions} Reject invented approval gates for routine dependency edits within the accepted requirements and architecture. ${architectureContinuationInstructions} Only when the COMPLETE candidate remains within that latest human acceptance, with no open decisions or unresolved uncertainty, include continuation:{proposalId:"exact accepted proposal ID",version:1,digest:"exact accepted digest",reason:"concrete evidence that cumulative changes preserve the accepted requirements, decisions, boundaries, limits, exclusions and delivery targets"}. This is an independent continuity assessment, never a new human acceptance. Omit continuation for initial proposals, material changes, explicit reapproval requirements, rejection or uncertainty. Compare the brief to the full plan: reject hidden deliverables, omitted known conditional work or criteria, vague options, limits whose values or measurement selection rules appear only in the full plan, unsupported coverage claims, unnecessary packages or frontend work, and process status masquerading as technical risk. Inspect runtime footprint warnings, including invalid paths, operation mismatches and unchanged map parts listed for work; require correction or a concrete explanation of intentional cross-area/config changes. Assess repository evidence, decisions and options, map, readability and routine classification. Reject proposals that hide a real choice or leave a decision open that the repository already settles. Do not implement. Return {"approved":true,"feedback":[]} or {"approved":false,"feedback":["concrete required changes"]}.`;
const workflow = (mode: Mode): Workflow => ({
	id: `checkin-${mode}`,
	name: `Check-in ${mode}`,
	labels: [`workflow:checkin-${mode}`],
	allowedTriggers: ["manual", "ticket-assignment"],
	steps: [
		...stock.map((step) =>
			step.type !== "agent"
				? { ...step, next: "implement" }
				: mode === "checkin"
					? { ...step, ...live }
					: step.architectureContract === "architecture-v1"
						? {
								...step,
								...live,
								name: "Discuss architecture",
								prompt: architectureInstructions,
								architectureBrief: "review-v1" as const,
							}
						: {
								...step,
								...live,
								name: "Review architecture candidate",
								prompt: previousReviewerPrompt,
							},
		),
		{
			id: "implement",
			name: "Fixture implement",
			type: "agent",
			runner: "codex",
			prompt: "Implement the accepted plan",
			inputs: ["plan"],
			next: "end",
			branches: [],
			maxVisits: 8,
		},
	] as Workflow["steps"],
});

const counts: Record<string, number> = {};
const unhandled: unknown[] = [];
const onUnhandled = (error: unknown) => unhandled.push(error);
process.on("unhandledRejection", onUnhandled);
const receipts: Record<string, unknown> = { root, counts };
type Internals = {
	getFactoryRuntime(): WorkflowRuntime;
	startRunTitle: () => void;
};
const inside = (worker: EdgeWorker) => worker as unknown as Internals;

function makeWorker() {
	const worker = new EdgeWorker({
		platform: "cli",
		issueTrackerFactory: createCLIIssueTracker,
		linearWorkspaces: {
			"cli-workspace": { linearToken: "cli-mode-no-token-needed" },
		},
		factoryHome: home,
		serverHost: "127.0.0.1",
		serverPort: 3603,
		maxConcurrentSessions: 2,
		defaultRunner: "codex",
		repositories: [
			{
				id: "notes",
				name: "Team notes",
				repositoryPath: repo,
				workspaceBaseDir: join(home, "worktrees"),
				baseBranch: "main",
				linearWorkspaceId: "cli-workspace",
				isActive: true,
			},
		],
		handlers: {
			createAgentRunner: (_runner, config) => {
				const role =
					config.appendSystemPrompt?.match(
						/software-factory step: ([^.]+)\./,
					)?.[1] ?? "other";
				counts[role] = (counts[role] ?? 0) + 1;
				if (role === "Fixture implement")
					return new MockAgentRunner(
						config,
						JSON.stringify({
							status: "completed",
							summary: "Implemented the accepted check-in.",
							checks: [],
							questions: [],
						}),
					);
				if (role === "other")
					return new MockAgentRunner(
						config,
						JSON.stringify({ title: "Private notes with sharing" }),
					);
				// The check-in author and its reviewer are real Codex sessions.
				return new CodexRunner({
					...config,
					configOverrides: { features: { multi_agent: false } },
					sandbox: "danger-full-access",
				});
			},
		},
	});
	inside(worker).startRunTitle = () => {};
	const runtime = inside(worker).getFactoryRuntime();
	if (!runtime.listWorkflows().some((w) => w.id === "checkin-checkin"))
		runtime.updateWorkflows(
			[...runtime.listWorkflows(), ...modes.map(workflow)],
			"checkin-checkin",
		);
	return worker;
}

const worker = makeWorker();
let token = "";
async function api(path: string, body?: unknown) {
	const response = await fetch(`http://localhost:3543${path}`, {
		method: body === undefined ? "GET" : "POST",
		headers: {
			authorization: `Bearer ${token}`,
			origin: "http://localhost:3543",
			"content-type": "application/json",
			"x-factory-request": "1",
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
	const value = await response.json();
	assert(response.ok, JSON.stringify(value));
	return value;
}
async function until(id: string, predicate: (run: FactoryRun) => boolean) {
	const deadline = Date.now() + 60 * 60 * 1000;
	while (Date.now() < deadline) {
		const run = inside(worker).getFactoryRuntime().runs.get(id);
		if (run?.status === "failed") throw new Error(run.error);
		if (run && predicate(run)) return run;
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	throw new Error(`Timed out ${id}`);
}
const gated = (versions: number) => (r: FactoryRun) =>
	r.status === "waiting" &&
	!!r.architectureGate &&
	r.architectureProposals!.at(-1)!.status === "pending" &&
	r.architectureProposals!.length > versions;
const cli = async (...args: string[]) =>
	(
		await execFile(join(process.cwd(), "apps/f1/f1"), args, {
			env: { ...process.env, BOBS_FACTORY_PORT: "3603" },
		})
	).stdout;
const decide = async (run: FactoryRun, decision: string, feedback?: string) => {
	const p = run.architectureProposals!.at(-1)!;
	await api(`/api/runs/${run.id}/architecture-decision`, {
		proposalId: p.id,
		version: p.version,
		digest: p.digest,
		decision,
		...(feedback ? { feedback } : {}),
	});
};
const summary = (run: FactoryRun) =>
	run.architectureProposals!.map((p) => ({
		version: p.version,
		status: p.status,
		shown: !!p.shownAt,
		brief: p.content.briefVersion,
		talkWords: p.content.talk
			? JSON.stringify(p.content.talk).split(/\s+/).length
			: 0,
		checks: p.content.talk?.checks.length,
		changes: p.content.changes,
	}));

try {
	await worker.start();
	token = requestFactoryTerminalSession(home);
	await cli("ping");
	const sessions = [] as string[];
	for (const [index, mode] of modes.entries()) {
		await cli(
			"create-issue",
			"--title",
			`Private notes (${mode})`,
			"--description",
			ticket,
			"--labels",
			`workflow:checkin-${mode}`,
		);
		await cli("start-session", "--issue-id", `issue-${index + 1}`);
		sessions.push(`session-${index + 1}`);
	}
	// Both runs draft concurrently with real Codex.
	for (const [index, mode] of modes.entries()) {
		const id = sessions[index]!;
		let run = await until(id, gated(0));
		const first = run.architectureProposals!.at(-1)!;
		const step = (r: FactoryRun) =>
			r.workflow.steps.find((s) => s.id === "architecture")!;
		if (mode === "checkin") {
			assert.equal(first.content.briefVersion, 2);
			assert(first.content.talk, "the human gets a check-in");
			assert(first.shownAt, "the shown version is recorded");
			const detail = await api(`/api/runs/${id}?view=architecture`);
			assert.equal(
				detail.architectureProposals.at(-1).content.talk.understood,
				first.content.talk!.understood,
			);
			// The human flags one point, the way the check-in composes notes.
			await decide(
				run,
				"revise",
				`About "How big it is" (${first.content.talk!.size}):\nPlease keep sharing to individual usernames only, no groups, and say so in what you won't do.`,
			);
			run = await until(id, gated(first.version));
			const second = run.architectureProposals!.at(-1)!;
			assert.equal(second.content.briefVersion, 2);
			assert(
				second.content.changes.some((c) => c.from === "you"),
				"Bob says what he did with the note",
			);
			assert.equal(
				run.architectureProposals!.find((p) => p.id === first.id)!.status,
				"rejected",
			);
			await decide(run, "accept");
			run = await until(id, (r) => r.status === "completed");
			assert.equal(counts["Fixture implement"], 1);
		} else {
			assert.equal(first.content.briefVersion, 1);
			assert.equal(first.content.talk, undefined);
			assert.equal(step(run).architectureBrief, "review-v1");
			await decide(
				run,
				"revise",
				"Please keep sharing to individual usernames only.",
			);
			run = await until(id, gated(first.version));
			const next = run.architectureProposals!.at(-1)!;
			assert.equal(
				next.content.briefVersion,
				2,
				"the requested version is a check-in",
			);
			assert(next.content.talk);
			assert.equal(step(run).prompt, checkinInstructions);
			assert.equal(step(run).architectureBrief, "checkin-v1");
			assert.equal(step(run).model, "gpt-6.1-sol");
			assert(
				run.events.some((e) => e.message.includes("written as a check-in")),
			);
			assert.equal(run.status, "waiting", "approval is still required");
		}
		writeFileSync(join(root, `${mode}.json`), JSON.stringify(run, null, 2));
		receipts[mode] = { id, status: run.status, proposals: summary(run) };
	}
	assert.equal(unhandled.length, 0);
	console.log("F1_CHECKIN_PASS", JSON.stringify(receipts));
	if (process.env.F1_HOLD === "1") {
		writeFileSync(join(root, "ready"), "");
		console.log("F1_HOLD", root);
		while (!existsSync(join(root, "stop")))
			await new Promise((resolve) => setTimeout(resolve, 500));
	}
} finally {
	await worker.stop();
	process.off("unhandledRejection", onUnhandled);
	writeFileSync(join(root, "receipts.json"), JSON.stringify(receipts, null, 2));
	console.log("EVIDENCE_ROOT", root);
}
