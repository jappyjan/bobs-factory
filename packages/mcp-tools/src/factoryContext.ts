import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
	type FactoryArtifactBinding,
	submitFactoryResultArtifact,
} from "./factoryArtifacts.js";
import { FactoryContextProjection } from "./factoryContextMemory.js";
import { FactoryContextSnapshot } from "./factoryContextSnapshot.js";
import {
	type ResearchAccess,
	registerResearchTools,
} from "./factoryResearch.js";

export const factoryContextInstructions = `Your step input is served by the factory-context MCP server, not embedded in this prompt. First call list_context at path "" to discover it. Browse objects/arrays with list_context and read values with read_context using JSON Pointer paths (escape ~ as ~0 and / as ~1). read_context defaults to 12000 characters and caps positive requests at 16000; list_context defaults to 25 entries and caps positive requests at 50. Responses report the applied limit and immutable snapshotRoot. Both tools paginate: follow nextOffset until null for every relevant collection/value. Read all ticket comments, answers, decisions and assets required by your role. The default compact view is a lazy factory-context-memory-v2 projection: nested large objects, arrays and strings become factory-context-ref-v2 descriptors with paths, original counts and snapshotRoot. A descriptor is an index, not evidence you have read. Use list_context at its path to browse bounded records, then read the required sections. Small records remain directly usable. Pass a reference's snapshotRoot to reject references from another snapshot. Explicit view="full" retrieves the exact original scoped agent snapshot at fullPath/path; concatenate all text pages to recover complete original values. Compact pages recover only the bounded projection, never silently download a large original. When generated /contextMemory is present, reviewers/fixers must navigate /contextMemory/reviewLedger and /contextMemory/reviewRounds: these lazy indexes preserve every distinct past finding, disposition, observation, rejection and chronological review reasoning. Repeated identical claims are deduplicated with first/latest original source paths, round indexes and occurrence counts. Browse every relevant ledger/round page and read referenced claim values as needed. A fixer disposition is a claim, not reviewer acceptance; use the current gate and new evidence to assess unresolved findings, disagreements and reopenings. The ledger satisfies historical review reading requirements without rereading duplicate old review outputs. /contextMemory/latestSteps is also lazy. History listings include step identities and original outputPath previews. On repeated visits, start with /progress, current role inputs and the ledger; inspect the delta and referenced original evidence when needed. Current requirements, decisions, answers and outputs are preserved in the original snapshot and may need explicit browsing/full reads when large. originalInput may itself contain JSON: read it in pages and parse it. Never infer missing pages or claim unread original evidence was inspected. Screenshot source fingerprints remain compact runtime provenance summaries even in view="full"; do not request or reconstruct full hash maps. Only this role's declared step inputs are available. If these tools are unavailable, return {"infrastructureFailure":{"reason":"precise unavailable tool/connection diagnosis"}} as the complete result. Infrastructure failures preserve output-correction budgets; never invent a result without the input. When /resultSubmission is present, large JSON results may be saved in its directory and submitted with submit_result_artifact; return that tool’s bounded factoryArtifact envelope as the complete final response. /provenance exposes runtime/workflow/contract identity for this run; do not copy it into role output.`;

/** One immutable snapshot per role, including only the workflow's scoped input. */
/** Runtime provenance is not role input. Project every path, including old history. */
export function compactFactoryContext(input: unknown): unknown {
	const manifests = new Map<
		object,
		{ digest: string; entries: number; version: number }
	>();
	const project = (value: unknown): unknown => {
		if (!value || typeof value !== "object") return value;
		if (Array.isArray(value)) return value.map(project);
		return Object.fromEntries(
			Object.entries(value).map(([key, child]) => {
				if (
					(key === "dependencyManifests" ||
						key === "videoDependencyManifests") &&
					child &&
					typeof child === "object"
				)
					return [
						key === "videoDependencyManifests"
							? "videoManifestInventory"
							: "manifestInventory",
						{ count: Object.keys(child).length, runtimeOnly: true },
					];
				if (key === "dependencyHashes" && child && typeof child === "object") {
					let manifest = manifests.get(child);
					if (!manifest) {
						manifest = {
							digest: createHash("sha256")
								.update(JSON.stringify(child))
								.digest("hex"),
							entries: Object.keys(child).length,
							version: Number(
								(value as Record<string, unknown>).fingerprintVersion ?? 1,
							),
						};
						manifests.set(child, manifest);
					}
					return ["sourceFingerprint", manifest];
				}
				return [key, project(child)];
			}),
		);
	};
	return project(input);
}

