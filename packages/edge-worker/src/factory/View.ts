import { z } from "zod";
import {
	foreachPointer,
	foreachPointerSchema,
	sanitizeJsonConfiguration,
} from "./Foreach.js";
import {
	QuestionChoicesSchema,
	QuestionRecommendationSchema,
} from "./Questions.js";

/** Views are display data. Neither a component ID nor an action label grants authority. */
export const VIEW_VERSION = "view-v1" as const;
export const VIEW_LIMITS = {
	components: 40,
	items: 100,
	mapFields: 20,
	paths: 500,
	pathDepth: 8,
	text: 64_000,
} as const;

const text = (max: number) => z.string().min(1).max(max);
export const viewIdSchema = z
	.string()
	.regex(/^[a-zA-Z0-9_-][a-zA-Z0-9._-]{0,79}$/)
	.refine(
		(value) => !["__proto__", "prototype", "constructor"].includes(value),
		"Reserved JSON key cannot be an ID",
	);
const id = viewIdSchema;
const hash = z.string().regex(/^[a-f0-9]{64}$/, "Expected a SHA-256 digest");
const line = z.number().int().min(1).max(10_000_000);

/** Bind only explicitly declared reads and the current lexical For each item. */
export const viewPointerSchema = foreachPointerSchema.refine(
	(path) =>
		/^\/(?:inputs|item|index)(?:\/|$)/.test(path) && !/\p{Cc}/u.test(path),
	"View paths must start with /inputs, /item or /index",
);

function safeJson(value: unknown, context: z.RefinementCtx): unknown {
	try {
		return sanitizeJsonConfiguration(value);
	} catch (error) {
		context.addIssue({
			code: "custom",
			message: `Invalid view JSON: ${error instanceof Error ? error.message : "expected plain JSON data"}`,
		});
		return z.NEVER;
	}
}

const bindingSchema = z.union([
	z
		.object({
			literal: z
				.unknown()
				.refine(
					(value) => value !== undefined,
					"Literal binding requires JSON data",
				),
		})
		.strict(),
	z
		.object({ path: viewPointerSchema, format: z.literal("json").optional() })
		.strict(),
]);
export const ViewBindingSchema = z.preprocess(safeJson, bindingSchema);
export type ViewBinding = z.infer<typeof ViewBindingSchema>;

/** One flat object per source item; an empty pointer reads the item itself. */
const collectionBindingSchema = z
	.object({
		from: viewPointerSchema,
		map: z
			.record(
				viewIdSchema,
				foreachPointerSchema
					.refine((path) => !/\p{Cc}/u.test(path), "Invalid view item pointer")
					.describe("JSON Pointer relative to each item; empty reads the item"),
			)
			.refine(
				(fields) =>
					Object.keys(fields).length > 0 &&
					Object.keys(fields).length <= VIEW_LIMITS.mapFields,
				"View projections require 1–20 map fields",
			),
	})
	.strict()
	.describe(
		"Project at most 100 declared items to flat objects using field pointers",
	);
const componentFieldBindingSchema = z.union([
	...bindingSchema.options,
	collectionBindingSchema,
]);
export interface ViewScope {
	inputs?: Record<string, unknown>;
	item?: unknown;
	index?: number;
}

/** External links are click-only display links, never media or server-side fetches. */
export const viewUrlSchema = z
	.string()
	.max(2000)
	.url()
	.refine((value) => {
		if (/[\s\p{Cc}\\]/u.test(value)) return false;
		try {
			const url = new URL(value);
			return (
				(url.protocol === "http:" || url.protocol === "https:") &&
				!url.username &&
				!url.password
			);
		} catch {
			return false;
		}
	}, "View links must use HTTP(S) without credentials");

