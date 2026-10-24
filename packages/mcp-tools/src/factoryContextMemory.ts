import type { FactoryContextSnapshot } from "./factoryContextSnapshot.js";

type RecordValue = Record<string, unknown>;
const isRecord = (value: unknown): value is RecordValue =>
	value !== null && typeof value === "object" && !Array.isArray(value);

/** Snapshot adapters inspect metadata without loading complete historical outputs. */
export interface ContextMemoryAccess {
	isRecord(value: unknown): boolean;
	array(value: unknown): unknown[] | undefined;
	fields(value: unknown): RecordValue;
	string(value: unknown): string | undefined;
	serializedLength(value: unknown): number;
	signature(value: unknown): string;
}
const plainAccess: ContextMemoryAccess = {
	isRecord,
	array: (value) => (Array.isArray(value) ? value : undefined),
	fields: (value) => value as RecordValue,
	string: (value) => (typeof value === "string" ? value : undefined),
	serializedLength: (value) => (JSON.stringify(value) ?? "null").length,
	signature: (value) => JSON.stringify(value),
};

interface Claim {
	value: unknown;
	firstPath: string;
	latestPath: string;
	firstRound: number;
	latestRound: number;
	occurrences: number;
}
interface ReviewRecord {
	scope: string;
	id: string | null;
	findings: Claim[];
	dispositions: Claim[];
	observations: Claim[];
}
const claimKinds = ["findings", "dispositions", "observations"] as const;

interface HistoryEntry {
	fullPath: string;
	step?: string;
	at?: string;
	call?: unknown;
	outputPath?: string;
	outputCharacters?: number;
}

function historyIndex(
	history: unknown[],
	path: string,
	access: ContextMemoryAccess,
): HistoryEntry[] {
	return history.map((item, index) => {
		const fullPath = `${path}/${index}`;
		if (!access.isRecord(item)) return { fullPath };
		const fields = access.fields(item),
			step = access.string(fields.step),
			at = access.string(fields.at);
		return {
			fullPath,
			...(step !== undefined ? { step } : {}),
			...(at !== undefined ? { at } : {}),
			...(Object.hasOwn(fields, "call") ? { call: fields.call } : {}),
			...(Object.hasOwn(fields, "output")
				? {
						outputPath: `${fullPath}/output`,
						outputCharacters: access.serializedLength(fields.output),
					}
				: {}),
		};
	});
}

/** Exact review claims, deduplicated without interpreting acceptance or status. */
function reviewLedger(
	history: unknown[],
	access: ContextMemoryAccess,
): ReviewRecord[] {
	const records = new Map<string, ReviewRecord>();
	const signatures = new WeakMap<ReviewRecord, Map<string, Claim>>();
	for (const [round, item] of history.entries()) {
		if (!access.isRecord(item)) continue;
		const fields = access.fields(item);
		if (!access.isRecord(fields.output)) continue;
		const output = access.fields(fields.output),
			step = access.string(fields.step);
		const scope =
			step !== undefined
				? step.slice(0, Math.max(0, step.lastIndexOf("/")))
				: "";
		for (const kind of claimKinds) {
			const values = access.array(output[kind]);
			if (!values) continue;
			for (const [index, value] of values.entries()) {
				const path = `/history/${round}/output/${kind}/${index}`;
				const id = access.isRecord(value)
					? (access.string(access.fields(value).id) ?? null)
					: null;
				// Unlabelled legacy claims remain visible; never merge unrelated claims.
				const key = JSON.stringify([scope, id ?? path]);
				let record = records.get(key);
				if (!record) {
					record = {
						scope,
						id,
						findings: [],
						dispositions: [],
						observations: [],
					};
					records.set(key, record);
					signatures.set(record, new Map());
				}
				const signature = `${kind}:${access.signature(value)}`;
				const previous = signatures.get(record)!.get(signature);
				if (previous) {
					previous.latestPath = path;
					previous.latestRound = round;
					previous.occurrences++;
				} else {
					const claim = {
						value,
						firstPath: path,
						latestPath: path,
						firstRound: round,
						latestRound: round,
						occurrences: 1,
					};
					record[kind].push(claim);
					signatures.get(record)!.set(signature, claim);
				}
			}
		}
	}
	return [...records.values()];
}

