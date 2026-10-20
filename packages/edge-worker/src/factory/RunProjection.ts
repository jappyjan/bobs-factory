import { activityPreview } from "./ActivityPage.js";
import { workflowDisplay } from "./ConfigProjection.js";
import type { FactoryRun } from "./WorkflowRuntime.js";

const focusFields = [
	"id",
	"title",
	"titleGeneration",
	"repositoryId",
	"status",
	"createdAt",
	"updatedAt",
	"step",
	"runner",
	"workflowBlock",
	"triggerOrigin",
	"capacityLeaves",
	"deliveryCoordination",
	"questions",
	"questionBatchId",
	"questionChoices",
	"questionRecommendations",
	"architectureGate",
	"reviewGate",
	"iterationLimit",
] as const satisfies readonly (keyof FactoryRun)[];

function architectureSummary(run: FactoryRun) {
	const proposal = run.architectureProposals?.at(-1);
	return proposal
		? [
				{
					id: proposal.id,
					version: proposal.version,
					status: proposal.status,
					continuation: proposal.continuation,
					content: {
						title: proposal.content.title,
						summary: proposal.content.summary,
						decisions: Array.isArray(proposal.content.decisions)
							? proposal.content.decisions.map(({ status }) => ({ status }))
							: undefined,
					},
				},
			]
		: [];
}

export function ticketSyncSummary(run: FactoryRun) {
	return (
		run.ticketSync && {
			error: run.ticketSync.error,
			receipts: run.ticketSync.receipts.map(
				({ delivered, superseded, conflict }) => ({
					delivered,
					superseded,
					...(conflict === undefined ? {} : { conflict }),
				}),
			),
		}
	);
}

/** Today needs the current decision, not the run's execution and review history. */
export function focusRun(
	run: FactoryRun,
	outputs: Record<string, unknown>,
	deliveryRecovery: boolean,
) {
	const guide = outputs.guide as
		| { verdict?: { headline?: string }; summary?: string; goal?: string }
		| undefined;
	return {
		...Object.fromEntries(focusFields.map((key) => [key, run[key]])),
		workflow: workflowDisplay(run.workflow),
		improvement: run.workflow.improvement
			? { phase: run.improvementState?.phase ?? "preparing" }
			: undefined,
		improvementParent: run.improvementParent,
		workflowDefinitions: run.workflowDefinitions?.map(workflowDisplay),
		error: run.error?.slice(0, 4000),
		deliveryRecovery,
		ticketSync: ticketSyncSummary(run),
		architectureProposals: architectureSummary(run),
		outputs: {
			guide: guide && {
				summary: String(
					guide.verdict?.headline ?? guide.summary ?? guide.goal ?? "",
				).slice(0, 320),
			},
			"draft-pr": outputs["draft-pr"] && {
				url: (outputs["draft-pr"] as { url?: string }).url,
			},
		},
	};
}

/** The overview keeps exact review identities without retaining evidence bodies. */
export function dashboardRun(
	run: FactoryRun,
	outputs: Record<string, unknown>,
	deliveryRecovery: boolean,
	architecture = false,
) {
	const decision = run.impactDecisions?.at(-1);
	return {
		...focusRun(run, outputs, deliveryRecovery),
		workspace: run.workspace,
		input: run.input,
		runner: run.runner,
		model: run.model,
		reasoningEffort: run.reasoningEffort,
		modelVariant: run.modelVariant,
		serviceTier: run.serviceTier,
		workflowCalls: run.workflowCalls,
		ticketReference: run.ticketReference,
		answers: run.answers,
		executionSnapshot: run.executionSnapshot,
		executionDiagnostics: run.executionDiagnostics,
		roleRevisions: run.roleRevisions,
		...(architecture
			? {
					architectureProposals: run.architectureProposals,
					architectureDecisions: run.architectureDecisions,
				}
			: {}),
		impactDecisions: decision
			? [
					{
						status: decision.status,
						classification: decision.classification,
						uncertainty: decision.uncertainty,
						snapshot: {
							digest: decision.snapshot.digest,
							repositories: decision.snapshot.repositories.map(
								({ repositoryId, headSha, reviewHead }) => ({
									repositoryId,
									headSha,
									reviewHead,
								}),
							),
							approval: decision.snapshot.approval && {
								headSha: decision.snapshot.approval.headSha,
							},
						},
						reuseRecords: decision.reuseRecords.map(
							({ boundary, snapshotDigest }) => ({ boundary, snapshotDigest }),
						),
					},
				]
			: [],
		outputs,
	};
}

/** Raw entries have their own endpoint; previews must not copy arbitrary metadata. */
export function entryPreviews(entries: unknown[]) {
	const start = Math.max(0, entries.length - 12);
	return entries.slice(start).map((value, offset) => ({
		...activityPreview(value, 4000),
		activityIndex: start + offset,
	}));
}

/** Mutation callers refresh their views separately; never serialize saved payloads. */
export function runActionResult(run: FactoryRun) {
	return { accepted: true, id: run.id, title: run.title, status: run.status };
}
