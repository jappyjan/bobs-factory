import { immutableJson } from "bobs-factory-core";
import { isUpdatePaused } from "../../../updates/UpdatePausedError.js";
import {
	assertImpactFresh,
	decisionFor,
	inventoryScopeMatches,
} from "../../Impact.js";
import { finishStepAttempt } from "../../Provenance.js";
import { runRepositories } from "../../RepositoryScope.js";
import {
	captureReviewContext,
	type Inventory,
	reviewedRunRevision,
} from "../../SpecialistReview.js";
import {
	consumesImpact,
	consumesReview,
	inheritStepConfig,
	readOutput,
	readStep,
	resolveStepConfig,
	reviewEvidenceContract,
} from "../../StepConfig.js";
import { NODE_REROUTE } from "../control.js";
import type { NodeContext } from "../NodeDefinition.js";
export async function execute(ctx: NodeContext): Promise<unknown> {
	const context = ctx;
	const {
		run,
		step,
		signal,
		engine,
		frame: checkpoint,
		workflowId,
		chat = false,
		reviewBaseline,
	} = ctx;
	const key = ctx.stepKey!;
	const state = checkpoint.active!;
	const outputs = ctx.outputs!;
	const config = resolveStepConfig(step);
	const input = ctx.sourceInput;
	const reviewConfig = consumesReview(step)
		? {
				inventory: readStep(step, "inventory")!,
				fanout: readStep(step, "fanout"),
			}
		: undefined;
	const impactSourceId = consumesImpact(step)
		? readStep(step, "impact")
		: undefined;
	let output: unknown;

	if (
		step.groups?.some((group) =>
			group.some(
				(item) =>
					item.askQuestions ||
					["human-review", "architecture-decision"].includes(item.tool ?? ""),
			),
		)
	)
		throw new Error("Human checkpoints belong outside fanout branches");
	if (reviewConfig && !state.reviewBaseline) {
		const inventory = outputs[reviewConfig!.inventory] as Inventory | undefined;
		if (
			!inventory?.digest ||
			inventory.questions.length ||
			inventory.conflicts.length ||
			inventory.sourceReceipt.unavailable.length
		)
			throw new Error(
				"Requirement extraction is missing or has unresolved scope/source blockers",
			);
		const impact = impactSourceId ? decisionFor(run, key) : undefined;
		if (impact) await assertImpactFresh(context, impact, step);
		if (!inventoryScopeMatches(context, inventory, impact)) {
			checkpoint.current = reviewConfig!.inventory;
			checkpoint.active = undefined;
			engine.log(
				run,
				key,
				"Scope changed after extraction; extracting a fresh inventory before starting reviewers.",
			);
			finishStepAttempt(context, "blocked");
			return NODE_REROUTE;
		}
		if (impactSourceId && !impact)
			throw new Error(
				"Configured review requires a completed impact assessment",
			);
		const repo = readOutput(step, "repository", outputs) as
			| { baseBranch?: string }
			| undefined;
		const source = readOutput(step, "source", outputs) as
			| { baseRefName?: string }
			| undefined;
		const revision = await reviewedRunRevision(
			run,
			`refs/remotes/origin/${source?.baseRefName ?? repo?.baseBranch ?? runRepositories(run)[0]!.baseBranch}`,
		);
		run.reviewRounds ??= [];
		state.reviewBaseline = immutableJson({
			schemaVersion: 1,
			round: run.reviewRounds.length + 1,
			key,
			inventory: structuredClone(inventory),
			...revision,
			historyLength: run.history.length,
			at: new Date().toISOString(),
			reviewers: (step.groups ?? []).flatMap((group, i) =>
				group.map((s) => ({
					id: s.id,
					key: `${key}/${i}/${s.id}`,
					group: i,
					contract: reviewEvidenceContract(s)!,
				})),
			),
			...captureReviewContext(input, run, engine.historyPreviews(run)),
			...(impact
				? {
						impact: {
							snapshot: structuredClone(impact.snapshot),
							reuse: structuredClone(impact.reuseRecords),
						},
					}
				: {}),
		});
		run.reviewRounds.push(state.reviewBaseline);
	}
	if (state.reviewBaseline) checkpoint.reviewKey = state.reviewBaseline.key;
	state.children ??= (step.groups ?? []).map((group, index) => {
		const prior =
			state.reviewBaseline?.impact?.snapshot.reuseVersion === "composed-v1"
				? checkpoint.branches?.[step.id]?.[index]
				: undefined;
		return {
			...engine.newCheckpoint(group),
			...(prior
				? {
						visits: { ...prior.visits },
						agentSessions: structuredClone(prior.agentSessions),
						additionalVisits: structuredClone(prior.additionalVisits),
					}
				: {}),
			outputs: reviewConfig ? {} : structuredClone(outputs),
		};
	});
	if (config.explicit) {
		checkpoint.branches ??= {};
		checkpoint.branches[step.id] = state.children;
	}
	// Also fill older resumed branches, preserving reviews established within them.
	for (const child of state.children) {
		child.reviewKey ??= checkpoint.reviewKey;
		child.iteration ??= checkpoint.iteration;
		child.callInputs ??= checkpoint.callInputs;
		child.progressInputs ??= checkpoint.progressInputs;
		child.progressItem ??= checkpoint.progressItem;
		child.snapshotInputs ??= checkpoint.snapshotInputs;
		child.projectResults ??= config.explicit ? true : checkpoint.projectResults;
	}
	await engine.save(run);
	signal.throwIfAborted();
	const branchController = new AbortController();
	const cancelBranches = () => branchController.abort(signal.reason);
	signal.addEventListener("abort", cancelBranches, { once: true });
	if (signal.aborted) cancelBranches();
	let failure: unknown;
	const branchResults = await Promise.allSettled(
		(step.groups ?? []).map((group, index) => {
			const reused = state.reviewBaseline?.impact?.reuse ?? [];
			const retainedRole = (id: string) =>
				reused.some((r) => r.original.stamp.reviewer === id);
			const afterRetained = (
				target: string | undefined,
			): string | undefined => {
				const seen = new Set<string>();
				while (target && retainedRole(target)) {
					if (seen.has(target))
						throw new Error("Review reuse cannot skip a cyclic role route");
					seen.add(target);
					const index = group.findIndex((s) => s.id === target);
					const role = group[index]!;
					if (role.branches.length)
						throw new Error("Conditional reviewer routes need full execution");
					target = role.next ?? group[index + 1]?.id ?? "end";
				}
				return target;
			};
			const selected = group
				.filter((s) => !retainedRole(s.id))
				.map((s) => ({
					...s,
					next: afterRetained(s.next),
					branches: s.branches.map((b) => ({
						...b,
						next: afterRetained(b.next)!,
					})),
				}));
			for (const candidate of selected)
				inheritStepConfig(group.find((s) => s.id === candidate.id)!, candidate);
			for (const role of group) {
				const retained = reused.find(
					(r) => r.original.stamp.reviewer === role.id,
				);
				if (retained)
					state.children![index]!.outputs![role.id] = structuredClone(
						retained.original,
					);
			}
			if (!selected.length)
				return Promise.resolve(state.children![index]!.outputs!);
			// Review branches have no internal correction routes; retain selected order.
			if (
				state.children![index]!.current !== "end" &&
				!selected.some((s) => s.id === state.children![index]!.current)
			)
				state.children![index]!.current = selected[0]!.id;
			state.children![index]!.progressPath =
				`${context.progressOperation}/${index}`;
			return engine
				.graph(
					run,
					selected,
					state.children![index]!.outputs!,
					branchController.signal,
					`${key}/${index}/`,
					state.children![index]!,
					workflowId,
					chat,
					true,
					state.reviewBaseline ?? reviewBaseline,
				)
				.catch((error) => {
					// Suspension must wait for active siblings without cancelling
					// them. A real failure still cancels and takes precedence.
					if (!failure || !isUpdatePaused(error)) failure = error;
					if (!isUpdatePaused(error)) branchController.abort(error);
					throw error;
				});
		}),
	);
	signal.removeEventListener("abort", cancelBranches);
	if (failure) throw failure;
	if (state.reviewBaseline) {
		// All runner hooks have returned and cleaned up their temporary
		// project configuration. Reject any remaining edits before
		// accepting the round, without exempting runner directories.
		const revision = await reviewedRunRevision(run, state.reviewBaseline);
		if (revision.headSha !== state.reviewBaseline.headSha)
			throw new Error("Revision changed during specialist review");
	}
	output = branchResults.map((result, index) =>
		result.status === "fulfilled"
			? reviewConfig
				? Object.fromEntries(
						(step.groups?.[index] ?? []).map((s) => [s.id, result.value[s.id]]),
					)
				: config.explicit || checkpoint.projectResults
					? engine.frameResults(
							run,
							step.groups?.[index] ?? [],
							state.children![index]!,
							`${key}/${index}/`,
						)
					: result.value
			: undefined,
	);
	if (impactSourceId) {
		const decision = decisionFor(run, key)!;
		decision.pending.specialists = state
			.reviewBaseline!.reviewers.filter((r) => {
				const receipt = (output as Record<string, any>[])[r.group]?.[r.id];
				return receipt?.status !== "completed" || receipt.blockers?.length;
			})
			.map((r) => r.id);
	}
	if (state.reviewBaseline)
		for (const reviewer of state.reviewBaseline.reviewers) {
			run.outputs[reviewer.key] = (output as Record<string, unknown>[])[
				reviewer.group
			]![reviewer.id];
		}

	return output;
}