/** Preserve review reasoning and gate outcomes without repeating claim bodies. */
function reviewRounds(history: unknown[], access: ContextMemoryAccess) {
	return history.flatMap((item, index) => {
		if (!access.isRecord(item)) return [];
		const fields = access.fields(item);
		if (!access.isRecord(fields.output)) return [];
		const output = access.fields(fields.output);
		if (!claimKinds.some((kind) => access.array(output[kind]))) return [];
		return [
			{
				round: index,
				step: fields.step,
				at: fields.at,
				outputPath: `/history/${index}/output`,
				...Object.fromEntries(
					[
						"summary",
						"approved",
						"feedback",
						"questions",
						"reviewAssessment",
					].flatMap((key) =>
						Object.hasOwn(output, key) ? [[key, output[key]]] : [],
					),
				),
			},
		];
	});
}

/**
 * Compact the default browsing view, not the immutable source snapshot. Current
 * requirements, decisions, answers and outputs stay exact. Older role outputs
 * are indexed and remain available through their original paths or view=full.
 */
export function factoryContextView(
	input: unknown,
	access: ContextMemoryAccess = plainAccess,
): unknown {
	if (!access.isRecord(input)) return input;
	const fields = access.fields(input),
		originalHistory = access.array(fields.history);
	if (!originalHistory || Object.hasOwn(fields, "contextMemory")) return input;
	const history = historyIndex(originalHistory, "/history", access);
	const latest = new Map<string, (typeof history)[number]>();
	for (const item of history) if (item.step) latest.set(item.step, item);
	const progress = fields.progress;
	const progressFields = access.isRecord(progress)
		? access.fields(progress)
		: undefined;
	const newHistory = progressFields
		? access.array(progressFields.newHistory)
		: undefined;
	return {
		...fields,
		history,
		...(progressFields && newHistory
			? {
					progress: {
						...progressFields,
						newHistory: historyIndex(
							newHistory,
							"/progress/newHistory",
							access,
						),
					},
				}
			: {}),
		contextMemory: {
			format: "factory-context-memory-v1",
			historyCount: history.length,
			latestSteps: [...latest.values()],
			reviewLedger: reviewLedger(originalHistory, access),
			reviewRounds: reviewRounds(originalHistory, access),
		},
	};
}

/** Serving limits apply to every subtree, including embedded prior inputs. */
export const factoryContextProjectionLimits = Object.freeze({
	entries: 25,
	depth: 6,
	nodes: 128,
	subtreeCharacters: 6000,
	stringCharacters: 2000,
});
const pointerChild = (path: string, key: string) =>
	`${path}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`;

/**
 * V2 is an agent boundary only. Do not replace factoryContextView in native
 * review authority/digest code: that v1 function deliberately retains its exact
 * historical semantics. This projection never walks history until an explicit
 * memory-index read, and never caches a path-bearing result by content hash.
 */
