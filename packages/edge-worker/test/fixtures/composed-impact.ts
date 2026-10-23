import { execFileSync, spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect } from "vitest";
import { z } from "zod";
import { createFactoryContextServer } from "../../../mcp-tools/src/factoryContext.js";
import { installStockChecks } from "../../src/factory/CheckPresets.js";
import { defaultWorkflows } from "../../src/factory/defaultWorkflows.js";
import { QaScopeSchema } from "../../src/factory/FactoryResults.js";
import {
	captureEvidence,
	FactoryTools,
	QaCaptureSchema,
} from "../../src/factory/FactoryTools.js";
import type {
	ImpactAssessment,
	ImpactSnapshot,
} from "../../src/factory/Impact.js";
import { roleProgress } from "../../src/factory/Incremental.js";
import { parseStepOutput } from "../../src/factory/OutputFormats.js";
import { qaDigest } from "../../src/factory/Qa.js";
import { verifyQaEnvironment } from "../../src/factory/QaReuse.js";
import { hasCheck, readOutput } from "../../src/factory/StepConfig.js";
import {
	latestAggregate,
	type AggregateReview,
} from "../../src/factory/SpecialistReview.js";
import { StepSchema, validateWorkflows } from "../../src/factory/Workflow.js";
import {
	type RuntimeHooks,
	WorkflowRuntime,
} from "../../src/factory/WorkflowRuntime.js";

export const baseline = process.env.TASK145_BASELINE === "1";
export const cases = [
	"provider-recovery",
	"metadata-answer",
	"small-correction",
	"target-advance",
	"integration-conflict",
	"accepted-requirements",
	"weakened-tests",
	"extraction-drift",
] as const;
export type ReplayCase = (typeof cases)[number];
export const roles = {
	outer: "dispatch-bundle",
	inner: "inspect-bundle",
	inventory: "accepted-scope",
	assessor: "delta-reader",
	checks: "chosen-verifications",
	panel: "independent-panel",
	gate: "receipt-check",
	disposition: "return-route",
	edit: "apply-request",
	repair: "resolve-integration",
	plan: "behavior-plan",
	capture: "behavior-execution",
	qaReview: "evidence-reader",
	qaGate: "behavior-check",
	publication: "publish-draft",
	qaRoute: "after-evidence",
	retainedCi: "retained-evidence-readiness",
	providerFix: "provider-recovery-fix",
	ci: "forge-observation",
	guide: "review-notes",
	handoff: "present-revision",
	human: "explicit-acceptance",
	merge: "guarded-delivery",
	security: "trust-boundary",
	architecture: "dependency-boundary",
	maintenance: "lifecycle-boundary",
	integration: "combined-tree",
	quality: "failure-paths",
	coverage: "accepted-behavior",
};
export const specialists = [
	roles.security,
	roles.architecture,
	roles.maintenance,
	roles.integration,
	roles.quality,
	roles.coverage,
];
export const reviewKey = `${roles.outer}/${roles.inner}/${roles.panel}`;
export const producer = (id: string) => `${roles.outer}/${roles.inner}/${id}`;
const port = {
	inventory: "inventoryPort",
	fanout: "reviewPort",
	impact: "assessmentPort",
};
const require = createRequire(import.meta.url);
const metrics: Record<string, unknown> = {};
export function saveMetrics(name: string, value: unknown) {
	metrics[name] = value;
	if (process.env.TASK145_METRICS_PATH)
		writeFileSync(
			process.env.TASK145_METRICS_PATH,
			JSON.stringify({ baseline, cases: metrics }, null, 2),
		);
}

// Real bounded MCP reads; no direct JSON-size estimate stands in for retrieval.
async function retrieve(
	input: unknown,
	measurements: { calls: number; characters: number; bytes: number },
) {
	const from = join(__dirname, "../../../mcp-tools");
	const { Client } = await import(
		require.resolve("@modelcontextprotocol/sdk/client/index.js", {
			paths: [from],
		})
	);
	const { InMemoryTransport } = await import(
		require.resolve("@modelcontextprotocol/sdk/inMemory.js", { paths: [from] })
	);
	const server = createFactoryContextServer(input);
	const client = new Client({ name: "composed-impact-replay", version: "1" });
	const [a, b] = InMemoryTransport.createLinkedPair();
	await server.connect(a);
	await client.connect(b);
	try {
		for (const name of ["list_context", "read_context"]) {
			const result = await client.callTool({
				name,
				arguments: {
					path: "",
					offset: 0,
					limit: name === "list_context" ? 40 : 4000,
				},
			});
			if (result.isError) throw new Error(JSON.stringify(result));
			measurements.calls++;
			measurements.characters += JSON.stringify(result).length;
			measurements.bytes += Buffer.byteLength(JSON.stringify(result));
		}
	} finally {
		await client.close();
		await server.close();
	}
}

