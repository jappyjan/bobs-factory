// Explicitly authorized live Codex drive. Discovery only; no automatic Apply choices.
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createCLIIssueTracker, JsonSnapshotStore } from "bobs-factory-core";
import { EdgeWorker } from "../../../../../packages/edge-worker/src/EdgeWorker.ts";
import type { FactoryRun } from "../../../../../packages/edge-worker/src/factory/WorkflowRuntime.ts";

if (process.env.F1_AGENT_MODE !== "live")
	throw new Error(
		"Set F1_AGENT_MODE=live only with explicit user authorization",
	);
const restore =
	process.env.BOBS_FACTORY_IMPROVE_RESTORE === "1"
		? JSON.parse(
				readFileSync("/tmp/bobs-factory-live-improvement.json", "utf8"),
			)
		: undefined;
const source = process.cwd(),
	home = restore?.home ?? mkdtempSync(join(tmpdir(), "bobs-live-improvement-")),
	repo = join(home, "repo");
const sourceSha =
	restore?.sourceSha ??
	execFileSync("git", ["-C", source, "rev-parse", "HEAD"], {
		encoding: "utf8",
	}).trim();
if (!restore) {
	execFileSync("git", ["clone", "--shared", "--no-checkout", source, repo], {
		stdio: "pipe",
	});
	execFileSync("git", ["-C", repo, "checkout", "-B", "main", sourceSha], {
		stdio: "pipe",
	});
	execFileSync("git", ["-C", repo, "remote", "set-url", "origin", repo], {
		stdio: "pipe",
	});
}
const port = Number(process.env.BOBS_FACTORY_IMPROVE_PORT ?? 3600);
process.env.BOBS_FACTORY_FACTORY_PORT = String(port);
const sourceConfig = join(homedir(), ".bobs-factory/config.json");
const configuredRepositories = existsSync(sourceConfig)
	? (JSON.parse(readFileSync(sourceConfig, "utf8")).repositories ?? [])
	: [];
const repositoryId =
	restore?.repositoryId ??
	process.env.BOBS_FACTORY_IMPROVE_REPOSITORY_ID ??
	configuredRepositories.find(
		(r: { name?: string; repositoryPath?: string }) =>
			/bob.?s.?factory/i.test(r.name ?? "") ||
			r.repositoryPath?.endsWith("/bobs-factory"),
	)?.id ??
	"demo-bobs-factory";
const worker = new EdgeWorker({
	platform: "cli",
	factoryHome: home,
	serverPort: port + 1,
	serverHost: "localhost",
	strictMcpConfig: true,
	defaultRunner: "codex",
	codexDefaultModel: "gpt-6.1-sol",
	issueTrackerFactory: createCLIIssueTracker,
	repositories: [
		{
			id: repositoryId,
			name: "Bob’s Factory · live demo",
			repositoryPath: repo,
			baseBranch: "main",
			workspaceBaseDir: join(home, "worktrees"),
			isActive: true,
			linearWorkspaceId: "cli-workspace",
		},
	],
	linearWorkspaces: {
		"cli-workspace": { linearToken: "cli-mode-no-token-needed" },
	},
});
await worker.start();
const runtime = worker.getFactoryRuntime();
const workflows = runtime.listWorkflows(),
	definition = workflows.find((w) => w.id === "improve-codebase")!;
definition.steps.find((s) => s.id === "research-worker")!.model = "gpt-6-luna";
definition.steps.find((s) => s.id === "research-worker")!.reasoningEffort =
	"medium";
runtime.updateWorkflows(workflows);
runtime.updateTitleSettings({
	runner: "codex",
	model: "gpt-6-luna",
	reasoningEffort: "low",
});
// Read a dated subset of real local Bob history. Never copy credentials, raw prompts or native execution bindings.
const production = join(homedir(), ".bobs-factory/factory"),
	snapshots = new JsonSnapshotStore(join(production, "run-chunks"));
