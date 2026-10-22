import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { z } from "zod";
import { AgentSettingsSchema } from "./AgentSettings.js";
import {
	deliveredImprovement,
	type ImprovementAction,
	type ImprovementPackage,
	ImprovementSettingsSchema,
	type ImprovementState,
	improvementChildId,
	improvementDigest,
	improvementPerspectives,
	PackagesSchema,
	PlanCheckSchema,
	ProposalOutputSchema,
	ResearchPlanSchema,
	ResearchResultSchema,
	validateChoices,
	validateOpportunities,
	validatePackages,
} from "./Improvement.js";
import { runRepositories } from "./RepositoryScope.js";
import { classifyOperationalError } from "./RepositorySnapshot.js";
import { legacyImprovementTemplate } from "./StepConfig.js";
import { outputForTool } from "./ToolBindings.js";
import type {
	ExecutionContext,
	FactoryRun,
	WorkflowRuntime,
} from "./WorkflowRuntime.js";

export interface ImprovementHost {
	runtime: WorkflowRuntime;
	agent(context: ExecutionContext): Promise<unknown>;
	issue?(
		run: FactoryRun,
		issue: ImprovementState["issues"][string],
		signal: AbortSignal,
	): Promise<{ id: string; url: string }>;
	wait(
		run: FactoryRun,
		signal: AbortSignal,
		phase: ImprovementState["phase"],
	): Promise<void>;
}
export function improvementState(run: FactoryRun): ImprovementState {
	run.improvementState ??= {
		phase: "research",
		settings: ImprovementSettingsSchema.parse(run.workflow.improvement ?? {}),
		revision: 0,
		jobs: {},
		attempts: 0,
		proposals: [],
		choices: {},
		comments: [],
		children: {},
		issues: {},
		limitations: [],
	};
	return run.improvementState;
}
export function applyImprovementAction(
	run: FactoryRun,
	action: ImprovementAction,
	actor: string,
) {
	const state = structuredClone(improvementState(run)),
		proposal = state.proposals.at(-1);
	if (action.expectedRevision !== state.revision)
		throw new Error("Choices changed; refresh before acting");
	if (
		!proposal ||
		action.version !== proposal.version ||
		action.digest !== proposal.digest
	)
		throw new Error("Proposal changed; refresh before acting");
	if (state.acceptance)
		throw new Error(
			"Accepted action manifest is immutable; use the existing child or start another batch",
		);
	if (!["discussion", "ready"].includes(state.phase))
		throw new Error(
			"Wait for the current research/planning operation to finish",
		);
	if (action.choices) {
		for (const key of Object.keys(action.choices))
			if (!proposal.opportunities.some((i) => i.id === key))
				throw new Error("Unknown proposal item");
		state.choices = structuredClone(action.choices);
		delete state.manifest;
		state.phase = "discussion";
	}
	if (action.comment?.trim()) {
		state.comments.push({
			itemId: action.itemId,
			text: action.comment.trim(),
			actor,
			at: new Date().toISOString(),
		});
		if (action.action === "choose") {
			delete state.manifest;
			state.phase = "discussion";
		}
	}
	if (action.action === "follow-up") {
		if (!action.comment?.trim())
			throw new Error("Enter the follow-up question");
		if (
			action.itemId &&
			!proposal.opportunities.some((i) => i.id === action.itemId)
		)
			throw new Error("Unknown proposal item");
		if (action.itemId)
			state.choices[action.itemId] = {
				action: "follow-up",
				comment: action.comment,
			};
		state.phase = "research";
		delete state.manifest;
	} else if (action.action === "prepare") {
		validateChoices(proposal, state.choices, true);
		delete state.manifest;
		state.phase = "planning";
	} else if (action.action === "apply") {
		const manifest = state.manifest;
		if (
			!manifest ||
			manifest.digest !== action.manifestDigest ||
			manifest.proposalDigest !== proposal.digest ||
			improvementDigest(manifest.choices) !== improvementDigest(state.choices)
		)
			throw new Error(
				"Prepare and review the exact current action manifest before applying choices",
			);
		validatePackages(proposal, manifest.choices, manifest.packages);
		if (manifest.checks.some((c) => !PlanCheckSchema.parse(c).approved))
			throw new Error("Plan corrections remain unresolved");
		const workflow = run.workflowDefinitions?.find((w) => w.id === "factory");
		if (!workflow?.allowedTriggers.includes("manual"))
			throw new Error(
				"Software factory workflow is unavailable for child launches",
			);
		state.acceptance = {
			digest: manifest.digest,
			actor,
			at: new Date().toISOString(),
			workflow: structuredClone(workflow),
			definitions: structuredClone(run.workflowDefinitions!),
		};
		state.phase = "dispatch";
	} else if (action.action === "finish") state.phase = "finished";
	const original = improvementState(run);
	state.revision++;
	if (!state.manifest) delete original.manifest;
	Object.assign(original, state);
}

