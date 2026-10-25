import { z } from "zod";

/**
 * Declarative cross-field rules (rules-v1).
 *
 * A rule is plain JSON data: no expressions, templates or scripts are evaluated.
 * Paths are JSON Pointers ("/status", "/stories/0/id"). A "*" segment expands
 * every array element or object value, so "/stories/*\/criteria/*\/id" selects
 * all criterion IDs as a list. Inside `each`/`some` the element becomes the
 * scope; a path starting with "$" ("$/captureBudget") reads from the document
 * root instead. Evaluation is bounded (depth, expansion size, rule count).
 *
 * The same format is used by agent-step `rules` and by the Check step.
 */
export const RULES_FORMAT = "rules-v1" as const;

export type RuleOperand =
	| number
	| { path: string }
	| { length: string }
	| { sum: RuleOperand[] };
export type FreshnessResolver = (reference: string) => boolean;
export type RuleCondition =
	| { fresh: string }
	| { all: RuleCondition[] }
	| { any: RuleCondition[] }
	| { not: RuleCondition }
	| { conforms: string; path?: string }
	| {
			compare: {
				left: RuleOperand;
				op: "eq" | "lt" | "lte" | "gt" | "gte";
				right: RuleOperand;
			};
	  }
	| { distinct: string[]; by?: string | string[] }
	| { sameLength: { items: string; as: string } }
	| {
			lookup: { collection: string; key: string; value: string };
			require: RuleCondition;
	  }
	| {
			text: {
				path: string;
				test:
					| "nonblank"
					| "no-local-path"
					| "no-commit-sha"
					| "repository-relative";
			};
	  }
	| { each: string; where?: RuleCondition; require: RuleCondition }
	| { some: string; where?: RuleCondition; require: RuleCondition }
	| {
			count: string;
			where?: RuleCondition;
			min?: RuleOperand;
			max?: RuleOperand;
	  }
	| {
			path: string;
			equals?: unknown;
			notEquals?: unknown;
			in?: unknown[];
			exists?: boolean;
			empty?: boolean;
			minLength?: RuleOperand;
			maxLength?: RuleOperand;
			min?: RuleOperand;
			max?: RuleOperand;
			unique?: boolean;
			by?: string | string[];
			within?: string | string[];
			disjoint?: string | string[];
			equalsPath?: string;
			maxItem?: RuleOperand;
	  };
export interface Rule {
	id?: string;
	message: string;
	/** Optional pointer reported with the issue. */
	path?: string;
	when?: RuleCondition;
	require: RuleCondition;
}
export interface RuleIssue {
	path: string;
	message: string;
	rule?: string;
}

/** Collection projections use the same paths, predicates and budget as rules. */
export type RuleAggregate =
	| {
			aggregate: "all" | "any";
			path: string;
			where?: RuleCondition;
			require: RuleCondition;
	  }
	| {
			aggregate: "count" | "filter";
			path: string;
			where?: RuleCondition;
	  };
export type RuleExpression =
	| RuleCondition
	| RuleAggregate
	| { select: string }
	| { find: { collection: string; key: string; value: string } };
export type RuleResult =
	| boolean
	| number
	| string
	| null
	| unknown[]
	| Record<string, unknown>;

const MAX_DEPTH = 12;
const MAX_VALUES = 20_000;
const pointer = z
	.string()
	.max(400)
	.regex(/^\$?(\/[^/]*)*$/, "Rule paths are JSON Pointers such as /status");
const transformPointer = z
	.string()
	.max(400)
	.regex(
		/^(?:\$|\^*(?:@key|@index)?)?(\/[^/]*)*$/,
		"Rule paths are JSON Pointers such as /status",
	);
function ruleSchemas(pointer: z.ZodString) {
	const operand: z.ZodType<RuleOperand> = z.lazy(() =>
		z.union([
			z.number(),
			z.object({ path: pointer }).strict(),
			z.object({ length: pointer }).strict(),
			z.object({ sum: z.array(operand).min(1).max(20) }).strict(),
		]),
	);
	const pointers = z.union([pointer, z.array(pointer).min(1).max(20)]);
	const RuleConditionSchema: z.ZodType<RuleCondition> = z.lazy(() =>
		z.union([
			z.object({ fresh: z.string().min(1).max(400) }).strict(),
			z.object({ all: z.array(RuleConditionSchema).min(1).max(20) }).strict(),
			z.object({ any: z.array(RuleConditionSchema).min(1).max(20) }).strict(),
			z.object({ not: RuleConditionSchema }).strict(),
			z
				.object({
					conforms: z
						.string()
						.regex(/^[a-z][a-z0-9-]*-v[1-9]\d*$/)
						.max(100),
					path: pointer.optional(),
				})
				.strict(),
			z
				.object({
					compare: z
						.object({
							left: operand,
							op: z.enum(["eq", "lt", "lte", "gt", "gte"]),
							right: operand,
						})
						.strict(),
				})
				.strict(),
			z
				.object({
					distinct: z.array(pointer).min(1).max(20),
					by: pointers.optional(),
				})
				.strict(),
			z
				.object({
					sameLength: z.object({ items: pointer, as: pointer }).strict(),
				})
				.strict(),
			z
				.object({
					lookup: z
						.object({ collection: pointer, key: pointer, value: pointer })
						.strict(),
					require: RuleConditionSchema,
				})
				.strict(),
			z
				.object({
					text: z
						.object({
							path: pointer,
							test: z.enum([
								"nonblank",
								"no-local-path",
								"no-commit-sha",
								"repository-relative",
							]),
						})
						.strict(),
				})
				.strict(),
			z
				.object({
					each: pointer,
					where: RuleConditionSchema.optional(),
					require: RuleConditionSchema,
				})
				.strict(),
			z
				.object({
					some: pointer,
					where: RuleConditionSchema.optional(),
					require: RuleConditionSchema,
				})
				.strict(),
			z
				.object({
					count: pointer,
					where: RuleConditionSchema.optional(),
					min: operand.optional(),
					max: operand.optional(),
				})
				.strict()
				.refine(
					(c) => c.min !== undefined || c.max !== undefined,
					"count needs min or max",
				),
			z
				.object({
					path: pointer,
					equals: z.unknown().optional(),
					notEquals: z.unknown().optional(),
					in: z.array(z.unknown()).max(100).optional(),
					exists: z.boolean().optional(),
					empty: z.boolean().optional(),
					minLength: operand.optional(),
					maxLength: operand.optional(),
					min: operand.optional(),
					max: operand.optional(),
					unique: z.literal(true).optional(),
					by: pointers.optional(),
					within: pointers.optional(),
					disjoint: pointers.optional(),
					equalsPath: pointer.optional(),
					maxItem: operand.optional(),
				})
				.strict()
				.refine(
					(c) =>
						[
							"equals",
							"notEquals",
							"in",
							"exists",
							"empty",
							"minLength",
							"maxLength",
							"min",
							"max",
							"unique",
							"within",
							"disjoint",
							"equalsPath",
							"maxItem",
						].some((key) => Object.hasOwn(c, key)),
					"A path condition needs an operator such as equals, empty or unique",
				),
		]),
	);
	const RuleAggregateSchema: z.ZodType<RuleAggregate> = z.union([
		z
			.object({
				aggregate: z.enum(["all", "any"]),
				path: pointer,
				where: RuleConditionSchema.optional(),
				require: RuleConditionSchema,
			})
			.strict(),
		z
			.object({
				aggregate: z.enum(["count", "filter"]),
				path: pointer,
				where: RuleConditionSchema.optional(),
			})
			.strict(),
	]);
	const RuleExpressionSchema: z.ZodType<RuleExpression> = z.union([
		RuleConditionSchema,
		RuleAggregateSchema,
		z.object({ select: pointer }).strict(),
		z
			.object({
				find: z
					.object({ collection: pointer, key: pointer, value: pointer })
					.strict(),
			})
			.strict(),
	]);

	return { RuleConditionSchema, RuleAggregateSchema, RuleExpressionSchema };
}
const standardRules = ruleSchemas(pointer);
const transformRules = ruleSchemas(transformPointer);
export const {
	RuleConditionSchema,
	RuleAggregateSchema,
	RuleExpressionSchema,
} = standardRules;
export const RuleSchema: z.ZodType<Rule> = z
	.object({
		id: z
			.string()
			.regex(/^[a-zA-Z0-9_-]+$/)
			.max(80)
			.optional(),
		message: z.string().trim().min(1).max(600),
		path: pointer.optional(),
		when: RuleConditionSchema.optional(),
		require: RuleConditionSchema,
	})
	.strict();
