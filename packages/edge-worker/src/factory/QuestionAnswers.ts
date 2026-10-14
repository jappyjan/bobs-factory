import { isExplanationRequest, type QuestionChoices } from "./Questions.js";
// Shared by the web dashboard and the terminal UI so both send answers in one format.
export type AnswerChoice = {
	mode: "recommendation" | "predefined" | "custom";
	custom: string;
	selectedOptionIds?: string[];
};
export type AnswerDraft = Record<number, AnswerChoice | string>;
export type Recommendation = {
	questionIndex: number;
	answer: string;
	reason: string;
};
/** Text values are treated as explicit custom answers. */
export function answerChoice(
	value: AnswerChoice | string | undefined,
	recommendation?: Recommendation,
	choices?: QuestionChoices,
): AnswerChoice {
	if (typeof value === "string") return { mode: "custom", custom: value };
	if (choices)
		return (
			value ?? {
				mode: "predefined",
				custom: "",
				selectedOptionIds: [...(choices.preselectedOptionIds ?? [])],
			}
		);
	if (value && !recommendation) return { ...value, mode: "custom" };
	return (
		value ?? { mode: recommendation ? "recommendation" : "custom", custom: "" }
	);
}
export function resolveAnswers(
	questions: string[],
	recommendations: Recommendation[],
	draft: AnswerDraft,
	choices: QuestionChoices[] = [],
): string[] {
	return questions.map((_, i) => {
		const recommendation = recommendations.find(
			(item) => item.questionIndex === i,
		);
		const options = choices.find((item) => item.questionIndex === i);
		const choice = answerChoice(draft[i], recommendation, options);
		if (choice.mode === "predefined" && options) {
			const ids = choice.selectedOptionIds ?? [];
			if (
				!ids.length ||
				new Set(ids).size !== ids.length ||
				ids.some((id) => !options.options.some((option) => option.id === id)) ||
				(options.selection === "single" && ids.length !== 1)
			)
				return "";
			const selected = options.options.filter((option) =>
				ids.includes(option.id),
			);
			return options.selection === "multiple"
				? selected.map((option) => `- ${option.answer}`).join("\n")
				: selected[0]!.answer;
		}
		return choice.mode === "recommendation"
			? (recommendation?.answer ?? "")
			: choice.custom;
	});
}
export function serializeAnswers(
	questions: string[],
	answers: string[],
): string {
	return questions.map((q, i) => `${i + 1}. ${q}\n${answers[i]}`).join("\n\n");
}

export function toggleAnswerOption(
	choice: AnswerChoice,
	options: QuestionChoices,
	id: string,
): AnswerChoice {
	if (!options.options.some((option) => option.id === id)) return choice;
	const selected = choice.selectedOptionIds ?? [];
	return {
		...choice,
		mode: "predefined",
		selectedOptionIds:
			options.selection === "single"
				? [id]
				: selected.includes(id)
					? selected.filter((value) => value !== id)
					: [...selected, id],
	};
}

/** Only custom replies can request an explanation; predefined text is a decision. */
export function answerReplyKind(
	questions: string[],
	recommendations: Recommendation[],
	draft: AnswerDraft,
	choices: QuestionChoices[] = [],
): "answer" | "explanation" {
	return questions.some((_, index) => {
		const choice = answerChoice(
			draft[index],
			recommendations.find((item) => item.questionIndex === index),
			choices.find((item) => item.questionIndex === index),
		);
		return choice.mode === "custom" && isExplanationRequest(choice.custom);
	})
		? "explanation"
		: "answer";
}
