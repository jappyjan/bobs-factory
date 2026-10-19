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