export const RuleDataSchema = z.unknown().superRefine((value, context) => {
	const pending = [{ value, depth: 0 }],
		seen = new Set<object>();
	let nodes = 0;
	let characters = 0;
	while (pending.length) {
		const entry = pending.pop()!;
		if (typeof entry.value === "string") characters += entry.value.length;
		if (characters > 1_000_000) {
			context.addIssue({
				code: "custom",
				message: "Rules exceed the configuration complexity limit",
			});
			return;
		}
		if (++nodes > 10_000 || entry.depth > MAX_DEPTH * 4) {
			context.addIssue({
				code: "custom",
				message: "Rules exceed the configuration complexity limit",
			});
			return;
		}
		if (entry.value && typeof entry.value === "object") {
			if (seen.has(entry.value)) {
				context.addIssue({
					code: "custom",
					message: "Rules must be acyclic JSON data",
				});
				return;
			}
			seen.add(entry.value);
			for (const key in entry.value) {
				if (!Object.hasOwn(entry.value, key)) continue;
				characters += key.length;
				if (nodes + pending.length >= 10_000 || characters > 1_000_000) {
					context.addIssue({
						code: "custom",
						message: "Rules exceed the configuration complexity limit",
					});
					return;
				}
				const descriptor = Object.getOwnPropertyDescriptor(entry.value, key)!;
				if (!("value" in descriptor)) {
					context.addIssue({
						code: "custom",
						message: "Rules must be JSON data without accessors",
					});
					return;
				}
				pending.push({ value: descriptor.value, depth: entry.depth + 1 });
			}
		}
	}
});
export const RulesSchema = RuleDataSchema.pipe(z.array(RuleSchema).max(50));

/** Transform templates reuse rules-v1 with literals, object merging and item mapping. */
export type TransformValue =
	| RuleExpression
	| string
	| number
	| boolean
	| null
	| { literal: unknown }
	| { merge: (RuleExpression | { literal: unknown })[] }
	| {
			map: string | string[];
			where?: RuleCondition;
			template: TransformTemplate;
			distinctBy?: string;
			missingAsEmpty?: boolean;
	  };
export type TransformTemplate = Record<string, TransformValue>;
const fieldName = z
	.string()
	.min(1)
	.max(80)
	.refine(
		(name) => !["__proto__", "constructor", "prototype"].includes(name),
		"Reserved transform field",
	);
const transformLiteralSchema = z
	.object({
		literal: z.unknown().superRefine((value, context) => {
			if (!z.json().safeParse(value).success)
				context.addIssue({
					code: "custom",
					message: "Transform literals must be JSON data",
				});
		}),
	})
	.strict();
function transformSchemas(inMap: boolean) {
	const paths = inMap ? transformPointer : pointer;
	const expression = (inMap ? transformRules : standardRules)
		.RuleExpressionSchema;
	const TransformValueSchema: z.ZodType<TransformValue> = z.lazy(() =>
		z.union([
			expression,
			z
				.object({
					merge: z
						.array(z.union([expression, transformLiteralSchema]))
						.min(1)
						.max(20),
				})
				.strict(),
			z.string(),
			z.number(),
			z.boolean(),
			z.null(),
			transformLiteralSchema,
			z
				.object({
					map: z.union([paths, z.array(paths).min(1).max(20)]),
					distinctBy: transformPointer.optional(),
					missingAsEmpty: z.boolean().optional(),
					where: transformRules.RuleConditionSchema.optional(),
					template: mappedTransform.TransformTemplateSchema,
				})
				.strict(),
		]),
	);
	const TransformTemplateSchema: z.ZodType<TransformTemplate> = z.lazy(() =>
		z
			.record(fieldName, TransformValueSchema)
			.refine(
				(value) => Object.keys(value).length <= 50,
				"At most 50 transform fields",
			),
	);
	return { TransformValueSchema, TransformTemplateSchema };
}
const mappedTransform = transformSchemas(true);
export const { TransformValueSchema, TransformTemplateSchema } =
	transformSchemas(false);
