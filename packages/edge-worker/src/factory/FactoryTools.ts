import { createHash } from "node:crypto";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
	presentLinearPublication,
	spawnExecution as spawn,
} from "bobs-factory-core";
import { z } from "zod";
import {
	DeliveryContractSchema,
	digest,
	freezeDelivery,
	repositoryCompletionProven,
	type TicketDelivery,
} from "./Delivery.js";
import { externalGuideEvidence } from "./ExternalGuide.js";
import { feedbackInstructionFingerprint } from "./FeedbackPolicy.js";
import {
	executeGithubApi,
	GITHUB_API_COMMAND,
	githubGitEnvironment,
} from "./GithubApi.js";
import { type GitProvider, resolveGitProvider } from "./GitProvider.js";
import { gitAgentEnvironment } from "./GitSettings.js";
import { groupedTool, scopeCommand } from "./GroupedTools.js";
import { guideGapRecovery } from "./GuideRecovery.js";
import {
	assertCurrentImpact,
	effectiveApproval,
	impactDecisionDigest,
	selectedChecks,
} from "./Impact.js";
import { dependencyCovers, dependencyHashes } from "./Incremental.js";
import {
	assessFeedback,
	feedbackWorkFingerprint,
	inspectReadinessWithRetry,
	type MergeReadiness,
	reportReadiness,
	waitForNextPoll,
} from "./MergeReadiness.js";
import { confirmedMerge, pendingMergeConfirmation } from "./MergeRecovery.js";
import { OutputValidationError } from "./OutputValidation.js";
import {
	QA_CONTRACT,
	QaExecutionFields,
	qaCoverage,
	qaDigest,
	qaRequirementIssues,
} from "./Qa.js";
import {
	qaReuseContext,
	stampQaCriteria,
	verifyQaEnvironment,
} from "./QaReuse.js";
import { runRepositories } from "./RepositoryScope.js";
import { reviewRecoveryQuestions } from "./ReviewRecovery.js";
import { takeoverSource, ticketSnapshot } from "./RunContextSources.js";
import {
	aggregateForContext,
	assertAggregateRevision,
	scopeContextDigest,
} from "./SpecialistReview.js";
import {
	consumesImpact,
	formatOf,
	hasCheck,
	readStep,
	resolveStepConfig,
} from "./StepConfig.js";
import { inspectPullRequest } from "./Takeover.js";
import {
	boundOutput,
	boundStepKey,
	boundToolOutput,
	producerValue,
	stepForRun,
	writeBoundOutput,
} from "./ToolBindings.js";
import {
	VideoCaptureFields,
	VideoReceiptSchema,
	videoGateIssues,
} from "./Video.js";
import { readPath } from "./Workflow.js";

export function toolArguments(
	context: ExecutionContext,
	value: unknown,
): unknown {
	const data = {
		outputs: context.outputs ?? context.run.outputs,
		input: context.input,
		run: { id: context.run.id, title: context.run.title },
		workspace: context.run.workspace,
		repositories: runRepositories(context.run),
		evidenceDir: context.evidenceDir,
	};
	if (typeof value === "string") {
		const exact = value.match(/^\{\{([\w.-]+)\}\}$/);
		if (exact) {
			const resolved = readPath(data, exact[1]!);
			if (resolved === undefined)
				throw new Error(`Missing tool input: ${exact[1]}`);
			return resolved;
		}
		return value.replace(/\{\{([\w.-]+)\}\}/g, (_match, path) => {
			const resolved = readPath(data, path);
			if (resolved === undefined)
				throw new Error(`Missing tool input: ${path}`);
			return typeof resolved === "string" ? resolved : JSON.stringify(resolved);
		});
	}
	if (Array.isArray(value))
		return value.map((item) => toolArguments(context, item));
	if (value && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [
				key,
				toolArguments(context, item),
			]),
		);
	return value;
}

import type { GuideSchema } from "./FactoryResults.js";
import { briefMarkdown, guideReady, isReviewBrief } from "./ReviewBrief.js";
import type { ExecutionContext } from "./WorkflowRuntime.js";

function blockRevisionMismatch(
	snapshot: MergeReadiness,
	headSha: string,
): void {
	snapshot.worktreeHeadSha = headSha;
	snapshot.fix = true;
	snapshot.approved = false;
	snapshot.reviewReady = false;
	snapshot.blockers.push({
		kind: "revision",
		action: "fix",
		message: `PR points to ${snapshot.headSha}, but the worktree is at ${headSha}. Synchronize the PR and branch without discarding work, then confirm the PR head and repeat review and CI. Checks for the old revision cannot validate this worktree.`,
	});
}

export function reviewGuideMarkdown(value: unknown, headSha: string): string {
	const guide = value as z.infer<typeof GuideSchema>;
	const list = (items: string[]) => items.map((item) => `- ${item}`).join("\n");
	const coverage = guide.requirementCoverage
		? `\n\n<details><summary>Complete requirement coverage and specialist evidence</summary>\n\n${guide.requirementCoverage.assessments.map((a) => `- **${a.requirementId}: ${a.criterion}** (${a.status}): ${a.reason}; ${a.evidence.join("; ")}${a.decision ? `; Accepted by ${a.decision.acceptedBy}: ${a.decision.rationale} (${a.decision.source.reference})` : ""}`).join("\n")}\n\n${guide.requirementCoverage.reviewers.map((r) => `**${r.reviewer}:** ${r.summary}\n${r.findings.map((f) => `- ${r.reviewer}:${f.id} · ${f.rating} · ${f.status}: ${f.summary}; ${f.evidence}; ${f.reason ?? ""}`).join("\n")}\n${r.disagreements.join("\n")}\n${(r.disputeResolutions ?? []).map((d) => `- Resolved disagreement: ${d.disagreement}; Reason: ${d.reason}; Evidence: ${d.evidence}`).join("\n")}`).join("\n\n")}\n\n</details>`
		: "";

	if (guide.chapters?.length) {
		const chapters = guide.chapters
			.map(
				(chapter) =>
					`### ${chapter.title}\n${chapter.summary}\n\n**Before:** ${chapter.before}\n\n**After:** ${chapter.after}\n\n${chapter.diagrams.map((diagram) => `**${diagram.title}:** ${diagram.steps.map((step) => step.label).join(" → ")}`).join("\n")}\n\n${list(chapter.reviewChecks)}\n\n<details><summary>Code and evidence</summary>\n\n${list(chapter.files.map((file) => `\`${file}\``))}\n\n${list(chapter.evidence)}\n\n</details>`,
			)
			.join("\n\n");
		return `## ${guide.goal}\n${guide.summary}\n\n${guide.decision.status}: ${guide.decision.summary}\n\n${chapters}${coverage}\n\n## Know before approving\n${list(guide.risks)}\n\n<details><summary>Verification evidence</summary>\n\n${list(guide.checks)}\n\n</details>\n\n## Human decision\n${list(guide.reviewInstructions)}\n\nRevision: ${headSha}\nOpen the factory review guide for the step-by-step walkthrough, diagrams and screenshots.\n\n<!-- generated-by-bobs-factory -->`;
	}
	return `## Goal\n${guide.goal}\n\n${guide.summary}\n\n## Decision\n${guide.decision.status}: ${guide.decision.summary}\n\n## Before and after\n${guide.behavior.map((item) => `### ${item.scenario}\nBefore: ${item.before}\n\nAfter: ${item.after}`).join("\n\n")}\n\n## Requirements\n${guide.requirements.map((item) => `- **${item.criterion}** (${item.status}): ${item.evidence.join("; ")}`).join("\n")}\n\n${coverage}\n\n## Checks\n${list(guide.checks)}\n\n## Risks\n${list(guide.risks)}\n\n## Human review\n${list(guide.reviewInstructions)}\n\nRevision: ${headSha}\nScreenshots and complete decision/review history are available in the local factory dashboard.\n\n<!-- generated-by-bobs-factory -->`;
}

const commandTimeoutMs = 20 * 60 * 1000;

export function executeCommand(
	context: ExecutionContext,
	command: string,
	args: string[],
	timeoutMs = commandTimeoutMs,
): Promise<string> {
	context.signal.throwIfAborted();
	if (command === GITHUB_API_COMMAND) return executeGithubApi(context, args);
	if (
		command === "git" &&
		["fetch", "push", "ls-remote", "clone"].includes(args[0] ?? "")
	)
		return githubGitEnvironment(context).then((environment) =>
			executeProcessCommand(context, command, args, timeoutMs, environment),
		);
	return executeProcessCommand(context, command, args, timeoutMs);
}