const fileSchema = text(400).refine(
	(value) =>
		!/^[/~]/.test(value) &&
		!/[\\:\p{Cc}]/u.test(value) &&
		value
			.split("/")
			.every((part) => part && ![".", "..", ".git"].includes(part)),
	"Code references must use a repository-relative file path",
);
const details = z
	.array(z.object({ label: text(160), value: text(4000) }).strict())
	.max(20);
const option = z.object({ id, label: text(200) }).strict();
const uniqueIds = (items: { id: string }[]) =>
	new Set(items.map((item) => item.id)).size === items.length;
const fieldBase = { id, label: text(200), required: z.boolean().optional() };
const formField = z.discriminatedUnion("type", [
	z
		.object({
			...fieldBase,
			type: z.literal("text"),
			value: z.string().max(4000).optional(),
		})
		.strict(),
	z
		.object({
			...fieldBase,
			type: z.literal("textarea"),
			value: z.string().max(4000).optional(),
		})
		.strict(),
	z
		.object({
			...fieldBase,
			type: z.literal("checkbox"),
			value: z.boolean().optional(),
		})
		.strict(),
	z
		.object({
			...fieldBase,
			type: z.literal("select"),
			options: z
				.array(option)
				.min(1)
				.max(30)
				.refine(uniqueIds, "Choice option IDs must be unique"),
			value: id.optional(),
		})
		.strict()
		.refine(
			(field) =>
				field.value === undefined ||
				field.options.some((option) => option.id === field.value),
			"Choice value must name a declared option",
		),
]);
export const ViewRunStatusSchema = z.enum([
	"pending",
	"queued",
	"running",
	"waiting",
	"paused",
	"completed",
	"failed",
	"cancelled",
	"stopped",
	"launched",
	"merged",
	"blocked",
	"uncertain",
]);

