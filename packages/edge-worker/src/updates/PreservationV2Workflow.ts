/**
 * The frozen `factory-preservation-v2` receipt hashes workflows as the
 * pre-node-engine worker held them in memory. That worker re-parsed every run
 * graph with its schema on load, which reordered properties, stripped unknown
 * ones and added defaults. Installed supervisors capture that running worker's
 * receipt as the baseline, so a candidate that keeps stored bytes verbatim
 * hashes the same graph differently and every update rolls back.
 *
 * This module reproduces only that observable shape. It performs no
 * validation and never changes the stored run. The key orders and defaults are
 * frozen from the removed schema; do not edit them to follow the live one.
 * Only workflow and step-level shape is reproduced. Nested step configuration
 * was already written in schema order by that worker and is kept as stored.
 */

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);

const workflowKeys = [
	"id",
	"convergence",
	"context",
	"stepConfigVersion",
	"inputs",
	"outcomes",
	"name",
	"icon",
	"description",
	"labels",
	"steps",
	"internal",
	"chat",
	"allowedTriggers",
	"launchFields",
];

const stepHead = [
	"id",
	"view",
	"context",
	"configVersion",
	"reads",
	"output",
	"rules",
	"checks",
	"revision",
	"access",
	"instructions",
	"delivery",
	"resources",
	"name",
	"next",
	"branches",
	"qaContract",
	"videoContract",
	"review",
	"impactSource",
	"maxVisits",
	"type",
];
const human = (...tail: string[]) => ["notifications", ...stepHead, ...tail];
const stepKeys: Record<string, string[]> = {
	agent: [
		...stepHead,
		"impactContract",
		"impact",
		"architectureSource",
		"architectureContract",
		"architectureBrief",
		"reviewContract",
		"guideContract",
		"computeIntensive",
		"prompt",
		"inputs",
		"runner",
		"model",
		"reasoningEffort",
		"modelVariant",
		"serviceTier",
		"json",
		"askQuestions",
		"chat",
	],
	decide: human("decide", "computeIntensive"),
	approve: human("computeIntensive"),
	show: human("computeIntensive"),
	snapshot: [...stepHead, "snapshot", "computeIntensive"],
	"file-issues": [...stepHead, "fileIssues", "computeIntensive"],
	"launch-runs": [...stepHead, "launchRuns", "computeIntensive"],
	check: [...stepHead, "check", "computeIntensive"],
	workflow: [
		...stepHead,
		"workflow",
		"inputFreshness",
		"bindings",
		"inputMapping",
		"computeIntensive",
	],
	script: [...stepHead, "script", "computeIntensive"],
	tool: [...stepHead, "tool", "computeIntensive", "args", "arguments"],
	foreach: [
		...stepHead,
		"items",
		"itemId",
		"concurrency",
		"maxItems",
		"failure",
		"body",
		"computeIntensive",
	],
	fanout: [...stepHead, "computeIntensive", "groups"],
};

const stepDefaults: Record<string, () => unknown> = {
	branches: () => [],
	maxVisits: () => 16,
};
const typeDefaults: Record<string, Record<string, () => unknown>> = {
	agent: { json: () => true, askQuestions: () => false },
	tool: { args: () => [] },
	foreach: {
		itemId: () => "/id",
		concurrency: () => 4,
		maxItems: () => 100,
		failure: () => "all-must-succeed",
	},
};

/** Zod object semantics: schema key order, unknown keys dropped, defaults added. */
function reshape(
	value: Json,
	keys: string[],
	defaults: Record<string, () => unknown>,
	child: (key: string, value: unknown) => unknown,
): Json {
	const result: Json = {};
	for (const key of keys) {
		if (key in value && value[key] !== undefined)
			result[key] = child(key, value[key]);
		else if (defaults[key]) result[key] = defaults[key]!();
	}
	return result;
}

function step(value: unknown): unknown {
	if (!isObject(value) || typeof value.type !== "string") return value;
	const keys = stepKeys[value.type];
	if (!keys) return value;
	return reshape(
		value,
		keys,
		{ ...stepDefaults, ...typeDefaults[value.type] },
		(key, item) => {
			if (key === "branches" && Array.isArray(item))
				return item.map((branch) =>
					isObject(branch)
						? reshape(branch, ["when", "next", "entry"], {}, (name, inner) =>
								name === "when" && isObject(inner)
									? reshape(inner, ["path", "equals"], {}, (_, leaf) => leaf)
									: inner,
							)
						: branch,
				);
			if (key === "body" && Array.isArray(item)) return item.map(step);
			if (key === "groups" && Array.isArray(item))
				return item.map((group) =>
					Array.isArray(group) ? group.map(step) : group,
				);
			return item;
		},
	);
}

function legacyTriggers(workflow: Json): string[] {
	return workflow.id === "simple"
		? ["manual", "ticket-assignment"]
		: workflow.internal
			? ["workflow"]
			: ["workflow", "manual", "ticket-assignment"];
}

/**
 * Project a run's accepted workflow the way the pre-node-engine worker held
 * it after loading. Node-engine graphs never existed in that worker and are
 * returned unchanged.
 */
export function preservationV2Workflow<T>(workflow: T): T {
	if (!isObject(workflow) || workflow.engineVersion === "nodes-v1")
		return workflow;
	const result = reshape(
		workflow,
		workflowKeys,
		{ description: () => "", labels: () => [] },
		(key, item) =>
			key === "steps" && Array.isArray(item) ? item.map(step) : item,
	);
	// The old transform appended the legacy default after every schema key.
	result.allowedTriggers ??= legacyTriggers(workflow);
	return result as T;
}