function executeProcessCommand(
	context: ExecutionContext,
	command: string,
	args: string[],
	timeoutMs: number,
	gitEnvironment?: NodeJS.ProcessEnv,
): Promise<string> {
	const input = JSON.stringify(context.input) ?? "null";
	const directory = mkdtempSync(join(tmpdir(), "cyrus-factory-command-"));
	const inputPath = join(directory, "input.json");
	try {
		writeFileSync(inputPath, input, { mode: 0o600 });
	} catch (error) {
		rmSync(directory, { recursive: true, force: true });
		throw error;
	}
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: context.run.workspace,
			detached: process.platform !== "win32",
			env: {
				...(context.execution?.environment ?? process.env),
				...(!context.execution && context.factoryHome
					? gitAgentEnvironment(context.factoryHome)
					: {}),
				...gitEnvironment,
				// Large contexts cannot fit in the OS process argument/environment limit.
				FACTORY_INPUT: Buffer.byteLength(input) <= 16000 ? input : undefined,
				FACTORY_INPUT_FILE: inputPath,
				FACTORY_EVIDENCE_DIR: context.evidenceDir,
				FACTORY_REPOSITORIES: JSON.stringify(runRepositories(context.run)),
			},
			stdio: ["ignore", "pipe", "pipe"],
		});
		let output = "";
		let timedOut = false;
		const terminate = () => {
			try {
				if (process.platform !== "win32" && child.pid)
					process.kill(-child.pid, "SIGTERM");
				else child.kill("SIGTERM");
			} catch {
				/* Already exited. */
			}
			const kill = setTimeout(() => {
				try {
					if (process.platform !== "win32" && child.pid)
						process.kill(-child.pid, "SIGKILL");
					else child.kill("SIGKILL");
				} catch {
					/* Already exited. */
				}
			}, 2000);
			kill.unref();
		};
		context.signal.addEventListener("abort", terminate, { once: true });
		const timer = setTimeout(() => {
			timedOut = true;
			terminate();
		}, timeoutMs);
		const record = (chunk: Buffer) => {
			const text = chunk.toString();
			output = (output + text).slice(-1000000);
			// Wait until close to redact across arbitrary stdout chunk boundaries.
			if (!context.execution) context.log(text);
		};
		child.stdout.on("data", record);
		child.stderr.on("data", record);
		const cleanup = () => {
			clearTimeout(timer);
			context.signal.removeEventListener("abort", terminate);
			rmSync(directory, { recursive: true, force: true });
		};
		child.on("error", (error) => {
			cleanup();
			reject(error);
		});
		child.on("close", (code) => {
			cleanup();
			if (context.execution) {
				output = context.execution.redact(output);
				context.log(output);
			}
			if (context.signal.aborted) reject(new Error("Run terminated"));
			else if (timedOut) reject(new Error(`Command timed out: ${command}`));
			else if (code !== 0) {
				const agentFailure =
					command === "git" &&
					!context.execution &&
					/Couldn't (?:find key in agent|get agent socket)/.test(output);
				reject(
					new Error(
						`${command} exited ${code}: ${output.slice(-12000)}${agentFailure ? "\nOpen Settings → Identity profiles → Host Git identity, select the SSH agent that holds your signing key, test and save it, then retry this step." : ""}`,
					),
				);
			} else resolve(output.trim());
		});
	});
}

export const ReviewResultSchema = z.object({
	/** Older accepted artifacts remain readable; an unlabelled new gate fails closed. */
	status: z.enum(["completed", "blocked", "failed"]).optional(),
	blockers: z.array(z.string().min(1)).default([]),
	acceptedVideos: z.array(VideoReceiptSchema).max(3).optional(),
	qaContract: z.literal(QA_CONTRACT).optional(),
	qaReviewStamp: z
		.object({
			headSha: z.string(),
			dirty: z.boolean(),
			captureHash: z.string(),
			scopeHash: z.string(),
		})
		.optional(),
	acceptedScreenshots: z
		.array(
			z.object({
				area: z.string().min(1),
				state: z.string().min(1),
				imageSha256: z.string().regex(/^[a-f0-9]{64}$/),
			}),
		)
		.optional(),
	findings: z.array(
		z.object({
			id: z.string().min(1),
			rating: z.number().int().min(1).max(3),
			summary: z.string().min(1),
			evidence: z.string().min(1),
			status: z
				.enum(["open", "resolved", "accepted-rejection"])
				.default("open"),
		}),
	),
	summary: z.string(),
});
export function filterReview(
	value: unknown,
): z.infer<typeof ReviewResultSchema> {
	const result = ReviewResultSchema.parse(value);
	result.findings = result.findings.filter((finding) => finding.rating > 1);
	return result;
}

const screenshotSchema = z.object({
	context: z.string().max(600).optional(),
	path: z.string(),
	caption: z.string(),
	revision: z.string().optional(),
	imageSha256: z.string().optional(),
	dependencyHashes: z.record(z.string(), z.string()).optional(),
	fingerprintVersion: z.number().int().optional(),
	dependencyManifest: z.string().optional(),
	reused: z.boolean().optional(),
	area: z.string(),
	state: z.string().optional(),
});
const CaptureFields = {
	...VideoCaptureFields,
	screenshots: z.array(screenshotSchema),
	dependencyManifests: z
		.record(z.string(), z.record(z.string(), z.string()))
		.optional(),
	unavailable: z
		.array(
			z.object({
				area: z.string(),
				reason: z.string(),
				cause: z.enum(["access", "product"]).optional(),
			}),
		)
		.default([]),
};
export const CaptureSchema = z.object(CaptureFields);
export const QaCaptureSchema = z.object({
	...CaptureFields,
	...QaExecutionFields,
});
function captureGaps(capture: z.infer<typeof CaptureSchema>, areas: unknown) {
	const gaps = [...capture.unavailable];
	if (Array.isArray(areas)) {
		for (const area of areas) {
			const missing = (area.states ?? []).filter(
				(state: string) =>
					!capture.screenshots.some(
						(shot) => shot.area === area.name && shot.state === state,
					),
			);
			if (missing.length && !gaps.some((gap) => gap.area === area.name))
				gaps.push({
					area: area.name,
					reason: `No screenshot supplied for states: ${missing.join("; ")}`,
				});
		}
	}
	return gaps;
}
export function verifiedScreenshot(
	path: string,
	directory: string,
	retainedHash?: string,
): string {
	let candidate = resolve(directory, path);
	const within = (path: string) =>
		Boolean(path) &&
		path !== ".." &&
		!path.startsWith(`..${sep}`) &&
		!isAbsolute(path);
	let relocated = false;
	if (!within(relative(resolve(directory), candidate))) {
		// Completed capture receipts remain immutable when the Factory home moves.
		// Resolve only their same-run suffix in the current home, never the old file.
		const marker = `${sep}${join("factory", "evidence", basename(directory))}${sep}`;
		const index = candidate.lastIndexOf(marker);
		if (
			isAbsolute(path) &&
			index >= 0 &&
			/^[a-f0-9]{64}$/.test(retainedHash ?? "")
		) {
			candidate = resolve(directory, candidate.slice(index + marker.length));
			relocated = true;
		}
	}
	const resolved = realpathSync(candidate);
	const inside = relative(realpathSync(directory), resolved);
	if (!within(inside))
		throw new Error("Screenshot must be inside this run's evidence directory");
	const bytes = readFileSync(resolved);
	if (
		relocated &&
		createHash("sha256").update(bytes).digest("hex") !== retainedHash
	)
		throw new Error("Screenshot content changed after verification");
	const png = bytes
		.subarray(0, 8)
		.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
	const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
	if (!png && !jpeg) throw new Error("Screenshot is not a PNG or JPEG");
	return resolved;
}