const historyIds: string[] = [];
for (const file of restore ? [] : readdirSync(join(production, "runs"))) {
	if (!file.endsWith(".json")) continue;
	const path = join(production, "runs", file),
		envelope = JSON.parse(readFileSync(path, "utf8")),
		summary = envelope.summary ?? envelope;
	if (
		summary.repositoryId !== repositoryId ||
		Date.parse(summary.updatedAt) < Date.now() - 30 * 86400000
	)
		continue;
	const sourceRun =
		envelope.format === "bobs-factory-json-snapshot-1"
			? snapshots.load<FactoryRun>(path).value
			: envelope;
	const observed = {
		workspace: "",
		input: "Read-only historical observation",
		outputs: {},
		events: [],
		history: [],
		answers: [],
		id: summary.id,
		repositoryId,
		status: summary.status,
		step: summary.step,
		createdAt: summary.createdAt,
		updatedAt: summary.updatedAt,
		workflow: { id: summary.workflow },
		architectureGate: sourceRun.architectureGate ? {} : undefined,
		reviewGate: sourceRun.reviewGate ? {} : undefined,
		questions: sourceRun.questions?.length ? ["Awaiting human input"] : [],
		capacityLeaves: Object.fromEntries(
			Object.entries(sourceRun.capacityLeaves ?? {}).map(([key, value]) => [
				key,
				{ phase: value.phase },
			]),
		),
		activitySteps: sourceRun.activitySteps?.slice(-50),
		stepAttempts: sourceRun.stepAttempts?.slice(-30).map((a) => ({
			step: a.step,
			outcome: a.outcome,
			startedAt: a.startedAt,
			endedAt: a.endedAt,
			runtime: a.runtime,
			revision: a.revision,
		})),
		error: sourceRun.error
			? /timeout|timed out/i.test(sourceRun.error)
				? "timeout"
				: /auth|credential|401|403/i.test(sourceRun.error)
					? "authentication failure"
					: /output|schema|json|validation/i.test(sourceRun.error)
						? "output validation failure"
						: "recorded run failure"
			: undefined,
	};
	runtime.runs.set(observed.id, observed as FactoryRun);
	historyIds.push(observed.id);
}
let run: FactoryRun | undefined;
const startedAt = new Date().toISOString();
try {
	run = restore
		? runtime.get(restore.runId)
		: await worker.startManualFactoryRun({
				repositoryId,
				workflow: "improve-codebase",
				runner: "codex",
				model: "gpt-6.1-sol",
				reasoningEffort: "medium",
				inputs: {},
			});
	const info = {
		mode: "live",
		home,
		repository: repo,
		sourceSha,
		repositoryId,
		runId: run.id,
		url: `http://localhost:${port}/#/runs/${run.id}`,
		coordinatorModel: "gpt-6.1-sol",
		workerModel: "gpt-6-luna",
		observedHistory: restore?.observedHistory ?? historyIds.length,
		startedAt: restore?.startedAt ?? startedAt,
		restoredAt: restore ? new Date().toISOString() : undefined,
	};
	writeFileSync(
		"/tmp/bobs-factory-live-improvement.json",
		JSON.stringify(info, null, 2),
	);
	console.log(`LIVE_READY ${JSON.stringify(info)}`);
	const timer = setInterval(() => {
		if (run?.improvementState?.operations) {
			for (const id of historyIds) runtime.runs.delete(id);
		}
		const state = run?.improvementState;
		if (state)
			console.log(
				"LIVE_PROGRESS " +
					JSON.stringify({
						status: run?.status,
						phase: state.phase,
						completed: Object.values(state.jobs).filter(
							(j) => j.status === "completed",
						).length,
						failed: Object.values(state.jobs).filter(
							(j) => j.status === "failed",
						).length,
						step: run?.step,
						error: run?.error,
						versions: state.proposals.length,
					}),
			);
	}, 15000);
	await new Promise<void>((resolve) => {
		process.once("SIGINT", resolve);
		process.once("SIGTERM", resolve);
	});
	clearInterval(timer);
} finally {
	for (const id of historyIds) runtime.runs.delete(id);
	await worker.stop();
}
