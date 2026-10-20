import { createHash, randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import {
	type ArchitectureFootprint,
	type ArchitectureRepository,
	architectureFootprint,
} from "./ArchitectureFootprint.js";

const text = z.string().trim().min(1);
const short = (max: number) => text.max(max);
const EvidenceSchema = z
	.object({
		repository: text,
		paths: z.array(text).min(1),
		observation: short(320),
	})
	.strict();
export const PlannedFileSchema = z
	.object({
		path: short(400),
		change: z.enum(["new", "edit", "delete"]),
		/** Required when a relative path could belong to more than one repository. */
		repository: short(120).optional(),
	})
	.strict();
const TraceSchema = z.union([
	z.object({ criterion: short(60) }).strict(),
	z.object({ added: short(320) }).strict(),
]);
export const CandidatePlanSchema = z.object({
	plan: text,
	/** Legacy steps stay readable; review-v1 proposals require the richer fields. */
	steps: z
		.array(
			z.object({
				id: short(60).optional(),
				title: short(120),
				what: short(480).optional(),
				kind: z.enum(["code", "test", "docs", "config"]).optional(),
				size: z.enum(["S", "M", "L"]).optional(),
				traces: z.array(TraceSchema).min(1).max(30).optional(),
				files: z.array(z.union([short(400), PlannedFileSchema])).max(40),
			}),
		)
		.min(1)
		.max(64),
	assets: z.array(z.object({ path: text, purpose: text })),
});
const MapPartSchema = z
	.object({
		id: short(60),
		label: short(40),
		/** One short line under the label, for example "learns about Jira". */
		note: short(50),
		/** One plain sentence shown when the part is selected. */
		detail: short(240),
		file: short(200).optional(),
		area: short(60),
		status: z.enum(["new", "changed", "unchanged", "outside"]),
	})
	.strict();
const MapLinkSchema = z
	.object({ from: short(60), to: short(60), label: short(24).optional() })
	.strict();
export const ArchitectureMapSchema = z
	.object({
		areas: z
			.array(z.object({ id: short(60), name: short(40) }).strict())
			.min(1)
			.max(4),
		parts: z.array(MapPartSchema).min(1).max(16),
		links: z.array(MapLinkSchema).max(32),
	})
	.strict();
const OptionSchema = z
	.object({
		id: short(40),
		name: short(60),
		upside: short(160),
		catch: short(160),
		/** How the map would differ if this option were chosen instead. */
		preview: z
			.object({
				parts: z.array(MapPartSchema).max(4).default([]),
				links: z.array(MapLinkSchema).max(8).default([]),
				hide: z.array(short(60)).max(8).default([]),
			})
			.strict()
			.optional(),
	})
	.strict();
const DecisionSchema = z
	.object({
		id: short(40),
		question: short(120),
		why: short(240).optional(),
		status: z.enum(["decided", "open"]),
		pick: short(40).optional(),
		decidedBy: z.enum(["bob", "you"]).optional(),
		/** Check-in: the option Bob would take on an open decision; never an answer. */
		lean: short(40).optional(),
		options: z.array(OptionSchema).min(2).max(4),
	})
	.strict();
/**
 * Check-in (briefVersion=2): what Bob would say at your desk before building.
 * Bob restates the goal, sketches what people will experience, flags who notices
 * and asks you to check the calls that need human judgment. Everything the
 * automated reviewer verifies (files, traces, coverage) stays in Bob's notes.
 */
const SceneSchema = z
	.object({
		/** Whose experience this is, e.g. "A new reader joining". */
		title: short(60),
		before: z.array(short(90)).min(1).max(5),
		after: z.array(short(90)).min(1).max(6),
	})
	.strict();
const CheckSchema = z
	.object({
		/** The decision this call settles, when it is one. */
		decision: short(40).optional(),
		/** First person: what Bob did and why. */
		say: short(260),
		/** The other way, and what it would mean for people. */
		instead: short(220),
	})
	.strict();
const TalkSchema = z
	.object({
		/** "You want ... so that ...": the goal in the human's terms. */
		understood: short(360),
		/** "I'd ...": the approach in two to four spoken sentences. */
		plan: short(480),
		scenes: z.array(SceneSchema).min(1).max(3),
		notice: z
			.array(z.object({ who: short(40), what: short(200) }).strict())
			.max(5),
		/** Calls that need human judgment, the least certain first. */
		checks: z.array(CheckSchema).max(3),
		/** How big this is, in human terms. */
		size: short(240),
		/** A sensible way to split the work, when there is one. */
		split: short(240).optional(),
	})
	.strict();
export const CHECKIN_VERSION = 2;
export const ArchitectureSchema = z
	.object({
		architectureContract: z.literal("architecture-v1"),
		classification: z.enum(["meaningful", "routine"]),
		rationale: text,
		title: short(80),
		summary: short(320),
		/** Absent on saved proposals generated before the review brief; 2 adds the check-in. */
		briefVersion: z.union([z.literal(1), z.literal(2)]).optional(),
		problem: z.array(EvidenceSchema).min(1).max(3).optional(),
		criteria: z
			.array(
				z
					.object({
						id: short(60),
						text: short(1200),
						source: short(240),
						url: z
							.string()
							.url()
							.regex(/^https?:\/\//)
							.optional(),
						status: z.enum(["covered", "partial", "deferred"]),
						reason: short(480),
					})
					.strict(),
			)
			.min(1)
			.max(40)
			.optional(),
		nonGoals: z.array(short(320)).max(12).optional(),
		acceptance: z.array(short(480)).min(1).max(12).optional(),
		/** What changed since the previous version and who asked for it. */
		changes: z
			.array(
				z.object({ text: short(200), from: z.enum(["you", "bob"]) }).strict(),
			)
			.max(8)
			.default([]),
		decisions: z.array(DecisionSchema).max(6),
		talk: TalkSchema.optional(),
		map: ArchitectureMapSchema.optional(),
		evidence: z.array(EvidenceSchema).min(1).max(6),
		risks: z.array(short(240)).max(6),
		candidate: CandidatePlanSchema,
	})
	.strict()
	.superRefine((proposal, ctx) => {
		const issue = (path: (string | number)[], message: string) =>
			ctx.addIssue({ code: "custom", path, message });
		if (proposal.briefVersion) {
			for (const key of [
				"problem",
				"criteria",
				"nonGoals",
				"acceptance",
			] as const)
				if (!proposal[key]) issue([key], `The review brief requires ${key}`);
			const criteria = proposal.criteria ?? [];
			const ids = new Set(criteria.map((c) => c.id));
			if (ids.size !== criteria.length)
				issue(["criteria"], "Criterion IDs must be unique");
			const stepIds = new Set<string>();
			for (const [i, step] of proposal.candidate.steps.entries()) {
				for (const key of ["id", "what", "kind", "size", "traces"] as const)
					if (!step[key])
						issue(
							["candidate", "steps", i, key],
							`A deliverable requires ${key}`,
						);
				if (step.id && stepIds.has(step.id))
					issue(
						["candidate", "steps", i, "id"],
						"Deliverable IDs must be unique",
					);
				if (step.id) stepIds.add(step.id);
				for (const [j, file] of step.files.entries())
					if (typeof file === "string")
						issue(
							["candidate", "steps", i, "files", j],
							"Declare the path and new, edit or delete operation",
						);
				for (const [j, trace] of (step.traces ?? []).entries())
					if ("criterion" in trace && !ids.has(trace.criterion))
						issue(
							["candidate", "steps", i, "traces", j],
							"Trace must reference a listed criterion",
						);
			}
			for (const [i, criterion] of criteria.entries()) {
				const linked = proposal.candidate.steps.some((s) =>
					s.traces?.some(
						(t) => "criterion" in t && t.criterion === criterion.id,
					),
				);
				if (criterion.status !== "deferred" && !linked)
					issue(
						["criteria", i],
						"Covered or partial criteria require a linked deliverable",
					);
				if (criterion.status === "deferred" && linked)
					issue(
						["criteria", i],
						"Deferred criteria cannot claim implementation deliverables; use partial for preparation work",
					);
			}
		}
		if (proposal.briefVersion === CHECKIN_VERSION) {
			if (!proposal.talk)
				issue(["talk"], "The check-in needs what Bob would say to the human");
			const decisions = new Map(proposal.decisions.map((d) => [d.id, d]));
			for (const [i, check] of (proposal.talk?.checks ?? []).entries()) {
				const decision = check.decision && decisions.get(check.decision);
				if (check.decision && !decision)
					issue(
						["talk", "checks", i, "decision"],
						"Check names an unknown decision",
					);
				if (decision && decision.status === "open")
					issue(
						["talk", "checks", i, "decision"],
						"Open decisions are questions for the human, not calls to check",
					);
			}
			if ((proposal.map?.parts.length ?? 0) > 12)
				issue(["map", "parts"], "Keep the check-in map to 12 parts");
		} else if (proposal.talk)
			issue(["talk"], "The check-in belongs to briefVersion=2");
		if (proposal.classification === "meaningful") {
			if (!proposal.map)
				issue(["map"], "Meaningful choices require a map of what changes");
			if (!proposal.decisions.length)
				issue(
					["decisions"],
					"Meaningful choices require at least one decision with options",
				);
		}
		const decisionIds = new Set<string>();
		for (const [i, decision] of proposal.decisions.entries()) {
			if (decisionIds.has(decision.id))
				issue(["decisions", i, "id"], "Decision IDs must be unique");
			decisionIds.add(decision.id);
			const optionIds = new Set(decision.options.map((o) => o.id));
			if (optionIds.size !== decision.options.length)
				issue(["decisions", i, "options"], "Option IDs must be unique");
			if (decision.status === "decided") {
				if (!decision.pick || !optionIds.has(decision.pick))
					issue(
						["decisions", i, "pick"],
						"A decided choice must pick one of its options",
					);
				if (!decision.decidedBy)
					issue(["decisions", i, "decidedBy"], "Say who made this choice");
				if (decision.lean)
					issue(
						["decisions", i, "lean"],
						"Only open decisions carry Bob's lean",
					);
			} else {
				if (decision.lean && !optionIds.has(decision.lean))
					issue(["decisions", i, "lean"], "Lean must name one of the options");
				if (decision.pick || decision.decidedBy)
					issue(
						["decisions", i, "pick"],
						"An open decision cannot have a pick; the human answers it",
					);
				if (!decision.why)
					issue(
						["decisions", i, "why"],
						"Explain why the human needs to answer this decision",
					);
			}
		}
		const map = proposal.map;
		if (!map) {
			if (proposal.decisions.some((d) => d.options.some((o) => o.preview)))
				issue(["map"], "Option previews require a map");
			return;
		}
		const areas = new Set(map.areas.map((a) => a.id));
		const parts = new Set(map.parts.map((p) => p.id));
		if (
			areas.size !== map.areas.length ||
			parts.size !== map.parts.length ||
			map.parts.some((p) => !areas.has(p.area)) ||
			map.links.some((l) => !parts.has(l.from) || !parts.has(l.to))
		)
			issue(
				["map"],
				"Map IDs must be unique and every area and link must exist",
			);
		for (const [i, decision] of proposal.decisions.entries())
			for (const [j, option] of decision.options.entries()) {
				const preview = option.preview;
				if (!preview) continue;
				const added = new Set(preview.parts.map((p) => p.id));
				const all = new Set([...parts, ...added]);
				if (
					added.size !== preview.parts.length ||
					preview.parts.some((p) => parts.has(p.id) || !areas.has(p.area)) ||
					preview.hide.some((id) => !parts.has(id)) ||
					preview.links.some((l) => !all.has(l.from) || !all.has(l.to))
				)
					issue(
						["decisions", i, "options", j, "preview"],
						"Previews add new part IDs, hide existing parts and link known parts",
					);
			}
	});
/** Only newly opted-in steps require the richer brief; check-in steps require briefVersion=2. */
export function assertReviewBrief(
	content: Architecture,
	brief: "review-v1" | "checkin-v1" = "review-v1",
): void {
	if (brief === "checkin-v1" && content.briefVersion !== CHECKIN_VERSION)
		throw new Error(
			"This architecture step requires briefVersion=2 and a complete check-in",
		);
	if (!content.briefVersion)
		throw new Error(
			"This architecture step requires briefVersion=1 and a complete review brief",
		);
}
/** A new version must tell the human what changed since the previous one. */
export function assertRevisionChanges(
	content: Architecture,
	previousVersions: number,
): void {
	if (previousVersions > 0 && !content.changes.length)
		throw new Error(
			`List what changed since version ${previousVersions} in "changes"`,
		);
}
export function openDecisions(content: Architecture): number {
	return content.decisions.filter((d) => d.status === "open").length;
}
const ArchitectureContinuationSchema = z
	.object({
		proposalId: text,
		version: z.number().int().positive(),
		digest: text,
		reason: short(1200),
	})
	.strict();
export type ArchitectureContinuation = z.infer<
	typeof ArchitectureContinuationSchema
>;
export const ArchitectureReviewSchema = z
	.object({
		approved: z.boolean(),
		feedback: z.array(text),
		questions: z.array(text).optional(),
		continuation: ArchitectureContinuationSchema.optional(),
	})
	.strict()
	.refine(
		(r) => r.approved || r.feedback.length > 0 || !!r.questions?.length,
		"Rejected candidate review requires feedback",
	)
	.refine(
		(r) => !r.approved || !r.questions?.length,
		"A candidate with unanswered questions cannot be approved",
	)
	.refine(
		(r) => !r.continuation || r.approved,
		"Rejected reviews cannot continue approval",
	);
export const architectureQuestionInstructions = `When a genuine product, privacy or architecture choice requires human input that the accepted answers and repository do not settle, return approved:false and questions:["the concrete unresolved choice and its consequences"], with feedback describing any candidate changes needed. The runtime asks these questions before another drafting pass, then follows the accepted rejection route to revise and independently review the candidate using the saved answer. Do not repeat unchanged drafting to obtain an answer or invent a policy. Questions and answers never accept an architecture proposal; exact-candidate review and any required human architecture acceptance still follow.`;
export type Architecture = z.infer<typeof ArchitectureSchema>;
export interface ArchitectureProposal {
	id: string;
	version: number;
	digest: string;
	source: string;
	bypassReason?: string;
	/** Independent review links this revision to an actual human decision; it is not a new acceptance. */
	continuation?: ArchitectureContinuation;
	status:
		| "proposed"
		| "pending"
		| "accepted"
		| "rejected"
		| "superseded"
		| "routine";
	content: Architecture;
	/** When the human was first asked to decide; absent for Bob's internal drafts and older runs. */
	shownAt?: string;
	/** Runtime-derived review evidence; absent on historical proposals. */
	footprint?: ArchitectureFootprint;
	assetDigests: { path: string; digest: string }[];
	feedback: {
		kind: "revise" | "discuss" | "explain" | "explanation";
		text: string;
		at: string;
	}[];
	at: string;
}
export const ArchitectureDecisionSchema = z
	.object({
		proposalId: text,
		version: z.number().int().positive(),
		digest: text,
		decision: z.enum(["accept", "revise", "discuss", "explain"]),
		feedback: z.string().trim().max(100000).optional(),
	})
	.strict()
	.refine(
		(d) => d.decision === "accept" || !!d.feedback,
		"Enter feedback or an explanation request",
	);
export type ArchitectureDecision = z.infer<
	typeof ArchitectureDecisionSchema
> & { at: string };
export function architectureDigest(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function proposalDigest(proposal: ArchitectureProposal): string {
	return architectureDigest({
		content: proposal.content,
		assets: proposal.assetDigests,
		...(proposal.footprint ? { footprint: proposal.footprint } : {}),
	});
}
export function verifyProposal(proposal: ArchitectureProposal): void {
	if (proposalDigest(proposal) !== proposal.digest)
		throw new Error("Architecture content changed; regenerate the proposal");
	for (const asset of proposal.assetDigests)
		if (
			createHash("sha256").update(readFileSync(asset.path)).digest("hex") !==
			asset.digest
		)
			throw new Error("Architecture asset changed; regenerate the proposal");
}
/** Continuation is cumulative from the latest human decision in this proposal route. */
export function reviewedArchitectureContinuation(
	value: unknown,
	current: ArchitectureProposal,
	proposals: readonly ArchitectureProposal[],
	decisions: readonly ArchitectureDecision[],
): ArchitectureContinuation | undefined {
	const parsed = ArchitectureContinuationSchema.safeParse(value);
	if (!parsed.success || openDecisions(current.content)) return;
	const reference = parsed.data;
	const sameSource = new Map(
		proposals.filter((p) => p.source === current.source).map((p) => [p.id, p]),
	);
	const latest = [...decisions]
		.reverse()
		.find((d) => sameSource.has(d.proposalId));
	const accepted = latest && sameSource.get(latest.proposalId);
	if (
		!latest ||
		latest.decision !== "accept" ||
		!accepted ||
		accepted.version >= current.version ||
		openDecisions(accepted.content) ||
		latest.proposalId !== reference.proposalId ||
		latest.version !== reference.version ||
		latest.digest !== reference.digest ||
		accepted.version !== reference.version ||
		accepted.digest !== reference.digest
	)
		return;
	verifyProposal(accepted);
	return reference;
}
export async function snapshotProposal(
	value: unknown,
	source: string,
	version: number,
	directory: string,
	signal: AbortSignal,
	allowedDirectories: readonly string[] = [directory],
	repositories: readonly ArchitectureRepository[] = [],
): Promise<ArchitectureProposal> {
	const content = ArchitectureSchema.parse(value);
	const footprint = architectureFootprint(content, repositories);
	const id = randomUUID();
	const assetDigests: ArchitectureProposal["assetDigests"] = [];
	const snapshots = new Map<string, string>();
	const contains = (root: string, path: string) => {
		const child = relative(root, path);
		return (
			child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child)
		);
	};
	for (const [index, asset] of content.candidate.assets.entries()) {
		const original = asset.path;
		let bytes: Buffer;
		if (/^https?:\/\//.test(asset.path)) {
			const response = await fetch(asset.path, { signal });
			if (!response.ok)
				throw new Error(
					`Cannot snapshot architecture asset: HTTP ${response.status}`,
				);
			const chunks: Uint8Array[] = [];
			let size = 0;
			if (!response.body) throw new Error("Architecture asset has no body");
			for await (const chunk of response.body) {
				size += chunk.length;
				if (size > 25 * 1024 * 1024)
					throw new Error("Architecture asset exceeds 25 MiB");
				chunks.push(chunk);
			}
			if (size === 0) throw new Error("Architecture asset has no body");
			bytes = Buffer.concat(chunks);
		} else {
			if (!isAbsolute(asset.path))
				throw new Error(
					"Architecture asset paths must be absolute or HTTP URLs",
				);
			const resolved = realpathSync(asset.path);
			if (
				!allowedDirectories.some(
					(root) =>
						existsSync(root) &&
						contains(resolve(root), resolve(asset.path)) &&
						contains(realpathSync(root), resolved),
				)
			)
				throw new Error("Architecture asset is outside authorized directories");
			bytes = readFileSync(resolved);
		}
		const folder = join(directory, "architecture", id);
		mkdirSync(folder, { recursive: true });
		const path = join(
			folder,
			`${index}-${basename(asset.path.split("?")[0]!) || "asset"}`,
		);
		writeFileSync(path, bytes, { flag: "wx" });
		asset.path = path;
		snapshots.set(original, path);
		assetDigests.push({
			path,
			digest: createHash("sha256").update(bytes).digest("hex"),
		});
	}
	const choice = (d: Architecture["decisions"][number]) => {
		const picked = d.options.find((o) => o.id === d.pick);
		const others = d.options
			.filter((o) => o !== picked)
			.map((o) => `${o.name} (${o.upside}; but ${o.catch})`)
			.join("; ");
		return `- ${d.question} ${picked ? `Chosen by ${d.decidedBy === "you" ? "the human" : "Bob"}: ${picked.name}. ${picked.upside} Trade-off: ${picked.catch}` : "OPEN"}${others ? ` Not chosen: ${others}.` : ""}`;
	};
	content.candidate.plan += `\n\n## Architecture proposal ${id} (version ${version})\n\n${content.title}\n\n${content.summary}\n\nClassification: ${content.classification}\n\nRationale: ${content.rationale}\n\nDecisions:\n${content.decisions.map(choice).join("\n") || "None"}\n\nRepository evidence:\n${content.evidence.map((x) => `- ${x.repository}: ${x.paths.join(", ")}. ${x.observation}`).join("\n")}\n\nRisks:\n${content.risks.map((x) => `- ${x}`).join("\n") || "None"}\n\n${content.map ? `What changes:\n${content.map.parts.map((x) => `- ${x.label} (${x.status}${x.file ? `, ${x.file}` : ""}): ${x.detail}`).join("\n")}\n\nConnections: ${content.map.links.map((x) => `${x.from} -> ${x.to}${x.label ? ` (${x.label})` : ""}`).join("; ")}` : ""}`;
	if (content.talk)
		content.candidate.plan += `\n\n## What the human was told\n${content.talk.understood}\n\n${content.talk.plan}\n\n${content.talk.scenes.map((x) => `${x.title}\n- Before: ${x.before.join(" -> ")}\n- After: ${x.after.join(" -> ")}`).join("\n\n")}\n\nWho will notice:\n${content.talk.notice.map((n) => `- ${n.who}: ${n.what}`).join("\n") || "Nobody outside the code"}\n\nCalls the human checked:\n${content.talk.checks.map((c) => `- ${c.say} Instead: ${c.instead}`).join("\n") || "None"}`;
	if (content.briefVersion)
		content.candidate.plan += `\n\n## Accepted review brief\n${JSON.stringify({ problem: content.problem, criteria: content.criteria, deliverables: content.candidate.steps, nonGoals: content.nonGoals, acceptance: content.acceptance })}\n\nPlanned footprint (declared paths, not an implemented diff):\n${JSON.stringify(footprint)}`;
	if (snapshots.size) {
		const references = [...snapshots.keys()].sort(
			(a, b) => b.length - a.length,
		);
		const pattern = new RegExp(
			references
				.map((path) => path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
				.join("|"),
			"g",
		);
		content.candidate.plan = content.candidate.plan.replace(
			pattern,
			(path) => snapshots.get(path)!,
		);
		content.candidate.plan += `\n\n## Accepted asset snapshots\nUse only the frozen snapshot paths in candidate.assets for implementation. Original paths and URLs below identify sources; do not read or fetch them, including references expressed in another form.\n${JSON.stringify([...snapshots].map(([original, snapshot]) => ({ original, snapshot })))}`;
	}
	const proposal: ArchitectureProposal = {
		id,
		version,
		digest: "",
		source,
		status: "proposed",
		content,
		footprint,
		assetDigests,
		feedback: [],
		at: new Date().toISOString(),
	};
	proposal.digest = proposalDigest(proposal);
	return proposal;
}
export const implementationScopeInstructions = `Treat planned file paths as an estimate of implementation work. During implementation, completing the accepted requirements with the accepted architecture includes necessary edits to newly discovered callers, imports, fixtures, tests, configuration and documentation. The implementer inspects those dependencies, makes the required edits and records added paths with their concrete purpose in implementation checks. Do not request permission solely because a necessary path was omitted, and do not add file-by-file approval requirements to the plan. Preserve explicit user/repository restrictions and accepted non-goals. New requirements, materially changed architecture, additional repository or external delivery targets, and unresolved human-dependent decisions still require their applicable authorization or revision route. Self-contained plans must include this implementation policy.`;

export const architectureContinuationInstructions = `For a follow-up proposal, compare the COMPLETE current candidate cumulatively with the latest explicitly human-accepted architecture in architectureProposals and architectureDecisions, not just the preceding generated version. Retain settled decisions and exclusions. The original design's complexity does not itself require another approval. Necessary caller/test wiring, file discoveries and implementation details within the accepted requirements and boundaries do not create a new human decision. Do not turn Bob-authored file manifests into user restrictions. Material changes to requirements, responsibilities, interfaces, security/operating limits, delivery targets, explicit human/repository restrictions or non-goals, and unresolved human-dependent choices still need their applicable authorization. Explain the actual change and its evidence; uncertainty must remain visible.`;

/** The review-v1 proposer prompt. Frozen runs keep it until a human asks for a new version. */
export const architectureInstructions = `Inspect the selected repositories, actual module boundaries and conventions, all requirements, comments, answers and decisions, the draft plan and prior candidate-review feedback. Preserve Takeover's completed work, PR URL and branch. Propose the smallest adequate design; do not implement or invent human acceptance. Routine unsplit changes using established patterns may bypass architecture approval with a concrete rationale; meaningful responsibilities, boundaries, interfaces or trade-offs require human acceptance.

${implementationScopeInstructions}

${architectureContinuationInstructions}

The human must understand the problem, each concrete change, its scope and coverage without opening code or the folded full plan. Write short sentences in everyday words. Keep paths in file/path/paths/files fields. Use concrete quantities, limits and observable behavior where they matter; do not replace substance with benefit statements. The summary states the current gap, the proposed change and its scope boundary. Risks are product/technical consequences; ticket synchronization and workflow status belong to run status, not risks. Character limits: findings and nonGoals 320 each; criterion text 1200; criterion reason, deliverable what and acceptance check 480 each; added-work reason 320; version-change text 200; deliverable title and decision question 120; IDs and option name 60; option upside/catch 160; decision why, map detail and risks 240; map label 40 and note 50; file paths 400. Put further detail in the full plan while keeping every substantive deliverable visible in the brief.

Return ONLY architecture-v1 with briefVersion=1:
{"architectureContract":"architecture-v1","briefVersion":1,"classification":"meaningful or routine","rationale":"concrete classification reason","title":"plain title, max 80 chars","summary":"Current gap. This adds specific behavior within a clear scope (max 320 chars).","problem":[{"repository":"selected repo","paths":["inspected existing file"],"observation":"concrete current behavior or missing capability; 1-3 findings, no invented defects"}],"criteria":[{"id":"AC1","text":"complete original criterion text","source":"ticket identifier and criterion number, or user requirement","url":"optional actual source HTTP URL","status":"covered or partial or deferred","reason":"which work addresses it, or precisely what remains and why"}],"nonGoals":["specific excluded work or explicit follow-up boundary"],"acceptance":["observable check, conditions and passing result"],"changes":[{"text":"what changed since the previous version","from":"you if requested by human, bob if added"}],"decisions":[{"id":"storage","question":"plain question","why":"required when open: why the human must answer","status":"decided or open","pick":"option id, only when decided","decidedBy":"bob, or you when the human chose it","options":[{"id":"a","name":"concrete option","upside":"specific behavior and quantities where relevant","catch":"concrete cost or limitation","preview":{"parts":[map parts this option adds],"links":[links],"hide":["map part ids this option removes"]}}]}],"map":{"areas":[{"id":"area","name":"Area name"}],"parts":[{"id":"part","label":"short name","note":"few words","detail":"plain sentence about what it does","file":"optional repo-relative path","area":"area","status":"new or changed or unchanged or outside"}],"links":[{"from":"part","to":"part","label":"optional 1-2 words"}]},"evidence":[{"repository":"selected repo","paths":["actual inspected path"],"observation":"why this design fits the existing architecture"}],"risks":["one concrete product/technical consequence each"],"candidate":{"plan":"COMPLETE self-contained implementation plan incorporating every accepted requirement/decision, repository/base/delivery targets, inherited Takeover PR/work and validation expectations","steps":[{"id":"D1","title":"concrete deliverable","what":"what gets built and observable before/after behavior; include substantive test duration, identities, failure cases or document deliverables","kind":"code or test or docs or config","size":"S or M or L, a relative estimate","traces":[{"criterion":"AC1"}],"files":[{"path":"complete repo-relative file path","change":"new or edit or delete","repository":"selected repo id; required for grouped repositories"}]}],"assets":[{"path":"absolute path or HTTP URL","purpose":"..."}]}}.

List EVERY original acceptance criterion, including independent/external/hardware checks that this PR cannot complete; preserve its meaning and source. If no explicit criteria exist, derive clearly sourced requirements from the request. Coverage describes what this plan will deliver, not completed test evidence. Partial means useful preparation with an explicitly remaining part; deferred has no implementation deliverable. Link covered/partial criteria through step.traces. Every step needs a trace: use {"criterion":"AC1"} for requested work or {"added":"concrete necessity and why this was not explicitly requested"} for Bob-added work. Never hide extras behind unrelated criteria. List all currently anticipated file changes (including tests, docs, configuration and cross-plugin work), using exact paths and operations rather than representative files or directories. Declare known conditional edits and their triggers. Inspect likely callers and test wiring before estimating the footprint. Reuse a file across steps when necessary. Do not invent files or add UI/screenshots for a backend-only task without an explicit reason. State the number and subject of runbooks or documents, not just 'update docs'. For limits chosen through measurement, show the selection rule and known starting constraints in the brief; do not leave them only in the full plan or invent measured values. Include 3-6 meaningful acceptance checks where appropriate, with measurable passing outcomes; never claim future physical tests or independent review have passed. Keep exclusions in nonGoals. Do not defer mandatory baseline security if the request makes it a prerequisite.

Meaningful proposals need a map and at least one decision. Show every real choice with 2-4 concrete options; decide it yourself when repository evidence or requirements settle it, and mark it open only for human-dependent habits, scope or cost. Open decisions block approval. Keep the map to relevant parts (up to 4 areas); unchanged parts cannot also be listed for file changes. Add an option preview when it changes the map. On a new version, list every change and set decidedBy=you for human-settled decisions. Routine outputs may omit map and decisions but still require the review brief. Never return footprint/counts or approval fields; the runtime computes footprint from listed files and actual repository boundaries. Include all implementation details in candidate; the implementer receives only the accepted plan/assets. Read architectureProposals and architectureDecisions for feedback; explanation requests are not authorization. Independent child delivery is separate future work, not executable scheduling here.`;

/**
 * Check-in (briefVersion=2): before building, Bob walks over to the human's desk.
 * The human approves the understanding, the approach, the consequences for
 * people and the calls that need judgment; the reviewer checks everything else.
 */
export const checkinInstructions = `Before Bob builds anything, he checks his plan with the human, the way a good colleague walks over and says "got two minutes before I start?". Your output is that check-in, plus the complete plan and evidence the automated reviewer verifies.

Inspect the selected repositories, actual module boundaries and conventions, all requirements, comments, answers and decisions, the draft plan and prior candidate-review feedback. Preserve Takeover's completed work, PR URL and branch. Propose the smallest adequate design; do not implement or invent human acceptance. Routine unsplit changes using established patterns may bypass approval with a concrete rationale; meaningful responsibilities, boundaries, interfaces or trade-offs require human acceptance.

${implementationScopeInstructions}

${architectureContinuationInstructions}

WHY THE HUMAN IS ASKED
An independent reviewer already checks that every requirement is traced, files are real and the plan is consistent. The human is asked only for what a human can catch while it is still cheap to change course: you misunderstood what they want; a call you made does not fit their product, customers or team; the consequences for people are unacceptable; or the work is the wrong size. Write the check-in for exactly that.

THE CHECK-IN (talk) - spoken, first person, everyday words, about two minutes to read in total (at most 350 words across all talk fields). No file paths, class names, endpoints or jargon a product owner would not use; say what people experience. Concrete numbers where they matter ("every 30 seconds", "up to 128 waiting devices").
- understood (max 360): "You want ... so that ...", then what done looks like to them. This is the first thing the human confirms, so restate their goal in their terms, not your solution.
- plan (max 480): "I'd ..." in two to four sentences: the approach, not the task list.
- scenes: 1-3 whiteboard sketches of what a person or device experiences, before and after, as short steps (max 90 characters each; before 1-5 steps, after 1-6). Pick the moments the change is really about, e.g. title "A new reader joins": before ["Reader connects", "It is registered automatically"], after ["Reader shows a code that changes every 30 seconds", "An administrator types or scans the code", "Only then is the reader registered"].
- notice: up to 5 groups of people, devices, integrations or operators that will notice once this ships, and how (who max 40, what max 200). Include upgrades, configuration they must set and anything that stops working. [] only when nobody outside the code notices.
- checks: up to 3 calls you made that need human judgment (product, customers, cost, habits), the least certain first. say (max 260): "I went with ... because ..."; instead (max 220): the other way and what it would mean for people. Link decision when the call is one of decisions. Do not list calls the repository or the human's answers already settle; those stay in decisions. Open decisions are questions, never checks.
- size (max 240): how big this is in human terms: how many separate things change, which parts of the product, rough effort. split (max 240, optional): a sensible way to split it into smaller deliveries if one exists, and what each would deliver first.

WHAT THE REVIEWER CHECKS (Bob's notes; the human opens these only to dig)
- title (max 80): what will be true afterwards. summary (max 320): current gap, proposed change, scope boundary.
- problem: 1-3 findings about how things behave today, tied to inspected files. No invented defects.
- decisions: every real choice with 2-4 concrete options. Decide it yourself (decidedBy=bob) when repository evidence or requirements settle it; mark it open only for human-dependent habits, scope or cost, give why, and set lean to the option you would take. Open decisions block approval; never hide a real choice or leave open one the repository settles.
- criteria: EVERY original acceptance criterion, including independent/external/hardware checks this PR cannot complete; preserve meaning and source. Without explicit criteria, derive clearly sourced requirements. Coverage is what this plan will deliver, not completed evidence; partial means useful preparation with an explicit remaining part; deferred has no deliverable. The human sees partial and deferred items as "what this will not fully prove", so make their reason plain.
- nonGoals: specific exclusions. acceptance: 3-6 measurable checks; never claim future physical tests or independent review have passed. risks: up to 6 concrete product/technical consequences with what limits each; workflow or ticket status is not a risk. Do not defer mandatory baseline security if the request makes it a prerequisite.
- map: the system view for engineers: 1-4 areas, at most 10 parts (label max 24, note max 32), links with 1-2 word labels. unchanged parts give context only and cannot also be listed for file changes. Add option previews when an alternative changes the map.
- evidence: why this design fits the existing architecture, tied to inspected paths.
- candidate: the COMPLETE self-contained implementation plan; the implementer receives only the accepted plan and assets. Each step: what gets built and observable behavior, kind, relative size, traces ({"criterion":"AC1"} for requested work or {"added":"concrete necessity and why it was not requested"} for Bob-added work; never hide extras behind unrelated criteria) and every anticipated file change with exact repo-relative path and new/edit/delete, including tests, docs, configuration and known conditional edits with their triggers. Inspect callers and test wiring before estimating. Do not invent files or add UI/screenshots for a backend-only task without an explicit reason. Name the number and subject of documents. For limits chosen through measurement, state the selection rule and starting constraints; never invent measured values.

NEW VERSIONS
List every change to the plan since the previous version in changes (max 200 each; from=you when the human asked for it, bob when you added it) and set decidedBy=you for human-settled decisions. The human reads changes first on a new version, so say plainly what you did with each of their notes. Describe what changed in the plan, never approval or authorization status, reviewer process or what was not changed; the runtime tracks those. Read architectureProposals and architectureDecisions for feedback; explanation requests are not authorization.

LIMITS
problem observations and nonGoals 320; criterion text 1200; criterion reason, deliverable what and acceptance checks 480; added-work reason 320; deliverable title and decision question 120; IDs and option name 60; option upside/catch 160; decision why, map detail and risks 240; evidence at most 6.

Return ONLY architecture-v1 with briefVersion=2:
{"architectureContract":"architecture-v1","briefVersion":2,"classification":"meaningful or routine","rationale":"concrete classification reason","title":"...","summary":"...","talk":{"understood":"You want ...","plan":"I'd ...","scenes":[{"title":"...","before":["..."],"after":["..."]}],"notice":[{"who":"...","what":"..."}],"checks":[{"decision":"optional decision id","say":"I went with ...","instead":"..."}],"size":"...","split":"optional"},"problem":[{"repository":"selected repo","paths":["inspected existing file"],"observation":"..."}],"decisions":[{"id":"storage","question":"plain question","why":"required when open","status":"decided or open","pick":"option id, only when decided","decidedBy":"bob or you, only when decided","lean":"option id, only when open","options":[{"id":"a","name":"concrete option","upside":"...","catch":"...","preview":{"parts":[],"links":[],"hide":[]}}]}],"criteria":[{"id":"AC1","text":"complete original criterion text","source":"ticket identifier and criterion number, or user requirement","url":"optional actual source HTTP URL","status":"covered or partial or deferred","reason":"..."}],"nonGoals":["..."],"acceptance":["..."],"changes":[{"text":"...","from":"you or bob"}],"risks":["..."],"map":{"areas":[{"id":"area","name":"Area name"}],"parts":[{"id":"part","label":"...","note":"...","detail":"plain sentence","file":"optional repo-relative path","area":"area","status":"new or changed or unchanged or outside"}],"links":[{"from":"part","to":"part","label":"optional"}]},"evidence":[{"repository":"selected repo","paths":["actual inspected path"],"observation":"..."}],"candidate":{"plan":"COMPLETE self-contained implementation plan incorporating every accepted requirement/decision, repository/base/delivery targets, inherited Takeover PR/work and validation expectations","steps":[{"id":"D1","title":"...","what":"...","kind":"code or test or docs or config","size":"S or M or L","traces":[{"criterion":"AC1"}],"files":[{"path":"complete repo-relative file path","change":"new or edit or delete","repository":"selected repo id; required for grouped repositories"}]}],"assets":[{"path":"absolute path or HTTP URL","purpose":"..."}]}}

Meaningful proposals need a map and at least one decision. Routine outputs may omit map and decisions but still need the check-in and scope fields. Never return footprint/counts or approval fields; the runtime computes footprint from listed files and actual repository boundaries. Independent child delivery is separate future work, not executable scheduling here.`;