export function definitions() {
	const agent = (id: string, extra = {}) =>
		StepSchema.parse({
			id,
			name: id,
			type: "agent",
			configVersion: "step-config-v1",
			prompt:
				"Independently inspect actual accepted inputs and repository evidence",
			output: { format: "json-v1" },
			...extra,
		});
	const tool = (id: string, name: string, extra = {}) =>
		StepSchema.parse({
			id,
			name: id,
			type: "tool",
			configVersion: "step-config-v1",
			tool: name,
			...extra,
		});
	const reviewReads = {
		inventory: roles.inventory,
		fanout: roles.panel,
		impact: roles.assessor,
	};
	const audit = [
		agent(roles.assessor, {
			reads: {
				inventory: roles.inventory,
				fanout: roles.panel,
				feedback: "@feedback",
				answers: "@answers",
			},
			output: { format: "impact-v1" },
			access: "read-only",
			askQuestions: true,
			checks: [
				{
					check: "impact-reuse",
					maxUnchangedCycles: 3,
					...(!baseline ? { reuseVersion: "composed-v1" } : {}),
				},
			],
			next: roles.checks,
			branches: [
				{
					when: { path: "correctionRequired", equals: true },
					next: "integrate",
				},
				{
					when: { path: "extractRequirements", equals: true },
					next: "external-revision-boundary",
				},
			],
		}),
		StepSchema.parse({
			id: "external-revision-boundary",
			name: "Observe a concurrent fixture writer",
			type: "script",
			configVersion: "step-config-v1",
			script: "git status --porcelain",
			next: roles.inventory,
		}),
		agent(roles.inventory, {
			reads: { answers: "@answers" },
			askQuestions: true,
			output: { format: "inventory-v1" },
			checks: ["inventory-evidence"],
			revision: "bound",
			access: "read-only",
			next: roles.checks,
		}),
		tool(roles.checks, "impact-checks", {
			reads: { inventory: roles.inventory, impact: roles.assessor },
			checks: ["impact-boundary"],
			next: roles.panel,
		}),
		StepSchema.parse({
			id: roles.panel,
			name: "Configured specialist Parallel",
			type: "fanout",
			configVersion: "step-config-v1",
			reads: { inventory: roles.inventory, impact: roles.assessor },
			checks: ["review-boundary", "impact-boundary"],
			groups: specialists.map((id) => [
				agent(id, {
					output: {
						format: id === roles.coverage ? "coverage-v1" : "specialist-v1",
					},
					checks: [
						{
							check: "specialist-evidence",
							...(id === roles.coverage ? { coverage: true } : {}),
						},
					],
					revision: "bound",
					access: "read-only",
				}),
			]),
			next: roles.gate,
		}),
		tool(roles.gate, "review-gate", {
			reads: reviewReads,
			checks: ["review-boundary", "impact-boundary"],
			next: roles.disposition,
		}),
		StepSchema.parse({
			id: roles.disposition,
			name: "Return an explicit Call outcome",
			type: "check",
			configVersion: "step-config-v1",
			reads: { history: "@history" },
			check: {
				results: {
					edit: {
						count: "/inputs/history",
						where: { path: "/step", equals: `${roles.outer}/${roles.edit}` },
						max: 0,
					},
				},
			},
			branches: [{ when: { path: "edit", equals: true }, next: "rework" }],
			next: "completed",
		}),
	];
	installStockChecks(audit);
	const downstream = {
		inventory: port.inventory,
		fanout: port.fanout,
		impact: port.impact,
	};
	const qaReads = {
		...downstream,
		scope: roles.plan,
		capture: roles.capture,
		qaReview: roles.qaReview,
		qaGate: roles.qaGate,
	};
	const delivery = [
		tool(roles.publication, "draft-pr", { next: roles.ci }),
		tool(roles.ci, "ci", {
			reads: {
				fanout: port.fanout,
				impact: port.impact,
				ci: roles.ci,
				draftPr: roles.publication,
				scope: roles.plan,
				capture: roles.capture,
				qaGate: roles.qaGate,
			},
			checks: ["impact-boundary"],
			branches: [
				{ when: { path: "impactRequired", equals: true }, next: roles.inner },
				{ when: { path: "fix", equals: true }, next: roles.providerFix },
			],
			next: roles.inner,
		}),
		agent(roles.providerFix, {
			reads: { publication: roles.publication },
			next: roles.inner,
		}),
		StepSchema.parse({
			id: roles.inner,
			name: "Inner review Call",
			type: "workflow",
			configVersion: "step-config-v1",
			workflow: "composed-audit",
			reads: { requestMetadata: "@answers" },
			inputMapping: { requestMetadata: "/inputs/requestMetadata" },
			bindings: Object.fromEntries(
				Object.values(port).map((name) => [name, `@bindings/${name}`]),
			),
			...(!baseline ? { inputFreshness: "on-read" } : {}),
			branches: [
				{ when: { path: "outcome", equals: "rework" }, next: roles.plan },
				{ when: { path: "outcome", equals: "integrate" }, next: roles.repair },
			],
			next: roles.retainedCi,
		}),
		tool(roles.retainedCi, "ci", {
			reads: { ...qaReads, draftPr: roles.publication },
			checks: ["impact-boundary"],
			branches: [
				{ when: { path: "retainQa", equals: true }, next: roles.guide },
			],
			next: roles.plan,
		}),
		agent(roles.edit, { askQuestions: true, next: roles.ci }),
		agent(roles.repair, { next: roles.inner }),
		agent(roles.plan, {
			reads: downstream,
			checks: ["impact-boundary"],
			output: { format: "qa-scope-v1" },
			next: roles.capture,
		}),
		agent(roles.capture, {
			reads: qaReads,
			checks: ["capture-evidence", "qa-environment", "impact-boundary"],
			output: { format: "qa-capture-v1" },
			next: roles.qaReview,
		}),
		agent(roles.qaReview, {
			reads: qaReads,
			checks: ["qa-review-evidence", "impact-boundary"],
			output: { format: "qa-review-v1" },
			next: roles.qaGate,
		}),
		tool(roles.qaGate, "visual-gate", {
			reads: { ...qaReads, review: roles.qaReview },
			checks: ["qa-evidence", "impact-boundary"],
			next: roles.qaRoute,
		}),
		StepSchema.parse({
			id: roles.qaRoute,
			name: "Edit only after first complete independent QA",
			type: "check",
			configVersion: "step-config-v1",
			reads: { history: "@history" },
			check: {
				results: {
					edit: {
						count: "/inputs/history",
						where: { path: "/step", equals: `${roles.outer}/${roles.edit}` },
						max: 0,
					},
				},
			},
			branches: [{ when: { path: "edit", equals: true }, next: roles.edit }],
			next: roles.guide,
		}),
		agent(roles.guide, { reads: qaReads, next: roles.handoff }),
		tool(roles.handoff, "handoff", {
			reads: {
				...qaReads,
				guide: roles.guide,
				draftPr: roles.publication,
				ci: roles.retainedCi,
			},
			checks: ["qa-evidence", "impact-boundary"],
			next: roles.human,
		}),
		tool(roles.human, "human-review", {
			reads: {
				...downstream,
				handoff: roles.handoff,
				draftPr: roles.publication,
			},
			checks: ["impact-boundary"],
			next: roles.merge,
		}),
		tool(roles.merge, "merge", {
			reads: { ...downstream, draftPr: roles.publication },
			checks: ["impact-boundary"],
			next: "completed",
		}),
	];
	installStockChecks(delivery);
	// Imported evidence ports are data, so correction routes return to the
	// caller instead of treating an imported assessor name as a local step.
	for (const step of delivery)
		for (const branch of step.branches)
			if (branch.next === port.impact) branch.next = "reassess";
	return validateWorkflows([
		...defaultWorkflows,
		{
			id: "composed-audit",
			name: "Composed audit",
			stepConfigVersion: "step-config-v1",
			allowedTriggers: ["workflow"],
			inputs: [...Object.values(port), "requestMetadata"],
			outcomes: ["rework", "integrate", "completed"],
			steps: audit,
		},
		{
			id: "composed-delivery",
			name: "Composed delivery",
			stepConfigVersion: "step-config-v1",
			allowedTriggers: ["workflow"],
			inputs: [...Object.values(port), roles.inventory],
			outcomes: ["completed", "reassess"],
			steps: delivery,
		},
		{
			id: "composed-replay",
			name: "Composed replay",
			stepConfigVersion: "step-config-v1",
			steps: [
				StepSchema.parse({
					id: roles.outer,
					name: "Outer delivery Call",
					type: "workflow",
					configVersion: "step-config-v1",
					workflow: "composed-delivery",
					bindings: {
						[port.inventory]: producer(roles.inventory),
						// Explicit alias lets the old consumer-frame implementation reach
						// each differential correction, before its remaining replay defects.
						[roles.inventory]: producer(roles.inventory),
						[port.fanout]: producer(roles.panel),
						[port.impact]: producer(roles.assessor),
					},
					...(!baseline ? { inputFreshness: "on-read" } : {}),
					branches: [
						{
							when: { path: "outcome", equals: "reassess" },
							next: roles.outer,
							entry: roles.inner,
						},
					],
					next: "end",
				}),
			],
		},
	]);
}

