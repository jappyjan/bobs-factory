// Modal forms for the TUI: starting a run and answering Bob's questions.
import {
	type AnswerDraft,
	answerChoice,
	answerReplyKind,
	resolveAnswers,
	serializeAnswers,
	toggleAnswerOption,
} from "bobs-factory-edge-worker";
import {
	type FactoryConfig,
	type LaunchField,
	launchableWorkflows,
	RUNNERS,
	type RunDetail,
} from "./model.js";
import { type Key, pad, type Screen, TextInput, wrap } from "./terminal.js";
import type { Theme } from "./theme.js";

type Field =
	| {
			kind: "select";
			label: string;
			options: { value: string; label: string }[];
			index: number;
			name: string;
	  }
	| {
			kind: "input";
			label: string;
			input: TextInput;
			name: string;
			required?: boolean;
			description?: string;
	  };

export type FormResult = "submit" | "cancel" | undefined;

function selectField(
	name: string,
	label: string,
	options: { value: string; label: string }[],
	value?: string,
): Field {
	return {
		kind: "select",
		name,
		label,
		options,
		index: Math.max(
			0,
			options.findIndex((option) => option.value === value),
		),
	};
}

function launchField(field: LaunchField): Field {
	if (field.type === "select")
		return selectField(
			field.name,
			field.label,
			[
				...(field.required
					? []
					: [{ value: "", label: field.placeholder ?? "—" }]),
				...(field.options ?? []),
			],
			field.defaultValue,
		);
	const input = new TextInput(
		field.placeholder ?? field.description ?? "",
		field.type === "textarea" || field.name === "prompt",
	);
	if (field.defaultValue) input.value = field.defaultValue;
	return {
		kind: "input",
		name: field.name,
		label: field.label,
		input,
		required: field.required,
		description: field.description,
	};
}

/** Shared keyboard/rendering for the field lists below. */
abstract class FieldForm {
	fields: Field[] = [];
	focus = 0;
	error = "";

	get current() {
		return this.fields[this.focus];
	}

	protected move(delta: number) {
		this.focus = (this.focus + delta + this.fields.length) % this.fields.length;
	}

	/** Handles navigation and editing; returns "submit"/"cancel" for terminal keys. */
	key(key: Key): FormResult {
		const field = this.current;
		if (key.name === "escape") return "cancel";
		if (key.name === "ctrl-s") return "submit";
		if (key.name === "tab") return void this.move(1);
		if (key.name === "shift-tab") return void this.move(-1);
		if (key.name === "enter") {
			if (this.focus === this.fields.length - 1) return "submit";
			return void this.move(1);
		}
		if (!field) return undefined;
		if (field.kind === "select") {
			if (key.name === "left" || key.name === "right") {
				const delta = key.name === "left" ? -1 : 1;
				if (!field.options.length) return undefined;
				field.index =
					(field.index + delta + field.options.length) % field.options.length;
				this.changed(field);
			} else if (key.name === "up") this.move(-1);
			else if (key.name === "down") this.move(1);
			return undefined;
		}
		if (!field.input.multiline && (key.name === "up" || key.name === "down"))
			return void this.move(key.name === "up" ? -1 : 1);
		field.input.handle(key);
		this.error = "";
		return undefined;
	}

	protected changed(_field: Field) {}

	value(name: string) {
		const field = this.fields.find((item) => item.name === name);
		if (!field) return "";
		return field.kind === "select"
			? (field.options[field.index]?.value ?? "")
			: field.input.value.trim();
	}