export function prepareFactoryContext(
	input: unknown,
	artifacts?: FactoryArtifactBinding,
) {
	const directory = mkdtempSync(join(tmpdir(), "bobs-factory-context-"));
	const path = join(directory, "input.json");
	try {
		new FactoryContextSnapshot(path).writeSync(input, true);
		return preparedContext(directory, path, artifacts);
	} catch (error) {
		rmSync(directory, { recursive: true, force: true });
		throw error;
	}
}

/** Production handoff yields while capturing cold history, before starting a role. */
export async function prepareFactoryContextAsync(
	input: unknown,
	artifacts?: FactoryArtifactBinding,
	research?: ResearchAccess,
	options?: { cacheDirectory: string },
) {
	const directory = mkdtempSync(join(tmpdir(), "bobs-factory-context-"));
	const path = join(directory, "input.json");
	try {
		if (options)
			mkdirSync(options.cacheDirectory, { recursive: true, mode: 0o700 });
		await new FactoryContextSnapshot(path, options?.cacheDirectory).writeAsync(
			input,
			true,
		);
		return preparedContext(directory, path, artifacts, research);
	} catch (error) {
		rmSync(directory, { recursive: true, force: true });
		throw error;
	}
}

function preparedContext(
	directory: string,
	path: string,
	artifacts?: FactoryArtifactBinding,
	research?: ResearchAccess,
) {
	if (research)
		writeFileSync(join(directory, "research.json"), JSON.stringify(research), {
			mode: 0o600,
		});
	if (artifacts)
		writeFileSync(
			join(directory, "artifacts.json"),
			JSON.stringify(artifacts),
			{ mode: 0o600 },
		);
	return {
		config: {
			type: "stdio" as const,
			command: process.execPath,
			args: process.env.BOBS_FACTORY_INTERNAL_EXECUTABLE
				? ["internal", "factory-context", "--snapshot", path]
				: [
						fileURLToPath(
							new URL("./factory-context-main.js", import.meta.url),
						),
						"--snapshot",
						path,
					],
		},
		cleanup: () => rmSync(directory, { recursive: true, force: true }),
	};
}
const result = (data: Record<string, unknown>) => ({
	content: [{ type: "text" as const, text: JSON.stringify(data) }],
	structuredContent: data,
});
const location = {
	path: z
		.string()
		.max(2000)
		.default("")
		.describe("JSON Pointer into this role's input; empty string is root"),
	offset: z.number().int().min(0).default(0),
	snapshotRoot: z
		.string()
		.regex(/^[a-f0-9]{64}$/)
		.optional()
		.describe(
			"Immutable snapshotRoot returned by a prior response/reference; rejects a different role snapshot",
		),
};
const viewOption = z
	.enum(["compact", "full"])
	.default("compact")
	.describe(
		"Bounded recursive projection by default; full reads the original scoped agent snapshot",
	);
const annotations = {
	readOnlyHint: true,
	destructiveHint: false,
	openWorldHint: false,
};

export function createFactoryContextServer(
	input: unknown,
	artifacts?: FactoryArtifactBinding,
): McpServer {
	const directory = mkdtempSync(join(tmpdir(), "bobs-factory-context-"));
	try {
		const snapshot = new FactoryContextSnapshot(join(directory, "input.json"));
		snapshot.writeSync(input);
		const server = contextServer(snapshot, artifacts);
		server.server.onclose = () =>
			rmSync(directory, { recursive: true, force: true });
		return server;
	} catch (error) {
		rmSync(directory, { recursive: true, force: true });
		throw error;
	}
}

export function createFactoryContextServerFromSnapshot(
	path: string,
	artifacts?: FactoryArtifactBinding,
	research?: ResearchAccess,
): McpServer {
	return contextServer(FactoryContextSnapshot.open(path), artifacts, research);
}