export interface FactoryToolHooks {
	ticketDelivery?: TicketDelivery;
	postComment(
		runId: string,
		body: string,
		purpose?: "documentation" | "operational",
	): Promise<void>;
	command?(
		context: ExecutionContext,
		executable: string,
		args: string[],
		timeout?: number,
	): Promise<string>;
	mcp?(
		context: ExecutionContext,
		server: string,
		tool: string,
	): Promise<unknown>;
}
export class FactoryTools {
	constructor(private hooks: FactoryToolHooks) {}
	private scopeChanged(context: ExecutionContext, frozen: unknown): boolean {
		return (
			scopeContextDigest(frozen) !==
			scopeContextDigest(
				context.currentScope?.() ?? {
					...(context.input as Record<string, unknown>),
					answers: context.run.answers,
					humanDecisions: context.run.humanDecisions ?? [],
				},
			)
		);
	}
	private async qaEvidence(
		context: ExecutionContext,
		command: (exe: string, args: string[]) => Promise<string>,
	) {
		const { run } = context;
		// Import at execution time to share the scope safeguards without a schema initialization cycle.
		const { QaScopeSchema } = await import("./FactoryResults.js");
		const scope = QaScopeSchema.parse(boundOutput(context, "scope"));
		await verifyQaEnvironment(context);
		const capture = QaCaptureSchema.parse(boundOutput(context, "capture"));
		// Validate original behavioral provenance again at the consuming gate.
		if (consumesImpact(context.step)) {
			const cloned = structuredClone(capture);
			stampQaCriteria(context, cloned, true);
			if (qaDigest(cloned.results) !== qaDigest(capture.results))
				throw new Error("QA criterion provenance changed after execution");
		}
		const review = filterReview(boundOutput(context, "qaReview"));
		const headSha = (await command("git", ["rev-parse", "HEAD"])).trim();
		const dirty = Boolean(
			(await command("git", ["status", "--porcelain"])).trim(),
		);
		if (consumesImpact(context.step)) await assertCurrentImpact(context);
		const scopeHash = qaDigest(scope),
			captureHash = qaDigest(capture),
			reviewHash = qaDigest(review);
		const stamp = capture.testedRevision,
			reviewed = review.qaReviewStamp;
		const provenance = ["capture", "qaReview"].every((name) => {
			const key = boundStepKey(context, name);
			const revision = key ? run.roleRevisions?.[key] : undefined;
			return revision && !revision.dirty && revision.headSha === headSha;
		});
		const coverage = qaCoverage(scope, capture);
		for (const requirement of aggregateForContext(context)?.baseline.inventory
			.requirements ?? [])
			if (
				requirement.classification === "active" &&
				requirement.stage === "qa" &&
				!scope.stories.some((s) => s.requirementRefs.includes(requirement.id))
			)
				coverage.errors.push(
					`${requirement.id}: a required QA obligation needs executed story coverage, not an exclusion`,
				);
		coverage.errors.push(
			...qaRequirementIssues(
				scope,
				(boundOutput(context, "scopeClarify") ??
					boundOutput(context, "scopeDecisions")) as
					| { requirements?: string[]; decisions?: unknown[] }
					| undefined,
				run.answers,
				aggregateForContext(context)?.baseline.inventory,
			),
		);
		if (
			dirty ||
			!provenance ||
			!stamp ||
			stamp.dirty ||
			stamp.headSha !== headSha ||
			stamp.scopeHash !== scopeHash ||
			!reviewed ||
			reviewed.dirty ||
			review.qaContract !== QA_CONTRACT ||
			reviewed.headSha !== headSha ||
			reviewed.scopeHash !== scopeHash ||
			reviewed.captureHash !== captureHash
		)
			coverage.errors.push(
				"QA execution or review has missing, dirty or stale revision/scope provenance. Retry QA and review on the current clean revision.",
			);
		const gaps = captureGaps(capture, scope.areas);
		const assistanceGaps = gaps.filter(
			(g) =>
				!(
					g.cause === "product" &&
					scope.stories.some(
						(s) =>
							s.screenshotTasks.some((t) => t.area === g.area) &&
							capture.results.some(
								(r) =>
									r.storyId === s.id &&
									r.criteria.some((c) => c.outcome === "failed"),
							),
					)
				),
		);
		coverage.blocked.push(
			...assistanceGaps.map((g) => `${g.area}: ${g.reason}`),
		);
		for (const shot of capture.screenshots) {
			if (
				!scope.areas.some(
					(a) => a.name === shot.area && a.states.includes(shot.state ?? ""),
				)
			)
				coverage.errors.push(
					`Unknown screenshot task ${shot.area}/${shot.state}`,
				);
			const bytes = readFileSync(
				verifiedScreenshot(shot.path, context.evidenceDir, shot.imageSha256),
			);
			if (createHash("sha256").update(bytes).digest("hex") !== shot.imageSha256)
				coverage.errors.push(
					`${shot.area}/${shot.state}: screenshot bytes changed after capture`,
				);
		}
		const videoIssues = await videoGateIssues(context, headSha);
		coverage.blocked.push(...videoIssues.blocked);
		const findings = [
			...review.findings.filter((f) => f.status === "open"),
			...videoIssues.failures,
		];
		for (const finding of capture.findings.filter((f) => f.status === "open"))
			if (!findings.some((f) => f.id === finding.id)) findings.push(finding);
		for (const failure of coverage.failed) {
			const reported = capture.findings.some(
				(f) =>
					f.status === "open" &&
					f.storyId === failure.storyId &&
					f.criterionId === failure.criterionId,
			);
			if (!reported && !findings.some((f) => f.id === failure.id))
				findings.push(failure);
		}

		const receipts = review.acceptedScreenshots ?? [];
		for (const shot of capture.screenshots)
			if (
				!receipts.some(
					(r) =>
						r.area === shot.area &&
						r.state === shot.state &&
						r.imageSha256 === shot.imageSha256,
				) &&
				!findings.length
			)
				coverage.errors.push(
					`${shot.area}/${shot.state}: no exact inspected-image acceptance receipt`,
				);
		return {
			qaContract: QA_CONTRACT,
			evidenceErrors: coverage.errors,
			evidenceBlocked: coverage.blocked,
			...(coverage.errors.length && !coverage.blocked.length
				? { qaRetry: true, evidenceIssues: coverage.errors }
				: {}),
			findings,
			observations: capture.observations,
			headSha,
			scopeHash,
			captureHash,
			reviewHash,
			...(!findings.length && coverage.blocked.length
				? {
						qaBlocked: true,
						captureBlocked: assistanceGaps.length > 0,
						questions: [
							`QA evidence is incomplete. ${coverage.blocked.join("\n\n")}\n\nResolve the missing access, fixtures, tooling or evidence above and explain how to run the blocked checks. Your answer retries QA and screenshot review in this run. It does not approve the PR or waive required testing.`,
						],
					}
				: {}),
		};
	}

	/** Fixed read-only evidence projections; no rule result or next-step selection. */
	async evidence(context: ExecutionContext): Promise<Record<string, unknown>> {
		const evidence: Record<string, unknown> = {};
		const command = (exe: string, args: string[]) =>
			scopeCommand(context, this.command.bind(this), exe, args);
		if (hasCheck(context.step, "review-evidence")) {
			const review = filterReview(boundOutput(context, "review"));
			const incomplete =
				review.status !== "completed" || review.blockers.length > 0;
			evidence["review-evidence"] = {
				...review,
				incomplete,
				reviewIncomplete: incomplete,
				questions: incomplete
					? [
							`${readStep(context.step, "review") ?? "configured review"} did not complete (${review.status ?? "legacy outcome missing"}). ${review.blockers.join("; ") || review.summary} Restore the required input/tools, then answer to retry only this reviewer. Missing findings do not approve or waive the review.`,
						]
					: [],
			};
		}
		if (hasCheck(context.step, "qa-gate-evidence")) {
			const review = evidence["review-evidence"] as
				| { incomplete?: boolean }
				| undefined;
			const capture = QaCaptureSchema.safeParse(
				boundOutput(context, "capture"),
			);
			// Preserve incomplete-review assistance unless recorded product failures need correction first.
			if (
				!review?.incomplete ||
				(capture.success &&
					(capture.data.results.some((r) =>
						r.criteria.some((c) => c.outcome === "failed"),
					) ||
						capture.data.findings.some((f) => f.status === "open")))
			) {
				const qa = await this.qaEvidence(context, command);
				evidence["qa-gate-evidence"] = qa;
				if (review)
					Object.assign(review, {
						questions: qa.findings.length
							? []
							: "questions" in qa
								? qa.questions
								: [],
					});
			}
		}
		if (hasCheck(context.step, "delivery-evidence"))
			evidence["delivery-evidence"] = {
				mode: context.run.delivery?.contract.mode ?? "repository",
				repositoryComplete:
					context.run.delivery?.contract.mode === "mixed" &&
					(context.run.humanDecisions ?? []).some(
						(decision) =>
							decision.decision === "approve" &&
							repositoryCompletionProven({
								...context.run,
								humanDecisions: [decision],
							}),
					),
			};
		return evidence;
	}
	private async qaGate(
		context: ExecutionContext,
		command: (exe: string, args: string[]) => Promise<string>,
	) {
		const evidence = await this.qaEvidence(context, command);
		const { evidenceErrors, evidenceBlocked, ...retained } = evidence;
		return {
			...retained,
			approved:
				!evidence.findings.length &&
				!evidenceBlocked.length &&
				!evidenceErrors.length,
		};
	}