/** A FIFO shared work limit; a coordinator consumes a slot only during its own turn. */
class ResearchSlots {
	private active = 0;
	private queue: (() => void)[] = [];
	constructor(private limit: number) {}
	async run<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
		if (this.active >= this.limit)
			await new Promise<void>((resolve, reject) => {
				const ready = () => {
					signal.removeEventListener("abort", abort);
					resolve();
				};
				const abort = () => {
					this.queue = this.queue.filter((r) => r !== ready);
					reject(signal.reason);
				};
				this.queue.push(ready);
				signal.addEventListener("abort", abort, { once: true });
				if (signal.aborted) abort();
			});
		else this.active++;
		try {
			signal.throwIfAborted();
			return await operation();
		} finally {
			const next = this.queue.shift();
			if (next) next();
			else this.active--;
		}
	}
}
export async function runImprovement(
	host: ImprovementHost,
	run: FactoryRun,
	signal: AbortSignal,
) {
	const { runtime } = host,
		state = improvementState(run);
	const slots = new ResearchSlots(state.settings.concurrency);
	const save = () => runtime.save(run);
	const role = async <T>(
		roleId: string,
		key: string,
		input: unknown,
		schema: z.ZodType<T>,
	): Promise<T> => {
		const saved = state.jobs[key];
		if (saved?.status === "completed") return schema.parse(saved.output);
		const template = legacyImprovementTemplate(run.workflow, roleId);
		if (!template) throw new Error(`Missing accepted research role: ${roleId}`);
		return slots.run(signal, async () => {
			if (state.attempts >= state.settings.maxAgentAttempts)
				throw new Error(
					"Improvement research budget exhausted; increase the accepted workflow budget in a new run",
				);
			state.attempts++;
			state.jobs[key] ??= {
				role: roleId,
				status: "running",
				attempts: 0,
			};
			const job = state.jobs[key]!;
			job.attempts++;
			job.status = "running";
			delete job.error;
			job.settings ??= AgentSettingsSchema.parse(template);
			run.step = key;
			run.status = "running";
			await save();
			signal.throwIfAborted();
			const controller = new AbortController();
			const abort = () => controller.abort(signal.reason);
			signal.addEventListener("abort", abort, { once: true });
			const timer = setTimeout(
				() =>
					controller.abort(new Error("Research role time budget exhausted")),
				state.settings.roleTimeoutSeconds * 1000,
			);
			try {
				const output = await host.agent({
					run,
					step: { ...template, ...job.settings },
					stepKey: key,
					input,
					signal: controller.signal,
					validateRoleOutput: (value) => schema.parse(value),
					factoryHome: join(runtime.directory, ".."),
					readOnlyResearch: true,
					researchAccess: state.baseline && {
						repositories: state.baseline.repositories,
						maxCalls: 60,
					},
					capacity: runtime.capacityOptions(run, key, job.attempts),
					chat: false,
					evidenceDir: join(
						runtime.directory,
						"evidence",
						run.id,
						"research",
						key,
					),
					resumeAgent: job.agent,
					checkpointAgent: async (agent) => {
						job.agent = agent;
						await save();
					},
					save,
					log: (message, source) => runtime.log(run, key, message, source),
				});
				controller.signal.throwIfAborted();
				job.output = schema.parse(output);
				job.status = "completed";
				return schema.parse(job.output);
			} catch (error) {
				job.status = "failed";
				job.error = error instanceof Error ? error.message : String(error);
				throw error;
			} finally {
				clearTimeout(timer);
				signal.removeEventListener("abort", abort);
				await save();
			}
		});
	};
	if (!state.baseline) {
		const repositories = runRepositories(run).map((repo) => {
			const root = repo.workspace || run.workspace;
			const revision = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
				encoding: "utf8",
				timeout: 15000,
			}).trim();
			return { id: repo.id, root, revision, baseBranch: repo.baseBranch };
		});
		state.baseline = {
			repositories,
			history: Object.fromEntries(
				repositories.map((repo) => [
					repo.id,
					execFileSync(
						"git",
						[
							"-C",
							repo.root,
							"log",
							`--since=${state.settings.lookbackDays} days ago`,
							"--format=%h %ad %s",
							"--date=short",
							"--name-only",
							"-100",
							repo.revision,
						],
						{ encoding: "utf8", timeout: 15000, maxBuffer: 1024 * 1024 },
					).slice(0, 120000),
				]),
			),
			observedAt: new Date().toISOString(),
		};
		const cutoff = Date.now() - state.settings.lookbackDays * 86400000;
		const applicable = runRepositories(run).some((repo) => {
			try {
				return /bobs-factory/.test(
					execFileSync(
						"git",
						[
							"-C",
							repo.workspace || run.workspace,
							"show",
							`${state.baseline!.repositories.find((r) => r.id === repo.id)!.revision}:package.json`,
						],
						{
							encoding: "utf8",
							timeout: 15000,
							stdio: ["ignore", "pipe", "pipe"],
						},
					),
				);
			} catch {
				return false;
			}
		});
		const all = [...runtime.runs.values()].filter(
			(r) =>
				r.id !== run.id &&
				r.repositoryId === run.repositoryId &&
				Date.parse(r.updatedAt) >= cutoff,
		);
		state.operations = applicable
			? {
					observedAt: state.baseline.observedAt,
					lookbackDays: state.settings.lookbackDays,
					total: all.length,
					sampled: all.length > 200,
					records: all.slice(-200).map((r) => ({
						id: r.id,
						workflow: r.workflow.id,
						status: r.status,
						step: r.step,
						createdAt: r.createdAt,
						updatedAt: r.updatedAt,
						wait: r.architectureGate
							? "architecture"
							: r.reviewGate
								? "human-review"
								: r.questions.length
									? "questions"
									: Object.values(r.capacityLeaves ?? {}).map((l) => l.phase),
						transitions: (r.activitySteps ?? []).slice(-50),
						attempts: r.stepAttempts?.slice(-30).map((a) => ({
							step: a.step,
							outcome: a.outcome,
							startedAt: a.startedAt,
							endedAt: a.endedAt,
							runtime: a.runtime,
							revision: a.revision,
						})),
						// Aggregate error categories avoid copying credentials/personal data from raw logs.
						error: r.error ? classifyOperationalError(r.error) : undefined,
					})),
				}
			: {
					available: false,
					reason:
						"No repository-matched operational source configured; source research remains available",
				};
		await save();
	}
	const shared = {
		focus: run.launchInputs?.focus ?? "",
		baseline: state.baseline,
		operations: state.operations,
	};
	while (state.phase !== "finished") {
		signal.throwIfAborted();
		if (state.phase === "research") {
			const worker = legacyImprovementTemplate(
				run.workflow,
				"research-worker",
			)!;
			if (!worker.model && state.settings.workerFallback === "block")
				throw new Error(
					"Choose a cheaper model for Improve codebase → Cheaper research worker in Recipes, or explicitly enable inherit fallback in a private fork. No worker model was silently substituted.",
				);
			if (
				!worker.model &&
				!state.limitations.includes(
					"Workers explicitly inherit the coordinator model",
				)
			)
				state.limitations.push(
					"Workers explicitly inherit the coordinator model",
				);
			const lead = await role(
				"lead",
				"lead",
				shared,
				ProposalOutputSchema.pick({
					summary: true,
					limitations: true,
				}).passthrough(),
			);
			const round = state.proposals.length;
			let reports: unknown[] = [];
			{
				const feedback = round
					? {
							previous: state.proposals.at(-1),
							comments: state.comments,
							choices: state.choices,
						}
					: {};
				const perspectives = round
					? improvementPerspectives.filter(([id]) => {
							const itemId = state.comments.at(-1)?.itemId;
							const item = state.proposals
								.at(-1)
								?.opportunities.find((i) => i.id === itemId);
							return item?.perspectives.includes(id) || id === "architecture";
						})
					: improvementPerspectives;
				const suffix = round ? `-followup-${round}` : "";
				const results = await Promise.allSettled(
					perspectives.map(async ([id, name]) => {
						const plan = await role(
							`coordinate-${id}`,
							`coordinate-${id}${suffix}`,
							{ ...shared, lead, ...feedback },
							ResearchPlanSchema,
						);
						if (plan.skippedReason)
							return {
								perspective: id,
								summary: plan.summary,
								skippedReason: plan.skippedReason,
							};
						const workers = await Promise.allSettled(
							plan.assignments.map((assignment) =>
								role(
									"research-worker",
									`worker-${id}-${assignment.id}${suffix}`,
									{ ...shared, lead, perspective: id, assignment, ...feedback },
									ResearchResultSchema,
								),
							),
						);
						return {
							perspective: id,
							report: await role(
								"coordinate-results",
								`results-${id}${suffix}`,
								{
									...shared,
									lead,
									perspective: name,
									plan,
									workers: workers.map((r) =>
										r.status === "fulfilled"
											? r.value
											: { coverageGap: String(r.reason) },
									),
								},
								ResearchResultSchema,
							),
						};
					}),
				);
				reports = results.map((r, i) =>
					r.status === "fulfilled"
						? r.value
						: {
								perspective: perspectives[i]![0],
								coverageGap: String(r.reason),
							},
				);
				if (results.every((r) => r.status === "rejected"))
					throw new Error(
						"All research perspectives failed; restore access/model configuration and Retry",
					);
				state.reports = [...(round ? (state.reports ?? []) : []), ...reports];
				reports = state.reports;
			}
			const output = await role(
				"synthesize",
				`proposal-${round}`,
				{
					...shared,
					lead,
					reports,
					previous: state.proposals.at(-1),
					comments: state.comments,
					choices: state.choices,
				},
				ProposalOutputSchema.superRefine((value, ctx) => {
					try {
						validateOpportunities(value.opportunities);
					} catch (error) {
						ctx.addIssue({
							code: "custom",
							path: ["opportunities"],
							message: error instanceof Error ? error.message : String(error),
						});
					}
				}),
			);
			validateOpportunities(output.opportunities);
			const proposal = {
				...output,
				version: round + 1,
				at: new Date().toISOString(),
				digest: improvementDigest({
					output,
					baseline: state.baseline,
					version: round + 1,
				}),
			};
			const previous = state.proposals.at(-1);
			state.choices = Object.fromEntries(
				Object.entries(state.choices).filter(
					([id, choice]) =>
						choice.action !== "follow-up" &&
						improvementDigest(
							previous?.opportunities.find((i) => i.id === id) ?? null,
						) ===
							improvementDigest(
								proposal.opportunities.find((i) => i.id === id) ?? null,
							),
				),
			);
			state.proposals.push(proposal);
			state.revision++;
			state.phase = output.opportunities.length ? "discussion" : "finished";
			delete state.manifest;
			await save();
		} else if (state.phase === "planning") {
			const proposal = state.proposals.at(-1)!;
			validateChoices(proposal, state.choices, true);
			const version = improvementDigest([
				proposal.digest,
				state.choices,
				state.comments,
			]).slice(0, 16);
			const refined = await Promise.all(
				proposal.opportunities
					.filter((i) => state.choices[i.id]?.action === "fix")
					.map((item) =>
						role(
							"package",
							`package-${version}-${item.id}`,
							{
								...shared,
								item,
								proposal,
								choices: state.choices,
								comments: state.comments,
							},
							PackagesSchema,
						),
					),
			);
			const packages = refined.flatMap((p) => p.packages);
			validatePackages(proposal, state.choices, packages);
			const candidate = {
				proposalDigest: proposal.digest,
				choices: structuredClone(state.choices),
				packages,
			};
			const checks = packages.length
				? await Promise.all(
						["check-architecture", "check-security", "check-dependencies"].map(
							(check) =>
								role(
									check,
									`${check}-${version}`,
									{ ...shared, proposal, manifest: candidate },
									PlanCheckSchema,
								),
						),
					)
				: [];
			if (checks.some((c) => !c.approved)) {
				delete state.manifest;
				state.comments.push({
					text: `Independent plan corrections: ${checks.flatMap((c) => c.feedback).join("\n")}`,
					actor: "independent plan checks",
					at: new Date().toISOString(),
				});
				state.phase = "discussion";
				state.limitations.push(
					"Plan corrections need a revised proposal before acceptance",
				);
			} else {
				state.manifest = {
					...candidate,
					checks,
					digest: improvementDigest({ ...candidate, checks }),
				};
				state.phase = "ready";
			}
			await save();
		} else if (state.phase === "dispatch") {
			const manifest = state.manifest!,
				acceptance = state.acceptance!;
			if (
				acceptance.digest !== manifest.digest ||
				improvementDigest({
					proposalDigest: manifest.proposalDigest,
					choices: manifest.choices,
					packages: manifest.packages,
					checks: manifest.checks,
				}) !== manifest.digest
			)
				throw new Error("Accepted improvement manifest integrity check failed");
			const issueErrors: string[] = [];
			for (const [id, choice] of Object.entries(manifest.choices)) {
				if (choice.action !== "issue") continue;
				const item = state.proposals
					.at(-1)!
					.opportunities.find((i) => i.id === id)!;
				const key = improvementDigest([run.id, manifest.digest, id, "issue"]);
				state.issues[id] ??= {
					key,
					title: item.title,
					body: `${item.problem}\n\nDeferred from improvement run ${run.id}; this issue does not schedule implementation.\n\n## Repository baseline\n${state.baseline!.repositories.map((r) => `- ${r.id}: ${r.revision} (base ${r.baseBranch})`).join("\n")}\n\n## Expected benefit\n${item.consequence}\n\n## Current design\n${item.before}\n\n## Proposed design\n${item.after}\n\n## Evidence\n${item.evidence.join("\n\n")}\n\n## Proposed improvement\n${item.plan}\n\n## Acceptance criteria\n${item.criteria.map((c) => `- ${c}`).join("\n")}\n\n## Non-goals\n${item.nonGoals.join("\n")}\n\n## Risks and tradeoffs\n${item.risks.join("\n")}\n\n## Prerequisites\n${item.dependencies.join(", ") || "None"}\n\n<!-- factory-improvement:${key} -->`,
					destination: choice.destination!,
					phase: "pending",
				};
				const issue = state.issues[id]!;
				if (issue.phase === "confirmed") continue;

				await save();
				signal.throwIfAborted();
				try {
					if (issue.phase === "sending") issue.phase = "uncertain";
					await save();
					if (!host.issue)
						throw new Error("Configured issue creation adapter is unavailable");
					const result = await host.issue(run, issue, signal);
					issue.phase = "confirmed";
					issue.id = result.id;
					issue.url = result.url;
					delete issue.error;
					await save();
				} catch (error) {
					issue.error = String(error);
					if (issue.phase === "sending") issue.phase = "uncertain";
					await save();
					issueErrors.push(`${item.title}: ${String(error)}`);
				}
			}
			let allDone = true;
			for (const pkg of manifest.packages) {
				signal.throwIfAborted();
				const runId = improvementChildId(run.id, manifest.digest, pkg.id);
				let child = runtime.runs.get(runId);
				if (!child) {
					if (
						!pkg.dependencies.every((id) => {
							const ref = state.children[id];
							return (
								ref &&
								runtime.runs.has(ref.runId) &&
								deliveredImprovement(runtime.get(ref.runId))
							);
						})
					) {
						allDone = false;
						continue;
					}
					state.children[pkg.id] = { runId };
					await save();
					signal.throwIfAborted();
					const brief = packageBrief(run, pkg);
					child = runtime.create(
						{
							id: runId,
							repositoryId: run.repositoryId,
							repositories: run.repositories?.map((r) => ({
								...r,
								workspace: "",
							})),
							workflow: acceptance.workflow,
							workflowDefinitions: acceptance.definitions,
							workspace: "",
							input: brief,
							executionSnapshot: run.executionSnapshot,
							runner: run.runner,
							model: run.model,
							reasoningEffort: run.reasoningEffort,
							modelVariant: run.modelVariant,
							serviceTier: run.serviceTier,
							triggerOrigin: {
								type: "manual",
								workflowId: acceptance.workflow.id,
								at: new Date().toISOString(),
								manual: { method: "follow-up", sourceRunId: run.id },
							},
							improvementParent: {
								runId: run.id,
								manifestDigest: manifest.digest,
								packageId: pkg.id,
							},
							setupComplete: false,
							launchRequest: {
								repositoryId: run.repositoryId,
								repositoryIds: run.repositories?.map((r) => r.id),
								workflow: "factory",
								source: undefined,
								prompt: brief,
								inputs: { prompt: brief },
								attachments: {},
							},
						},
						{
							workflow: acceptance.workflow,
							workflowDefinitions: acceptance.definitions,
						},
					);
					child.title = pkg.title;
					child.titleGeneration = undefined;
					child.launchRequest = {
						repositoryId: run.repositoryId,
						repositoryIds: run.repositories?.map((r) => r.id),
						workflow: "factory",
						source: undefined,
						prompt: brief,
						inputs: { prompt: brief },
						attachments: {},
					};
					child.setupComplete = false;
					await runtime.save(child);
					signal.throwIfAborted();
					void runtime.launch(child);
				}
				if (
					child.improvementParent?.manifestDigest !== manifest.digest ||
					child.improvementParent.packageId !== pkg.id ||
					child.improvementParent.runId !== run.id
				)
					throw new Error("Child launch identity collision");
				state.children[pkg.id] = {
					runId,
					status: child.status,
					url: (
						outputForTool(child, "draft-pr") as { url?: string } | undefined
					)?.url,
				};
				if (!deliveredImprovement(child)) allDone = false;
			}
			if (issueErrors.length)
				throw new Error(
					`Issue filing needs attention; independent Fix runs have been dispatched. Retry reconciles existing issues: ${issueErrors.join("; ")}`,
				);
			if (allDone) {
				state.phase = "finished";
				await save();
				continue;
			}
			await save();
			run.step = "track-improvements";
			run.status = "waiting";
			await save();
			await host.wait(run, signal, "dispatch");
		} else {
			const waitingPhase = state.phase;
			run.step =
				state.phase === "ready"
					? "accept-improvements"
					: "discuss-improvements";
			run.status = "waiting";
			await save();
			await host.wait(run, signal, waitingPhase);
		}
	}
	run.outputs.improvements = {
		summary: state.proposals.at(-1)?.summary ?? "No improvements selected",
		children: state.children,
		issues: state.issues,
		choices: state.choices,
		limitations: state.limitations,
	};
	await save();
}
function packageBrief(run: FactoryRun, pkg: ImprovementPackage) {
	const state = run.improvementState!;
	return `Implement the approved architectural improvement: ${pkg.title}\n\n${pkg.plan}\n\nAcceptance criteria:\n${pkg.criteria.map((c) => `- ${c}`).join("\n")}\n\nRepository/base: ${JSON.stringify(state.baseline?.repositories.map((r) => ({ id: r.id, revision: r.revision, baseBranch: r.baseBranch })))}\n\nSource opportunities:\n${JSON.stringify(state.proposals.at(-1)!.opportunities.filter((i) => pkg.itemIds.includes(i.id)))}\n\nPrerequisite deliveries:\n${JSON.stringify(pkg.dependencies.map((id) => state.children[id]))}\n\nAccepted by ${state.acceptance!.actor} at ${state.acceptance!.at}, manifest ${state.acceptance!.digest}. Preserve accepted requirements and non-goals. Parent acceptance does not approve a delivered PR revision; retain ordinary Factory architecture, review, QA and human delivery gates. Revalidate assumptions against the current base containing prerequisite merges; material drift requires normal renewed architecture acceptance.`;
}