export const TransformSchema = RuleDataSchema.pipe(
	z.unknown().superRefine((value, context) => {
		// Inspect original keys before record parsing can discard __proto__.
		const visit = (template: unknown, path: string[]) => {
			if (!template || typeof template !== "object" || Array.isArray(template))
				return;
			for (const name of Object.keys(template)) {
				if (["__proto__", "constructor", "prototype"].includes(name))
					context.addIssue({
						code: "custom",
						path: [...path, name],
						message: "Reserved transform field",
					});
				const child = (template as Record<string, unknown>)[name];
				if (
					child &&
					typeof child === "object" &&
					Object.hasOwn(child, "map") &&
					Object.hasOwn(child, "template")
				)
					visit((child as { template: unknown }).template, [
						...path,
						name,
						"template",
					]);
			}
		};
		visit(value, []);
	}),
).pipe(TransformTemplateSchema);

/** Independent AST and total-work ceilings; recipe data cannot increase either. */
export const RULE_EVALUATION_LIMITS = {
	conditions: 100_000,
	work: 1_000_000,
	slice: 2_048,
	collection: MAX_VALUES,
	dataDepth: 48,
	canonicalCharacters: 1_000_000,
} as const;
export const TRANSFORM_WORK_LIMIT = 20_000_000;

interface TransformScope {
	value: unknown;
	parent?: TransformScope;
	key?: string;
	index?: number;
}

type FormatValidator = (format: string, value: unknown) => boolean;
type Task<T> = Generator<void, T, void>;
export interface RuleEvaluationBudget {
	remaining: number;
	workRemaining?: number;
	validateFormat?: FormatValidator;
	fresh?: FreshnessResolver;
}
interface Work {
	remaining: number;
	validateFormat?: FormatValidator;
	fresh?: FreshnessResolver;
	work: number;
	slice: number;
	/** Named Check inputs are lazy JSON; old condition host getters retain their API. */
	strictJson?: boolean;
	transformScope?: TransformScope;
}
const limit = () => new Error("Rules exceed the evaluation operation limit");
function* spend(state: Work, amount = 1): Task<void> {
	if (!Number.isSafeInteger(amount) || amount < 0 || amount > state.work)
		throw limit();
	state.work -= amount;
	state.slice += amount;
	if (state.slice >= RULE_EVALUATION_LIMITS.slice) {
		state.slice = 0;
		yield;
	}
}
function state(budget: RuleEvaluationBudget): Work {
	return {
		...budget,
		remaining: Number.isNaN(budget.remaining)
			? 0
			: Math.min(budget.remaining, RULE_EVALUATION_LIMITS.conditions),
		work: Number.isNaN(budget.workRemaining)
			? 0
			: Math.min(
					budget.workRemaining ?? RULE_EVALUATION_LIMITS.work,
					RULE_EVALUATION_LIMITS.work,
				),
		slice: 0,
	};
}
function selected(value: unknown, state: Work): void {
	if (!state.strictJson || value === null) return;
	if (typeof value !== "object") {
		if (!["undefined", "boolean", "number", "string"].includes(typeof value))
			throw new Error("Rules accept only JSON data");
		return;
	}
	const prototype = Object.getPrototypeOf(value);
	if (
		prototype !== null &&
		prototype !== (Array.isArray(value) ? Array.prototype : Object.prototype)
	)
		throw new Error("Rules accept only JSON data");
}
function own(value: object, key: string, state: Work): unknown {
	if (!state.strictJson) return (value as Record<string, unknown>)[key];
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (descriptor && !("value" in descriptor))
		throw new Error("Rules accept JSON data, not accessors");
	const result = descriptor?.value;
	selected(result, state);
	return result;
}
function* members(value: object, state: Work): Task<string[]> {
	selected(value, state);
	const keys: string[] = [];
	for (const key in value) {
		if (!Object.hasOwn(value, key)) continue;
		if (keys.length >= MAX_VALUES)
			throw new Error("Rule collection exceeds the evaluation limit");
		yield* spend(state, key.length + 1);
		const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
		if (!("value" in descriptor))
			throw new Error("Rules accept JSON data, not accessors");
		keys.push(key);
	}
	return keys;
}
class InvalidJsonSelection extends Error {}

/** Account the complete argument before calling any fixed, synchronous format parser. */
function* footprint(
	value: unknown,
	state: Work,
	active = new Set<object>(),
	depth = 0,
	requireJson = false,
): Task<number> {
	yield* spend(state);
	if (
		requireJson &&
		(value === undefined ||
			(typeof value === "number" && !Number.isFinite(value)))
	)
		throw new InvalidJsonSelection();
	if (depth > RULE_EVALUATION_LIMITS.dataDepth)
		throw new Error("Rule data nesting exceeds the evaluation limit");
	if (typeof value === "string") {
		yield* spend(state, value.length);
		return 1;
	}
	if (!value || typeof value !== "object") {
		if (
			!["undefined", "boolean", "number"].includes(typeof value) &&
			value !== null
		)
			throw new Error("Rules accept only JSON data");
		return 1;
	}
	if (active.has(value)) throw new Error("Rule data must be acyclic");
	const prototype = Object.getPrototypeOf(value);
	if (
		!Array.isArray(value) &&
		prototype !== Object.prototype &&
		prototype !== null
	)
		throw new Error("Rules accept only JSON data");
	active.add(value);
	let nodes = 1;
	try {
		if (Array.isArray(value)) {
			if (value.length > MAX_VALUES)
				throw new Error("Rule collection exceeds the evaluation limit");
			for (let i = 0; i < value.length; i++) {
				const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
				if (descriptor && !("value" in descriptor))
					throw new Error("Rules accept JSON data, not accessors");
				nodes += yield* footprint(
					descriptor?.value,
					state,
					active,
					depth + 1,
					requireJson,
				);
			}
		} else {
			for (const key of yield* members(value, state))
				nodes += yield* footprint(
					(value as Record<string, unknown>)[key],
					state,
					active,
					depth + 1,
					requireJson,
				);
		}
	} finally {
		active.delete(value);
	}
	return nodes;
}
function decode(segment: string): string {
	return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}