	async script(context: ExecutionContext): Promise<unknown> {
		const stdout = await executeCommand(context, "/bin/sh", [
			"-c",
			context.step.script!,
		]);
		try {
			return JSON.parse(stdout);
		} catch {
			return { stdout };
		}
	}
	async tool(context: ExecutionContext): Promise<unknown> {
		// Projected grouped runs share retry identities and immutable check receipts.
		context.run.ciSupervision ??= { retries: [] };
		if (context.step.tool === "impact-checks")
			return selectedChecks(context, (ctx, script) =>
				this.command(ctx, "/bin/sh", ["-c", script]),
			);
		if (context.step.tool === "merge")
			context.executionApproval = await effectiveApproval(context);
		if (
			runRepositories(context.run).length > 1 &&
			context.run.delivery?.contract.mode !== "external" &&
			!resolveStepConfig(context.step).reads.external
		) {
			if (
				context.step.tool === "handoff" &&
				hasCheck(context.step, "qa-evidence")
			) {
				const gate = await this.qaGate(context, (exe, args) =>
					scopeCommand(context, this.command.bind(this), exe, args),
				);
				const accepted = boundOutput(context, "qaGate");
				if (
					!gate.approved ||
					["headSha", "captureHash", "scopeHash", "reviewHash"].some(
						(key) => readPath(accepted, key) !== readPath(gate, key),
					)
				)
					throw new Error(
						"Grouped QA evidence changed or is incomplete; handoff blocked",
					);
			}
			const output = await groupedTool(
				context,
				this.command.bind(this),
				(child) => {
					const execute = () =>
						this.repositoryTool(
							child.run === context.run
								? child
								: {
										...child,
										step: {
											...child.step,
											reads: resolveStepConfig(child.step).reads,
											checks: resolveStepConfig(child.step)
												.checks.filter((check) => check.check !== "qa-evidence")
												.map((check) => ({
													check: check.check,
													...check.args,
												})),
										},
									},
						);
					return child.step.tool === "draft-pr" && child.coordinateDelivery
						? child.coordinateDelivery(execute)
						: execute();
				},
			);
			if (context.step.tool === "ci-fix-readiness") {
				writeBoundOutput(context, "ci", output);
				await context.save?.();
			}
			if (context.step.tool === "inspect-review-readiness") {
				const joined = output as Record<string, unknown> & {
					deliveries?: {
						repositoryId: string;
						name: string;
						output: { observations?: Record<string, unknown>[] };
					}[];
				};
				return {
					...joined,
					observations:
						joined.deliveries?.flatMap((delivery) =>
							(delivery.output.observations ?? []).map((observation) => ({
								...observation,
								repositoryId: delivery.repositoryId,
								repositoryName: delivery.name,
							})),
						) ?? [],
				};
			}
			return output;
		}
		return context.step.tool === "draft-pr" && context.coordinateDelivery
			? context.coordinateDelivery(() => this.repositoryTool(context))
			: this.repositoryTool(context);
	}
	private command(
		context: ExecutionContext,
		executable: string,
		args: string[],
		timeout = commandTimeoutMs,
	): Promise<string> {
		return this.hooks.command
			? this.hooks.command(context, executable, args, timeout)
			: executeCommand(context, executable, args, timeout);
	}
	private async repositoryTool(context: ExecutionContext): Promise<unknown> {
		const { run } = context;
		// Built-in commands return machine data retained in artifacts. Their raw
		// stdout (especially repeated provider polling) is not conversation text.
		const commandContext =
			context.step.tool === "exec" ? context : { ...context, log: () => {} };
		const command = (exe: string, args: string[], timeout?: number) => {
			// Merge provider calls specify the PR explicitly. Keep their cwd outside
			// the worktree: issue cleanup can remove it while the provider completes a merge.
			const ctx =
				exe !== "git" && context.step.tool === "merge" && context.evidenceDir
					? {
							...commandContext,
							run: { ...run, workspace: context.evidenceDir },
						}
					: commandContext;
			return scopeCommand(ctx, this.command.bind(this), exe, args, timeout);
		};
		let selected: Promise<GitProvider> | undefined;
		const provider = (url?: string) =>
			(selected ??= resolveGitProvider(context, command, url));

		switch (context.step.tool) {
			case "inspect-existing": {
				const branch = await command("git", ["branch", "--show-current"]);
				let pr = takeoverSource(run) as
					| Awaited<ReturnType<typeof inspectPullRequest>>
					| undefined;
				if (!pr?.url) {
					const candidates = await (await provider()).list(branch);
					if (candidates.length > 1)
						throw new Error(
							"Multiple PRs for this branch; start Takeover with an explicit PR URL",
						);
					if (candidates[0])
						pr = await inspectPullRequest(
							command,
							candidates[0].url,
							await provider(),
						);
				}
				if (pr) {
					if (branch !== pr.headRefName)
						throw new Error(
							"Takeover worktree does not match the existing PR branch",
						);
					if (!pr.isDraft) await (await provider(pr.url)).draft(pr.url, true);
					run.outputs.source = { ...pr, isDraft: true };
					run.takeoverSource = run.outputs.source;
					run.outputs.repository = {
						...(run.outputs.repository as Record<string, unknown>),
						baseBranch: pr.baseRefName,
					};
					const repository = run.repositories?.find(
						(item) => item.id === run.repositoryId,
					);
					if (repository) repository.takeoverSource = run.takeoverSource;
					if (repository?.baseBranch === pr.headRefName) {
						repository.baseBranch = pr.baseRefName;
						context.log(
							`Confirmed takeover base ${pr.baseRefName} from ${pr.url}; retained the existing working branch.`,
						);
					}
				}
				return {
					branch,
					pr: takeoverSource(run),
					ticket: ticketSnapshot(run),
					status: await command("git", ["status", "--porcelain"]),
					diff: await command("git", ["diff", "HEAD"]),
					commits: await command("git", [
						"log",
						"--oneline",
						`${pr?.baseRefName ?? runRepositories(run)[0]!.baseBranch}..HEAD`,
					]),
					diffSummary: await command("git", [
						"diff",
						"--stat",
						`${pr?.baseRefName ?? runRepositories(run)[0]!.baseBranch}...HEAD`,
					]),
				};
			}
			case "delivery-mode":
				return {
					mode: run.delivery?.contract.mode ?? "repository",
					repositoryComplete:
						run.delivery?.contract.mode === "mixed" &&
						(run.humanDecisions ?? []).some(
							(decision) =>
								decision.decision === "approve" &&
								repositoryCompletionProven({
									...run,
									humanDecisions: [decision],
								}),
						),
				};
			case "accept-delivery":
			case "delivery-route": {
				if (resolveStepConfig(context.step).explicit) {
					const keys = ["plan", "planReview", "clarify"].map((name) => {
						const key = boundStepKey(context, name);
						if (
							!key ||
							stepForRun(run, key)?.type !== "agent" ||
							producerValue(run, key) === undefined ||
							digest(producerValue(run, key)) !==
								digest(boundOutput(context, name))
						)
							throw new Error(
								"Delivery acceptance requires original executed plan, independent review and clarification producers",
							);
						return key;
					});
					if (new Set(keys).size !== keys.length)
						throw new Error(
							"Delivery plan review must be independent of its author",
						);
				}
				const contract = DeliveryContractSchema.parse(
					boundOutput(context, "plan", "deliveryContract"),
				);
				if (
					boundOutput(context, "planReview", "approved") !== true ||
					boundOutput(context, "planReview", "deliveryContractDigest") !==
						digest(contract)
				)
					throw new Error(
						"Plan review must confirm the exact delivery contract digest",
					);
				if (
					boundOutput(context, "clarify", "deliveryMode") !==
						readPath(contract, "mode") &&
					!(run.deliveryRecovery && contract.mode === "external")
				)
					throw new Error(
						"Clarified delivery mode must match the reviewed contract",
					);
				if (readPath(contract, "authorization.status") === "deferred")
					return { deferred: true };
				const delivery = freezeDelivery(run, contract);
				await context.save?.();
				return { mode: delivery.contract.mode };
			}
			case "external-apply": {
				if (!this.hooks.ticketDelivery)
					throw new Error("Ticket delivery integration unavailable");
				await this.hooks.ticketDelivery.apply(run);
				return { applied: true, receipts: run.delivery!.receipts };
			}
			case "external-verify": {
				if (!this.hooks.ticketDelivery)
					throw new Error("Ticket delivery integration unavailable");
				return this.hooks.ticketDelivery.verify(run);
			}
			case "external-guide": {
				const delivery = run.delivery,
					snapshot = delivery?.verification;
				if (!snapshot || snapshot.criteria.some((c) => !c.passed))
					throw new Error(
						"Independent verification required before external guide",
					);
				const externalEvidence = externalGuideEvidence(run);
				const guide = {
					...externalEvidence,
					deliveryMode: "external",
					externalDigest: snapshot.digest,
					goal: run.title,
					summary:
						"Authorized ticket changes applied and independently verified.",
					decision: {
						status: "ready",
						summary:
							"Accept the verified state or request changes. Applied changes remain after rejection.",
					},
					requirements: delivery.contract.targets.flatMap((t) =>
						t.criteria.map((c) => ({
							requirementId: c.id,
							criterion: c.description,
							status: "supported",
							evidence: [
								JSON.stringify(snapshot.criteria.find((x) => x.id === c.id)),
							],
						})),
					),
					behavior: delivery.receipts.map((r) => ({
						scenario: r.intent.id,
						before: JSON.stringify(r.before),
						after: JSON.stringify(r.after),
					})),
					checks: [
						"Complete ticket content and relationships fetched twice independently; every accepted criterion passed.",
					],
					risks: [...new Set(delivery.receipts.map((r) => r.limitation))],
					reviewInstructions: [
						"Open each linked ticket and inspect the applied changes. Accept completed work or request changes.",
					],
					resources: delivery.contract.targets.map((t) => ({
						key: t.key,
						url: t.resource.url,
					})),
					receipts: delivery.receipts,
					verification: snapshot,
				};
				const updatedGuide =
					delivery.contract.mode === "mixed"
						? {
								...(boundOutput(context, "guide") as Record<string, unknown>),
								...externalEvidence,
							}
						: guide;
				// New recipes declare the action's own result slot. Frozen graphs keep
				// their original shared guide destination.
				writeBoundOutput(
					context,
					readStep(context.step, "result") ? "result" : "guide",
					updatedGuide,
				);
				await context.save?.();
				return updatedGuide;
			}
			case "external-final": {
				if (!this.hooks.ticketDelivery)
					throw new Error("Ticket delivery integration unavailable");
				const valid = await this.hooks.ticketDelivery.finalCheck(run);
				return { drift: !valid, complete: valid };
			}
			case "record-decisions": {
				const decisions = boundOutput(context, "clarify");
				const records =
					(decisions as { decisions?: unknown[] } | undefined)?.decisions ?? [];
				for (const decision of records) {
					const presented = presentLinearPublication({
						purpose: "decision",
						eventId: JSON.stringify(decision),
						owner: "record-decisions",
						source: { runId: run.id },
						content: decision,
					});
					if (presented.destination === "comment")
						await this.hooks.postComment(run.id, presented.markdown);
				}
				return decisions;
			}
			case "draft-pr": {
				const source = takeoverSource(run) as
					| { url?: string; headRefName?: string; baseRefName?: string }
					| undefined;
				const continuing = context.step.arguments?.publication === "existing";
				const prior = continuing
					? (boundToolOutput(context, "draftPr", "draft-pr") as
							| { url?: string; branch?: string }
							| undefined)
					: undefined;
				const continuedUrl = source?.url ?? prior?.url;
				if (continuing && !continuedUrl)
					throw new Error(
						"Continued publication requires its original executed PR receipt or accepted takeover source",
					);

				if (boundOutput(context, "implementation", "status") === "blocked")
					throw new Error(
						`Implementation is blocked: ${String(boundOutput(context, "implementation", "summary"))}. Answer the implementation questions before publishing.`,
					);
				const branch = await command("git", ["branch", "--show-current"]);
				if (!branch) throw new Error("Draft PR requires a branch");
				// Keep provider validation ahead of mutations for a delivery candidate.
				// A grouped context-only repository needs no publication provider.
				if (!context.allowUnchangedRepository) await provider();
				if (continuedUrl) {
					const originalBranch = source?.url
						? source.headRefName
						: prior?.branch;
					if (!originalBranch || originalBranch !== branch)
						throw new Error(
							"Continued publication must use the original PR branch",
						);
					const pr = await (await provider(continuedUrl)).view(
						continuedUrl,
						"state,isDraft",
					);
					if (pr.state !== "OPEN" || (!continuing && !pr.isDraft))
						throw new Error("Takeover PR must remain open and draft");
				}

				if (await command("git", ["status", "--porcelain"])) {
					await provider();
					await command("git", ["add", "-A"]);
					// Ticket titles are not commit messages; conventional-commit hooks
					// require a type and subject. Keep the header short and single-line.
					const subject = run.title
						.replace(/\s+/g, " ")
						.trim()
						.toLowerCase()
						.slice(0, 72)
						.trim()
						.replace(/\.+$/, "");
					// Repository commit hooks can run unbounded full-suite checks that a
					// mechanical step can neither finish nor repair, failing delivery on
					// every retry. Implementation checks, review and CI with its fixer
					// own verification. Push hooks still run (for example Git LFS).
					await command("git", [
						"commit",
						"--no-verify",
						"-m",
						`chore: ${subject || "factory changes"}`,
					]);
				}
				const baseBranch = String(
					source?.baseRefName ?? runRepositories(run)[0]!.baseBranch,
				);
				await command("git", ["fetch", "origin", baseBranch]);
				const baseRef = `refs/remotes/origin/${baseBranch}`;
				const commits = await command("git", [
					"rev-list",
					"--count",
					`${baseRef}..HEAD`,
				]);
				const changes = await command("git", [
					"diff",
					"--name-only",
					`${baseRef}...HEAD`,
				]);
				if (commits.trim() === "0" || !changes.trim())
					if (context.allowUnchangedRepository) return { unchanged: true };
				if (commits.trim() === "0" || !changes.trim())
					throw new Error(
						`No implementation changes to publish against ${baseBranch}. ${String(boundOutput(context, "implementation", "summary") ?? "The worktree has no deliverable changes.")} Resolve the implementation blocker before delivery; retrying PR creation cannot fix an empty branch.`,
					);
				const forge = await provider();
				const existing = await forge.list(branch);
				if (
					continuing &&
					existing.some((candidate) => candidate.url !== continuedUrl)
				)
					throw new Error(
						"Original publication receipt conflicts with the current branch PR",
					);
				if (existing.length > 1)
					throw new Error(
						"Multiple pull/merge requests for this branch; supply an explicit takeover source",
					);
				let url = continuedUrl || existing[0]?.url;

				if (url && !continuing && !source?.url && !existing[0]?.isDraft)
					throw new Error(
						"Existing PR is not draft; refusing to change its state automatically",
					);
				await command("git", ["push", "-u", "origin", "HEAD"]);
				if (!url) {
					url = await forge.create({
						branch,
						baseBranch,
						title: run.title,
						body: `Software factory run ${run.id}. Review and validation in progress.\n\n<!-- generated-by-bobs-factory -->`,
					});
				}
				return {
					url,
					branch,
					headSha: await command("git", ["rev-parse", "HEAD"]),
					baseSha: await command("git", ["rev-parse", baseRef]),
				};
			}
			case "review-gate":
			case "visual-gate": {
				const recovery = async (gate: Record<string, unknown>) => {
					if (gate.approved || gate.questions) return gate;
					const fixer = boundStepKey(context, "fix");
					if (
						!run.history.some(
							(item) =>
								item.step === fixer &&
								readPath(item.output, "reviewAssessment.unchangedCode") ===
									true,
						)
					)
						return gate;
					const headSha = (await command("git", ["rev-parse", "HEAD"])).trim();
					const dirty = Boolean(
						(await command("git", ["status", "--porcelain"])).trim(),
					);
					const questions = reviewRecoveryQuestions(context, gate, {
						headSha,
						dirty,
					});
					return questions.length
						? { ...gate, reviewBlocked: true, questions }
						: gate;
				};
				const source = readStep(context.step, "review") ?? "configured review";
				const review = filterReview(boundOutput(context, "review"));
				if (review.status !== "completed" || review.blockers.length) {
					if (
						context.step.tool === "visual-gate" &&
						hasCheck(context.step, "qa-evidence")
					) {
						const capture = QaCaptureSchema.safeParse(
							boundOutput(context, "capture"),
						);
						// An incomplete reviewer cannot approve, but recorded product failures
						// still need correction before fresh QA and a complete review.
						if (
							capture.success &&
							(capture.data.results.some((result) =>
								result.criteria.some(
									(criterion) => criterion.outcome === "failed",
								),
							) ||
								capture.data.findings.some(
									(finding) => finding.status === "open",
								))
						) {
							const gate = await this.qaGate(context, command);
							if (gate.findings.length) return recovery(gate);
						}
					}
					return {
						approved: false,
						findings: review.findings.filter(
							(finding) => finding.status === "open",
						),
						reviewIncomplete: true,
						questions: [
							`${source} did not complete (${review.status ?? "legacy outcome missing"}). ${review.blockers.join("; ") || review.summary} Restore the required input/tools, then answer to retry only this reviewer. Missing findings do not approve or waive the review.`,
						],
					};
				}
				const open = review.findings.filter(
					(finding) => finding.status === "open",
				);
				if (
					context.step.tool === "visual-gate" &&
					hasCheck(context.step, "qa-evidence")
				) {
					return recovery(await this.qaGate(context, command));
				}
				if (context.step.tool === "visual-gate") {
					const capture = CaptureSchema.parse(boundOutput(context, "capture"));
					const gaps = captureGaps(
						capture,
						boundOutput(context, "scope", "areas"),
					);
					if (!capture.screenshots.length || gaps.length)
						return {
							approved: false,
							findings: open,
							captureBlocked: true,
							questions: [
								`Visual evidence is incomplete. ${gaps.length ? gaps.map((gap) => `${gap.area}: ${gap.reason}`).join("\n\n") : "No screenshots were supplied."}\n\nResolve the capture access, tooling or application setup above, then explain how to capture the missing states. Your answer retries capture and visual review in this run, preserving verified accepted screenshots where possible. An answer does not approve or waive missing evidence.`,
							],
						};
					for (const shot of capture.screenshots)
						verifiedScreenshot(
							shot.path,
							context.evidenceDir,
							shot.imageSha256,
						);
				}
				return recovery({ approved: open.length === 0, findings: open });
			}
			case "inspect-review-readiness": {
				const aggregate = aggregateForContext(context, {
					requireComplete: false,
				});
				const reviewed = aggregate
					? { headSha: aggregate.baseline.headSha, dirty: false }
					: run.reviewRounds?.length
						? undefined
						: boundStepKey(context, "review")
							? run.roleRevisions?.[boundStepKey(context, "review")!]
							: undefined;
				const headSha = await command("git", ["rev-parse", "HEAD"]);
				const dirty = Boolean(await command("git", ["status", "--porcelain"]));
				const readiness = await inspectReadinessWithRetry(
					context,
					command,
					String(boundOutput(context, "draftPr", "url") ?? ""),
				);
				if (readiness.headSha !== headSha)
					blockRevisionMismatch(readiness, headSha);
				assessFeedback(context, readiness);
				const previous = boundOutput(context, "ci") as
					| MergeReadiness
					| undefined;
				const fingerprint = feedbackWorkFingerprint(readiness);
				const failures = (checks: unknown) =>
					Array.isArray(checks)
						? checks
								.filter((check) => check.bucket === "fail")
								.map((check) => [check.name, check.state, check.link])
								.sort()
						: [];
				const observation = {
					readiness,
					reviewed: reviewed ?? null,
					headSha,
					dirty,
					previous: previous ?? null,
					previousBase:
						aggregate?.baseline.baseSha ??
						previous?.correctionBaseSha ??
						previous?.baseSha ??
						null,
					feedback: (previous?.blockers ?? []).map((item) => ({
						...item,
						fixReviewRequired:
							boundOutput(context, "fix", "reviewRequired") ?? null,
						currentFix: readiness.blockers.some(
							(current) =>
								current.kind === item.kind && current.action === "fix",
						),
					})),
					fix: boundOutput(context, "fix") ?? {},
					reviewApproved:
						aggregate?.approved ??
						boundOutput(context, "reviewGate", "approved") ??
						null,
					scopeChanged: Boolean(
						aggregate?.baseline.context &&
							this.scopeChanged(context, aggregate.baseline.context),
					),
					failures: failures(readiness.checks),
					previousFailures: failures(previous?.checks),
					fingerprint: fingerprint ?? null,
					previousFingerprint: previous
						? (feedbackWorkFingerprint(previous) ?? null)
						: null,
					repeated: (run.history ?? [])
						.slice(0, -1)
						.some(
							(item) =>
								item.step === boundStepKey(context, "fix") &&
								readPath(item.output, "feedbackAssessment.fingerprint") ===
									fingerprint &&
								readPath(
									item.output,
									"feedbackAssessment.instructionsSha256",
								) === feedbackInstructionFingerprint(context),
						),
				};
				return { ...observation, observations: [observation] };
			}

			case "review-after-fix": {
				const aggregate = aggregateForContext(context, {
					requireComplete: false,
				});
				// Once specialist review exists, a legacy receipt cannot fill its gap.
				const reviewed = aggregate
					? { headSha: aggregate.baseline.headSha, dirty: false }
					: run.reviewRounds?.length
						? undefined
						: boundStepKey(context, "review")
							? run.roleRevisions?.[boundStepKey(context, "review")!]
							: undefined;
				const headSha = await command("git", ["rev-parse", "HEAD"]);
				const dirty = Boolean(await command("git", ["status", "--porcelain"]));
				const url = String(boundOutput(context, "draftPr", "url") ?? "");
				const readiness = await inspectReadinessWithRetry(
					context,
					command,
					url,
				);
				if (readiness.headSha !== headSha)
					blockRevisionMismatch(readiness, headSha);
				const previousBase =
					aggregate?.baseline.baseSha ??
					boundOutput(context, "ci", "correctionBaseSha") ??
					boundOutput(context, "ci", "baseSha");
				assessFeedback(context, readiness);
				const feedback = boundOutput(context, "ci", "blockers") as
					| { kind: string; action?: string }[]
					| undefined;
				const substantiveFeedback =
					feedback?.some(
						(item) =>
							["threads", "reviews", "revision"].includes(item.kind) &&
							(item.action === undefined || item.action === "fix") &&
							(boundOutput(context, "fix", "reviewRequired") !== false ||
								readiness.blockers.some(
									(current) =>
										current.kind === item.kind && current.action === "fix",
								)),
					) ||
					(feedback?.some((item) => item.kind === "comments") &&
						boundOutput(context, "fix", "reviewRequired") !== false);
				const reviewRequired =
					substantiveFeedback ||
					boundOutput(context, "fix", "reviewRequired") === true ||
					!reviewed ||
					reviewed.dirty ||
					dirty ||
					reviewed.headSha !== headSha ||
					readiness.headSha !== headSha ||
					!previousBase ||
					previousBase !== readiness.baseSha ||
					(aggregate?.approved ??
						boundOutput(context, "reviewGate", "approved")) !== true ||
					Boolean(
						aggregate &&
							(!aggregate.approved ||
								(aggregate.baseline.context &&
									this.scopeChanged(context, aggregate.baseline.context))),
					);
				context.log(
					reviewRequired
						? previousBase && previousBase !== readiness.baseSha
							? `Base changed from ${String(previousBase)} to ${readiness.baseSha}; integration context requires review and relevant validation.`
							: "Changed source revision, substantive feedback or missing review provenance requires code review."
						: "Accepted code and base are unchanged; returning directly to merge readiness.",
				);
				const previousChecks = boundOutput(context, "ci", "checks");
				const failures = (checks: unknown) =>
					Array.isArray(checks)
						? checks
								.filter((check) => check.bucket === "fail")
								.map((check) => [check.name, check.state, check.link])
								.sort()
						: [];
				const unchangedFailures =
					!reviewRequired &&
					boundOutput(context, "ci", "headSha") === headSha &&
					failures(readiness.checks).length > 0 &&
					JSON.stringify(failures(previousChecks)) ===
						JSON.stringify(failures(readiness.checks));
				const previous = boundOutput(context, "ci") as
					| MergeReadiness
					| undefined;
				const unchangedRevision =
					!dirty &&
					readiness.headSha !== headSha &&
					previous?.worktreeHeadSha === headSha &&
					previous.headSha === readiness.headSha &&
					previous.baseSha === readiness.baseSha;
				const fingerprint = feedbackWorkFingerprint(readiness);
				const repeated = (run.history ?? [])
					.slice(0, -1)
					.some(
						(item) =>
							item.step === boundStepKey(context, "fix") &&
							readPath(item.output, "feedbackAssessment.fingerprint") ===
								fingerprint &&
							readPath(item.output, "feedbackAssessment.instructionsSha256") ===
								feedbackInstructionFingerprint(context),
					);
				const unchangedWork =
					!dirty &&
					previous?.headSha === headSha &&
					previous.baseSha === readiness.baseSha &&
					fingerprint !== undefined &&
					fingerprint === feedbackWorkFingerprint(previous) &&
					(!reviewRequired || repeated);
				return {
					reviewRequired,
					invalidation: {
						kind:
							previousBase && previousBase !== readiness.baseSha
								? "base-change"
								: reviewed?.headSha !== headSha ||
										dirty ||
										readiness.headSha !== headSha
									? "source-change"
									: substantiveFeedback
										? "new-feedback"
										: reviewRequired
											? "missing-provenance"
											: "none",
						previousBaseSha: previousBase,
						baseSha: readiness.baseSha,
						previousHeadSha: reviewed?.headSha,
						headSha,
					},
					headSha,
					baseSha: readiness.baseSha,
					...(unchangedRevision || unchangedFailures || unchangedWork
						? {
								questions: [
									unchangedRevision
										? `The same revision mismatch remains after the CI fixer's synchronization attempt: The provider reports ${readiness.headSha}, while the worktree is at ${headSha}. Restore synchronization between this PR and its branch, then reply to resume. Checks for the older revision remain insufficient; your answer does not approve or waive review and CI.`
										: unchangedFailures
											? `The CI fixer made no revision change and these same checks still fail: ${readiness.checks
													.filter((check) => check.bucket === "fail")
													.map(
														(check) =>
															`${check.name}: ${check.link ?? check.state}`,
													)
													.join(
														"; ",
													)}. Resolve the external blocker or provide a corrective direction before retrying. The failures remain blocking.`
											: `The CI fixer made no progress on the same actionable blockers: ${readiness.blockers
													.filter((blocker) => blocker.action === "fix")
													.map((blocker) => blocker.message)
													.join(
														"; ",
													)}. Resolve the blocker or provide a corrective direction before retrying. Review and merge safeguards remain enforced.`,
								],
							}
						: {}),
				};
			}
			case "ci": {
				const url = String(boundOutput(context, "draftPr", "url") ?? "");
				if (!url) throw new Error("No PR to check");
				for (;;) {
					const snapshot = await inspectReadinessWithRetry(
						context,
						command,
						url,
					);
					assessFeedback(context, snapshot);
					const headSha = await command("git", ["rev-parse", "HEAD"]);
					if (snapshot.headSha !== headSha) {
						if (
							snapshot.state !== "OPEN" ||
							!context.step.branches.some(
								(branch) =>
									branch.when.path === "fix" && branch.when.equals === true,
							)
						)
							throw new Error(
								`PR must match the current pushed worktree revision (PR ${snapshot.headSha}, worktree ${headSha}); this step has no open PR synchronization recovery path`,
							);
						blockRevisionMismatch(snapshot, headSha);
					}
					reportReadiness(context, snapshot);
					const aggregate = aggregateForContext(context);
					if (
						consumesImpact(context.step) &&
						snapshot.unassessedComments?.length &&
						!snapshot.ciAssistance?.length &&
						!snapshot.queued
					) {
						writeBoundOutput(context, "ci", snapshot);
						return { ...snapshot, impactRequired: true };
					}
					if (
						consumesImpact(context.step) &&
						aggregate &&
						aggregate.baseline.baseSha !== snapshot.baseSha &&
						!snapshot.ciAssistance?.length &&
						!snapshot.queued
					) {
						writeBoundOutput(context, "ci", snapshot);
						await command("git", ["fetch", "origin", snapshot.baseSha]);
						await command("git", [
							"update-ref",
							`refs/remotes/origin/${runRepositories(run)[0]!.baseBranch}`,
							snapshot.baseSha,
						]);
						return { ...snapshot, impactRequired: true };
					}
					if (
						snapshot.ciAssistance?.length ||
						snapshot.fix ||
						snapshot.reviewReady ||
						snapshot.approved
					) {
						const priorQa = boundOutput(context, "qaGate") as
							| { approved?: boolean; headSha?: string }
							| undefined;
						if (
							consumesImpact(context.step) &&
							snapshot.reviewReady &&
							priorQa?.approved &&
							priorQa.headSha === headSha &&
							aggregate?.approved &&
							aggregate.baseline.headSha === headSha &&
							!this.scopeChanged(context, aggregate.baseline.context)
						) {
							const scope = boundOutput(context, "scope") as
								| import("./Qa.js").QaScope
								| undefined;
							await verifyQaEnvironment(context);
							const reusable = qaReuseContext(context).criteria;
							const count = scope?.stories.reduce(
								(n, s) => n + s.criteria.length,
								0,
							);
							if (count !== undefined && reusable.length === count) {
								await assertCurrentImpact(context);
								return { ...snapshot, retainQa: true };
							}
						}
						return snapshot;
					}
					await waitForNextPoll(context);
				}
			}
			case "architecture-decision":
				return {}; // Runtime owns proposal identity and the passive wait.
			case "ci-fix-readiness": {
				const previous = boundOutput(context, "ci") as
					| MergeReadiness
					| undefined;
				const url = String(boundOutput(context, "draftPr", "url") ?? "");
				const snapshot = await inspectReadinessWithRetry(context, command, url);
				assessFeedback(context, snapshot);
				const head = (await command("git", ["rev-parse", "HEAD"])).trim();
				const dirty = Boolean(
					(await command("git", ["status", "--porcelain"])).trim(),
				);
				if (snapshot.headSha !== head) blockRevisionMismatch(snapshot, head);
				const digest = scopeContextDigest(
					context.currentScope?.() ?? context.input,
				);
				const aggregate = aggregateForContext(context, {
					requireComplete: false,
				});
				const scopeUnchanged =
					previous?.scopeDigest === digest ||
					Boolean(
						aggregate?.baseline.context &&
							scopeContextDigest(aggregate.baseline.context) === digest,
					);
				const skipFix =
					snapshot.state === "OPEN" &&
					!snapshot.fix &&
					!dirty &&
					scopeUnchanged &&
					!boundOutput(context, "handoff", "guideRecovery") &&
					boundOutput(context, "qaGate", "approved") !== false &&
					boundOutput(context, "reviewGate", "approved") !== false;
				const refreshed = {
					...snapshot,
					scopeDigest: digest,
					correctionBaseSha: previous?.correctionBaseSha ?? previous?.baseSha,
				};
				writeBoundOutput(context, "ci", refreshed);
				reportReadiness(context, snapshot);
				await context.save?.();
				return { ...refreshed, skipFix };
			}
			case "human-review": {
				if (
					run.delivery?.contract.mode === "external" ||
					resolveStepConfig(context.step).reads.external
				) {
					const delivery = run.delivery;
					if (!delivery)
						throw new Error("Accepted external delivery contract required");
					const snapshot = delivery.verification;
					if (
						!snapshot ||
						boundOutput(context, "guide", "externalDigest") !== snapshot.digest
					)
						throw new Error(
							"External guide must bind current independent verification",
						);
					if (delivery.contract.mode === "mixed") {
						if (boundOutput(context, "merge", "merged") !== true)
							throw new Error(
								"Mixed external reacceptance requires retained confirmed repository merge proof",
							);
						return {
							...(boundOutput(context, "draftPr") as Record<string, unknown>),
							mode: "mixed",
							externalDigest: snapshot.digest,
						};
					}
					return {
						headSha: "",
						url: "",
						mode: "external",
						externalDigest: snapshot.digest,
					};
				}
				const headSha = await command("git", ["rev-parse", "HEAD"]);
				const url = String(boundOutput(context, "draftPr", "url") ?? "");
				const snapshot = await inspectReadinessWithRetry(context, command, url);
				assessFeedback(context, snapshot);
				const aggregate = aggregateForContext(context);
				if (aggregate) {
					if (
						aggregate.baseline.headSha !== headSha ||
						aggregate.baseline.baseSha !== snapshot.baseSha ||
						this.scopeChanged(context, aggregate.baseline.context)
					) {
						if (
							context.step.branches.some(
								(b) => b.when.path === "rework" && b.when.equals === true,
							)
						)
							return {
								rework: true,
								headSha,
								url,
								reason:
									"Revision or accepted scope changed after review; extract and review again before human approval",
							};
						throw new Error(
							"Revision or accepted scope changed after review; configure a correction route through requirement extraction",
						);
					}
					if (!context.groupedImpactValidated)
						await assertCurrentImpact(context);
					assertAggregateRevision(aggregate, headSha, snapshot.baseSha);
				}
				if (
					snapshot.headSha !== headSha ||
					boundOutput(context, "handoff", "headSha") !== headSha
				)
					throw new Error(
						"Review guide revision changed; retry review before approving",
					);
				if (run.delivery?.contract.mode === "mixed") {
					if (!this.hooks.ticketDelivery)
						throw new Error("Ticket delivery integration unavailable");
					const snapshot = await this.hooks.ticketDelivery.verify(run);
					if (
						boundOutput(context, "guide", "externalDigest") !== snapshot.digest
					)
						return {
							rework: true,
							reason: "External evidence changed after guide; review it again",
						};
					return {
						headSha,
						url,
						mode: "mixed",
						externalDigest: snapshot.digest,
					};
				}
				return { headSha, url };
			}
			case "merge": {
				const impact = context.groupedImpactValidated
					? undefined
					: await assertCurrentImpact(context);
				const originalApproved =
					context.executionApproval ?? run.humanDecisions?.at(-1);
				const continuation = run.approvalContinuations?.at(-1);
				const approved =
					continuation &&
					impact &&
					continuation.decisionDigest === impactDecisionDigest(impact) &&
					continuation.originalReviewId === originalApproved?.reviewId
						? { ...originalApproved, headSha: continuation.headSha }
						: originalApproved;
				if (approved?.decision !== "approve")
					throw new Error("Explicit human approval required before merge");
				const url = String(boundOutput(context, "draftPr", "url") ?? "");
				let submitted = false;
				for (;;) {
					context.assertSchedulingOpen?.();
					let immediate = false;
					const inspectAndMerge = async () => {
						const impact = context.groupedImpactValidated
							? undefined
							: await assertCurrentImpact(context);
						const originalApproved = context.validateDelivery
							? (context.executionApproval ?? run.humanDecisions?.at(-1))
							: await effectiveApproval(context);
						const continuation = run.approvalContinuations?.at(-1);
						const approved =
							continuation &&
							impact &&
							continuation.decisionDigest === impactDecisionDigest(impact) &&
							continuation.originalReviewId === originalApproved?.reviewId
								? { ...originalApproved, headSha: continuation.headSha }
								: originalApproved;
						if (approved?.decision !== "approve")
							throw new Error("Explicit human approval required before merge");
						if (!context.groupedImpactValidated)
							await assertCurrentImpact(context);
						const invalid = await context.validateDelivery?.();
						if (invalid) return invalid;
						const snapshot = await inspectReadinessWithRetry(
							context,
							command,
							url,
						);
						const merged = confirmedMerge(run, snapshot);
						if (merged) {
							reportReadiness(context, snapshot);
							return merged;
						}
						assessFeedback(context, snapshot);
						reportReadiness(context, snapshot);
						if (snapshot.ciAssistance?.length) return snapshot;
						const aggregate = aggregateForContext(context);
						if (
							aggregate &&
							(aggregate.baseline.baseSha !== snapshot.baseSha ||
								this.scopeChanged(context, aggregate.baseline.context))
						) {
							delete run.reviewGate;
							return {
								...snapshot,
								rework: true,
								reason:
									"Base or accepted scope changed after specialist review",
							};
						}
						if (aggregate)
							assertAggregateRevision(
								aggregate,
								approved.headSha,
								snapshot.baseSha,
							);
						if (
							snapshot.headSha !== approved.headSha ||
							(await command("git", ["rev-parse", "HEAD"])) !==
								approved.headSha ||
							(await command("git", ["status", "--porcelain"]))
						) {
							delete run.reviewGate;
							return {
								...snapshot,
								fix: true,
								rework: false,
								reason:
									"Revision changed after human approval; synchronize the local and remote branch without discarding work, commit/push pending changes, then repeat all review gates",
							};
						}
						if (snapshot.state !== "OPEN")
							throw new Error("PR closed without merging");
						if (snapshot.isDraft) {
							await (await provider(url)).draft(url, false);
							immediate = true;
							return undefined;
						}
						if (snapshot.fix) return { ...snapshot, fix: true };
						if (snapshot.approved && !snapshot.queued && !submitted) {
							await (await provider(url)).merge(
								url,
								approved.headSha,
								snapshot.mergeMethod,
							);
							submitted = true;
							context.log(
								"Merge requested; waiting for the provider to confirm merge or queue completion.",
							);
						}
						return undefined;
					};
					const result = await (context.coordinateDelivery
						? context.coordinateDelivery(inspectAndMerge)
						: inspectAndMerge());
					if (result) return result;
					if (!immediate) await waitForNextPoll(context);
				}
			}
			case "handoff": {
				const headSha = await command("git", ["rev-parse", "HEAD"]);
				const url = String(boundOutput(context, "draftPr", "url"));
				const pr = await (await provider(url)).view(
					url,
					"headRefOid,isDraft,state",
				);
				if (await command("git", ["status", "--porcelain"]))
					throw new Error("Worktree changed after review; handoff blocked");
				if (pr.state === "MERGED") {
					const receipt = confirmedMerge(run, {
						state: pr.state,
						headSha: pr.headRefOid,
					});
					if (
						receipt &&
						headSha === receipt.headSha &&
						pendingMergeConfirmation(run, receipt)
					)
						return receipt;
				}
				if (pr.state !== "OPEN")
					throw new Error("PR is no longer open; handoff blocked");
				if (
					pr.headRefOid !== headSha ||
					boundOutput(context, "ci", "headSha") !== headSha
				) {
					if (
						!context.step.branches.some(
							(branch) =>
								branch.when.path === "fix" && branch.when.equals === true,
						)
					) {
						throw new Error(
							"PR revision or CI evidence changed; handoff blocked",
						);
					}
					const readiness = await inspectReadinessWithRetry(
						context,
						command,
						url,
					);
					assessFeedback(context, readiness);
					readiness.fix = true;
					readiness.approved = false;
					readiness.reviewReady = false;
					readiness.blockers.push({
						kind: "revision",
						action: "fix",
						message:
							"PR/worktree revision changed after CI; synchronize the branch and repeat review and validation before handoff",
					});
					writeBoundOutput(context, "ci", readiness);
					return readiness;
				}
				let readiness: MergeReadiness;
				for (;;) {
					readiness = await inspectReadinessWithRetry(context, command, url);
					assessFeedback(context, readiness);
					reportReadiness(context, readiness);
					if (readiness.ciAssistance?.length) return readiness;
					if (readiness.headSha !== headSha || readiness.state !== "OPEN")
						throw new Error(
							`Merge readiness changed; handoff blocked: ${readiness.blockers.map((blocker) => blocker.message).join("; ") || "PR state or revision changed"}`,
						);
					if (
						(await command("git", ["rev-parse", "HEAD"])) !== headSha ||
						(await command("git", ["status", "--porcelain"]))
					)
						throw new Error("Worktree changed after review; handoff blocked");
					if (
						consumesImpact(context.step) &&
						readiness.unassessedComments?.length
					) {
						writeBoundOutput(context, "ci", readiness);
						return { ...readiness, impactRequired: true };
					}
					if (readiness.fix) {
						if (
							context.step.branches.some(
								(branch) =>
									branch.when.path === "fix" && branch.when.equals === true,
							)
						) {
							// The existing fixer and its review gate consume the latest
							// CI receipt, including feedback arriving after the guide.
							writeBoundOutput(context, "ci", readiness);
							return readiness;
						}
						throw new Error(
							`Merge readiness changed; handoff blocked: ${readiness.blockers.map((blocker) => blocker.message).join("; ")}`,
						);
					}
					const aggregate = aggregateForContext(context);
					if (aggregate) {
						if (
							aggregate.baseline.headSha !== headSha ||
							aggregate.baseline.baseSha !== readiness.baseSha ||
							this.scopeChanged(context, aggregate.baseline.context)
						) {
							if (
								context.step.branches.some(
									(b) => b.when.path === "fix" && b.when.equals === true,
								)
							)
								return {
									...readiness,
									fix: true,
									scopeReviewRequired: true,
									impactRequired: Boolean(consumesImpact(context.step)),
									reason:
										"Accepted context changed after review; extract a new requirement baseline",
								};
							throw new Error(
								"Accepted scope changed after specialist review; configure a correction route through requirement extraction",
							);
						}
						if (!context.groupedImpactValidated)
							await assertCurrentImpact(context);
						assertAggregateRevision(aggregate, headSha, readiness.baseSha);
					}
					if (readiness.reviewReady) break;
					// The provider may recalculate mergeability or start checks while the
					// guide is being written. Wait as CI does, without replaying roles.
					await waitForNextPoll(context);
				}
				const recovery = guideGapRecovery(context, readiness);
				if (recovery) {
					writeBoundOutput(context, "ci", recovery);
					return recovery;
				}
				if (!guideReady(boundOutput(context, "guide")))
					throw new Error(
						"Review guide reports unresolved gaps; handoff blocked",
					);
				if (hasCheck(context.step, "qa-evidence")) {
					const gate = await this.qaGate(context, command);
					const accepted = boundOutput(context, "qaGate");
					if (
						!gate.approved ||
						readPath(accepted, "headSha") !== headSha ||
						readPath(accepted, "captureHash") !== gate.captureHash ||
						readPath(accepted, "scopeHash") !== gate.scopeHash ||
						readPath(accepted, "reviewHash") !== gate.reviewHash
					)
						throw new Error(
							"QA evidence changed or is incomplete; handoff blocked",
						);
				}
				const guideOutput = boundOutput(context, "guide");
				const guide = isReviewBrief(guideOutput)
					? briefMarkdown(guideOutput, headSha)
					: reviewGuideMarkdown(guideOutput, headSha);
				await (await provider(url)).description(url, guide);
				if (!run.ticketReference)
					await this.hooks.postComment(
						run.id,
						`Ready for human review: ${url}. Review the guide and approve this revision or request changes in Factory.`,
						"operational",
					);
				return { url, headSha, ready: true };
			}
			case "exec": {
				const [exe, ...args] = (context.step.args ?? []).map((arg) =>
					String(toolArguments(context, arg)),
				);
				if (!exe)
					throw new Error("exec tool needs an executable and arguments");
				const stdout = await command(exe, args);
				try {
					return JSON.parse(stdout);
				} catch {
					return { stdout };
				}
			}
			default: {
				const match = context.step.tool?.match(/^mcp__(.+?)__(.+)$/);
				if (match && this.hooks.mcp)
					return this.hooks.mcp(context, match[1]!, match[2]!);
				throw new Error(
					`Unknown workflow tool: ${context.step.tool}. Use exec for CLI tools or mcp__server__tool for configured MCP tools.`,
				);
			}
		}
	}
}