	/** Draws the fields; returns the rows used. */
	protected drawFields(
		screen: Screen,
		theme: Theme,
		x: number,
		y: number,
		w: number,
		maxRows: number,
	) {
		const labelWidth = Math.min(22, Math.floor(w / 4));
		const inputWidth = w - labelWidth - 3;
		let row = y;
		const height = (field: Field) =>
			field.kind === "input" && field.input.multiline ? 4 : 2;
		let first = 0;
		while (
			first < this.focus &&
			this.fields
				.slice(first, this.focus + 1)
				.reduce((n, field) => n + height(field), 0) > maxRows
		)
			first++;
		this.fields.forEach((field, index) => {
			if (index < first || row + height(field) - 1 > y + maxRows) return;
			const focused = index === this.focus;
			screen.put(x, row, focused ? "›" : " ", theme.focus);
			screen.put(
				x + 2,
				row,
				pad(field.label, labelWidth),
				focused ? theme.bold : theme.muted,
			);
			const fx = x + labelWidth + 3;
			if (field.kind === "select") {
				const option = field.options[field.index]?.label ?? "";
				screen.put(
					fx,
					row,
					focused ? `‹ ${option} ›` : `  ${option}`,
					focused ? theme.accentBold : theme.text,
					inputWidth,
				);
				row += 1;
			} else {
				const rows = field.input.multiline ? 3 : 1;
				screen.fill(
					fx,
					row,
					inputWidth,
					rows,
					focused ? theme.field : theme.panel,
				);
				field.input.render(
					screen,
					fx + 1,
					row,
					inputWidth - 2,
					rows,
					theme.text,
					theme.muted,
					focused,
				);
				row += rows;
			}
			row += 1;
		});
		return row - y;
	}
}

export class LaunchForm extends FieldForm {
	constructor(private config: FactoryConfig) {
		super();
		this.build();
		// Start on the task, like the web composer; repository and recipe keep their defaults.
		this.focus = this.workflowFields().length ? 2 : 0;
	}

	private build(previous = new Map<string, string>()) {
		const workflows = launchableWorkflows(this.config);
		const repository = selectField(
			"repositoryId",
			"Repository",
			this.config.repositories.map((repo) => ({
				value: repo.id,
				label: repo.name,
			})),
			previous.get("repositoryId"),
		);
		const recipe = selectField(
			"workflow",
			"Recipe",
			workflows.map((workflow) => ({
				value: workflow.id,
				label: workflow.name,
			})),
			previous.get("workflow") ?? this.config.defaultWorkflow,
		);
		const workflow = workflows[(recipe as { index: number }).index];
		const fields = (workflow?.launchFields ?? []).map(launchField);
		for (const field of fields)
			if (previous.has(field.name)) {
				if (field.kind === "input")
					field.input.value = previous.get(field.name)!;
				else
					field.index = Math.max(
						0,
						field.options.findIndex(
							(option) => option.value === previous.get(field.name),
						),
					);
			}
		const runner = selectField(
			"runner",
			"Agent",
			[
				{
					value: "",
					label: `Default (${this.config.defaultRunner ?? "claude"})`,
				},
				...RUNNERS.map((name) => ({ value: name, label: name })),
			],
			previous.get("runner"),
		);
		const model = new TextInput("Default model");
		if (previous.get("model")) model.value = previous.get("model")!;
		this.fields = [
			repository,
			recipe,
			...fields,
			runner,
			{ kind: "input", name: "model", label: "Model", input: model },
		];
	}

	protected override changed(field: Field) {
		if (field.name !== "workflow") return;
		// Keep values the user already typed when switching recipes.
		const values = new Map(
			this.fields.map((item) => [
				item.name,
				item.kind === "select"
					? (item.options[item.index]?.value ?? "")
					: item.input.value,
			]),
		);
		this.build(values);
	}

	workflowFields() {
		const workflow = launchableWorkflows(this.config)[
			(this.fields[1] as { index: number }).index
		];
		return workflow?.launchFields ?? [];
	}

	/** Request body for POST /api/runs, or an error message. */
	request(): { body?: Record<string, unknown>; error?: string } {
		const workflow = this.value("workflow");
		if (!workflow) return { error: "No recipe allows manual starts" };
		const repositoryId = this.value("repositoryId");
		if (!repositoryId)
			return { error: "Add a repository before starting a run" };
		const inputs: Record<string, string> = {};
		for (const field of this.workflowFields()) {
			inputs[field.name] = this.value(field.name);
			if (field.required && !inputs[field.name])
				return { error: `${field.label} is required` };
		}
		const runner = this.value("runner");
		const model = this.value("model");
		return {
			body: {
				repositoryId,
				repositoryIds: this.config.repositories.find(
					(repo) => repo.id === repositoryId,
				)?.repositoryIds,
				workflow,
				inputs,
				...(runner ? { runner } : {}),
				...(model ? { model } : {}),
			},
		};
	}