function* resolve(
	scope: unknown,
	root: unknown,
	path: string,
	state: Work,
	strictCollectionPath = false,
	requiredSelection = false,
): Task<unknown> {
	yield* spend(state, path.length + 1);
	let transformScope = state.transformScope;
	while (path.startsWith("^")) {
		transformScope = transformScope?.parent;
		scope = transformScope?.value;
		path = path.slice(1);
	}
	if (path.startsWith("@key") || path.startsWith("@index")) {
		const key = path.startsWith("@key") ? "key" : "index";
		scope = transformScope?.[key] ?? null;
		path = path.slice(key.length + 1);
	}
	const fromRoot = path.startsWith("$");
	const pointer = fromRoot ? path.slice(1) : path;
	let current: unknown[] = [fromRoot ? root : scope];
	let expanded = false;
	let pathDepth = 0;
	for (const key of pointer === ""
		? []
		: pointer.slice(1).split("/").map(decode)) {
		if (state.strictJson && ++pathDepth > RULE_EVALUATION_LIMITS.dataDepth)
			throw new Error("Rule data nesting exceeds the evaluation limit");
		const next: unknown[] = [];
		const add = (item: unknown) => {
			if (next.length >= MAX_VALUES)
				throw new Error("Rule selection exceeds the evaluation limit");
			next.push(item);
		};
		for (const value of current) {
			yield* spend(state);
			selected(value, state);
			if (key === "*") {
				expanded = true;
				if (Array.isArray(value)) {
					if (value.length > MAX_VALUES)
						throw new Error("Rule selection exceeds the evaluation limit");
					for (const item of yield* collection(value, state)) {
						yield* spend(state);
						add(item);
					}
				} else if (value && typeof value === "object") {
					for (const name of yield* members(value, state)) {
						yield* spend(state);
						add(own(value, name, state));
					}
				} else if (requiredSelection) return undefined;
				else if (strictCollectionPath)
					throw new Error(`Rule aggregate path ${path} has no collection at *`);
			} else if (
				value &&
				typeof value === "object" &&
				Object.hasOwn(value, key)
			)
				add(own(value, key, state));
			else if (requiredSelection) return undefined;
			else if (strictCollectionPath)
				throw new Error(`Rule aggregate path ${path} is missing ${key}`);
			else if (!expanded) add(undefined);
		}
		current = next;
	}
	const result = expanded ? current : current[0];
	selected(result, state);
	return result;
}
function list<T = unknown>(value: unknown): T[] {
	if (!Array.isArray(value)) return [];
	if (value.length > MAX_VALUES)
		throw new Error("Rule collection exceeds the evaluation limit");
	return value as T[];
}
/** Inspect only collection entries actually selected, never a host iterator. */
function* collection<T = unknown>(value: unknown, state: Work): Task<T[]> {
	if (!state.strictJson) return list<T>(value);
	selected(value, state);
	const array = list<T>(value);
	const result: T[] = [];
	for (let index = 0; index < array.length; index++) {
		yield* spend(state);
		result.push(own(array, String(index), state) as T);
	}
	return result;
}
function* size(value: unknown, state: Work): Task<number | undefined> {
	yield* spend(state);
	if (typeof value === "string" || Array.isArray(value)) return value.length;
	if (value && typeof value === "object")
		return (yield* members(value, state)).length;
	return value === undefined ? 0 : undefined;
}
function* empty(value: unknown, state: Work): Task<boolean> {
	if (value === undefined || value === null) return true;
	if (typeof value === "string") {
		yield* spend(state, value.length);
		return value.trim() === "";
	}
	if (Array.isArray(value)) return value.length === 0;
	if (typeof value === "object")
		return (yield* members(value, state)).length === 0;
	return false;
}
function* operandValue(
	value: RuleOperand,
	scope: unknown,
	root: unknown,
	state: Work,
	depth = 0,
): Task<number | undefined> {
	yield* spend(state);
	if (depth > MAX_DEPTH)
		throw new Error("Rule operand nesting exceeds the limit");
	if (typeof value === "number") return value;
	if ("length" in value)
		return yield* size(yield* resolve(scope, root, value.length, state), state);
	if ("sum" in value) {
		let total = 0;
		for (const item of list<RuleOperand>(value.sum)) {
			const number = yield* operandValue(item, scope, root, state, depth + 1);
			if (number === undefined) return undefined;
			total += number;
		}
		return total;
	}
	const resolved = yield* resolve(scope, root, value.path, state);
	return typeof resolved === "number" ? resolved : undefined;
}
/** Deterministic JSON encoding with charged traversal, sorting, quoting and joining. */
function* canonical(
	value: unknown,
	state: Work,
	depth = 0,
	active = new Set<object>(),
): Task<string | undefined> {
	yield* spend(state);
	selected(value, state);
	if (depth > RULE_EVALUATION_LIMITS.dataDepth)
		throw new Error("Rule data nesting exceeds the evaluation limit");
	if (typeof value === "string") {
		yield* spend(state, value.length * 6 + 2);
		return JSON.stringify(value);
	}
	if (value === undefined) return undefined;
	if (!value || typeof value !== "object") {
		yield* spend(state, 24);
		return JSON.stringify(value);
	}
	if (state.strictJson) {
		if (active.has(value)) throw new Error("Rule data must be acyclic");
		active.add(value);
	}
	try {
		const parts: string[] = [];
		let characters = 2;
		const add = (part: string) => {
			characters += part.length + 1;
			if (characters > RULE_EVALUATION_LIMITS.canonicalCharacters)
				throw limit();
			parts.push(part);
		};
		if (Array.isArray(value)) {
			for (const item of yield* collection(value, state))
				add((yield* canonical(item, state, depth + 1, active)) ?? "null");
			yield* spend(state, characters);
			return `[${parts.join(",")}]`;
		}
		const keys = yield* members(value, state);
		// Prepay a bounded comparator allowance. The comparator also counts actual
		// calls, so no engine sort implementation can exceed the paid work.
		let longest = 0;
		for (const name of keys) {
			yield* spend(state);
			longest = Math.max(longest, name.length);
		}
		const comparisons =
			keys.length * 2 * Math.ceil(Math.log2(Math.max(2, keys.length)));
		yield* spend(state, comparisons * (longest + 1) * 2);
		let calls = 0;
		keys.sort((a, b) => {
			if (++calls > comparisons) throw limit();
			return a < b ? -1 : a > b ? 1 : 0;
		});
		for (const name of keys) {
			const item = yield* canonical(
				own(value, name, state),
				state,
				depth + 1,
				active,
			);
			if (item !== undefined) {
				yield* spend(state, name.length * 6 + 2);
				add(`${JSON.stringify(name)}:${item}`);
			}
		}
		yield* spend(state, characters);
		return `{${parts.join(",")}}`;
	} finally {
		if (state.strictJson) active.delete(value);
	}
}
function* same(a: unknown, b: unknown, state: Work): Task<boolean> {
	const left = yield* canonical(a, state),
		right = yield* canonical(b, state);
	yield* spend(state, (left?.length ?? 0) + (right?.length ?? 0) + 1);
	return left === right;
}
function* key(
	item: unknown,
	by: string | string[] | undefined,
	root: unknown,
	state: Work,
): Task<string | undefined> {
	let selected = item;
	if (Array.isArray(by)) {
		const tuple: unknown[] = [];
		for (const path of by) {
			yield* spend(state);
			tuple.push(yield* resolve(item, root, path, state));
		}
		selected = tuple;
	} else if (by) selected = yield* resolve(item, root, by, state);
	return yield* canonical(selected, state);
}
function* union(
	scope: unknown,
	root: unknown,
	paths: string | string[],
	state: Work,
): Task<unknown[]> {
	const values: unknown[] = [];
	for (const path of Array.isArray(paths) ? paths : [paths]) {
		for (const item of yield* collection(
			yield* resolve(scope, root, path, state),
			state,
		)) {
			yield* spend(state);
			if (values.length >= MAX_VALUES)
				throw new Error("Rule collection exceeds the evaluation limit");
			values.push(item);
		}
	}
	return values;
}
function* conditionTask(
	condition: RuleCondition,
	scope: unknown,
	root: unknown,
	depth: number,
	state: Work,
): Task<boolean> {
	if (--state.remaining < 0) throw limit();
	yield* spend(state);
	if (depth > MAX_DEPTH) throw new Error("Rule nesting exceeds the limit");
	const next = (condition: RuleCondition, item = scope) =>
		conditionTask(condition, item, root, depth + 1, state);
	if ("fresh" in condition) return state.fresh?.(condition.fresh) === true;
	if ("conforms" in condition) {
		if (!state.validateFormat)
			throw new Error("Format rules require the library validator");
		const before = state.work;
		const strictJson = state.strictJson;
		let value = scope;
		let nodes: number;
		try {
			if (condition.path !== undefined) {
				state.strictJson = true;
				value = yield* resolve(scope, root, condition.path, state, false, true);
			}
			nodes = yield* footprint(
				value,
				state,
				new Set(),
				0,
				condition.path !== undefined,
			);
		} catch (error) {
			if (error instanceof InvalidJsonSelection) return false;
			throw error;
		} finally {
			state.strictJson = strictJson;
		}
		// Prepay pairwise refinement comparisons too; repeated format checks cannot
		// hide their full argument size behind a single condition visit.
		yield* spend(state, nodes * (before - state.work));
		return state.validateFormat(condition.conforms, value);
	}
	if ("all" in condition) {
		for (const item of list<RuleCondition>(condition.all))
			if (!(yield* next(item))) return false;
		return true;
	}
	if ("any" in condition) {
		for (const item of list<RuleCondition>(condition.any))
			if (yield* next(item)) return true;
		return false;
	}
	if ("not" in condition) return !(yield* next(condition.not));
	if ("compare" in condition) {
		const left = yield* operandValue(
				condition.compare.left,
				scope,
				root,
				state,
			),
			right = yield* operandValue(condition.compare.right, scope, root, state);
		if (left === undefined || right === undefined) return false;
		switch (condition.compare.op) {
			case "eq":
				return left === right;
			case "lt":
				return left < right;
			case "lte":
				return left <= right;
			case "gt":
				return left > right;
			case "gte":
				return left >= right;
		}
	}
	if ("distinct" in condition) {
		const seen = new Set<string | undefined>();
		for (const item of yield* union(scope, root, condition.distinct, state)) {
			const id = yield* key(item, condition.by, root, state);
			yield* spend(state, (id?.length ?? 0) + 1);
			if (seen.has(id)) return false;
			seen.add(id);
		}
		return true;
	}
	if ("sameLength" in condition) {
		const expected = yield* size(
			yield* resolve(scope, root, condition.sameLength.as, state),
			state,
		);
		if (expected === undefined) return false;
		for (const item of yield* collection(
			yield* resolve(scope, root, condition.sameLength.items, state),
			state,
		))
			if ((yield* size(item, state)) !== expected) return false;
		return true;
	}
	if ("lookup" in condition) {
		const sought = yield* resolve(scope, root, condition.lookup.value, state);
		let match: unknown,
			count = 0;
		for (const item of yield* collection(
			yield* resolve(scope, root, condition.lookup.collection, state),
			state,
		)) {
			yield* spend(state);
			if (
				yield* same(
					yield* resolve(item, root, condition.lookup.key, state),
					sought,
					state,
				)
			) {
				match = item;
				if (++count > 1) return false;
			}
		}
		return (
			count === 1 && (yield* next(condition.require, { item: scope, match }))
		);
	}
	if ("text" in condition) {
		const value = yield* resolve(scope, root, condition.text.path, state);
		if (typeof value !== "string") return false;
		yield* spend(state, value.length * 4 + 1);
		switch (condition.text.test) {
			case "nonblank":
				return Boolean(value.trim());
			case "no-local-path":
				return !/(?:\/(?:Users|home|tmp|private|var)\/|[A-Za-z]:\\)/.test(
					value,
				);
			case "no-commit-sha":
				return !/\b[a-f0-9]{40}\b/i.test(value);
			case "repository-relative":
				return (
					Boolean(value) &&
					!value.startsWith("/") &&
					!/^[A-Za-z]:/.test(value) &&
					!value.split(/[\\/]/).includes("..")
				);
		}
	}
	if ("each" in condition || "some" in condition) {
		const each = "each" in condition;
		for (const item of yield* collection(
			yield* resolve(
				scope,
				root,
				each ? condition.each : condition.some,
				state,
			),
			state,
		)) {
			yield* spend(state);
			if (condition.where && !(yield* next(condition.where, item))) continue;
			const matches = yield* next(condition.require, item);
			if (each && !matches) return false;
			if (!each && matches) return true;
		}
		return each;
	}
	if ("count" in condition) {
		let count = 0;
		for (const item of yield* collection(
			yield* resolve(scope, root, condition.count, state),
			state,
		)) {
			yield* spend(state);
			if (!condition.where || (yield* next(condition.where, item))) count++;
		}
		const min =
				condition.min === undefined
					? undefined
					: yield* operandValue(condition.min, scope, root, state),
			max =
				condition.max === undefined
					? undefined
					: yield* operandValue(condition.max, scope, root, state);
		return (
			!(condition.min !== undefined && (min === undefined || count < min)) &&
			!(condition.max !== undefined && (max === undefined || count > max))
		);
	}
	const value = yield* resolve(scope, root, condition.path, state);
	if (
		condition.equalsPath !== undefined &&
		!(yield* same(
			value,
			yield* resolve(scope, root, condition.equalsPath, state),
			state,
		))
	)
		return false;
	if (condition.maxItem !== undefined) {
		const maximum = yield* operandValue(condition.maxItem, scope, root, state);
		if (maximum === undefined || !Array.isArray(value)) return false;
		for (const item of yield* collection(value, state)) {
			yield* spend(state);
			if (typeof item !== "number" || item > maximum) return false;
		}
	}
	if (
		Object.hasOwn(condition, "equals") &&
		!(yield* same(value, condition.equals, state))
	)
		return false;
	if (
		Object.hasOwn(condition, "notEquals") &&
		(yield* same(value, condition.notEquals, state))
	)
		return false;
	if (condition.in) {
		let found = false;
		for (const option of list(condition.in)) {
			yield* spend(state);
			if (yield* same(value, option, state)) {
				found = true;
				break;
			}
		}
		if (!found) return false;
	}
	if (
		condition.exists !== undefined &&
		(value !== undefined) !== condition.exists
	)
		return false;
	if (
		condition.empty !== undefined &&
		(yield* empty(value, state)) !== condition.empty
	)
		return false;
	for (const bound of ["minLength", "maxLength", "min", "max"] as const) {
		yield* spend(state);
		const limitValue = condition[bound];
		if (limitValue === undefined) continue;
		const target = yield* operandValue(limitValue, scope, root, state),
			actual = bound.endsWith("Length")
				? yield* size(value, state)
				: typeof value === "number"
					? value
					: undefined;
		if (
			target === undefined ||
			actual === undefined ||
			(bound.startsWith("min") ? actual < target : actual > target)
		)
			return false;
	}
	if (condition.unique) {
		const seen = new Set<string | undefined>();
		for (const item of yield* collection(value, state)) {
			const id = yield* key(item, condition.by, root, state);
			yield* spend(state, (id?.length ?? 0) + 1);
			if (seen.has(id)) return false;
			seen.add(id);
		}
	}
	for (const relationship of ["within", "disjoint"] as const) {
		const paths = condition[relationship];
		if (paths === undefined) continue;
		const other = new Set<string | undefined>();
		for (const item of yield* union(scope, root, paths, state)) {
			const id = yield* canonical(item, state);
			yield* spend(state, (id?.length ?? 0) + 1);
			other.add(id);
		}
		for (const item of Array.isArray(value)
			? yield* collection(value, state)
			: value === undefined
				? []
				: [value]) {
			const id = yield* key(item, condition.by, root, state);
			yield* spend(state, (id?.length ?? 0) + 1);
			if (relationship === "within" ? !other.has(id) : other.has(id))
				return false;
		}
	}
	return true;
}
function sync<T>(task: Task<T>): T {
	let next = task.next();
	while (!next.done) next = task.next();
	return next.value;
}
async function asynchronous<T>(
	task: Task<T>,
	signal?: AbortSignal,
): Promise<T> {
	const check = () => {
		if (signal?.aborted)
			throw signal.reason instanceof Error
				? signal.reason
				: new DOMException("Rule evaluation cancelled", "AbortError");
	};
	try {
		check();
		// Yield before evaluation too: an already queued cancellation need not wait
		// for the first complete work slice.
		await new Promise<void>((resolve) => setImmediate(resolve));
		check();
		let next = task.next();
		while (!next.done) {
			await new Promise<void>((resolve) => setImmediate(resolve));
			check();
			next = task.next();
		}
		return next.value;
	} finally {
		task.return(undefined as T);
	}
}
export function evaluateCondition(
	condition: RuleCondition,
	scope: unknown,
	root: unknown = scope,
	depth = 0,
	budget: RuleEvaluationBudget = {
		remaining: RULE_EVALUATION_LIMITS.conditions,
	},
): boolean {
	const work = state(budget);
	function* run(): Task<boolean> {
		// Named-context predicates may contain lazy host sources. Only selected
		// values are consumed; do not hydrate unrelated getters during preflight.
		return yield* conditionTask(condition, scope, root, depth, work);
	}
	try {
		return sync(run());
	} finally {
		budget.remaining = work.remaining;
		budget.workRemaining = work.work;
	}
}
function* rulesTask(
	rules: readonly Rule[] | undefined,
	document: unknown,
	validateFormat?: FormatValidator,
	fresh?: FreshnessResolver,
): Task<RuleIssue[]> {
	if (!rules?.length) return [];
	if (rules.length > 50)
		throw new Error("Rules exceed the configuration complexity limit");
	const work = state({
		remaining: RULE_EVALUATION_LIMITS.conditions,
		validateFormat,
		fresh,
	});
	yield* footprint(document, work);
	yield* footprint(rules, work);
	const issues: RuleIssue[] = [];
	for (const rule of rules) {
		yield* spend(work);
		if (
			rule.when &&
			!(yield* conditionTask(rule.when, document, document, 0, work))
		)
			continue;
		if (!(yield* conditionTask(rule.require, document, document, 0, work)))
			issues.push({
				path: rule.path ?? "/",
				message: rule.message,
				...(rule.id ? { rule: rule.id } : {}),
			});
	}
	return issues;
}
/** Synchronous compatibility; every primitive uses the same total-work accounting. */
export function evaluateRules(
	rules: readonly Rule[] | undefined,
	document: unknown,
	validateFormat?: FormatValidator,
	fresh?: FreshnessResolver,
): RuleIssue[] {
	return sync(rulesTask(rules, document, validateFormat, fresh));
}
/** Runtime evaluation cooperatively yields and propagates cancellation unchanged. */
export function evaluateRulesAsync(
	rules: readonly Rule[] | undefined,
	document: unknown,
	validateFormat?: FormatValidator,
	signal?: AbortSignal,
	fresh?: FreshnessResolver,
): Promise<RuleIssue[]> {
	return asynchronous(
		rulesTask(rules, document, validateFormat, fresh),
		signal,
	);
}

