import { stepPresentation } from "./StepPresentation.js";
import { configuredOutputKeys, stepForRun } from "./ToolBindings.js";
import type { FactoryRun } from "./WorkflowRuntime.js";

/** Stable view names refer to accepted roles/actions, never authored step IDs. */
export function presentationOutputKeys(
	run: FactoryRun,
): Record<string, string> {
	const selectors = {
		guide: { check: "requirement-coverage" },
		capture: { check: "capture-evidence" },
		"draft-pr": { tool: "draft-pr" },
		ci: { tool: "ci" },
		"merge-readiness": { tool: "merge-readiness" },
		"external-final": { tool: "external-final" },
		handoff: { tool: "handoff" },
		merge: { tool: "merge" },
	} as const;
	return Object.fromEntries(
		Object.entries(selectors).flatMap(([name, selector]) => {
			const key = configuredOutputKeys(run, selector)[0];
			return key ? [[name, key]] : [];
		}),
	);
}

const presentationNames = new Set([
	"guide",
	"capture",
	"draft-pr",
	"ci",
	"merge-readiness",
	"external-final",
	"handoff",
	"merge",
]);

/** Reserved view aliases are emitted only when a configured producer owns them. */
export function presentationOutputs(
	run: FactoryRun,
	outputs: Record<string, unknown>,
): Record<string, unknown> {
	const keys = presentationOutputKeys(run);
	return {
		...Object.fromEntries(
			Object.entries(outputs).filter(([name]) => !presentationNames.has(name)),
		),
		...Object.fromEntries(
			Object.entries(keys)
				.filter(([, key]) => Object.hasOwn(outputs, key))
				.map(([name, key]) => [name, outputs[key]]),
		),
	};
}

/** Explicit artifact requests retain authored names; reserved view names resolve to roles. */
export function artifactOutputKey(
	run: FactoryRun,
	name: string,
): string | undefined {
	const alias = presentationOutputKeys(run)[name];
	return Object.hasOwn(run.outputs, name) ? name : alias;
}

/** Current activity keeps the accepted graph's meaning even when the catalog changes. */
export function currentStepView(run: FactoryRun) {
	const step = stepForRun(run, run.step);
	return step
		? {
				key: run.step,
				name: step.name,
				presentation:
					run.workflow.id === "simple"
						? { phase: "yellow", icon: "⚡", fixing: false }
						: stepPresentation(step),
			}
		: undefined;
}