	render(screen: Screen, theme: Theme) {
		const w = Math.min(96, screen.w - 4);
		const h = Math.min(
			screen.h - 2,
			6 +
				this.fields.reduce(
					(n, f) => n + (f.kind === "input" && f.input.multiline ? 4 : 2),
					0,
				),
		);
		const x = Math.floor((screen.w - w) / 2);
		const y = Math.max(1, Math.floor((screen.h - h) / 2));
		screen.fill(x, y, w, h, theme.raised);
		screen.box(x, y, w, h, theme.focus, {
			text: "New run",
			style: theme.accentBold,
		});
		this.drawFields(screen, theme, x + 2, y + 2, w - 4, h - 5);
		if (this.error)
			screen.put(x + 3, y + h - 3, `✗ ${this.error}`, theme.stuck, w - 6);
		screen.put(
			x + 3,
			y + h - 2,
			"tab next · ←/→ choose · alt-enter newline · ctrl-s start · esc close (draft kept)",
			theme.muted,
			w - 6,
		);
	}
}

export class AnswerForm extends FieldForm {
	readonly questions: string[];
	draft: AnswerDraft = {};
	optionFocus: Record<number, number> = {};
	private questionScroll: Record<number, number> = {};
	private questionPage = 1;
	private questionScrollMax = 0;
	constructor(readonly run: RunDetail) {
		super();
		this.questions = run.questions ?? [];
		this.fields = this.questions.map((_, index) => {
			const recommendation = this.recommendation(index);
			return {
				kind: "input",
				name: String(index),
				label: `Answer ${index + 1}`,
				input: new TextInput(
					recommendation
						? `Enter to accept: ${recommendation.answer}`
						: "Your answer",
					true,
				),
			} satisfies Field;
		});
	}

	recommendation(index: number) {
		return this.run.questionRecommendations?.find(
			(item) => item.questionIndex === index,
		);
	}

	choices(index: number) {
		return this.run.questionChoices?.find(
			(item) => item.questionIndex === index,
		);
	}
	key(key: Key): FormResult {
		const options = this.choices(this.focus);
		if (!options) return super.key(key);
		if (key.name === "escape") return "cancel";
		if (key.name === "ctrl-s") return "submit";
		if (key.name === "tab" || key.name === "shift-tab")
			return void this.move(key.name === "tab" ? 1 : -1);
		if (key.name === "pageup" || key.name === "pagedown") {
			this.questionScroll[this.focus] = Math.max(
				0,
				Math.min(
					this.questionScrollMax,
					(this.questionScroll[this.focus] ?? 0) +
						(key.name === "pageup" ? -1 : 1) * this.questionPage,
				),
			);
			return;
		}
		const choice = answerChoice(this.draft[this.focus], undefined, options);
		const row = this.optionFocus[this.focus] ?? 0;
		if (key.name === "up" || key.name === "down") {
			this.optionFocus[this.focus] =
				(row + (key.name === "up" ? -1 : 1) + options.options.length + 1) %
				(options.options.length + 1);
			return;
		}
		if (key.name === "ctrl-space") {
			this.draft[this.focus] = { ...choice, mode: "predefined" };
			return;
		}
		if (choice.mode === "custom" && row === options.options.length) {
			const field = this.current;
			if (field?.kind === "input") {
				field.input.handle(key);
				this.draft[this.focus] = { ...choice, custom: field.input.value };
			}
			return;
		}
		if (key.text === " " || key.name === "enter" || key.name === "right") {
			this.draft[this.focus] =
				row === options.options.length
					? { ...choice, mode: "custom" }
					: toggleAnswerOption(choice, options, options.options[row]!.id);
		}
		return;
	}
	answerDraft() {
		const draft: AnswerDraft = { ...this.draft };
		this.questions.forEach((_, index) => {
			if (!this.choices(index)) {
				const custom = this.value(String(index));
				draft[index] =
					custom ||
					answerChoice(
						undefined,
						this.recommendation(index)
							? {
									...this.recommendation(index)!,
									reason: this.recommendation(index)!.reason ?? "",
								}
							: undefined,
					);
			}
		});
		return draft;
	}
	answers() {
		return resolveAnswers(
			this.questions,
			(this.run.questionRecommendations ?? []).map((item) => ({
				...item,
				reason: item.reason ?? "",
			})),
			this.answerDraft(),
			this.run.questionChoices,
		);
	}

