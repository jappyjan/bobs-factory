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
export type RuleCondition =
	| { all: RuleCondition[] }
	| { any: RuleCondition[] }
	| { not: RuleCondition }
	| { conforms: string }
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

const MAX_DEPTH = 12;
const MAX_VALUES = 20_000;
const pointer = z
	.string()
	.max(400)
	.regex(/^\$?(\/[^/]*)*$/, "Rule paths are JSON Pointers such as /status");
const operand: z.ZodType<RuleOperand> = z.lazy(() =>
	z.union([
		z.number(),
		z.object({ path: pointer }).strict(),
		z.object({ length: pointer }).strict(),
		z.object({ sum: z.array(operand).min(1).max(20) }).strict(),
	]),
);
const pointers = z.union([pointer, z.array(pointer).min(1).max(20)]);
export const RuleConditionSchema: z.ZodType<RuleCondition> = z.lazy(() =>
	z.union([
		z.object({ all: z.array(RuleConditionSchema).min(1).max(20) }).strict(),
		z.object({ any: z.array(RuleConditionSchema).min(1).max(20) }).strict(),
		z.object({ not: RuleConditionSchema }).strict(),
		z
			.object({
				conforms: z
					.string()
					.regex(/^[a-z][a-z0-9-]*-v[1-9]\d*$/)
					.max(100),
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
	while (pending.length) {
		const entry = pending.pop()!;
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
			for (const child of Object.values(entry.value))
				pending.push({ value: child, depth: entry.depth + 1 });
		}
	}
});
export const RulesSchema = RuleDataSchema.pipe(z.array(RuleSchema).max(50));

function decode(segment: string): string {
	return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}
function segments(path: string): string[] {
	return path === "" ? [] : path.slice(1).split("/").map(decode);
}

/** Select values; "*" expands. Returns undefined entries for missing scalars. */
function select(scope: unknown, root: unknown, path: string): unknown[] {
	const fromRoot = path.startsWith("$");
	let current: unknown[] = [fromRoot ? root : scope];
	let expanded = false;
	for (const key of segments(fromRoot ? path.slice(1) : path)) {
		const next: unknown[] = [];
		for (const value of current) {
			if (key === "*") {
				expanded = true;
				if (Array.isArray(value)) next.push(...value);
				else if (value && typeof value === "object")
					next.push(...Object.values(value));
			} else if (
				value &&
				typeof value === "object" &&
				Object.hasOwn(value, key)
			)
				next.push((value as Record<string, unknown>)[key]);
			else if (!expanded) next.push(undefined);
			if (next.length > MAX_VALUES)
				throw new Error("Rule selection exceeds the evaluation limit");
		}
		current = next;
	}
	return expanded ? [current] : current;
}
/** A path resolves to one value; wildcard paths resolve to the list of matches. */
function resolve(scope: unknown, root: unknown, path: string): unknown {
	return select(scope, root, path)[0];
}
function operandValue(
	value: RuleOperand,
	scope: unknown,
	root: unknown,
	depth = 0,
): number | undefined {
	if (depth > MAX_DEPTH)
		throw new Error("Rule operand nesting exceeds the limit");
	if (typeof value === "number") return value;
	if ("length" in value) return length(resolve(scope, root, value.length));
	if ("sum" in value) {
		const values = value.sum.map((item) =>
			operandValue(item, scope, root, depth + 1),
		);
		return values.some((item) => item === undefined)
			? undefined
			: values.reduce<number>((sum, item) => sum + item!, 0);
	}
	const resolved = resolve(scope, root, value.path);
	return typeof resolved === "number" ? resolved : undefined;
}
function isEmpty(value: unknown): boolean {
	if (value === undefined || value === null) return true;
	if (typeof value === "string") return value.trim() === "";
	if (Array.isArray(value)) return value.length === 0;
	if (typeof value === "object") return Object.keys(value).length === 0;
	return false;
}
function same(a: unknown, b: unknown): boolean {
	return canonical(a) === canonical(b);
}
function canonical(value: unknown): string {
	return JSON.stringify(value, (_key, item) =>
		item && typeof item === "object" && !Array.isArray(item)
			? Object.fromEntries(
					Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
				)
			: item,
	);
}
function list(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}
function length(value: unknown): number | undefined {
	if (typeof value === "string" || Array.isArray(value)) return value.length;
	if (value && typeof value === "object") return Object.keys(value).length;
	return value === undefined ? 0 : undefined;
}
function key(
	item: unknown,
	by: string | string[] | undefined,
	root: unknown,
): string {
	return canonical(
		Array.isArray(by)
			? by.map((path) => resolve(item, root, path))
			: by
				? resolve(item, root, by)
				: item,
	);
}
function union(
	scope: unknown,
	root: unknown,
	paths: string | string[],
): unknown[] {
	return (Array.isArray(paths) ? paths : [paths]).flatMap((path) =>
		list(resolve(scope, root, path)),
	);
}

export function evaluateCondition(
	condition: RuleCondition,
	scope: unknown,
	root: unknown = scope,
	depth = 0,
	budget: {
		remaining: number;
		validateFormat?: (format: string, value: unknown) => boolean;
	} = { remaining: 100_000 },
): boolean {
	if (--budget.remaining < 0)
		throw new Error("Rules exceed the evaluation operation limit");
	if (depth > MAX_DEPTH) throw new Error("Rule nesting exceeds the limit");
	const next = (c: RuleCondition, s = scope) =>
		evaluateCondition(c, s, root, depth + 1, budget);
	if ("conforms" in condition) {
		if (!budget.validateFormat)
			throw new Error("Format rules require the library validator");
		return budget.validateFormat(condition.conforms, scope);
	}
	if ("all" in condition) return condition.all.every((c) => next(c));
	if ("any" in condition) return condition.any.some((c) => next(c));
	if ("not" in condition) return !next(condition.not);
	if ("compare" in condition) {
		const left = operandValue(condition.compare.left, scope, root),
			right = operandValue(condition.compare.right, scope, root);
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
		const keys = union(scope, root, condition.distinct).map((item) =>
			key(item, condition.by, root),
		);
		return new Set(keys).size === keys.length;
	}
	if ("sameLength" in condition) {
		const expected = length(resolve(scope, root, condition.sameLength.as));
		return (
			expected !== undefined &&
			list(resolve(scope, root, condition.sameLength.items)).every(
				(item) => length(item) === expected,
			)
		);
	}
	if ("lookup" in condition) {
		const selected = list(
			resolve(scope, root, condition.lookup.collection),
		).filter((item) =>
			same(
				resolve(item, root, condition.lookup.key),
				resolve(scope, root, condition.lookup.value),
			),
		);
		return (
			selected.length === 1 &&
			next(condition.require, { item: scope, match: selected[0] })
		);
	}
	if ("text" in condition) {
		const value = resolve(scope, root, condition.text.path);
		if (typeof value !== "string") return false;
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
	if ("each" in condition)
		return list(resolve(scope, root, condition.each))
			.filter((item) => !condition.where || next(condition.where, item))
			.every((item) => next(condition.require, item));
	if ("some" in condition)
		return list(resolve(scope, root, condition.some))
			.filter((item) => !condition.where || next(condition.where, item))
			.some((item) => next(condition.require, item));
	if ("count" in condition) {
		const total = list(resolve(scope, root, condition.count)).filter(
			(item) => !condition.where || next(condition.where, item),
		).length;
		const min =
			condition.min === undefined
				? undefined
				: operandValue(condition.min, scope, root);
		const max =
			condition.max === undefined
				? undefined
				: operandValue(condition.max, scope, root);
		if (condition.min !== undefined && (min === undefined || total < min))
			return false;
		if (condition.max !== undefined && (max === undefined || total > max))
			return false;
		return true;
	}
	const value = resolve(scope, root, condition.path);
	if (
		condition.equalsPath !== undefined &&
		!same(value, resolve(scope, root, condition.equalsPath))
	)
		return false;
	if (condition.maxItem !== undefined) {
		const maximum = operandValue(condition.maxItem, scope, root);
		if (
			maximum === undefined ||
			!Array.isArray(value) ||
			value.some((item) => typeof item !== "number" || item > maximum)
		)
			return false;
	}
	if (Object.hasOwn(condition, "equals") && !same(value, condition.equals))
		return false;
	if (Object.hasOwn(condition, "notEquals") && same(value, condition.notEquals))
		return false;
	if (condition.in && !condition.in.some((option) => same(value, option)))
		return false;
	if (
		condition.exists !== undefined &&
		(value !== undefined) !== condition.exists
	)
		return false;
	if (condition.empty !== undefined && isEmpty(value) !== condition.empty)
		return false;
	for (const [bound, compare] of [
		["minLength", (a: number, b: number) => a >= b],
		["maxLength", (a: number, b: number) => a <= b],
	] as const) {
		const limit = condition[bound];
		if (limit === undefined) continue;
		const size = length(value);
		const target = operandValue(limit, scope, root);
		if (size === undefined || target === undefined || !compare(size, target))
			return false;
	}
	for (const [bound, compare] of [
		["min", (a: number, b: number) => a >= b],
		["max", (a: number, b: number) => a <= b],
	] as const) {
		const limit = condition[bound];
		if (limit === undefined) continue;
		const target = operandValue(limit, scope, root);
		if (
			typeof value !== "number" ||
			target === undefined ||
			!compare(value, target)
		)
			return false;
	}
	if (condition.unique) {
		const keys = list(value).map((item) => key(item, condition.by, root));
		if (new Set(keys).size !== keys.length) return false;
	}
	if (condition.within !== undefined) {
		const allowed = new Set(
			union(scope, root, condition.within).map((item) => canonical(item)),
		);
		const values = Array.isArray(value)
			? value
			: value === undefined
				? []
				: [value];
		if (values.some((item) => !allowed.has(key(item, condition.by, root))))
			return false;
	}
	if (condition.disjoint !== undefined) {
		const prohibited = new Set(
			union(scope, root, condition.disjoint).map(canonical),
		);
		const selected = Array.isArray(value)
			? value
			: value === undefined
				? []
				: [value];
		if (selected.some((item) => prohibited.has(key(item, condition.by, root))))
			return false;
	}
	return true;
}

/** Evaluate rules after schema validation; returns every violated rule. */
export function evaluateRules(
	rules: readonly Rule[] | undefined,
	document: unknown,
	validateFormat?: (format: string, value: unknown) => boolean,
): RuleIssue[] {
	const budget = { remaining: 100_000, validateFormat };
	const issues: RuleIssue[] = [];
	for (const rule of rules ?? []) {
		if (
			rule.when &&
			!evaluateCondition(rule.when, document, document, 0, budget)
		)
			continue;
		if (!evaluateCondition(rule.require, document, document, 0, budget))
			issues.push({
				path: rule.path ?? "/",
				message: rule.message,
				...(rule.id ? { rule: rule.id } : {}),
			});
	}
	return issues;
}