function* expressionTask(
	expression: RuleExpression,
	document: unknown,
	work: Work,
	root: unknown = document,
): Task<RuleResult> {
	if ("find" in expression) {
		const sought = yield* resolve(document, root, expression.find.value, work);
		if (sought === undefined) return null;
		const items = yield* resolve(
			document,
			root,
			expression.find.collection,
			work,
			true,
		);
		if (!Array.isArray(items))
			throw new Error("Find collection must select an array");
		const soughtKey = yield* canonical(sought, work);
		for (const item of yield* collection(items, work)) {
			if (
				(yield* canonical(
					yield* resolve(item, root, expression.find.key, work),
					work,
				)) === soughtKey
			) {
				const encoded = yield* canonical(item, work);
				if (encoded === undefined) return null;
				yield* spend(work, encoded.length + 1);
				return JSON.parse(encoded);
			}
		}
		return null;
	}
	if ("select" in expression) {
		const encoded = yield* canonical(
			yield* resolve(document, root, expression.select, work),
			work,
		);
		if (encoded === undefined) return null;
		// Parsing is bounded by the canonical character ceiling and prepaid in
		// the shared budget. The result owns its data; projections cannot expose
		// mutable references into earlier outputs or evidence.
		yield* spend(work, encoded.length + 1);
		return JSON.parse(encoded) as RuleResult;
	}
	if (!("aggregate" in expression))
		return yield* conditionTask(expression, document, root, 0, work);
	const selected = yield* resolve(document, root, expression.path, work, true);
	// An absent or malformed producer collection is not a successful empty
	// collection. Ordinary rules retain their historical missing-path semantics.
	if (!Array.isArray(selected))
		throw new Error(
			`Rule aggregate path ${expression.path || "/"} must select an array`,
		);
	let count = 0;
	const filtered: unknown[] = [];
	for (const item of yield* collection(selected, work)) {
		yield* spend(work);
		if (
			expression.where &&
			!(yield* conditionTask(expression.where, item, root, 0, work))
		)
			continue;
		if (expression.aggregate === "count") count++;
		else if (expression.aggregate === "filter") filtered.push(item);
		else if ("require" in expression) {
			const matches = yield* conditionTask(
				expression.require,
				item,
				root,
				0,
				work,
			);
			if (expression.aggregate === "all" && !matches) return false;
			if (expression.aggregate === "any" && matches) return true;
		}
	}
	switch (expression.aggregate) {
		case "all":
			return true;
		case "any":
			return false;
		case "count":
			return count;
		case "filter":
			return filtered;
	}
}

