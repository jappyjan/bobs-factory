import { z } from "zod";
import { foreachPointer } from "./Foreach.js";
import type { Rule } from "./Rules.js";
import {
	components,
	definitionSchema,
	type ResolvedView,
	ResolvedViewSchema,
	resolveView,
	type ViewComponent,
	ViewSchema,
	type ViewScope,
	type ViewSource,
	viewDataSchemas,
	viewPointerSchema,
} from "./View.js";

export const DISPLAY_COMPONENTS = [
	"markdown",
	"points",
	"checklist",
	"table",
	"chart",
	"beforeAfter",
	"steps",
	"code",
	"screenshots",
	"video",
	"itemCards",
	"form",
	"actions",
	"runList",
	"section",
	"codeTour",
] as const;

/** One bounded component tree; IDs identify controls across nested sections. */
export function displayComponents(view: ResolvedView): ViewComponent[] {
	const result: ViewComponent[] = [];
	function visit(list: ViewComponent[], depth: number) {
		if (depth > 8)
			throw new Error("Display sections allow at most eight nesting levels");
		for (const component of list) {
			if (result.length >= 40)
				throw new Error(
					"A display allows at most 40 components including nested sections",
				);
			if (!(DISPLAY_COMPONENTS as readonly string[]).includes(component.type))
				throw new Error(`Unknown display component: ${component.type}`);
			result.push(component);
			if (component.type === "section")
				visit(
					ResolvedViewSchema.parse({
						version: "view-v1",
						components: component.data.components,
					}).components,
					depth + 1,
				);
		}
	}
	visit(view.components, 0);
	return result;
}
function validateResolved(view: ResolvedView) {
	const list = displayComponents(view);
	const unique = (ids: string[], label: string) => {
		if (ids.length > 100)
			throw new Error(`A display allows at most 100 ${label}s`);
		if (new Set(ids).size !== ids.length)
			throw new Error(`Display ${label} IDs must be unique`);
	};
	unique(
		list.map((c) => c.id),
		"component",
	);
	unique(
		list.flatMap((c) =>
			c.type === "form" ? c.data.fields.map((f) => f.id) : [],
		),
		"field",
	);
	unique(
		list.flatMap((c) =>
			c.type === "itemCards"
				? c.data.items.map((i) => i.id)
				: c.type === "codeTour"
					? c.data.files.flatMap((f) => f.notes.map((n) => n.id))
					: [],
		),
		"item",
	);
	if (list.filter((c) => c.type === "actions").length > 1)
		throw new Error("A display has one document action bar");
	return view;
}
function validateDefinition(view: z.infer<typeof ViewSchema>) {
	let count = 0;
	const ids = new Set<string>();
	function visit(list: typeof view.components, depth: number) {
		if (depth > 8)
			throw new Error("Display sections allow at most eight nesting levels");
		for (const c of list) {
			if (++count > 40)
				throw new Error("A display allows at most 40 components");
			if (!(DISPLAY_COMPONENTS as readonly string[]).includes(c.type))
				throw new Error(`Unknown display component: ${c.type}`);
			if (ids.has(c.id))
				throw new Error("Display component IDs must be unique");
			ids.add(c.id);
			if (c.type === "section" && "literal" in c.data)
				visit(z.array(components).parse(c.data.literal.components), depth + 1);
		}
	}
	visit(view.components, 0);
	return view;
}
function checked<T>(check: (value: T) => unknown) {
	return (value: T, ctx: z.RefinementCtx) => {
		try {
			check(value);
		} catch (e) {
			ctx.addIssue({
				code: "custom",
				message: e instanceof Error ? e.message : "Invalid display document",
			});
		}
	};
}
export const DisplayDocumentSchema = ViewSchema.superRefine(
	checked(validateDefinition),
);
export const ResolvedDisplayDocumentSchema = ResolvedViewSchema.superRefine(
	checked(validateResolved),
);
export const DisplaySourceSchema = z.union([
	DisplayDocumentSchema,
	z.object({ from: viewPointerSchema }).strict(),
]);
export type DisplayDocument = z.infer<typeof DisplayDocumentSchema>;
export const DISPLAY_JSON_SCHEMA = z.toJSONSchema(
	z
		.object({
			version: definitionSchema.shape.version,
			reads: definitionSchema.shape.reads,
			components: z
				.array(
					z.union([
						components.options[0],
						...components.options
							.slice(1)
							.filter((c) =>
								(DISPLAY_COMPONENTS as readonly string[]).includes(
									c.shape.type.value,
								),
							),
					]),
				)
				.min(1)
				.max(40),
		})
		.strict(),
	{ unrepresentable: "any" },
);