export function setupReplay(kind: ReplayCase, layout: "js" | "python") {
	const home = mkdtempSync(join(tmpdir(), "composed-impact-"));
	const workspace = join(home, "work"),
		origin = join(home, "origin.git"),
		state = join(home, "state");
	mkdirSync(workspace);
	const env = {
		...process.env,
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_TERMINAL_PROMPT: "0",
		GIT_AUTHOR_DATE: "2026-10-23T00:00:00Z",
		GIT_COMMITTER_DATE: "2026-10-23T00:00:00Z",
		PYTHONDONTWRITEBYTECODE: "1",
	};
	const execute = (cwd: string, exe: string, args: string[]) =>
		execFileSync(exe, args, {
			cwd,
			env,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
	const git = (...args: string[]) => execute(workspace, "git", args);
	const attemptGit = (...args: string[]) =>
		spawnSync("git", args, { cwd: workspace, env, encoding: "utf8" });
	const target = layout === "js" ? "release-fixture" : "supported-fixture";
	const auth =
		layout === "js" ? "src/authorization.cjs" : "service/authorization.py";
	const cleanup = layout === "js" ? "src/cleanup.cjs" : "service/cleanup.py";
	const check = layout === "js" ? "checks/behavior.cjs" : "checks/behavior.py";
	mkdirSync(join(workspace, dirname(auth)), { recursive: true });
	mkdirSync(join(workspace, "checks"));
	const cleanupSource = (absent: boolean) =>
		layout === "js"
			? `module.exports = resource => resource.owner === 'ours'${absent ? " && resource.present !== false" : ""};\n`
			: `def removable(resource):\n    return resource['owner'] == 'ours'${absent ? " and resource.get('present', True)" : ""}\n`;
	const checkSource =
		layout === "js"
			? "const assert = require('node:assert/strict'); const allowed = require('../src/authorization.cjs'); const removable = require('../src/cleanup.cjs'); assert(allowed('trusted')); assert(!allowed('unknown')); assert(removable({owner:'ours'})); assert(!removable({owner:'foreign'})); console.log('ownership and authorization verified');\n"
			: "import sys\nsys.path.insert(0, 'service')\nfrom authorization import allowed\nfrom cleanup import removable\nassert allowed('trusted') and not allowed('unknown')\nassert removable({'owner': 'ours'}) and not removable({'owner': 'foreign'})\nprint('ownership and authorization verified')\n";
	git("init", "-b", target);
	git("config", "user.name", "Composed fixture");
	git("config", "user.email", "fixture@example.invalid");
	git("config", "commit.gpgsign", "false");
	writeFileSync(
		join(workspace, auth),
		layout === "js"
			? "module.exports = caller => caller === 'trusted';\n"
			: "def allowed(caller):\n    return caller == 'trusted'\n",
	);
	writeFileSync(join(workspace, cleanup), cleanupSource(false));
	writeFileSync(join(workspace, check), checkSource);
	git("add", ".");
	git("commit", "-m", "original fixture");
	execute(home, "git", ["init", "--bare", origin]);
	git("remote", "add", "origin", origin);
	git("push", "-u", "origin", target);
	git("checkout", "-b", "ownership-change");
	writeFileSync(
		join(workspace, cleanup),
		`${cleanupSource(false)}${layout === "js" ? "//" : "#"} preserve foreign resources\n`,
	);
	git("commit", "-am", "ownership change");
	const initialHead = git("rev-parse", "HEAD"),
		initialBase = git("rev-parse", `origin/${target}`);
	const calls: {
		role: string;
		key: string;
		round?: number;
		resume?: string;
		head: string;
	}[] = [];
	const snapshots: ImpactSnapshot[] = [];
	const checkVisits: {
		head: string;
		snapshot: ImpactSnapshot;
		pending: string[];
	}[] = [];
	const checkRuns: string[] = [];
	const qaHeads: string[] = [],
		providerCalls: {
			operation: string;
			input: Record<string, unknown>;
			head: string;
			human: number;
		}[] = [];
	const retrieval = { calls: 0, characters: 0, bytes: 0 };
	const toolTrace: { step: string; phase: string }[] = [];
	let edited = false,
		repaired = false,
		driftHead: string | undefined,
		driftSnapshot: ImpactSnapshot | undefined;
	let conflict: { code: number | null; output: string } | undefined;
	let originalQa:
		| { capture: unknown; review: unknown; gate: unknown }
		| undefined;
	let draft = true,
		merged = false,
		created = false,
		providerFailureShown = false;
	const url = `https://forge.example/replay/${layout}/pulls/7`;
	const command =
		layout === "js" ? "node checks/behavior.cjs" : "python3 checks/behavior.py";
	const runBehavior = () => {
		const output = execute(
			workspace,
			layout === "js" ? process.execPath : "python3",
			[check],
		);
		if (
			edited &&
			[
				"small-correction",
				"accepted-requirements",
				"extraction-drift",
			].includes(kind)
		)
			execute(
				workspace,
				layout === "js" ? process.execPath : "python3",
				layout === "js"
					? [
							"-e",
							"const assert=require('node:assert/strict'); const removable=require('./src/cleanup.cjs'); assert(!removable({owner:'ours',present:false}));",
						]
					: [
							"-c",
							"import sys; sys.path.insert(0,'service'); from cleanup import removable; assert not removable({'owner':'ours','present':False})",
						],
			);
		return output;
	};
	const commit = (message: string) => {
		git("add", ".");
		git("commit", "-m", message);
	};
	const advanceTarget = (overlap: boolean) => {
		git("checkout", target);
		if (overlap) writeFileSync(join(workspace, cleanup), cleanupSource(true));
		else
			writeFileSync(
				join(workspace, "release-notes.txt"),
				"unrelated packaging note\n",
			);
		commit("target advancement");
		git("push", "origin", target);
		git("checkout", "ownership-change");
	};
	const tools = new FactoryTools({
		postComment: async () => {},
		command: async (context, exe, args) => {
			if (exe !== "fixture-forge") {
				if (exe === "/bin/sh" && args[1] === command)
					checkRuns.push(git("rev-parse", "HEAD"));
				return execute(context.run.workspace, exe, args);
			}
			const request = z
				.object({ input: z.record(z.string(), z.unknown()) })
				.parse(JSON.parse(readFileSync(args.at(-1)!, "utf8")));
			const operation = args[0]!;
			const head = git("rev-parse", "HEAD");
			expect(git("rev-parse", "origin/ownership-change")).toBe(head);
			providerCalls.push({
				operation,
				input: request.input,
				head,
				human: context.run.humanDecisions?.length ?? 0,
			});
			if (operation === "list")
				return JSON.stringify(created ? [{ url, isDraft: draft }] : []);
			if (operation === "create") {
				expect(request.input.baseBranch).toBe(target);
				created = true;
				return JSON.stringify({ url });
			}
			if (operation === "view")
				return JSON.stringify({
					url,
					number: 7,
					title: "Ownership",
					body: "Fixture",
					headRefName: "ownership-change",
					headRefOid: head,
					baseRefName: target,
					state: merged ? "MERGED" : "OPEN",
					isDraft: draft,
					isCrossRepository: false,
				});
			if (operation === "description") return JSON.stringify({ ok: true });
			if (operation === "draft") {
				expect(context.run.humanDecisions?.at(-1)?.decision).toBe("approve");
				draft = request.input.draft === true;
				return JSON.stringify({ ok: true });
			}
			if (operation === "merge") {
				expect(request.input).toMatchObject({
					url,
					headSha: head,
					method: "merge",
				});
				expect(context.run.humanDecisions?.at(-1)).toMatchObject({
					decision: "approve",
					headSha: head,
				});
				merged = true;
				return JSON.stringify({ ok: true });
			}
			if (operation !== "readiness")
				throw new Error(`Unexpected native provider effect ${operation}`);
			const failed =
				kind === "provider-recovery" && edited && !providerFailureShown;
			if (failed) providerFailureShown = true;
			return JSON.stringify({
				url,
				headSha: head,
				baseSha: git("rev-parse", `origin/${target}`),
				baseRefName: target,
				state: merged ? "MERGED" : "OPEN",
				isDraft: draft,
				approved: !draft && !merged && !failed,
				reviewReady: !merged && !failed,
				fix: failed,
				blockers: failed
					? [
							{
								kind: "check",
								action: "fix",
								message: "Transient provider runner failure",
							},
						]
					: draft
						? [
								{
									kind: "draft",
									action: "human",
									message: "Explicit human approval required",
								},
							]
						: [],
				checks: [
					{
						name: "synthetic-native-check",
						state: failed ? "failure" : "success",
						bucket: failed ? "fail" : "pass",
					},
				],
				comments:
					kind === "metadata-answer" && edited
						? [
								{
									id: "thanks",
									body: "Thanks for the update",
									updated_at: edited
										? "2026-10-23T02:00:00Z"
										: "2026-10-23T01:00:00Z",
									user: { login: "reviewer" },
								},
							]
						: [],
				threads: [],
				reviews: [],
				queued: false,
				mergeMethod: "merge",
			});
		},
	});
	const hooks: RuntimeHooks = {
		script: async (context) => {
			if (context.step.id === "external-revision-boundary") {
				if (kind === "extraction-drift" && edited && !driftHead) {
					driftSnapshot = structuredClone(
						context.run.impactDecisions!.at(-1)!.snapshot,
					);
					writeFileSync(
						join(workspace, auth),
						`${readFileSync(join(workspace, auth), "utf8")}${layout === "js" ? "//" : "#"} concurrent revision after independent assessment\n`,
					);
					commit("unassessed post-assessment drift");
					git("push", "origin", "HEAD");
					driftHead = git("rev-parse", "HEAD");
				}
			}
			return tools.script(context);
		},
		evidence: (context) => tools.evidence(context),
		tool: async (context) => {
			toolTrace.push({ step: context.step.id, phase: "start" });
			if (context.step.tool === "impact-checks") {
				const decision = context.run.impactDecisions!.at(-1)!;
				checkVisits.push({
					head: git("rev-parse", "HEAD"),
					snapshot: structuredClone(decision.snapshot),
					pending: [...decision.pending.checks],
				});
			}
			const output = await tools.tool(context);
			toolTrace.push({ step: context.step.id, phase: "done" });
			return output;
		},
		agent: async (context) => {
			calls.push({
				role: context.step.id,
				key: context.stepKey!,
				round: context.reviewBaseline?.round,
				resume: context.resumeAgent?.sessionId,
				head: git("rev-parse", "HEAD"),
			});
			await context.checkpointAgent?.({
				runner: "codex",
				sessionId: `synthetic-${context.stepKey}`,
			});
			await retrieve(context.input, retrieval);
			const id = context.step.id;
			if (id === roles.assessor) {
				const input = context.input as {
					impactSnapshot: ImpactSnapshot;
					impactEvidence: {
						digest: string;
						receipt: AggregateReview["reviewers"][number];
					}[];
					feedback?: {
						readiness?: {
							unassessedComments?: {
								id: string;
								bodySha256: string;
								repositoryId?: string;
							}[];
						};
					};
				};
				const snapshot = input.impactSnapshot;
				snapshots.push(structuredClone(snapshot));
				const prior = latestAggregate(context.run, reviewKey);
				const changedRequirements = context.run.answers.some((a) =>
					a.answer.includes(
						"Accept the additional absent-resource requirement",
					),
				);
				const unsafe =
					[
						"integration-conflict",
						"weakened-tests",
						"accepted-requirements",
						"extraction-drift",
					].includes(kind) && edited;
				const correction =
					edited &&
					!repaired &&
					["integration-conflict", "weakened-tests"].includes(kind);
				const changed = snapshot.repositories.some((r) => r.diff);
				const capture = QaCaptureSchema.safeParse(
					context.run.outputs[`${roles.outer}/${roles.capture}`],
				);
				const originalCriterion = capture.success
					? capture.data.results[0]?.criteria[0]
					: undefined;
				const verify = !prior || changed || unsafe;
				const selected =
					kind === "small-correction" && edited
						? [roles.quality, roles.coverage]
						: [];
				const reuse =
					!prior || unsafe
						? []
						: input.impactEvidence
								.filter(
									({ receipt }) =>
										receipt.status === "completed" &&
										!selected.includes(receipt.stamp.reviewer) &&
										receipt.evidenceBoundary,
								)
								.map(({ digest, receipt }) => ({
									reviewer: receipt.stamp.reviewer,
									receiptDigest: digest,
									boundary: receipt.evidenceBoundary!.boundary,
									reason: `${receipt.stamp.reviewer}: inspected actual unchanged callers and dependencies; the requested ownership correction cannot cross this boundary`,
								}));
				const inventory = prior?.baseline.inventory;
				const currentInventory = (
					context.input as {
						inventory?: AggregateReview["baseline"]["inventory"];
					}
				).inventory;
				const extracted =
					currentInventory?.requirements.some((r) => r.id === "R2") &&
					changedRequirements;
				const retainedInventory = extracted ? currentInventory : inventory;
				return {
					impactContract: "impact-v1",
					status: "completed",
					summary: "Independent composed impact inspection",
					correctionRequired: correction,
					readinessOnly: false,
					commentAssessments: (
						input.feedback?.readiness?.unassessedComments ?? []
					).map((comment) => ({
						...comment,
						disposition: "informational",
						reason:
							"The unchanged thanks message requests no behavior or requirement change",
					})),
					classification:
						!prior || unsafe ? "full" : changed ? "affected" : "none",
					rationale: correction
						? "The real combined tree conflicts or test protection was weakened; correction is mandatory"
						: "Inspected actual source, target-only delta, original receipts and accepted answers",
					uncertainty:
						correction && kind === "integration-conflict"
							? ["Combined tree has an actual merge conflict"]
							: [],
					extractRequirements:
						!prior || (unsafe && changedRequirements && !extracted),
					...(retainedInventory &&
					(extracted || !unsafe) &&
					context.run.answers.length
						? {
								scopeReuse: {
									inventoryDigest: retainedInventory.digest,
									originalSourceDigest: retainedInventory.sourceContextDigest!,
									reason: extracted
										? "The qualified original extraction already covers the accepted added requirement; its source context remains current"
										: "The operational answer restores access and explicitly preserves every accepted requirement",
								},
							}
						: {}),
					specialists: snapshot.reviewers
						.map((r) => r.id)
						.filter((id) => !reuse.some((r) => r.reviewer === id)),
					requirementIds: [],
					checks: verify
						? [
								{
									id: "ownership-behavior",
									repositoryId: "fixture",
									command,
									reason: "Execute authorization and ownership behavior",
									environment: { isolation: "worktree" },
								},
							]
						: [],
					qaCriteria:
						verify || !originalCriterion ? ["ownership-preserved"] : [],
					qaReuse:
						!verify && originalCriterion
							? [
									{
										criterionId: "ownership-preserved",
										originalDigest: qaDigest(originalCriterion),
										reason:
											"Actual source/dependencies and probed fixture environment are unchanged; retain the original independent gate's criterion",
									},
								]
							: [],
					reuse,
					invalidate: [],
					targetCompatible: !correction,
					testAssertions: {
						inspected: true,
						weakened: kind === "weakened-tests" && edited && !repaired,
						evidence:
							"Compared actual committed behavior assertions with the original fixture",
					},
					humanReview: "no-prior-approval",
					approvalRationale:
						"No answer grants human approval; native exact revision acceptance remains mandatory",
					questions: [],
				} satisfies ImpactAssessment;
			}
			if (id === roles.inventory) {
				const added = context.run.answers.some((a) =>
					a.answer.includes(
						"Accept the additional absent-resource requirement",
					),
				);

				return {
					schemaVersion: 1,
					requirements: [
						{
							id: "R1",
							criterion:
								"Remove only owned resources and preserve authorization",
							classification: "active",
							sources: [{ source: "originalInput", reference: "/" }],
						},
						...(added
							? [
									{
										id: "R2",
										criterion: "Absent owned resources are harmless",
										classification: "active",
										sources: [
											{
												source: "answers",
												reference: `/${context.run.answers.length - 1}/answer`,
											},
										],
									},
								]
							: []),
					],
					decisions: [],
					conflicts: [],
					sourceReceipt: {
						considered: [
							{ source: "originalInput", reference: "/" },
							...(added
								? [
										{
											source: "answers",
											reference: `/${context.run.answers.length - 1}/answer`,
										},
									]
								: []),
						],
						unavailable: [],
					},
					questions: [],
				};
			}
			if (id === roles.edit) {
				originalQa ??= structuredClone({
					capture: context.run.outputs[`${roles.outer}/${roles.capture}`],
					review: context.run.outputs[`${roles.outer}/${roles.qaReview}`],
					gate: context.run.outputs[`${roles.outer}/${roles.qaGate}`],
				});
				const question =
					kind === "metadata-answer"
						? "Confirm restored fixture access; are requirements unchanged?"
						: ["accepted-requirements", "extraction-drift"].includes(kind)
							? "Accept the additional absent-resource requirement?"
							: undefined;
				if (question && !context.run.answers.length)
					return { questions: [question] };
				if (!edited) {
					edited = true;
					if (
						[
							"small-correction",
							"accepted-requirements",
							"extraction-drift",
						].includes(kind)
					) {
						writeFileSync(join(workspace, cleanup), cleanupSource(true));
						commit("small ownership correction");
					}
					if (["target-advance", "integration-conflict"].includes(kind))
						advanceTarget(kind === "integration-conflict");
					if (kind === "integration-conflict") {
						const result = attemptGit(
							"merge-tree",
							"--write-tree",
							"HEAD",
							`origin/${target}`,
						);
						conflict = {
							code: result.status,
							output: result.stdout + result.stderr,
						};
						expect(result.status).toBe(1);
						expect(conflict.output).toContain("CONFLICT");
					}
					if (kind === "weakened-tests") {
						writeFileSync(
							join(workspace, check),
							layout === "js"
								? "console.log('assertions removed');\n"
								: "print('assertions removed')\n",
						);
						commit("weaken assertions");
					}
					git("push", "origin", "HEAD");
				}
				return {
					summary: "Applied the actual requested revision or metadata change",
					questions: [],
				};
			}
			if (id === roles.repair) {
				if (kind === "integration-conflict") {
					const result = attemptGit(
						"merge",
						"--no-commit",
						"--no-ff",
						`origin/${target}`,
					);
					expect(result.status).toBe(1);
					writeFileSync(
						join(workspace, cleanup),
						`${cleanupSource(true)}${layout === "js" ? "//" : "#"} preserve foreign resources\n`,
					);
				} else writeFileSync(join(workspace, check), checkSource);
				commit("resolve consequential correction");
				git("push", "origin", "HEAD");
				repaired = true;
				return {
					summary:
						"Integrated the actual conflicting target or restored executable assertions",
				};
			}
			if (specialists.includes(id)) {
				const blocked =
					kind === "metadata-answer" &&
					id === roles.coverage &&
					!context.run.answers.length;
				const evidence = blocked
					? "Independent fixture access unavailable"
					: runBehavior();
				const inventory = context.reviewBaseline!.inventory;
				const narrow = [roles.quality, roles.coverage].includes(id);
				return {
					status: blocked ? "blocked" : "completed",
					blockers: blocked ? ["Restore independent fixture access"] : [],
					summary: evidence,
					findings: [],
					disagreements: [],
					...(!blocked
						? {
								evidenceBoundary: {
									requirementIds: inventory.requirements.map((r) => r.id),
									areas: [narrow ? "ownership" : "authorization"],
									dependencies: narrow ? [cleanup, check] : [auth],
									independence:
										"Inspected actual caller and shared configuration graph; authorization does not import ownership cleanup",
								},
							}
						: {}),
					...(id === roles.coverage
						? {
								coverage: inventory.requirements.map((r) => ({
									requirementId: r.id,
									status: "met",
									reason: blocked
										? "Code inspected; independent execution is blocked"
										: "Actual ownership and authorization commands passed",
									evidence: [evidence],
								})),
							}
						: {}),
				};
			}
			if (id === roles.plan)
				return QaScopeSchema.parse({
					qaContract: "qa-v1",
					changed: false,
					areas: [],
					captureBudget: 24,
					environment: { isolation: "worktree" },
					environmentFingerprint: "disposable-local-ownership-fixture-v1",
					environmentEvidence: {
						repositoryId: "fixture",
						command: "printf '%s' composed-fixture-v1",
						expectedDigest: qaDigest("composed-fixture-v1"),
					},
					stories: [
						{
							id: "ownership",
							goal: "Preserve ownership and authorization",
							requirementRefs: latestAggregate(
								context.run,
								reviewKey,
							)!.baseline.inventory.requirements.map((r) => r.id),
							interface: "cli",
							preconditions: ["Clean disposable repository"],
							fixtures: [check],
							actions: [command],
							criteria: [
								{
									id: "ownership-preserved",
									expected:
										"Owned resources are removable; foreign resources and authorization are preserved",
								},
							],
							dependencies: [auth, cleanup, check],
							independence:
								"Executable local fixture; no shared provider resources",
							evidenceInstructions: "Execute the actual fixture command",
							screenshotTasks: [],
						},
					],
					exclusions: [],
				});
			if (id === roles.capture) {
				const scope = QaScopeSchema.parse(
					(context.input as { scope: unknown }).scope,
				);
				const evidence = runBehavior();
				qaHeads.push(git("rev-parse", "HEAD"));
				return QaCaptureSchema.parse({
					qaContract: "qa-v1",
					screenshots: [],
					unavailable: [],
					findings: [],
					observations: [],
					results: scope.stories.map((story) => ({
						storyId: story.id,
						outcome: "passed",
						criteria: story.criteria.map((criterion) => ({
							criterionId: criterion.id,
							outcome: "passed",
							expected: criterion.expected,
							observed: evidence,
							evidence: [
								{
									kind: "command",
									executed: true,
									action: command,
									details: evidence,
									exitCode: 0,
									screenshotTasks: [],
								},
							],
						})),
					})),
				});
			}
			if (id === roles.qaReview)
				return {
					qaContract: "qa-v1",
					status: "completed",
					blockers: [],
					summary:
						"Inspected actual command receipts against each planned criterion",
					findings: [],
					observations: [],
					acceptedScreenshots: [],
				};
			if (id === roles.guide)
				return {
					goal: "Preserve ownership",
					summary: "Reviewed and executed the exact current revision",
					decision: {
						status: "ready",
						summary: "Await explicit human approval",
					},
					behavior: [
						{
							scenario: "Ownership",
							before: "Owned resource removal",
							after: "Accepted ownership behavior verified",
						},
					],
					requirements: latestAggregate(
						context.run,
						reviewKey,
					)!.baseline.inventory.requirements.map((r) => ({
						criterion: r.criterion,
						status: "met",
						evidence: [command],
					})),
					checks: [command],
					risks: [],
					reviewInstructions: [
						"Approve this exact revision or request changes",
					],
				};
			throw new Error(`Unexpected configured role ${id}`);
		},
	};
	// The deterministic native-runner substitute uses the same result finalization
	// boundary as EdgeWorker; provenance comes from roleProgress, never invented SHAs.
	const invokeAgent = hooks.agent;
	hooks.agent = async (context) => {
		context.progress = await roleProgress(context);
		if (hasCheck(context.step, "qa-environment"))
			await verifyQaEnvironment(context);
		let output = parseStepOutput(context.step, await invokeAgent(context));
		if (hasCheck(context.step, "capture-evidence"))
			output = captureEvidence(context, output);
		const completed = (await roleProgress(context)).currentRevision;
		if (completed && hasCheck(context.step, "qa-review-evidence"))
			output = {
				...z.record(z.string(), z.unknown()).parse(output),
				qaReviewStamp: {
					headSha: completed.headSha,
					dirty: completed.dirty,
					captureHash: qaDigest(
						readOutput(
							context.step,
							"capture",
							context.outputs ?? context.run.outputs,
						),
					),
					scopeHash: qaDigest(
						readOutput(
							context.step,
							"scope",
							context.outputs ?? context.run.outputs,
						),
					),
				},
			};
		if (completed) {
			context.run.roleRevisions ??= {};
			context.run.roleRevisions[context.stepKey ?? context.step.id] = completed;
		}
		return output;
	};
	const instances: WorkflowRuntime[] = [];
	const createRuntime = () => {
		const runtime = new WorkflowRuntime(state, hooks);
		instances.push(runtime);
		return runtime;
	};
	const runtime = createRuntime(),
		workflows = definitions(),
		workflow = workflows.at(-1)!;
	runtime.updateWorkflows(workflows);
	const run = runtime.create({
		title: `Composed ${kind}`,
		input: "Remove only owned resources; preserve authorization",
		repositoryId: "fixture",
		workspace,
		repositories: [
			{
				id: "fixture",
				name: "Disposable fixture",
				workspace,
				repositoryPath: workspace,
				baseBranch: target,
				gitProvider: {
					type: "custom",
					repositoryUrl: `https://forge.example/replay/${layout}`,
					command: "fixture-forge",
					args: [],
				},
			},
		],
		workflow,
		triggerOrigin: {
			type: "manual",
			workflowId: workflow.id,
			at: "2026-10-23T00:00:00.000Z",
		},
	});
	return {
		runtime,
		run,
		createRuntime,
		hooks,
		git,
		home,
		workspace,
		target,
		initialHead,
		initialBase,
		calls,
		snapshots,
		checkVisits,
		checkRuns,
		qaHeads,
		providerCalls,
		retrieval,
		url,
		originalQa: () => originalQa,
		conflict: () => conflict,
		drift: () => ({ head: driftHead, snapshot: driftSnapshot }),
		count: (id: string) => calls.filter((c) => c.role === id).length,
		metrics: () => ({
			calls,
			toolTrace,
			roleCounts: Object.fromEntries(
				[...new Set(calls.map((c) => c.role))].map((id) => [
					id,
					calls.filter((c) => c.role === id).length,
				]),
			),
			checks: checkRuns.length,
			qa: qaHeads.length,
			retrieval,
		}),
		cleanup: async () => {
			for (const runtime of instances) await runtime.shutdown();
			rmSync(home, { recursive: true, force: true });
		},
	};
}