export interface NamedRuleEvaluation {
	results: Record<string, RuleResult>;
	passed: boolean;
}

function* namedRulesTask(
	expressions: Readonly<Record<string, RuleExpression>>,
	inputs: unknown,
	evidence: unknown,
	passed: RuleCondition | undefined,
	validateFormat?: FormatValidator,
	fresh?: FreshnessResolver,
): Task<NamedRuleEvaluation> {
	const work = state({
		remaining: RULE_EVALUATION_LIMITS.conditions,
		validateFormat,
		fresh,
	});
	work.strictJson = true;
	const document = { inputs, evidence };
	yield* footprint({ expressions, passed }, work);
	const names = yield* members(expressions, work);
	if (names.length > 50)
		throw new Error("At most 50 named rule results are allowed");
	const results: Record<string, RuleResult> = {};
	let allPassed = true;
	let booleans = 0;
	for (const name of names) {
		if (["passed", "__proto__", "constructor", "prototype"].includes(name))
			throw new Error(`Reserved named rule result: ${name}`);
		const result = yield* expressionTask(expressions[name]!, document, work);
		// Charge each emitted projection, including repeated filtered values, so
		// many cheap scans cannot manufacture an unbounded serialized output.
		yield* footprint(result, work);
		results[name] = result;
		if (typeof result === "boolean") {
			booleans++;
			allPassed &&= result;
		}
	}
	if (!passed && !booleans)
		throw new Error("Check needs a boolean result or an explicit passed rule");
	return {
		results,
		passed: passed
			? yield* conditionTask(
					passed,
					{ ...document, results },
					{ ...document, results },
					0,
					work,
				)
			: allPassed,
	};
}