/** No filesystem paths or remote media URLs. The owner verifies refs in its run inventory. */
export const viewDataSchemas = {
	questions: z
		.object({
			questions: z.array(text(16000)).min(1).max(100),
			questionChoices: z.array(QuestionChoicesSchema).max(100).optional(),
			questionRecommendations: z
				.array(QuestionRecommendationSchema)
				.max(100)
				.optional(),
		})
		.strict(),
	"checkin-section": z
		.object({
			section: z.enum([
				"since",
				"understood",
				"plan",
				"notice",
				"open",
				"check-0",
				"check-1",
				"check-2",
				"size",
				"limits",
				"notes",
			]),
			proposalId: text(100),
			digest: hash,
			text: z.string().max(64000),
		})
		.strict(),
	"review-guide": z
		.object({
			source: text(500),
			digest: hash,
			text: z.string().max(64000),
		})
		.strict(),
	markdown: z.object({ text: text(16_000) }).strict(),
	checklist: z
		.object({
			items: z
				.array(
					z
						.object({
							label: text(200),
							detail: text(2000).optional(),
							state: z.enum(["done", "partly", "open"]),
						})
						.strict(),
				)
				.max(VIEW_LIMITS.items),
		})
		.strict(),
	beforeAfter: z
		.object({
			before: text(8000),
			after: text(8000),
			note: text(2000).optional(),
		})
		.strict(),
	chart: z
		.object({
			kind: z.enum(["bar", "line"]),
			series: z
				.array(
					z.object({ label: text(200), value: z.number().finite() }).strict(),
				)
				.max(VIEW_LIMITS.items),
			unit: text(80).optional(),
		})
		.strict(),
	screenshots: z
		.object({
			items: z
				.array(
					z
						.object({
							index: z.number().int().min(0).max(999),
							sha256: hash,
							alt: text(500),
							caption: text(2000).optional(),
						})
						.strict(),
				)
				.max(12),
		})
		.strict(),
	video: z
		.object({
			taskId: id,
			sha256: hash,
			label: text(200),
			transcript: text(16_000),
		})
		.strict(),
	table: z
		.object({
			columns: z.array(text(160)).min(1).max(12),
			rows: z
				.array(
					z
						.array(
							z.union([
								z.string().max(2000),
								z.number().finite(),
								z.boolean(),
								z.null(),
							]),
						)
						.min(1)
						.max(12),
				)
				.max(VIEW_LIMITS.items),
		})
		.strict()
		.refine(
			(table) => table.rows.every((row) => row.length === table.columns.length),
			"Table rows must match the column count",
		),
	code: z
		.object({
			file: fileSchema,
			excerpt: z.string().max(16_000).optional(),
			language: z
				.string()
				.regex(/^[a-zA-Z0-9+#.-]{1,40}$/)
				.optional(),
			startLine: line.optional(),
			endLine: line.optional(),
		})
		.strict()
		.refine(
			(code) =>
				code.endLine === undefined ||
				(code.startLine !== undefined && code.endLine >= code.startLine),
			"Code end line requires an ordered start line",
		),
	steps: z
		.object({
			items: z
				.array(
					z
						.object({
							label: text(200),
							detail: text(2000).optional(),
							status: z
								.enum(["pending", "running", "completed", "failed", "skipped"])
								.optional(),
						})
						.strict(),
				)
				.max(VIEW_LIMITS.items),
		})
		.strict(),
	points: z
		.object({
			items: z
				.array(
					z
						.object({
							label: text(200),
							detail: text(2000).optional(),
							url: viewUrlSchema.optional(),
						})
						.strict(),
				)
				.max(VIEW_LIMITS.items),
		})
		.strict(),
	itemCards: z
		.object({
			items: z
				.array(
					z
						.object({
							id,
							title: text(300),
							body: text(8000).optional(),
							details: details.optional(),
						})
						.strict(),
				)
				.max(VIEW_LIMITS.items)
				.refine(uniqueIds, "Item card IDs must be unique"),
		})
		.strict(),
	choices: z
		.object({
			fields: z
				.array(formField)
				.min(1)
				.max(20)
				.refine(uniqueIds, "Form field IDs must be unique"),
		})
		.strict(),
	runList: z
		.object({
			waves: z
				.array(
					z
						.object({
							id,
							label: text(200).optional(),
							runs: z
								.array(
									z
										.object({
											id,
											title: text(300),
											status: ViewRunStatusSchema,
											note: text(2000).optional(),
										})
										.strict(),
								)
								.max(VIEW_LIMITS.items)
								.refine(uniqueIds, "Run IDs in a wave must be unique"),
						})
						.strict(),
				)
				.max(20)
				.refine(uniqueIds, "Wave IDs must be unique"),
		})
		.strict()
		.refine(
			(data) =>
				data.waves.reduce((count, wave) => count + wave.runs.length, 0) <=
				VIEW_LIMITS.items,
			"Run lists allow at most 100 children in total",
		)
		.refine(
			(data) => uniqueIds(data.waves.flatMap((wave) => wave.runs)),
			"Run IDs must be unique across all waves",
		),
	decisionBar: z
		.object({
			summary: text(2000).optional(),
			actions: z
				.array(option)
				.min(1)
				.max(12)
				.refine(uniqueIds, "Decision action IDs must be unique"),
		})
		.strict(),
};

function component<T extends string, D extends z.ZodObject>(
	type: T,
	dataSchema: D,
) {
	return z
		.object({
			id,
			type: z.literal(type),
			title: text(200).optional(),
			data: z.union([
				z.object({ literal: dataSchema }).strict(),
				z.object({ path: viewPointerSchema }).strict(),
				z
					.object({
						bindings: z.partialRecord(
							dataSchema.keyof(),
							componentFieldBindingSchema,
						),
					})
					.strict()
					.describe(
						"Bind component schema fields individually; resolved data is validated normally",
					),
			]),
		})
		.strict();
}
function resolvedComponent<T extends string, D extends z.ZodObject>(
	type: T,
	dataSchema: D,
) {
	return component(type, dataSchema).extend({ data: dataSchema });
}
const components = z.discriminatedUnion("type", [
	component("questions", viewDataSchemas.questions),
	component("checkin-section", viewDataSchemas["checkin-section"]),
	component("review-guide", viewDataSchemas["review-guide"]),
	component("markdown", viewDataSchemas.markdown),
	component("checklist", viewDataSchemas.checklist),
	component("beforeAfter", viewDataSchemas.beforeAfter),
	component("chart", viewDataSchemas.chart),
	component("screenshots", viewDataSchemas.screenshots),
	component("video", viewDataSchemas.video),
	component("table", viewDataSchemas.table),
	component("code", viewDataSchemas.code),
	component("steps", viewDataSchemas.steps),
	component("points", viewDataSchemas.points),
	component("itemCards", viewDataSchemas.itemCards),
	component("choices", viewDataSchemas.choices),
	component("runList", viewDataSchemas.runList),
	component("decisionBar", viewDataSchemas.decisionBar),
]);
const resolvedComponents = z.discriminatedUnion("type", [
	resolvedComponent("questions", viewDataSchemas.questions),
	resolvedComponent("checkin-section", viewDataSchemas["checkin-section"]),
	resolvedComponent("review-guide", viewDataSchemas["review-guide"]),
	resolvedComponent("markdown", viewDataSchemas.markdown),
	resolvedComponent("checklist", viewDataSchemas.checklist),
	resolvedComponent("beforeAfter", viewDataSchemas.beforeAfter),
	resolvedComponent("chart", viewDataSchemas.chart),
	resolvedComponent("screenshots", viewDataSchemas.screenshots),
	resolvedComponent("video", viewDataSchemas.video),
	resolvedComponent("table", viewDataSchemas.table),
	resolvedComponent("code", viewDataSchemas.code),
	resolvedComponent("steps", viewDataSchemas.steps),
	resolvedComponent("points", viewDataSchemas.points),
	resolvedComponent("itemCards", viewDataSchemas.itemCards),
	resolvedComponent("choices", viewDataSchemas.choices),
	resolvedComponent("runList", viewDataSchemas.runList),
	resolvedComponent("decisionBar", viewDataSchemas.decisionBar),
]);
export const ViewReadsSchema = z.record(
	viewIdSchema,
	z
		.string()
		.min(1)
		.max(500)
		.refine(
			(value) =>
				value === "@human" ||
				value === "@callInputs" ||
				value.startsWith("@callInputs/") ||
				/^[a-zA-Z0-9_-]+(?:\/[^\p{Cc}]+)*$/u.test(value),
			"Views may read public human data, call inputs or declared ordinary outputs",
		),
);
const definitionSchema = z
	.object({
		version: z.literal(VIEW_VERSION),
		preset: z.enum(["ask", "approve", "review", "external-review"]).optional(),
		reads: ViewReadsSchema.optional(),
		components: z
			.array(components)
			.min(1)
			.max(VIEW_LIMITS.components)
			.refine(uniqueIds, "Component IDs must be unique"),
	})
	.strict()
	.refine(
		(view) =>
			uniqueIds(
				view.components.flatMap((component) =>
					component.type === "choices" && "literal" in component.data
						? component.data.literal.fields
						: [],
				),
			),
		"Form field IDs must be unique across components",
	);
export const ViewSchema = z.preprocess(safeJson, definitionSchema);
export const ViewSourceSchema = z.preprocess(
	safeJson,
	z.union([definitionSchema, z.object({ from: viewPointerSchema }).strict()]),
);
export const ResolvedViewSchema = z.preprocess(
	safeJson,
	z
		.object({
			version: z.literal(VIEW_VERSION),
			preset: z
				.enum(["ask", "approve", "review", "external-review"])
				.optional(),
			components: z
				.array(resolvedComponents)
				.min(1)
				.max(VIEW_LIMITS.components)
				.refine(uniqueIds, "Component IDs must be unique"),
		})
		.strict()
		.refine(
			(view) =>
				uniqueIds(
					view.components.flatMap((component) =>
						component.type === "choices" ? component.data.fields : [],
					),
				),
			"Form field IDs must be unique across components",
		),
);
export type ViewDefinition = z.infer<typeof ViewSchema>;
export type ViewSource = z.infer<typeof ViewSourceSchema>;
export type ResolvedView = z.infer<typeof ResolvedViewSchema>;
export type ViewComponent = ResolvedView["components"][number];

/** Editor documentation; semantic refinements are enforced by ViewSchema on every save/render. */
export const VIEW_JSON_SCHEMA = z.toJSONSchema(definitionSchema, {
	unrepresentable: "any",
});

function acceptedScope(scope: ViewScope): Record<string, unknown> {
	if (!scope || typeof scope !== "object" || Array.isArray(scope))
		throw new Error("View scope must be a plain object");
	const prototype = Object.getPrototypeOf(scope);
	if (prototype !== null && prototype !== Object.prototype)
		throw new Error("View scope must be a plain object");
	const descriptors = Object.getOwnPropertyDescriptors(scope);
	const accepted: Record<string, unknown> = { inputs: {} };
	for (const key of ["inputs", "item", "index"] as const) {
		const descriptor = descriptors[key];
		if (!descriptor) continue;
		if (!("value" in descriptor))
			throw new Error("View scope cannot contain accessors");
		if (descriptor.value !== undefined) accepted[key] = descriptor.value;
	}
	const sanitized = sanitizeJsonConfiguration(accepted) as Record<
		string,
		unknown
	>;
	if (
		!sanitized.inputs ||
		typeof sanitized.inputs !== "object" ||
		Array.isArray(sanitized.inputs)
	)
		throw new Error("View inputs must be a declared-read object");
	if (
		sanitized.index !== undefined &&
		(!Number.isSafeInteger(sanitized.index) || (sanitized.index as number) < 0)
	)
		throw new Error("View index must be a non-negative safe integer");
	return sanitized;
}

/** Returned values are detached snapshots; neither binding nor caller-owned data is mutated. */
export function bindingValue(binding: ViewBinding, scope: ViewScope): unknown {
	const parsed = ViewBindingSchema.parse(binding);
	return "literal" in parsed
		? parsed.literal
		: boundValue(parsed, acceptedScope(scope));
}

function boundValue(
	binding: z.infer<typeof bindingSchema>,
	accepted: Record<string, unknown>,
) {
	if ("literal" in binding) return binding.literal;
	const value = foreachPointer(accepted, binding.path);
	return binding.format === "json" ? JSON.stringify(value, null, 2) : value;
}

/** The caller has sanitized the definition and accepted only public lexical inputs. */
function componentFieldValue(
	binding: z.infer<typeof componentFieldBindingSchema>,
	accepted: Record<string, unknown>,
): unknown {
	if ("literal" in binding || "path" in binding)
		return boundValue(binding, accepted);
	const items = foreachPointer(accepted, binding.from);
	if (!Array.isArray(items))
		throw new Error("View projection source must be an array");
	if (items.length > VIEW_LIMITS.items)
		throw new Error("View projections allow at most 100 items");
	return items.map((item) =>
		Object.fromEntries(
			Object.entries(binding.map).map(([field, path]) => [
				field,
				foreachPointer(item, path),
			]),
		),
	);
}

/** Save and render use the same schemas, including data produced by an agent. */
export function resolveView(
	source: ViewSource,
	scope: ViewScope,
): ResolvedView {
	const parsed = ViewSourceSchema.parse(source);
	const accepted = acceptedScope(scope);
	const definition =
		"from" in parsed
			? ViewSchema.parse(foreachPointer(accepted, parsed.from))
			: parsed;
	return ResolvedViewSchema.parse({
		version: VIEW_VERSION,
		...(definition.preset ? { preset: definition.preset } : {}),
		components: definition.components.map((component) => ({
			...component,
			data:
				"literal" in component.data || "path" in component.data
					? boundValue(component.data, accepted)
					: Object.fromEntries(
							Object.entries(component.data.bindings).map(
								([field, binding]) => [
									field,
									componentFieldValue(binding!, accepted),
								],
							),
						),
		})),
	});
}

/** Bounded discovery reveals only the scope the caller explicitly supplied as declared reads. */
export function availableViewPaths(scope: ViewScope): string[] {
	const root = acceptedScope(scope);
	const paths: string[] = [];
	function visit(value: unknown, path: string, depth: number) {
		if (paths.length >= VIEW_LIMITS.paths || path.length > 400) return;
		paths.push(path);
		if (!value || typeof value !== "object" || depth >= VIEW_LIMITS.pathDepth)
			return;
		for (const key of Object.keys(value)) {
			if (paths.length >= VIEW_LIMITS.paths) break;
			const child = `${path}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`;
			if (viewPointerSchema.safeParse(child).success)
				visit((value as Record<string, unknown>)[key], child, depth + 1);
		}
	}
	for (const key of Object.keys(root)) visit(root[key], `/${key}`, 0);
	return paths;
}

/** Safe in ticket Markdown and terminal output: no HTML, Markdown links or terminal escapes. */
export function viewPlainText(value: string): string {
	return value
		.replace(/[\p{Cc}\u202a-\u202e\u2066-\u2069]/gu, (character) =>
			character === "\n" || character === "\t"
				? character
				: `[U+${character.charCodeAt(0).toString(16).padStart(4, "0").toUpperCase()}]`,
		)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/([\\`*_{}[\]()#+.!|~:-])/g, "\\$1");
}

/** Every component has a useful, inert fallback for tickets, terminal clients and notifications. */
export function viewText(view: ResolvedView): string {
	const accepted = ResolvedViewSchema.parse(view);
	const s = viewPlainText;
	const blocks: string[] = [];
	for (const component of accepted.components) {
		const lines = [component.title ? s(component.title) : `${component.type}:`];
		switch (component.type) {
			case "questions":
				component.data.questions.forEach((question, index) => {
					lines.push(`${index + 1}. ${s(question)}`);
					for (const choices of component.data.questionChoices ?? [])
						if (choices.questionIndex === index)
							for (const option of choices.options)
								lines.push(
									`${s(option.id)}: ${s(option.answer)}${option.reason ? ` — ${s(option.reason)}` : ""}`,
								);
					for (const recommendation of component.data.questionRecommendations ??
						[])
						if (recommendation.questionIndex === index)
							lines.push(
								`Recommendation (requires explicit submission): ${s(recommendation.answer)} — ${s(recommendation.reason)}`,
							);
				});
				lines.push(
					"Custom answers are available. Defaults never submit themselves.",
				);
				break;
			case "checkin-section":
			case "review-guide":
				lines.push(s(component.data.text));
				break;
			case "markdown":
				lines.push(s(component.data.text));
				break;
			case "checklist":
				for (const item of component.data.items)
					lines.push(
						`- [${item.state === "done" ? "x" : item.state === "partly" ? "~" : " "}] ${s(item.label)}${item.detail ? ` — ${s(item.detail)}` : ""}`,
					);
				if (!component.data.items.length) lines.push("No checklist items.");
				break;
			case "beforeAfter":
				lines.push(
					`Before: ${s(component.data.before)}`,
					`After: ${s(component.data.after)}`,
					...(component.data.note ? [s(component.data.note)] : []),
				);
				break;
			case "chart":
				lines.push(
					`${component.data.kind === "bar" ? "Bar" : "Line"} chart${component.data.unit ? ` (${s(component.data.unit)})` : ""}`,
				);
				for (const point of component.data.series)
					lines.push(`- ${s(point.label)}: ${point.value}`);
				if (!component.data.series.length) lines.push("No chart data.");
				break;
			case "screenshots":
				for (const shot of component.data.items)
					lines.push(
						`- Screenshot ${shot.index + 1}: ${s(shot.alt)}${shot.caption ? ` — ${s(shot.caption)}` : ""} (SHA-256 ${shot.sha256})`,
					);
				if (!component.data.items.length) lines.push("No screenshots.");
				break;
			case "video":
				lines.push(
					`Video: ${s(component.data.label)} (SHA-256 ${component.data.sha256})`,
					`Transcript: ${s(component.data.transcript)}`,
				);
				break;
			case "table":
				for (const row of component.data.rows)
					lines.push(
						row
							.map(
								(cell, index) =>
									`${s(component.data.columns[index]!)}: ${s(cell === null ? "—" : String(cell))}`,
							)
							.join("; "),
					);
				if (!component.data.rows.length)
					lines.push(
						`No rows. Columns: ${component.data.columns.map(s).join(", ")}`,
					);
				break;
			case "code":
				lines.push(
					`File: ${s(component.data.file)}${component.data.startLine ? `, line ${component.data.startLine}${component.data.endLine ? `–${component.data.endLine}` : ""}` : ""}`,
					...(component.data.language
						? [`Language: ${s(component.data.language)}`]
						: []),
					...(component.data.excerpt !== undefined
						? [s(component.data.excerpt)]
						: []),
				);
				break;
			case "steps":
				for (const [index, step] of component.data.items.entries())
					lines.push(
						`${index + 1}. ${s(step.label)}${step.status ? ` [${step.status}]` : ""}${step.detail ? ` — ${s(step.detail)}` : ""}`,
					);
				if (!component.data.items.length) lines.push("No steps.");
				break;
			case "points":
				for (const point of component.data.items)
					lines.push(
						`- ${s(point.label)}${point.detail ? ` — ${s(point.detail)}` : ""}${point.url ? ` (${s(point.url)})` : ""}`,
					);
				if (!component.data.items.length) lines.push("No points.");
				break;
			case "itemCards":
				for (const item of component.data.items) {
					lines.push(
						`${s(item.id)}: ${s(item.title)}`,
						...(item.body ? [s(item.body)] : []),
					);
					for (const detail of item.details ?? [])
						lines.push(`  ${s(detail.label)}: ${s(detail.value)}`);
				}
				if (!component.data.items.length) lines.push("No items to decide.");
				break;
			case "choices":
				for (const field of component.data.fields) {
					lines.push(
						`${s(field.label)} (${s(field.id)}, ${field.type}${field.required ? ", required" : ", optional"})${field.value !== undefined ? `: ${s(String(field.value))}` : ""}`,
					);
					if (field.type === "select")
						for (const option of field.options)
							lines.push(`  - ${s(option.id)}: ${s(option.label)}`);
				}
				break;
			case "runList":
				for (const wave of component.data.waves) {
					lines.push(`Wave ${s(wave.label ?? wave.id)}:`);
					for (const run of wave.runs)
						lines.push(
							`- ${s(run.id)}: ${s(run.title)} [${run.status}]${run.note ? ` — ${s(run.note)}` : ""}`,
						);
					if (!wave.runs.length) lines.push("No child runs in this wave.");
				}
				if (!component.data.waves.length) lines.push("No child runs.");
				break;
			case "decisionBar":
				lines.push(
					...(component.data.summary ? [s(component.data.summary)] : []),
					`Available actions: ${component.data.actions.map((action) => `${s(action.id)} (${s(action.label)})`).join(", ")}`,
				);
				break;
		}
		blocks.push(lines.join("\n"));
	}
	const result = blocks.join("\n\n");
	return result.length <= VIEW_LIMITS.text
		? result
		: `${result.slice(0, VIEW_LIMITS.text)}\n[View truncated; open the dashboard for all displayed content.]`;
}