	request(): { body?: Record<string, unknown>; error?: string } {
		const answers = this.answers();
		if (!this.questions.length) return { error: "There is no open question" };
		const missing = answers.findIndex((answer) => !answer.trim());
		if (missing >= 0) {
			this.focus = missing;
			return { error: `Answer question ${missing + 1}` };
		}
		return {
			body: {
				answer: serializeAnswers(this.questions, answers),
				kind: answerReplyKind(
					this.questions,
					(this.run.questionRecommendations ?? []).map((item) => ({
						...item,
						reason: item.reason ?? "",
					})),
					this.answerDraft(),
					this.run.questionChoices,
				),
				context: {
					questions: this.questions,
					step: this.run.step,
					questionBatchId: this.run.questionBatchId,
				},
			},
		};
	}

	private renderChoices(screen: Screen, theme: Theme) {
		const options = this.choices(this.focus)!;
		const choice = answerChoice(this.draft[this.focus], undefined, options);
		const w = Math.max(12, Math.min(100, screen.w - 4));
		const h = Math.max(6, screen.h - 2);
		const x = Math.max(0, Math.floor((screen.w - w) / 2));
		const y = 1;
		const inner = w - 6;
		screen.fill(x, y, w, h, theme.raised);
		screen.box(x, y, w, h, theme.focus, {
			text: `Answer ${this.focus + 1}/${this.questions.length}`,
			style: theme.accentBold,
		});
		const question = wrap(this.questions[this.focus]!, inner);
		// Reserve space for choices, the custom editor and submission controls.
		const questionCapacity = Math.max(
			1,
			h - (choice.mode === "custom" ? 12 : 9),
		);
		const scrolling = question.length > questionCapacity;
		const questionRows = Math.min(
			question.length,
			Math.max(1, questionCapacity - (scrolling ? 1 : 0)),
		);
		this.questionPage = questionRows;
		this.questionScrollMax = Math.max(0, question.length - questionRows);
		const questionFirst = Math.min(
			this.questionScroll[this.focus] ?? 0,
			this.questionScrollMax,
		);
		this.questionScroll[this.focus] = questionFirst;
		let rowY = y + 1;
		for (const line of question.slice(
			questionFirst,
			questionFirst + questionRows,
		))
			screen.put(x + 3, rowY++, line, theme.bold, inner);
		if (scrolling)
			screen.put(
				x + 3,
				rowY++,
				`Question ${questionFirst + 1}–${questionFirst + questionRows}/${question.length} · PgUp/PgDn scroll`,
				theme.muted,
				inner,
			);
		screen.put(
			x + 3,
			rowY++,
			choice.mode === "custom"
				? "Custom text will be sent"
				: options.selection === "single"
					? "Choose one predefined answer"
					: "Choose one or more predefined answers",
			theme.muted,
			inner,
		);
		const cursor = this.optionFocus[this.focus] ?? 0;
		const rows: { text: string; focused: boolean }[] = [];
		let cursorStart = 0;
		options.options.forEach((option, index) => {
			if (cursor === index) cursorStart = rows.length;
			const selected = choice.selectedOptionIds?.includes(option.id);
			wrap(
				`${cursor === index ? "›" : " "} ${options.selection === "single" ? (selected ? "(●)" : "( )") : selected ? "[✓]" : "[ ]"} ${option.answer}${option.reason ? ` — ${option.reason}` : ""}`,
				inner,
			).forEach((text) => {
				rows.push({ text, focused: cursor === index });
			});
		});
		if (cursor === options.options.length) cursorStart = rows.length;
		rows.push({
			text: `${cursor === options.options.length ? "›" : " "} ${choice.mode === "custom" ? "(●)" : "( )"} Custom answer`,
			focused: cursor === options.options.length,
		});
		const available = Math.max(
			1,
			y + h - (choice.mode === "custom" ? 6 : 3) - rowY,
		);
		const first = Math.max(0, Math.min(cursorStart, rows.length - available));
		rows.slice(first, first + available).forEach((row, index) => {
			screen.put(
				x + 3,
				rowY + index,
				row.text,
				row.focused ? theme.focus : theme.text,
				inner,
			);
		});
		if (choice.mode === "custom") {
			const field = this.current;
			if (field?.kind === "input")
				field.input.render(
					screen,
					x + 3,
					y + h - 6,
					inner,
					3,
					theme.text,
					theme.muted,
					cursor === options.options.length,
				);
		}
		if (this.error)
			screen.put(x + 3, y + h - 3, this.error, theme.stuck, inner);
		else
			screen.put(
				x + 3,
				y + h - 3,
				"↑/↓ option · space choose · ctrl-space choices",
				theme.muted,
				inner,
			);
		screen.put(
			x + 3,
			y + h - 2,
			"ctrl-s send · tab question · esc close",
			theme.muted,
			inner,
		);
	}