/** Named Check rules share one total budget, including aggregate output size. */
export function evaluateNamedRules(
	expressions: Readonly<Record<string, RuleExpression>>,
	inputs: unknown,
	evidence: unknown = {},
	passed?: RuleCondition,
	validateFormat?: FormatValidator,
	fresh?: FreshnessResolver,
): NamedRuleEvaluation {
	return sync(
		namedRulesTask(
			expressions,
			inputs,
			evidence,
			passed,
			validateFormat,
			fresh,
		),
	);
}

export function evaluateNamedRulesAsync(
	expressions: Readonly<Record<string, RuleExpression>>,
	inputs: unknown,
	evidence: unknown = {},
	passed?: RuleCondition,
	validateFormat?: FormatValidator,
	signal?: AbortSignal,
	fresh?: FreshnessResolver,
): Promise<NamedRuleEvaluation> {
	return asynchronous(
		namedRulesTask(
			expressions,
			inputs,
			evidence,
			passed,
			validateFormat,
			fresh,
		),
		signal,
	);
}

/** Fixed evidence selectors reuse the same guarded traversal and total budget. */
export async function selectRuleValuesAsync(
	document: unknown,
	path: string,
	budget: RuleEvaluationBudget,
	signal?: AbortSignal,
): Promise<unknown[]> {
	pointer.parse(path);
	const work = state(budget);
	work.strictJson = true;
	function* run(): Task<unknown[]> {
		const value = yield* resolve(document, document, path, work, true);
		const expanded = path.split("/").some((part) => decode(part) === "*");
		const result: unknown[] = [];
		for (const item of expanded ? yield* collection(value, work) : [value]) {
			for (const selected of Array.isArray(item)
				? yield* collection(item, work)
				: [item]) {
				yield* spend(work);
				if (result.length >= MAX_VALUES)
					throw new Error("Evidence selection exceeds the limit");
				yield* footprint(selected, work);
				result.push(selected);
			}
		}
		return result;
	}
	try {
		return await asynchronous(run(), signal);
	} finally {
		budget.remaining = work.remaining;
		budget.workRemaining = work.work;
	}
}