export class FactoryContextProjection {
	private summary?: object;
	private memory?: object;
	private enabled?: boolean;
	constructor(private readonly snapshot: FactoryContextSnapshot) {}
	private hasMemory() {
		if (this.enabled === undefined) {
			const root = this.snapshot.root;
			const history = this.snapshot.get(root, "history");
			this.enabled =
				this.snapshot.node(root).kind === "object" &&
				!this.snapshot.get(root, "contextMemory") &&
				!!history &&
				this.snapshot.node(history).kind === "array";
		}
		return this.enabled;
	}
	private memorySummary() {
		if (!this.summary) {
			const history = this.snapshot.get(this.snapshot.root, "history")!;
			this.summary = this.snapshot.append({
				format: "factory-context-memory-v2",
				snapshotRoot: this.snapshot.identity,
				historyCount: this.snapshot.node(history).entries!.length,
				...Object.fromEntries(
					["latestSteps", "reviewLedger", "reviewRounds"].map((key) => [
						key,
						{
							format: "factory-context-ref-v2",
							snapshotRoot: this.snapshot.identity,
							path: `/contextMemory/${key}`,
							view: "compact",
							type: "array",
							derived: true,
							deferred: true,
						},
					]),
				),
			});
		}
		return this.summary;
	}
	private memoryIndex() {
		this.memory ??= this.snapshot.memoized("review-memory-v1", () => {
			const view = factoryContextView(
				this.snapshot.root,
				this.snapshot.access,
			) as RecordValue;
			return view.contextMemory;
		});
		return this.memory;
	}
	resolve(path: string): object {
		// Validate the entire pointer even for synthetic paths.
		if (path !== "" && (!path.startsWith("/") || /~(?![01])/u.test(path)))
			throw new Error("Use a JSON Pointer path, or an empty path for the root");
		if (this.hasMemory()) {
			if (
				/^\/contextMemory\/(latestSteps|reviewLedger|reviewRounds)(\/|$)/u.test(
					path,
				)
			)
				return this.snapshot.resolve(
					path.slice("/contextMemory".length),
					this.memoryIndex(),
				);
			if (path === "/contextMemory" || path.startsWith("/contextMemory/"))
				return this.snapshot.resolve(
					path.slice("/contextMemory".length),
					this.memorySummary(),
				);
		}
		return this.snapshot.resolve(path);
	}
	/** The synthetic root field must not require copying every root entry. */
	listing(reference: object, path: string, offset: number, limit: number) {
		const count = this.snapshot.node(reference).entries?.length ?? 0;
		const includeMemory = path === "" && this.hasMemory();
		const entries = this.snapshot.entries(reference, offset, limit);
		if (includeMemory && offset <= count && offset + limit > count)
			entries.push(["contextMemory", this.memorySummary()]);
		return { total: count + (includeMemory ? 1 : 0), entries };
	}
	/** Claims/round previews retain pointers into the original immutable source. */
	originalPath(path: string): string | undefined {
		if (!this.hasMemory() || !path.startsWith("/contextMemory")) return path;
		const claim = path.match(
			/^(\/contextMemory\/reviewLedger\/\d+\/(?:findings|dispositions|observations)\/\d+)\/value(\/.*)?$/u,
		);
		if (claim) {
			const origin = this.snapshot.get(this.resolve(claim[1]!), "firstPath");
			return origin
				? this.snapshot.read(origin, 0, 2000).text + (claim[2] ?? "")
				: undefined;
		}
		const round = path.match(
			/^(\/contextMemory\/reviewRounds\/\d+)\/(summary|approved|feedback|questions|reviewAssessment)(\/.*)?$/u,
		);
		if (round) {
			const origin = this.snapshot.get(this.resolve(round[1]!), "outputPath");
			return origin
				? `${this.snapshot.read(origin, 0, 2000).text}/${round[2]}${round[3] ?? ""}`
				: undefined;
		}
		return undefined;
	}
	descriptor(reference: object, path: string) {
		const node = this.snapshot.node(reference),
			originalPath = this.originalPath(path);
		return {
			format: "factory-context-ref-v2",
			snapshotRoot: this.snapshot.identity,
			path: originalPath ?? path,
			view: originalPath === undefined ? "compact" : "full",
			...(originalPath === undefined
				? { derived: true }
				: { fullPath: originalPath }),
			type: node.kind,
			characters: node.kind === "string" ? node.length : node.characters,
			...(node.entries ? { entries: node.entries.length } : {}),
		};
	}
	project(path: string, reference = this.resolve(path)): unknown {
		let remaining = factoryContextProjectionLimits.nodes;
		const visit = (reference: object, path: string, depth: number): unknown => {
			const node = this.snapshot.node(reference);
			if (node.transcript)
				return {
					format: "factory-transcript-restricted-v1",
					path,
					reason:
						"Use explicit handoff records; targeted diagnostics require accepted purpose, role/range and cumulative allowance.",
				};
			if (--remaining < 0) return this.descriptor(reference, path);
			if (node.kind === "string")
				return node.length! > factoryContextProjectionLimits.stringCharacters
					? this.descriptor(reference, path)
					: this.snapshot.read(reference, 0, node.length!).text;
			if (!node.entries) return node.value;
			const count =
				node.entries.length + (path === "" && this.hasMemory() ? 1 : 0);
			if (
				depth >= factoryContextProjectionLimits.depth ||
				count > factoryContextProjectionLimits.entries
			)
				return this.descriptor(reference, path);
			const { entries } = this.listing(
				reference,
				path,
				0,
				factoryContextProjectionLimits.entries,
			);
			const projected = entries.map(
				([key, child]) =>
					[key, visit(child, pointerChild(path, key), depth + 1)] as const,
			);
			const value =
				node.kind === "array"
					? projected.map(([, child]) => child)
					: Object.fromEntries(projected);
			return JSON.stringify(value).length <=
				factoryContextProjectionLimits.subtreeCharacters
				? value
				: this.descriptor(reference, path);
		};
		return visit(reference, path, 0);
	}
}
