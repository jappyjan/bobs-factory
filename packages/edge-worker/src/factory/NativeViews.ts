import { z } from "zod";
import type { ArchitectureProposal } from "./Architecture.js";
import { digest } from "./Delivery.js";
import { foreachPointer, sanitizeJsonConfiguration } from "./Foreach.js";
import { presentationOutputKeys } from "./RunOutputRoles.js";
import { resolveStepConfig } from "./StepConfig.js";
import {
	boundStepKey,
	configuredOutputBindings,
	configuredOutputKeys,
	producerKey,
	stepForRun,
} from "./ToolBindings.js";
import {
	type ResolvedView,
	resolveView,
	viewPlainText,
	viewText,
	viewUrlSchema,
} from "./View.js";
import { prepareViewAssetCheck } from "./ViewAssets.js";
import type { WorkflowStep } from "./Workflow.js";
import type {
	FactoryRun,
	GraphCheckpoint,
	WorkflowRuntime,
} from "./WorkflowRuntime.js";
import { cannotProve, checkinTalk } from "./web/checkin-model.js";

export type NativeViewPreset = "ask" | "approve" | "review" | "external-review";
export interface NativeViewSnapshot {
	preset: NativeViewPreset;
	/** The runtime gate, independent of any authored label/preset. */
	authority: NativeViewPreset | "read-only";
	stepKey: string;
	digest: string;
	view: ResolvedView;
	compatibility: boolean;
	guideSource?: string;
	proposalId?: string;
	proposalDigest?: string;
	context: ReturnType<typeof nativeReviewContext>;
	/** Public ordinary guide data only. No checkpoint, path reader or capability. */
	resources: Record<string, { source: string; digest: string; value: unknown }>;
}
export const NativeViewConsentSchema = z
	.object({ digest: z.string().regex(/^[a-f0-9]{64}$/) })
	.strict();

import { nativeViewPreset, sectionIds } from "./ViewPresets.js";