/** Retain each wildcard item's lexical parent and source key while flattening. */
function* transformItems(
	scope: TransformScope,
	root: unknown,
	path: string,
	work: Work,
	missingAsEmpty: boolean,
): Task<TransformScope[]> {
	let base: TransformScope | undefined = scope;
	while (path.startsWith("^")) {
		base = base?.parent;
		path = path.slice(1);
	}
	let value = base?.value;
	if (path.startsWith("$")) {
		value = root;
		path = path.slice(1);
	}
	let current = [{ value, scope: base }];
	let expanded = false;
	for (const key of path === "" ? [] : path.slice(1).split("/").map(decode)) {
		const next: typeof current = [];
		const add = (entry: (typeof current)[number]) => {
			if (next.length >= MAX_VALUES)
				throw new Error("Transform selection exceeds the limit");
			next.push(entry);
		};
		for (const entry of current) {
			yield* spend(work);
			selected(entry.value, work);
			if (key === "*") {
				if (!entry.value || typeof entry.value !== "object") {
					if (
						missingAsEmpty &&
						(entry.value === undefined || entry.value === null)
					)
						continue;
					throw new Error("Transform map wildcard must select a collection");
				}
				expanded = true;
				const keys = yield* members(entry.value, work);
				for (let index = 0; index < keys.length; index++) {
					const key = keys[index]!;
					const value = own(entry.value, key, work);
					add({
						value,
						scope: { value, key, index, parent: entry.scope },
					});
				}
			} else if (
				entry.value &&
				typeof entry.value === "object" &&
				Object.hasOwn(entry.value, key)
			) {
				add({ value: own(entry.value, key, work), scope: entry.scope });
			} else if (!missingAsEmpty)
				throw new Error(`Transform map path is missing ${key}`);
		}
		current = next;
	}
	if (expanded)
		return current.map((entry) => ({ ...entry.scope!, value: entry.value }));
	const items = current[0]?.value;
	if (missingAsEmpty && (items === undefined || items === null)) return [];
	if (!items || typeof items !== "object")
		throw new Error("Transform map must select an array or object");
	const keys = yield* members(items, work);
	return keys.map((key, index) => ({
		value: own(items, key, work),
		key,
		index,
		parent: base,
	}));
}

function* transformValueTask(
	value: TransformValue,
	scope: TransformScope,
	root: unknown,
	work: Work,
	depth: number,
): Task<unknown> {
	if (depth > MAX_DEPTH) throw new Error("Transform nesting exceeds the limit");
	yield* spend(work);
	if (value === null || typeof value !== "object") return value;
	if ("literal" in value) {
		const encoded = yield* canonical(value.literal, work);
		return encoded === undefined ? null : JSON.parse(encoded);
	}
	if ("merge" in value) {
		const merged: Record<string, unknown> = {};
		for (const expression of value.merge) {
			const object = yield* transformValueTask(
				expression,
				scope,
				root,
				work,
				depth + 1,
			);
			if (object === null) continue;
			if (typeof object !== "object" || Array.isArray(object))
				throw new Error("Transform merge accepts objects or null");
			for (const key of yield* members(object, work)) {
				Object.defineProperty(merged, key, {
					value: own(object, key, work),
					enumerable: true,
					writable: true,
					configurable: true,
				});
			}
		}
		return merged;
	}
	if (!("map" in value))
		return yield* expressionTask(value, scope.value, work, root);
	const mapped: unknown[] = [];
	const seen = new Set<string | undefined>();
	for (const path of Array.isArray(value.map) ? value.map : [value.map]) {
		const items = yield* transformItems(
			scope,
			root,
			path,
			work,
			value.missingAsEmpty ?? false,
		);
		for (const item of items) {
			work.transformScope = item;
			if (
				value.where &&
				!(yield* conditionTask(value.where, item.value, root, 0, work))
			)
				continue;
			if (value.distinctBy !== undefined) {
				const key = yield* canonical(
					yield* resolve(item.value, root, value.distinctBy, work),
					work,
				);
				if (key === undefined)
					throw new Error("Transform distinctBy key is missing");
				if (seen.has(key)) continue;
				seen.add(key);
			}
			if (mapped.length >= MAX_VALUES)
				throw new Error("Transform collection exceeds the limit");
			mapped.push(
				yield* transformTemplateTask(
					value.template,
					item,
					root,
					work,
					depth + 1,
				),
			);
		}
	}
	work.transformScope = scope;
	return mapped;
}

function* transformTemplateTask(
	template: TransformTemplate,
	scope: TransformScope,
	root: unknown,
	work: Work,
	depth = 0,
): Task<Record<string, unknown>> {
	if (depth > MAX_DEPTH) throw new Error("Transform nesting exceeds the limit");
	const previousScope = work.transformScope;
	work.transformScope = scope;
	try {
		const result: Record<string, unknown> = {};
		for (const name of yield* members(template, work)) {
			if (["__proto__", "constructor", "prototype"].includes(name))
				throw new Error("Reserved transform field");
			result[name] = yield* transformValueTask(
				own(template, name, work) as TransformValue,
				scope,
				root,
				work,
				depth,
			);
		}
		return result;
	} finally {
		work.transformScope = previousScope;
	}
}
/** One shared work/output budget covers every field and mapped item. */
export function evaluateTransformAsync(
	template: TransformTemplate,
	inputs: unknown,
	signal?: AbortSignal,
): Promise<Record<string, unknown>> {
	function* task(): Task<Record<string, unknown>> {
		const work = state({ remaining: RULE_EVALUATION_LIMITS.conditions });
		work.work = TRANSFORM_WORK_LIMIT;
		work.strictJson = true;
		yield* footprint(template, work);
		const document = { inputs };
		const result = yield* transformTemplateTask(
			template,
			{ value: document },
			document,
			work,
		);
		const encoded = (yield* canonical(result, work))!;
		yield* spend(work, encoded.length + 1);
		return JSON.parse(encoded) as Record<string, unknown>;
	}
	return asynchronous(task(), signal);
}
