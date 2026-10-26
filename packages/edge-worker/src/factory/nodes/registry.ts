import { z } from "zod";
import { resolveStepConfig } from "../StepConfig.js";
import type { WorkflowStep } from "../Workflow.js";
import {
	installNodeMetadata,
	type NodeMetadata,
	nodeEffect,
} from "./metadata.js";
import type { NodeContext, NodeDefinition } from "./NodeDefinition.js";

export class NodeRegistry {
	private readonly definitions = new Map<string, NodeDefinition>();
	register<S extends z.ZodType<WorkflowStep>>(
		definition: NodeDefinition<S>,
	): void {
		if (this.definitions.has(definition.type))
			throw new Error(`Node already registered: ${definition.type}`);
		const metadata = this.metadataOf(definition);
		// Type-specific executors are called only after parsing their registered schema.
		this.definitions.set(
			definition.type,
			definition as unknown as NodeDefinition,
		);
		installNodeMetadata([metadata]);
	}
	get(type: string): NodeDefinition {
		const node = this.definitions.get(type);
		if (!node) throw new Error(`Unknown node type: ${type}`);
		return node;
	}
	effectFor(step: WorkflowStep): NodeMetadata["effect"] {
		const node = this.get(step.type);
		return nodeEffect(node.schema.parse(step));
	}
	metadata(): NodeMetadata[] {
		return [...this.definitions.values()].map((node) => this.metadataOf(node));
	}
	private metadataOf(node: NodeMetadata): NodeMetadata {
		return {
			type: node.type,
			category: node.category,
			effect: node.effect,
			...(node.operationEffects
				? { operationEffects: structuredClone(node.operationEffects) }
				: {}),
			...(node.accessEffects
				? { accessEffects: structuredClone(node.accessEffects) }
				: {}),
			builder: structuredClone(node.builder),
		};
	}
	/** Dispatch on the already-sanitized own type; changes take effect on the next parse. */
	parse(value: unknown, context: z.RefinementCtx): WorkflowStep {
		const type =
			value && typeof value === "object"
				? (value as { type?: unknown }).type
				: undefined;
		const node = typeof type === "string" && this.definitions.get(type);
		if (!node) {
			context.addIssue({
				code: "custom",
				path: ["type"],
				message: `Unknown node type: ${String(type)}`,
			});
			return z.NEVER;
		}
		const result = node.schema.safeParse(value);
		if (result.success) {
			const step = result.data;
			if (step.reuse) {
				const selfRead = Object.values(resolveStepConfig(step).reads).some(
					({ from }) =>
						from.split("/")[0] === step.id || /^@history(\/|$)/.test(from),
				);
				const selfBind = step.bind?.some(
					(ref) => ref === step.id || ref === `/${step.id}`,
				);
				if (node.usesPreviousReceipt || selfRead || selfBind) {
					context.addIssue({
						code: "custom",
						path: ["reuse"],
						message: `${node.type} cannot reuse output because it depends on its previous receipt`,
					});
					return z.NEVER;
				}
			}
			return result.data;
		}
		// Finalized schema issues retain their original validation code and path.
		for (const issue of result.error.issues)
			context.addIssue(issue as Parameters<typeof context.addIssue>[0]);
		return z.NEVER;
	}
	execute(ctx: NodeContext): Promise<unknown> {
		return Promise.resolve(this.get(ctx.step.type).execute(ctx));
	}
}
export const nodeRegistry = new NodeRegistry();
/** Recursive structural schemas use the same live registry as top-level steps. */
export const registeredStepSchema: z.ZodType<WorkflowStep> = z.lazy(() => {
	// Import-free recursion is configured by Workflow, preserving its safety preprocessor.
	if (!stepSchema) throw new Error("Workflow step schema is not initialized");
	return stepSchema;
});
let stepSchema: z.ZodType<WorkflowStep> | undefined;
export function setRegisteredStepSchema(schema: z.ZodType<WorkflowStep>): void {
	stepSchema = schema;
}