function contextServer(
	snapshot: FactoryContextSnapshot,
	artifacts?: FactoryArtifactBinding,
	research?: ResearchAccess,
): McpServer {
	const compact = new FactoryContextProjection(snapshot);
	const contextValue = (
		path: string,
		view: "compact" | "full",
		root?: string,
	) => {
		if (root !== undefined && root !== snapshot.identity)
			throw new Error(
				"Context snapshot identity mismatch; reference belongs to a different immutable snapshot",
			);
		return view === "full" ? snapshot.resolve(path) : compact.resolve(path);
	};
	const server = new McpServer({ name: "factory-context", version: "1.0.0" });
	if (research) registerResearchTools(server, research);
	if (artifacts)
		server.registerTool(
			"submit_result_artifact",
			{
				description:
					"Submit a complete JSON role result saved in the authorized result artifact directory. Returns a bounded run/role/revision-bound factoryArtifact envelope: use that envelope as the entire final response. Finalization applies the same output schema, coverage and evidence checks as inline JSON. File size limit is 8 MiB; path must be relative to the runtime's resultSubmission.directory.",
				inputSchema: { path: z.string().min(1).max(2000) },
				annotations: {
					readOnlyHint: true,
					destructiveHint: false,
					openWorldHint: false,
				},
			},
			async ({ path }) =>
				result(await submitFactoryResultArtifact(artifacts, path)),
		);
	server.registerTool(
		"list_context",
		{
			description:
				"List immediate fields or array entries without downloading their bodies, with short identity/step metadata previews and immutable original paths. Follow nextOffset to discover every entry. Large records remain bounded on read; use view=full explicitly for complete original values. Review memory indexes are built once on explicit navigation.",
			inputSchema: {
				...location,
				view: viewOption,
				limit: z
					.number()
					.int()
					.min(1)
					.default(25)
					.describe(
						"Entries per page; positive requests above 50 are capped at 50",
					),
			},
			annotations,
		},
		async ({ path, offset, limit, view, snapshotRoot }) => {
			limit = Math.min(limit, 50);
			const value = contextValue(path, view, snapshotRoot);
			const node = snapshot.node(value);
			if (node.kind !== "object" && node.kind !== "array")
				return result({
					path,
					view,
					snapshotRoot: snapshot.identity,
					type: node.kind,
					entries: [],
					total: 0,
					limit,
					offset,
					nextOffset: null,
				});
			const listing =
				view === "compact"
					? compact.listing(value, path, offset, limit)
					: {
							total: node.entries!.length,
							entries: snapshot.entries(value, offset, limit),
						};
			const { total } = listing;
			const entries = listing.entries.map(([key, child]) => {
				const childNode = snapshot.node(child);
				const preview =
					childNode.kind === "object" || childNode.kind === "array"
						? Object.fromEntries(
								["step", "at", "outputPath", "id", "scope", "status"].flatMap(
									(field) => {
										const value = snapshot.get(child, field),
											node = value ? snapshot.node(value) : undefined;
										return node?.kind === "string" && node.length! <= 200
											? [[field, snapshot.read(value!, 0, 200).text]]
											: [];
									},
								),
							)
						: {};
				const childPath = `${path}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`;
				if (
					(path === "/history" || path === "/progress/newHistory") &&
					snapshot.get(child, "output")
				)
					preview.outputPath = `${childPath}/output`;
				const originalPath =
					view === "full" ? childPath : compact.originalPath(childPath);
				return {
					...(Object.keys(preview).length ? { preview } : {}),
					path: childPath,
					...(originalPath === undefined ? {} : { fullPath: originalPath }),
					type: childNode.kind,
					...(childNode.kind === "string"
						? { characters: childNode.length }
						: {}),
					...(childNode.kind === "object" || childNode.kind === "array"
						? { entries: childNode.entries!.length }
						: {}),
				};
			});
			return result({
				path,
				view,
				snapshotRoot: snapshot.identity,
				type: node.kind,
				entries,
				total,
				limit,
				offset,
				nextOffset:
					offset + entries.length < total ? offset + entries.length : null,
			});
		},
	);
	server.registerTool(
		"read_context",
		{
			description:
				"Read a character page of a recursively bounded v2 context projection. Large nested values become immutable factory-context-ref-v2 descriptors with original paths/counts; browse them with list_context or explicitly use view=full to recover the original. Direct string reads are paginated raw text. Other values are JSON. Follow nextOffset until null; compact pagination recovers the projection, full pagination recovers the original.",
			inputSchema: {
				...location,
				view: viewOption,
				limit: z
					.number()
					.int()
					.min(1)
					.default(12000)
					.describe(
						"Characters per page; positive requests above 16000 are capped at 16000",
					),
			},
			annotations,
		},
		async ({ path, offset, limit, view, snapshotRoot }) => {
			limit = Math.min(limit, 16000);
			const value = contextValue(path, view, snapshotRoot);
			const node = snapshot.node(value);
			const page =
				view === "full" || node.kind === "string"
					? snapshot.read(value, offset, limit)
					: (() => {
							const text = JSON.stringify(compact.project(path, value));
							return {
								text: text.slice(offset, offset + limit),
								totalCharacters: text.length,
								encoding: "json",
								nextOffset:
									offset + limit < text.length ? offset + limit : null,
							};
						})();
			return result({
				path,
				view,
				snapshotRoot: snapshot.identity,
				...(view === "compact"
					? { projection: "factory-context-memory-v2" }
					: {}),
				limit,
				offset,
				...page,
			});
		},
	);
	return server;
}
