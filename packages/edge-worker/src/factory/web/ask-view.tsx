import { useEffect, useRef } from "react";
import type { QuestionChoices } from "../Questions.js";
import type { ViewComponent } from "../View.js";
import { useAction } from "./client";
import { useFormState } from "./form-state";
import {
	type AnswerDraft,
	answerChoice,
	answerReplyKind,
	type Recommendation,
	resolveAnswers,
	serializeAnswers,
	toggleAnswerOption,
} from "./question-answers";
import { revisionOf } from "./restoration";
import { Bob, Button, Markdown, useToast } from "./ui";

type QuestionsData = Extract<ViewComponent, { type: "questions" }>["data"];

export function AskView({ run, data }: { run: any; data?: QuestionsData }) {
	const toast = useToast();
	const questions: string[] = data ? data.questions : (run.questions ?? []);
	const recommendations: Recommendation[] = data
		? (data.questionRecommendations ?? [])
		: (run.questionRecommendations ?? []);
	const choices: QuestionChoices[] = data
		? (data.questionChoices ?? [])
		: (run.questionChoices ?? []);
	const context = revisionOf([
		run.id,
		run.questionBatchId,
		questions,
		recommendations,
		choices,
		run.step,
		run.status,
		...(run.nativeView?.digest ? [run.nativeView.digest] : []),
	]);
	const action = useAction(`answers/${run.id}`, context);
	const [draft, setDraft] = useFormState<AnswerDraft>(context, {});
	const fields = useRef<Record<number, HTMLTextAreaElement | null>>({});
	const submitting = useRef(false);
	const focusCustom = useRef<number | undefined>(undefined);
	useEffect(() => {
		if (focusCustom.current === undefined) return;
		fields.current[focusCustom.current]?.focus();
		focusCustom.current = undefined;
	});
	const answers = resolveAnswers(questions, recommendations, draft, choices);
	const incomplete =
		!questions.length || answers.some((answer) => !answer.trim());
	const submit = async () => {
		if (
			submitting.current ||
			action.isPending ||
			action.isBlocked ||
			incomplete
		)
			return;
		submitting.current = true;
		try {
			await action.mutateAsync({
				path: `/api/runs/${run.id}/answer`,
				body: {
					...(run.nativeView?.digest
						? { display: { digest: run.nativeView.digest } }
						: {}),
					context: {
						questions,
						step: run.step,
						questionBatchId: run.questionBatchId,
					},
					answer: serializeAnswers(questions, answers),
					kind: answerReplyKind(questions, recommendations, draft, choices),
				},
			});
			setDraft({});
			toast({ text: "Reply sent" });
		} catch {
			/* error stays visible; draft is retained */
		} finally {
			submitting.current = false;
		}
	};
	return (
		<form
			className="question-form"
			onSubmit={(e) => {
				e.preventDefault();
				void submit();
			}}
			onKeyDown={(e) => {
				if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
					e.preventDefault();
					void submit();
				}
			}}
		>
			<fieldset disabled={action.isPending}>
				<legend className="sr-only">
					Answers to Bob's clarification questions
				</legend>
				{questions.map((q, i) => {
					const recommendation = recommendations.find(
						(item) => item.questionIndex === i,
					);
					const options = choices.find((item) => item.questionIndex === i);
					const choice = answerChoice(draft[i], recommendation, options);
					const custom =
						(!recommendation && !options) || choice.mode === "custom";
					const select = (mode: "custom" | "recommendation" | "predefined") => {
						if (mode === "custom") focusCustom.current = i;
						setDraft({ ...draft, [i]: { ...choice, mode } });
					};
					return (
						<div className="question" key={`${i}/${q}`}>
							<div className="question-heading">
								<Bob mood="alert" size={32} />
								<div
									id={`question-${run.id}-${i}`}
									className="question-content"
								>
									<Markdown>{q}</Markdown>
								</div>
							</div>
							<fieldset
								className="answer-controls"
								aria-labelledby={`question-${run.id}-${i}`}
							>
								<legend className="sr-only">
									Choose an answer for question {i + 1}
								</legend>
								{(recommendation || options) && (
									<>
										<div className="answer-modes">
											<label>
												<input
													type="radio"
													name={`answer-mode-${run.id}-${i}`}
													checked={!custom}
													onChange={() =>
														select(options ? "predefined" : "recommendation")
													}
												/>
												{options ? "Predefined answers" : "Use recommendation"}
											</label>
											<label>
												<input
													type="radio"
													name={`answer-mode-${run.id}-${i}`}
													checked={custom}
													onChange={() => select("custom")}
												/>
												Custom answer
											</label>
										</div>
										{options && !custom && (
											<fieldset
												className="answer-options"
												aria-label={
													options.selection === "single"
														? "Choose one answer"
														: "Choose one or more answers"
												}
											>
												{options.options.map((option) => (
													<label key={option.id} className="answer-option">
														<input
															type={
																options.selection === "single"
																	? "radio"
																	: "checkbox"
															}
															name={`answer-option-${run.id}-${i}`}
															checked={
																choice.selectedOptionIds?.includes(option.id) ??
																false
															}
															onChange={() =>
																setDraft({
																	...draft,
																	[i]: toggleAnswerOption(
																		choice,
																		options,
																		option.id,
																	),
																})
															}
														/>
														<span>
															{option.answer}
															{option.reason && <small>{option.reason}</small>}
														</span>
													</label>
												))}
											</fieldset>
										)}
										{recommendation && (
											<div className="answer-recommendation">
												<Markdown>{recommendation.answer}</Markdown>
												<div className="recommendation-reason">
													<Markdown>{recommendation.reason}</Markdown>
												</div>
											</div>
										)}
									</>
								)}
								{custom && (
									<textarea
										ref={(el) => {
											fields.current[i] = el;
										}}
										id={`answer-${run.id}-${i}`}
										aria-labelledby={`question-${run.id}-${i}`}
										required
										rows={2}
										placeholder="Type your answer…"
										value={choice.custom}
										onChange={(e) =>
											setDraft({
												...draft,
												[i]: {
													...choice,
													mode: "custom",
													custom: e.target.value,
												},
											})
										}
									/>
								)}
							</fieldset>
						</div>
					);
				})}
			</fieldset>
			{action.error && (
				<p className="error" role="alert">
					{action.error.message}
				</p>
			)}
			<Button
				type="submit"
				requiresConnection
				busy={action.isPending}
				disabled={incomplete}
			>
				Send answers <kbd>⌘⏎</kbd>
			</Button>
			{run.recheckAvailable && (
				<Button
					type="button"
					requiresConnection
					busy={action.isPending}
					onClick={async () => {
						if (submitting.current || action.isPending || action.isBlocked)
							return;
						submitting.current = true;
						try {
							await action.mutateAsync({
								path: `/api/runs/${run.id}/recheck`,
								body: {
									context: {
										step: run.step,
										questionBatchId: run.questionBatchId,
										questions,
									},
								},
							});
							toast({ text: "Bob is checking the blocker again" });
						} catch {
							/* error stays visible; answer draft is retained */
						} finally {
							submitting.current = false;
						}
					}}
				>
					Check again
				</Button>
			)}
			{run.recheckAvailable && (
				<p className="muted">
					After an update or access change, Bob can reassess the blocker. This
					sends no answers or approval.
				</p>
			)}
		</form>
	);
}
