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

const text = z.string().trim().min(1);
const short = (max: number) => text.max(max);
export const CandidatePlanSchema = z.object({
	plan: text,
	/** Short, plain step titles shown to the human; the full plan stays in `plan`. */
	steps: z
		.array(
			z.object({
				title: short(120),
				files: z.array(short(200)).max(8),
			}),
		)
		.min(1)
		.max(15),
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
		options: z.array(OptionSchema).min(2).max(4),
	})
	.strict();
export const ArchitectureSchema = z
	.object({
		architectureContract: z.literal("architecture-v1"),
		classification: z.enum(["meaningful", "routine"]),
		rationale: text,
		title: short(80),
		summary: short(320),
		/** What changed since the previous version and who asked for it. */
		changes: z
			.array(
				z.object({ text: short(200), from: z.enum(["you", "bob"]) }).strict(),
			)
			.max(8)
			.default([]),
		decisions: z.array(DecisionSchema).max(6),
		map: ArchitectureMapSchema.optional(),
		evidence: z
			.array(
				z
					.object({
						repository: text,
						paths: z.array(text).min(1),
						observation: short(240),
					})
					.strict(),
			)
			.min(1)
			.max(6),
		risks: z.array(short(240)).max(6),
		candidate: CandidatePlanSchema,
	})
	.strict()
	.superRefine((proposal, ctx) => {
		const issue = (path: (string | number)[], message: string) =>
			ctx.addIssue({ code: "custom", path, message });
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
			} else {
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
export const ArchitectureReviewSchema = z
	.object({ approved: z.boolean(), feedback: z.array(text) })
	.strict()
	.refine(
		(r) => r.approved || r.feedback.length > 0,
		"Rejected candidate review requires feedback",
	);
export type Architecture = z.infer<typeof ArchitectureSchema>;
export interface ArchitectureProposal {
	id: string;
	version: number;
	digest: string;
	source: string;
	bypassReason?: string;
	status:
		| "proposed"
		| "pending"
		| "accepted"
		| "rejected"
		| "superseded"
		| "routine";
	content: Architecture;
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
export async function snapshotProposal(
	value: unknown,
	source: string,
	version: number,
	directory: string,
	signal: AbortSignal,
	allowedDirectories: readonly string[] = [directory],
): Promise<ArchitectureProposal> {
	const content = ArchitectureSchema.parse(value);
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
		assetDigests,
		feedback: [],
		at: new Date().toISOString(),
	};
	proposal.digest = proposalDigest(proposal);
	return proposal;
}
export const architectureInstructions = `Inspect the selected repositories, actual module boundaries and conventions, all requirements, comments, answers and decisions, the draft plan and prior candidate-review feedback. Preserve Takeover's completed work, PR URL and branch. Propose the smallest adequate design; do not implement or invent human acceptance. Routine unsplit changes using established patterns may bypass architecture approval with a concrete rationale; meaningful responsibilities, boundaries, interfaces or trade-offs require human acceptance.

Write for a busy human reader. Use short sentences and everyday words. Keep code identifiers, file paths and jargon out of title, summary, questions, option text, map labels and risks; put paths only in "file", "paths" and "files". One idea per item.

Return ONLY architecture-v1: {"architectureContract":"architecture-v1","classification":"meaningful or routine","rationale":"concrete reason for the classification","title":"plain title, max 80 chars","summary":"1-2 plain sentences: what changes for users","changes":[{"text":"what changed since the previous version","from":"you if the human asked for it, bob if you added it"}],"decisions":[{"id":"storage","question":"plain question","why":"required when open: why the human must answer","status":"decided or open","pick":"option id, only when decided","decidedBy":"bob, or you when the human chose it","options":[{"id":"a","name":"short option name","upside":"one plain sentence","catch":"one plain sentence","preview":{"parts":[map parts this option adds],"links":[links],"hide":["map part ids this option removes"]}}]}],"map":{"areas":[{"id":"area","name":"Area name"}],"parts":[{"id":"part","label":"short name","note":"few words, e.g. learns about Jira","detail":"one plain sentence about what it does","file":"optional path","area":"area","status":"new or changed or unchanged or outside"}],"links":[{"from":"part","to":"part","label":"optional 1-2 words"}]},"evidence":[{"repository":"selected repo","paths":["actual inspected path"],"observation":"one plain sentence on why the design fits"}],"risks":["one plain sentence each"],"candidate":{"plan":"COMPLETE self-contained implementation plan incorporating this architecture, every accepted requirement/decision, repository/base/delivery targets, original Takeover PR/work and validation expectations","steps":[{"title":"short plain step","files":["paths"]}],"assets":[{"path":"absolute path or HTTP URL","purpose":"..."}]}}.

Meaningful proposals need a map and at least one decision. Show every real choice as a decision with 2-4 options; decide it yourself when the repository or requirements settle it, and mark it open only when the answer depends on the human (team habits, product scope, cost). Open decisions block approval until the human answers. Keep the map to the parts a reader needs (up to 4 areas, mark parts that stay the same as unchanged). Add an option preview when the alternative would change the map. On a new version, list every change in "changes" and set decidedBy "you" for decisions the human settled. Routine outputs may omit map and decisions. Never return approval fields. Include every detail the implementer needs in candidate; it will receive only the accepted plan/assets. Read architectureProposals and architectureDecisions for feedback; explanation requests are not authorization. Independent child delivery is separate future work, not executable scheduling here.`;