type JsonSchemaNode = {
	type?: string;
	const?: unknown;
	enum?: unknown[];
	anyOf?: JsonSchemaNode[];
	oneOf?: JsonSchemaNode[];
	items?: JsonSchemaNode;
	properties?: Record<string, JsonSchemaNode>;
	required?: string[];
};
function shape(node: JsonSchemaNode): string {
	const variants = node.anyOf ?? node.oneOf;
	if (variants) return [...new Set(variants.map(shape))].join(" | ");
	if ("const" in node) return JSON.stringify(node.const);
	if (node.enum) return node.enum.map((v) => JSON.stringify(v)).join(" | ");
	if (node.properties)
		return `{${Object.entries(node.properties)
			.map(
				([key, value]) =>
					`${key}${node.required?.includes(key) ? "" : "?"}: ${shape(value)}`,
			)
			.join(", ")}}`;
	if (node.type === "array")
		return `[${node.items ? shape(node.items) : "any"}]`;
	return node.type ?? "any";
}

/** Exact author-facing data contract, generated from the validators so it cannot drift. */
export const DISPLAY_CONTRACT = [
	'Display document: {version: "view-v1", components: [{id, type, title?, data: {literal: <data>}}]} with 1-40 components and unique IDs (letters, digits, "-", "_", "."). Every object is strict: unknown keys (such as placeholder or a title inside data) are rejected, and a component title belongs on the component, not in data. <data> per type:',
	...DISPLAY_COMPONENTS.map(
		(type) =>
			`- ${type}: ${shape(z.toJSONSchema(viewDataSchemas[type], { unrepresentable: "any", io: "input" }) as JsonSchemaNode)}`,
	),
].join("\n");

/** Agent-authored displays are corrected by the agent, with the validator's errors, instead of failing the run. */
export const DISPLAY_RULE_ID = "display-contract";
export function displayContractRule(path = "/display"): Rule {
	return {
		id: DISPLAY_RULE_ID,
		message: `${path} must follow the display contract`,
		path,
		when: { path, exists: true },
		require: { conforms: "display", path },
	};
}

export function resolveDisplayDocument(
	source: ViewSource,
	scope: ViewScope,
): ResolvedView {
	const definition =
		"from" in source ? foreachPointer(scope, source.from) : source;
	DisplayDocumentSchema.parse(definition);
	return ResolvedDisplayDocumentSchema.parse(resolveView(source, scope));
}
export function displayInteractive(view: ResolvedView): boolean {
	return displayComponents(view).some(
		(c) =>
			c.type === "form" ||
			c.type === "actions" ||
			(c.type === "itemCards" &&
				!!(c.data.actions?.length || c.data.comment || c.data.ask)) ||
			(c.type === "codeTour" && !!c.data.comment),
	);
}
export function displayItems(view: ResolvedView) {
	return displayComponents(view).flatMap((c) =>
		c.type === "itemCards"
			? c.data.items.map((item) => ({
					id: item.id,
					title: item.title,
					...(item.body ? { body: item.body } : {}),
					details: item.details ?? [],
					value: item.value === undefined ? item : item.value,
				}))
			: c.type === "codeTour" && c.data.comment
				? c.data.files.flatMap((file) =>
						file.notes.map((note) => ({
							id: note.id,
							title: `${file.path}:${note.line}`,
							body: note.text,
							details: [],
							value: note,
						})),
					)
				: [],
	);
}
export function displayAsk(view: ResolvedView, itemId: string) {
	return displayComponents(view).find(
		(c) =>
			c.type === "itemCards" &&
			c.data.items.some((i) => i.id === itemId) &&
			c.data.ask,
	) as Extract<ViewComponent, { type: "itemCards" }> | undefined;
}

/** Conservative authoring check; runtime resolves dynamic documents before display. */
export function displayMayInteract(step: {
	document?: DisplayDocument;
	from?: string;
}): boolean {
	if (!step.document) return true;
	const visit = (list: DisplayDocument["components"]): boolean =>
		list.some((c) => {
			if (c.type === "form" || c.type === "actions") return true;
			if (c.type === "itemCards" || c.type === "codeTour") {
				const data =
					"literal" in c.data
						? c.data.literal
						: "bindings" in c.data
							? c.data.bindings
							: undefined;
				if (!data) return true;
				return ["actions", "comment", "ask"].some((key) =>
					Object.hasOwn(data, key),
				);
			}
			if (c.type === "section") {
				if (!("literal" in c.data)) return true;
				return visit(z.array(components).parse(c.data.literal.components));
			}
			return false;
		});
	return visit(step.document.components);
}