/** Follow the accepted lexical identity into its actual retained runtime frame. */
function viewFrame(run: FactoryRun, key: string): GraphCheckpoint | undefined {
	if (!stepForRun(run, key)) return;
	const parts = key.split("/");
	let frame = run.checkpoint;
	let prefix = "";
	for (let index = 0; frame && index < parts.length - 1; ) {
		const id = parts[index]!;
		const step = stepForRun(run, `${prefix}${id}`);
		const active = frame.current === id ? frame.active : undefined;
		if (step?.type === "workflow") {
			frame = active?.children?.[0] ?? frame.calls?.[id];
			prefix += `${id}/`;
			index++;
		} else if (step?.type === "fanout") {
			const branch = Number(parts[index + 1]);
			if (String(branch) !== parts[index + 1] || !step.groups?.[branch]) return;
			frame = (active?.children ?? frame.branches?.[id])?.[branch];
			prefix += `${id}/${branch}/`;
			index += 2;
		} else if (step?.type === "foreach") {
			const item = parts[index + 1];
			frame = active?.children?.find((child) => child.iteration?.id === item);
			prefix += `${id}/${item}/`;
			index += 2;
		} else return;
	}
	return frame;
}
function nativeKind(run: FactoryRun): NativeViewPreset | undefined {
	if (run.architectureGate) return "approve";
	if (run.reviewGate?.status === "pending")
		return run.reviewGate.mode === "external" ? "external-review" : "review";
	// Rejected/accepted reviews remain in history while a later frame can ask.
	if (run.questions.length) return "ask";
	if (run.reviewGate)
		return run.reviewGate.mode === "external" ? "external-review" : "review";
	if (run.architectureProposals?.length) return "approve";
	return undefined;
}
function owner(
	run: FactoryRun,
	kind = nativeKind(run),
	proposal?: ArchitectureProposal,
): { key: string; step: WorkflowStep } | undefined {
	const identity =
		kind === "ask"
			? run.questionBatchId
			: kind === "approve"
				? (proposal?.id ??
					run.architectureGate?.proposalId ??
					run.architectureProposals?.at(-1)?.id)
				: run.reviewGate?.id;
	let key =
		(identity && run.nativeViewOwners?.[identity]) ||
		run.architectureGate?.stepKey ||
		run.step;
	let step = stepForRun(run, key);
	if (
		kind === "approve" &&
		(proposal || !run.architectureGate) &&
		run.architectureProposals?.length &&
		(proposal || !run.questions.length)
	) {
		const selected = proposal ?? run.architectureProposals.at(-1)!;
		const receipt = [...run.history]
			.reverse()
			.find(
				(entry) =>
					(entry.output as { proposalId?: string })?.proposalId ===
						selected.id &&
					stepForRun(run, entry.step)?.tool === "architecture-decision",
			);
		if (receipt) {
			key = receipt.step;
			step = stepForRun(run, key);
		}
	}
	// Historical native review receipts identify their owning step without guessing a screen name.
	if (
		(kind === "review" || kind === "external-review") &&
		run.reviewGate &&
		(run.reviewGate.status !== "pending" || run.status !== "waiting")
	) {
		const receipt = [...run.history]
			.reverse()
			.find(
				(entry) =>
					(entry.output as { reviewId?: string })?.reviewId ===
					run.reviewGate!.id,
			);
		if (receipt) {
			key = receipt.step;
			step = stepForRun(run, key);
		}
	}
	if (!key || !step) return;
	return { key, step };
}
function publicHuman(
	run: FactoryRun,
	kind: NativeViewPreset,
	located: { key: string; step: WorkflowStep },
	selectedProposal?: ArchitectureProposal,
	readOnly = false,
) {
	const resources: NativeViewSnapshot["resources"] = {};
	if (kind === "ask")
		return {
			resources,
			value: {
				questions: {
					questions: run.questions,
					...(run.questionChoices
						? { questionChoices: run.questionChoices }
						: {}),
					...(run.questionRecommendations
						? { questionRecommendations: run.questionRecommendations }
						: {}),
				},
			},
		};
	if (kind === "approve") {
		const proposal =
			selectedProposal ??
			run.architectureProposals?.find(
				(p) => p.id === run.architectureGate?.proposalId,
			) ??
			run.architectureProposals?.at(-1);
		if (!proposal) throw new Error("Native proposal unavailable");
		const talk = checkinTalk(proposal.content, proposal.footprint);
		const texts: Record<(typeof sectionIds)[number], string> = {
			since: (proposal.content.changes ?? []).map((c) => c.text).join("\n"),
			understood: talk.understood,
			plan: [
				talk.plan,
				...talk.scenes.map(
					(scene) =>
						`${scene.title}\nBefore: ${scene.before.join(" → ")}\nAfter: ${scene.after.join(" → ")}`,
				),
			].join("\n"),
			notice: talk.notice.map((n) => `${n.who}: ${n.what}`).join("\n"),
			open: proposal.content.decisions
				.filter((d) => d.status === "open")
				.map(
					(d) =>
						`${d.question}\n${d.options.map((o) => `${o.name}: ${o.upside}; ${o.catch}`).join("\n")}`,
				)
				.join("\n"),
			"check-0": talk.checks[0]
				? `${talk.checks[0].say}\nThe other way: ${talk.checks[0].instead}`
				: "",
			"check-1": talk.checks[1]
				? `${talk.checks[1].say}\nThe other way: ${talk.checks[1].instead}`
				: "",
			"check-2": talk.checks[2]
				? `${talk.checks[2].say}\nThe other way: ${talk.checks[2].instead}`
				: "",
			size: [talk.size, talk.split ?? ""].filter(Boolean).join("\n"),
			limits: [
				...(proposal.content.nonGoals ?? []),
				...cannotProve(proposal.content).map((c) => `${c.text}: ${c.reason}`),
			].join("\n"),
			notes: `Bob’s notes: ${proposal.content.title}. ${proposal.content.summary}\n${proposal.content.criteria?.length ?? 0} ticket items; ${proposal.content.candidate.steps.length} pieces of work; ${proposal.content.evidence.length} evidence entries. Read the complete plan, decision details and evidence in the check-in reader.`,
		};
		return {
			resources,
			value: {
				sections: Object.fromEntries(
					sectionIds.map((section) => [
						section,
						{
							section,
							proposalId: proposal.id,
							digest: proposal.digest,
							text: texts[section],
						},
					]),
				),
			},
		};
	}
	const config = resolveStepConfig(located.step);
	let source = boundStepKey(
		{ run, step: located.step, stepKey: located.key },
		"guide",
	);
	if ((!source || !Object.hasOwn(run.outputs, source)) && !config.explicit)
		source =
			config.reads.guide?.from.split("/")[0] ??
			presentationOutputKeys(run).guide;
	if (!source || !Object.hasOwn(run.outputs, source))
		throw new Error("Current review guide unavailable");
	return publicGuide(run, source, readOnly);
}
function publicGuide(run: FactoryRun, source: string, readOnly = false) {
	const resources: NativeViewSnapshot["resources"] = {};
	const guide = sanitizeJsonConfiguration(run.outputs[source]);
	const hash = digest(guide);
	resources[hash] = { source, digest: hash, value: guide };
	return {
		resources,
		value: {
			guide: {
				source,
				digest: hash,
				text: `Review guide: ${String((guide as { goal?: string; summary?: string }).goal ?? (guide as { summary?: string }).summary ?? "Review the changes and evidence")}\n${readOnly ? "Saved read-only guide. This presentation grants no native approval." : "This is a text summary. Read the complete guide, code tour, tests, checks and choices in the review reader before making the native decision."}`,
			},
		},
	};
}
/** Public takeover metadata, independent of authored output names. */
export function nativeReviewContext(run: FactoryRun) {
	const source = run.takeoverSource as
		| { url?: string; headRefName?: string; isCrossRepository?: boolean }
		| undefined;
	const existingKey = configuredOutputKeys(run, {
		tool: "inspect-existing",
	})[0];
	const existing = existingKey
		? (run.outputs[existingKey] as { branch?: string })
		: undefined;
	return {
		source: source
			? {
					url: source.url,
					headRefName: source.headRefName,
					isCrossRepository: source.isCrossRepository,
				}
			: undefined,
		existingWork: existing ? { branch: existing.branch } : undefined,
	};
}
function resolveNativeDeclaration(
	run: FactoryRun,
	kind: NativeViewPreset,
	located: { key: string; step: WorkflowStep },
	proposal?: ArchitectureProposal,
	readOnly = false,
) {
	const source = located.step.view ?? nativeViewPreset(kind);
	const human = publicHuman(run, kind, located, proposal, readOnly);
	const viewReads = "components" in source ? source.reads : undefined;
	const inputs: Record<string, unknown> = {};
	for (const [name, from] of Object.entries(viewReads ?? {})) {
		if (from === "@human") inputs[name] = human.value;
		else if (from === "@callInputs" || from.startsWith("@callInputs/")) {
			const frame = viewFrame(run, located.key);
			inputs[name] =
				from === "@callInputs"
					? (frame?.callInputs ?? {})
					: foreachPointer(
							frame?.callInputs ?? {},
							from.slice("@callInputs".length),
						);
		} else {
			const [target, ...parts] = from.split("/");
			const key = producerKey(run, located.key.replace(/[^/]+$/, ""), target!);
			if (proposal?.source !== key && !Object.hasOwn(run.outputs, key))
				throw new Error(`View input ${name} is unavailable`);
			inputs[name] = parts.length
				? foreachPointer(
						proposal?.source === key ? proposal.content : run.outputs[key],
						`/${parts.join("/")}`,
					)
				: proposal?.source === key
					? proposal.content
					: run.outputs[key];
		}
	}
	// Existing v1 views may keep their public step reads instead of view-local declarations.
	if (!viewReads)
		for (const [name, binding] of Object.entries(
			resolveStepConfig(located.step).reads,
		)) {
			if (binding.from.startsWith("@") || binding.when) continue;
			const [target, ...parts] = binding.from.split("/");
			const key = producerKey(run, located.key.replace(/[^/]+$/, ""), target!);
			if (proposal?.source === key || Object.hasOwn(run.outputs, key))
				inputs[name] = parts.length
					? foreachPointer(
							proposal?.source === key ? proposal.content : run.outputs[key],
							`/${parts.join("/")}`,
						)
					: proposal?.source === key
						? proposal.content
						: run.outputs[key];
		}
	const view = resolveView(source, { inputs });
	return { source, human, inputs, view };
}

