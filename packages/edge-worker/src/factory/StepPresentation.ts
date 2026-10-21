import {
	type CheckId,
	type InstructionId,
	resolveStepConfig,
} from "./StepConfig.js";
import type { WorkflowStep } from "./Workflow.js";

export interface StepPresentation {
	phase: "red" | "orange" | "yellow" | "green" | "blue" | "indigo" | "violet";
	icon: string;
	fixing: boolean;
}

/** Display semantics follow accepted configuration, independently of graph identities. */
export function stepPresentation(step: WorkflowStep): StepPresentation {
	const config = resolveStepConfig(step);
	const format =
		config.output && "format" in config.output
			? config.output.format
			: undefined;
	const has = (id: CheckId) =>
		config.checks.some((check) => check.check === id);
	const instruction = (id: InstructionId) => config.instructions.includes(id);
	const view = (
		phase: StepPresentation["phase"],
		icon: string,
		fixing = false,
	): StepPresentation => ({ phase, icon, fixing });
	if (step.type === "foreach") return view("yellow", "↻");
	if (step.type === "tool") {
		switch (step.tool) {
			case "record-decisions":
				return view("red", "📌");
			case "takeover":
				return view("red", "🔎");
			case "draft-pr":
				return view("yellow", "🚀");
			case "ci":
			case "merge-readiness":
			case "ci-fix-readiness":
				return view("blue", "🧪");
			case "review-gate":
			case "review-after-fix":
				return view("green", "🚦");
			case "visual-gate":
				return view("indigo", "✅");
			case "handoff":
				return view("violet", "🎁");
			case "human-review":
				return view("violet", "🙋");
			case "merge":
				return view("violet", "🎉");
			case "architecture-decision":
				return view("orange", "🧩");
		}
	}
	if (instruction("visual-fix")) return view("indigo", "🔧", true);
	if (format === "ci-fix-v1" || instruction("ci-fix-runtime"))
		return view("blue", "🧪", true);
	if (format === "review-fix-v1" || instruction("review-fix"))
		return view("green", "🔧", true);
	if (
		has("requirement-coverage") ||
		format === "guide-v1" ||
		format?.startsWith("review-brief-v")
	)
		return view("violet", "📖");
	if (
		has("capture-evidence") ||
		["capture-v1", "qa-capture-v1"].includes(format ?? "")
	)
		return view("indigo", "🧪");
	if (
		["visual-scope-v1", "legacy-video-scope-v1", "qa-scope-v1"].includes(
			format ?? "",
		)
	)
		return view("indigo", "🎯");
	if (has("qa-review-evidence") || format === "qa-review-v1")
		return view("indigo", "👀");
	if (format === "clarify-v1") return view("red", "💬");
	if (format === "plan-v1") return view("orange", "🗺️");
	if (format === "plan-review-v1") return view("green", "🧐");
	if (format === "implement-v1") return view("yellow", "🔨");
	if (has("architecture-proposal") || has("architecture-candidate"))
		return view("orange", "🧩");
	if (has("impact-reuse")) return view("green", "🧭");
	if (format === "coverage-v1") return view("green", "✅");
	if (format === "inventory-v1") return view("green", "🧭");
	if (format === "review-v1" || has("specialist-evidence"))
		return view("green", "👀");
	return view(
		"red",
		step.type === "agent"
			? "✦"
			: step.type === "script"
				? "›_"
				: step.type === "fanout"
					? "⫘"
					: step.type === "workflow"
						? "🧩"
						: "⚙️",
	);
}