export function parseAgentOutput(text: string): unknown {
	const cleaned = text
		.trim()
		.replace(/^```(?:json)?\s*/, "")
		.replace(/\s*```$/, "");
	try {
		return JSON.parse(cleaned);
	} catch {
		throw new Error(
			`Agent did not return the required JSON result: ${cleaned.slice(-2000)}`,
		);
	}
}

/** A completed capture needs agent correction, rather than another finalization retry. */
export class CaptureReuseError extends Error {
	constructor(
		readonly screenshots: { path: string; area: string; state?: string }[],
	) {
		super(
			`Screenshot reuse is not verified for ${screenshots.map((shot) => `${shot.area}/${shot.state}`).join(", ")}; capture a fresh image for each rejected state`,
		);
		this.name = "CaptureReuseError";
	}
}

export function captureEvidence(
	context: ExecutionContext,
	output: unknown,
): unknown {
	const qa =
		formatOf(context.step) === "qa-capture-v1" ||
		hasCheck(context.step, "qa-evidence");
	const capture: z.infer<typeof CaptureSchema> &
		Partial<z.infer<typeof QaCaptureSchema>> = qa
		? QaCaptureSchema.parse(output)
		: CaptureSchema.parse(output);
	const areas = boundOutput(context, "scope", "areas");
	if (qa) {
		const scope = boundOutput(context, "scope") as {
			stories: { id: string; goal: string; criteria: unknown[] }[];
			notApplicableReason?: string;
		};
		capture.coverage = {
			plannedStories: scope.stories.length,
			plannedCriteria: scope.stories.reduce((n, s) => n + s.criteria.length, 0),
			reportedStories: capture.results!.length,
			reportedCriteria: capture.results!.reduce(
				(n, s) => n + s.criteria.length,
				0,
			),
		};
		for (const result of capture.results!)
			result.goal = scope.stories.find((s) => s.id === result.storyId)?.goal;
		if (scope.notApplicableReason)
			capture.notApplicableReason = scope.notApplicableReason;
		else delete capture.notApplicableReason;
		const current = context.progress?.currentRevision;
		if (!current) throw new Error("QA requires runtime revision provenance");
		capture.testedRevision = {
			headSha: current.headSha,
			dirty: current.dirty,
			scopeHash: qaDigest(scope),
		};
		for (const shot of capture.screenshots)
			if (
				!Array.isArray(areas) ||
				!areas.some(
					(a) => a.name === shot.area && a.states.includes(shot.state),
				)
			)
				throw new Error(`Unknown screenshot task ${shot.area}/${shot.state}`);
	}
	const budget = boundOutput(context, "scope", "captureBudget");
	// Old persisted inventories remain readable/resumable; new evidence plans are bounded.
	if (typeof budget === "number") {
		if (capture.screenshots.length > budget)
			throw new OutputValidationError(output, [
				{
					path: "/screenshots",
					message: `Capture exceeds the representative evidence budget of ${budget}`,
					expected: budget,
					actual: capture.screenshots.length,
				},
			]);
		const identities = capture.screenshots.map(
			(shot) => `${shot.area}\0${shot.state}`,
		);
		const hashes = capture.screenshots.map((shot) =>
			createHash("sha256")
				.update(
					readFileSync(verifiedScreenshot(shot.path, context.evidenceDir)),
				)
				.digest("hex"),
		);
		if (
			new Set(identities).size !== identities.length ||
			new Set(hashes).size !== hashes.length
		)
			throw new OutputValidationError(output, [
				{
					path: "/screenshots",
					message:
						"Capture contains duplicate states or identical images; keep one representative image",
					expected: "unique states and image hashes",
					actual: { identities, hashes },
				},
			]);
	}
	capture.unavailable = captureGaps(capture, areas);
	const scope = boundOutput(context, "scope") as
		| {
				areas?: { name: string; dependencies?: string[]; changed?: boolean }[];
				nonVisualFiles?: string[];
		  }
		| undefined;
	const previous = context.progress?.previousOutput as
		| {
				screenshots?: z.infer<typeof screenshotSchema>[];
				dependencyManifests?: Record<string, Record<string, string>>;
		  }
		| undefined;
	const dependencies = (scope?.areas ?? []).flatMap(
		(area) => area.dependencies ?? [],
	);
	const nonVisual = new Set(scope?.nonVisualFiles ?? []);
	const unexplained =
		context.progress?.changedFiles.some(
			(file) =>
				!nonVisual.has(file) &&
				!dependencies.some((dependency) => dependencyCovers(file, dependency)),
		) ?? true;
	// Only runtime-computed manifests may survive finalization.
	delete capture.dependencyManifests;
	const rejected: CaptureReuseError["screenshots"] = [];
	const manifests = new Map<string, Record<string, string>>();
	for (const shot of capture.screenshots) {
		if (!existsSync(shot.path))
			throw new Error(`Screenshot missing: ${shot.path}`);
		verifiedScreenshot(shot.path, context.evidenceDir);
		const imageSha256 = createHash("sha256")
			.update(readFileSync(shot.path))
			.digest("hex");
		const area = scope?.areas?.find((area) => area.name === shot.area);
		let hashes: Record<string, string> | undefined;
		if (area?.dependencies?.length) {
			const key = JSON.stringify([...area.dependencies].sort());
			hashes = manifests.get(key);
			if (!hashes) {
				hashes = dependencyHashes(
					context.run.workspace,
					area.dependencies,
					runRepositories(context.run),
				);
				manifests.set(key, hashes);
			}
		}
		const old = previous?.screenshots?.find((old) => old.path === shot.path);
		if (old) {
			const oldHashes =
				old.dependencyHashes ??
				(old.dependencyManifest
					? previous?.dependencyManifests?.[old.dependencyManifest]
					: undefined);
			const sameSources =
				hashes &&
				oldHashes &&
				JSON.stringify(hashes) === JSON.stringify(oldHashes);
			// Exact revision alone cannot prove explicit ignored runtime inputs unchanged.
			// Legacy maps migrate only when their complete source fingerprint agrees.
			const unchanged =
				!context.progress?.uncertain &&
				sameSources &&
				(context.progress?.unchangedCode ||
					(!unexplained &&
						area?.changed === false &&
						old.fingerprintVersion === 2));

			if (
				!unchanged ||
				old.area !== shot.area ||
				old.state !== shot.state ||
				old.imageSha256 !== imageSha256 ||
				(boundOutput(context, "qaGate", "approved") !== true &&
					!(
						boundOutput(context, "qaReview", "acceptedScreenshots") as
							| { area: string; state: string; imageSha256: string }[]
							| undefined
					)?.some(
						(item) =>
							item.area === shot.area &&
							item.state === shot.state &&
							item.imageSha256 === imageSha256,
					))
			) {
				rejected.push({ path: shot.path, area: shot.area, state: shot.state });
				continue;
			}
			shot.reused = true;
		} else shot.reused = false;
		shot.revision = context.progress?.currentRevision?.headSha;
		shot.imageSha256 = imageSha256;
		delete shot.dependencyManifest;
		if (hashes) {
			const digest = createHash("sha256")
				.update(JSON.stringify(hashes))
				.digest("hex");
			capture.dependencyManifests ??= {};
			capture.dependencyManifests[digest] = hashes;
			shot.dependencyManifest = digest;
		}
		delete shot.dependencyHashes;
		shot.fingerprintVersion = 2;
	}
	if (rejected.length) throw new CaptureReuseError(rejected);
	if (qa) stampQaCriteria(context, capture as import("./Qa.js").QaExecution);
	return capture;
}