/** Read only the explicitly selected display inputs; native private sources never enter this scope. */
export function nativeViewSnapshot(
	run: FactoryRun,
): NativeViewSnapshot | undefined {
	const kind = nativeKind(run);
	if (run.viewDecision && !run.viewDecision.answer) return;
	const binding =
		run.status === "completed" &&
		!run.reviewGate &&
		!run.architectureGate &&
		!run.questions.length
			? configuredOutputBindings(run, { check: "requirement-coverage" })[0]
			: undefined;
	if (binding?.stepKey && Object.hasOwn(run.outputs, binding.key)) {
		const human = publicGuide(run, binding.key, true);
		return {
			preset: "review",
			authority: "read-only",
			stepKey: binding.stepKey,
			compatibility: true,
			guideSource: binding.key,
			resources: human.resources,
			context: nativeReviewContext(run),
			view: resolveView(nativeViewPreset("review"), {
				inputs: { human: human.value },
			}),
			digest: digest({
				protocol: "historical-review-display-v1",
				runId: run.id,
				source: binding.key,
				resources: human.resources,
			}),
		};
	}
	if (!kind) return;
	const located = owner(run, kind);
	if (!located) return;
	const { source, human, inputs, view } = resolveNativeDeclaration(
		run,
		kind,
		located,
	);
	const preset = view.preset ?? kind;
	return {
		preset,
		authority: kind,
		stepKey: located.key,
		compatibility: !located.step.view,
		view,
		resources: human.resources,
		guideSource: Object.values(human.resources)[0]?.source,
		context: nativeReviewContext(run),
		digest: digest({
			protocol: "native-human-view-v1",
			runId: run.id,
			stepKey: located.key,
			source,
			inputs,
			resources: human.resources,
			context: nativeReviewContext(run),
			configuration: located.step,
			callers: located.key
				.split("/")
				.slice(0, -1)
				.map((_, index, parts) =>
					stepForRun(run, parts.slice(0, index + 1).join("/")),
				),
			batch: run.questionBatchId,
			questions: run.questions,
			choices: run.questionChoices,
			recommendations: run.questionRecommendations,
			proposal: run.architectureProposals?.at(-1),
			gate: run.architectureGate,
			review: run.reviewGate,
			verification: run.delivery?.verification,
			captures: presentationOutputKeys(run).capture
				? run.outputs[presentationOutputKeys(run).capture!]
				: undefined,
		}),
	};
}
/** A saved reader never replaces the current question/decision or grants consent. */
export function savedReviewViewSnapshot(
	run: FactoryRun,
): NativeViewSnapshot | undefined {
	const gate = run.reviewGate;
	if (!gate || gate.status === "pending") return;
	const kind = gate.mode === "external" ? "external-review" : "review";
	const located = owner(run, kind);
	if (
		!located ||
		!(
			run.nativeViewOwners?.[gate.id] === located.key ||
			run.history.some(
				(entry) =>
					entry.step === located.key &&
					(entry.output as { reviewId?: string })?.reviewId === gate.id,
			)
		)
	)
		return;
	const { source, human, inputs, view } = resolveNativeDeclaration(
		run,
		kind,
		located,
		undefined,
		true,
	);
	return {
		preset: view.preset ?? kind,
		authority: "read-only",
		stepKey: located.key,
		compatibility: !located.step.view,
		view,
		resources: human.resources,
		guideSource: Object.values(human.resources)[0]?.source,
		context: nativeReviewContext(run),
		digest: digest({
			protocol: "saved-review-display-v1",
			runId: run.id,
			review: gate,
			stepKey: located.key,
			source,
			inputs,
			resources: human.resources,
		}),
	};
}
/** Proposal-local reader, independent of the run's current Ask/Review display. */
export function architectureViewSnapshot(
	run: FactoryRun,
	proposal: ArchitectureProposal,
): NativeViewSnapshot {
	if (run.architectureGate?.proposalId === proposal.id) {
		const current = nativeViewSnapshot(run);
		if (current?.authority === "approve")
			return {
				...current,
				proposalId: proposal.id,
				proposalDigest: proposal.digest,
			};
	}
	const located = owner(run, "approve", proposal);
	// Unshown legacy drafts have no owning human receipt. They remain stock readers.
	const selected =
		located &&
		(run.nativeViewOwners?.[proposal.id] === located.key ||
			run.history.some(
				(entry) =>
					entry.step === located.key &&
					(entry.output as { proposalId?: string })?.proposalId === proposal.id,
			))
			? located
			: {
					key: proposal.source,
					step: {
						id: proposal.source,
						name: "Saved check-in",
						type: "show",
						branches: [],
						maxVisits: 1,
					} satisfies WorkflowStep,
				};
	const { view, source, inputs } = resolveNativeDeclaration(
		run,
		"approve",
		selected,
		proposal,
	);
	return {
		preset: view.preset ?? "approve",
		authority: "read-only",
		stepKey: selected.key,
		compatibility: !selected.step.view,
		proposalId: proposal.id,
		proposalDigest: proposal.digest,
		view,
		resources: {},
		context: { source: undefined, existingWork: undefined },
		digest: digest({
			protocol: "historical-proposal-display-v1",
			runId: run.id,
			proposalId: proposal.id,
			proposalDigest: proposal.digest,
			source,
			inputs,
		}),
	};
}
export function nativeViewText(
	run: FactoryRun,
	limit = 100000,
): string | undefined {
	const snapshot = nativeViewSnapshot(run);
	if (!snapshot) return;
	const gate =
		snapshot.authority === "review" || snapshot.authority === "external-review"
			? run.reviewGate
			: undefined;
	const links = (gate?.repositories ?? []).map(
		(repository) =>
			`${viewPlainText(repository.repositoryId)}: ${viewUrlSchema.safeParse(repository.url).success ? viewPlainText(repository.url) : "Open the verified repository in Factory"} @ ${viewPlainText(repository.headSha)}`,
	);
	if (!links.length && gate?.url)
		links.push(
			`${viewUrlSchema.safeParse(gate.url).success ? viewPlainText(gate.url) : "Open the verified repository in Factory"} @ ${viewPlainText(gate.headSha)}`,
		);
	const identity =
		snapshot.authority === "ask"
			? `Question batch ${run.questionBatchId ?? ""}`
			: snapshot.authority === "approve"
				? `Proposal ${run.architectureGate?.proposalId ?? run.architectureProposals?.at(-1)?.id ?? ""}`
				: snapshot.authority === "read-only"
					? "Saved read-only guide"
					: `Review ${gate?.id ?? ""}${gate?.externalDigest ? ` · external ${gate.externalDigest}` : ""}`;
	const header = `${snapshot.preset}\n${viewPlainText(identity)}\nDisplayed digest: ${snapshot.digest}\n${links.join("\n")}\n`;
	const body = viewText(snapshot.view);
	const protocol =
		snapshot.authority === "read-only"
			? "\nThis retained presentation grants no native approval authority."
			: "\nUse the original native question/architecture/review command. This display never grants approval by itself.";
	if (header.length + body.length + protocol.length <= limit)
		return header + body + protocol;
	return (
		header +
		"[INCOMPLETE: this view exceeds the text-channel budget. Read the complete current view in Factory before answering.]" +
		protocol
	);
}
/** Optional for original clients/channels; new clients bind the complete accepted presentation too. */
export async function prepareNativeViewConsent(
	runtime: WorkflowRuntime,
	run: FactoryRun,
	value: unknown,
) {
	if (value === undefined) {
		const located = owner(run),
			kind = nativeKind(run);
		if (located?.step.view && kind && kind !== "ask")
			throw new Error(
				"Review the current display and submit its digest with the native decision.",
			);
		return () => {};
	}
	const consent = NativeViewConsentSchema.parse(value);
	const snapshot = nativeViewSnapshot(run);
	if (!snapshot || snapshot.digest !== consent.digest)
		throw new Error("Displayed content changed. Refresh and review again.");
	const captureKey = presentationOutputKeys(run).capture;
	const capture = captureKey
		? (run.outputs[captureKey] as {
				screenshots?: { imageSha256?: string; area?: string; state?: string }[];
			})
		: undefined;
	const references = (capture?.screenshots ?? []).flatMap((shot, index) =>
		shot.imageSha256
			? [
					{
						index,
						sha256: shot.imageSha256,
						alt: `${shot.area ?? "Screenshot"} ${shot.state ?? ""}`,
					},
				]
			: [],
	);
	const nativeAssets = {
		...snapshot.view,
		components: [...snapshot.view.components],
	};
	// The rich guide reuses the safe capture inventory. Hidden/reordered optional
	// sections do not remove its original asset obligations.
	for (let offset = 0; offset < references.length; offset += 12)
		nativeAssets.components.push({
			id: `native-assets-${offset}`,
			type: "screenshots",
			data: { items: references.slice(offset, offset + 12) },
		});
	const assets = await prepareViewAssetCheck(
		runtime.directory,
		run,
		nativeAssets,
	);
	return () => {
		if (!assets() || nativeViewSnapshot(run)?.digest !== consent.digest)
			throw new Error("Displayed content changed. Refresh and review again.");
	};
}
