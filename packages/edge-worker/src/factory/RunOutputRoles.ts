import { stepPresentation } from "./StepPresentation.js";
import { stepForRun } from "./ToolBindings.js";
import type { FactoryRun } from "./WorkflowRuntime.js";
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

export function artifactOutputKey(run: FactoryRun, name: string) {
	return Object.hasOwn(run.outputs, name) ? name : undefined;
}

/** Read only authored PR output slots; do not hydrate unrelated historical artifacts. */
export function requestUrls(run: FactoryRun): string[] {
	const urls = Object.keys(run.outputs)
		.filter((key) => stepForRun(run, key)?.type === "pr")
		.flatMap((key) => {
			const result = run.outputs[key] as
				| { repositories?: { url?: string }[] }
				| undefined;
			return (
				result?.repositories?.flatMap((repository) =>
					repository.url ? [repository.url] : [],
				) ?? []
			);
		});
	return [...new Set(urls)];
}