	render(screen: Screen, theme: Theme) {
		if (this.choices(this.focus)) return this.renderChoices(screen, theme);
		const w = Math.min(100, screen.w - 4);
		const x = Math.floor((screen.w - w) / 2);
		const inner = w - 6;
		const blocks = this.questions.map((question, index) => {
			const recommendation = this.recommendation(index);
			return {
				question: wrap(`${index + 1}. ${question}`, inner),
				recommendation: recommendation
					? wrap(
							`Recommended: ${recommendation.answer}${recommendation.reason ? ` — ${recommendation.reason}` : ""}`,
							inner - 2,
						).slice(0, 3)
					: [],
			};
		});
		const h = Math.min(
			screen.h - 2,
			5 +
				blocks.reduce(
					(n, b) => n + b.question.length + b.recommendation.length + 5,
					0,
				),
		);
		const y = Math.max(1, Math.floor((screen.h - h) / 2));
		screen.fill(x, y, w, h, theme.raised);
		screen.box(x, y, w, h, theme.focus, {
			text: `Answer Bob · ${this.run.title}`,
			style: theme.accentBold,
		});
		let row = y + 2;
		// Keep the focused question in view on short terminals.
		const first = this.focus;
		blocks.forEach((block, index) => {
			if (index < first || row >= y + h - 4) return;
			const focused = index === this.focus;
			const remaining = y + h - 4 - row;
			const questionRows = Math.max(
				1,
				remaining - 4 - Math.min(2, block.recommendation.length),
			);
			for (const line of block.question.slice(0, questionRows))
				screen.put(
					x + 3,
					row++,
					line,
					focused ? theme.bold : theme.text,
					inner,
				);
			for (const line of block.recommendation.slice(
				0,
				Math.max(0, y + h - 4 - row - 4),
			))
				screen.put(x + 5, row++, line, theme.review, inner - 2);
			const field = this.fields[index]!;
			if (field.kind === "input") {
				screen.fill(x + 3, row, inner, 3, focused ? theme.field : theme.panel);
				field.input.render(
					screen,
					x + 4,
					row,
					inner - 2,
					3,
					theme.text,
					theme.muted,
					focused,
				);
			}
			row += 4;
		});
		if (this.error)
			screen.put(x + 3, y + h - 3, `✗ ${this.error}`, theme.stuck, inner);
		screen.put(
			x + 3,
			y + h - 2,
			"tab next question · empty = recommendation · alt-enter newline · ctrl-s send · esc close",
			theme.muted,
			inner,
		);
	}
}

/** One free-text prompt: message Bob, request changes, or a follow-up run. */
export class PromptForm {
	readonly input: TextInput;
	error = "";
	constructor(
		readonly title: string,
		readonly hint: string,
		placeholder: string,
	) {
		this.input = new TextInput(placeholder, true);
	}

	key(key: Key): FormResult {
		if (key.name === "escape") return "cancel";
		if (key.name === "enter" || key.name === "ctrl-s")
			return this.input.value.trim() ? "submit" : undefined;
		this.input.handle(key);
		this.error = "";
		return undefined;
	}

	render(screen: Screen, theme: Theme) {
		const w = Math.min(90, screen.w - 4);
		const h = 10;
		const x = Math.floor((screen.w - w) / 2);
		const y = Math.max(1, Math.floor((screen.h - h) / 2));
		screen.fill(x, y, w, h, theme.raised);
		screen.box(x, y, w, h, theme.focus, {
			text: this.title,
			style: theme.accentBold,
		});
		screen.put(x + 3, y + 2, this.hint, theme.muted, w - 6);
		screen.fill(x + 3, y + 3, w - 6, 3, theme.field);
		this.input.render(
			screen,
			x + 4,
			y + 3,
			w - 8,
			3,
			theme.text,
			theme.muted,
			true,
		);
		if (this.error)
			screen.put(x + 3, y + 7, `✗ ${this.error}`, theme.stuck, w - 6);
		screen.put(
			x + 3,
			y + h - 2,
			"enter send · alt-enter newline · esc cancel",
			theme.muted,
			w - 6,
		);
	}
}
