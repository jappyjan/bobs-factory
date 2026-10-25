import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckSchema } from "../Check";
import {
	type RuleAggregate,
	type RuleCondition,
	RuleConditionSchema,
	type RuleExpression,
} from "../Rules";
import type { Step } from "./recipe-graph";

type Condition = RuleCondition;
type Collection = RuleAggregate;
type Expression = RuleExpression;
const initialCondition = (): Condition => ({ path: "/approved", equals: true });
const own = (value: object, key: string) => Object.hasOwn(value, key);
const operations = [
	["equals", "equals"],
	["notEquals", "does not equal"],
	["exists", "exists"],
	["empty", "is empty"],
	["min", "is at least"],
	["max", "is at most"],
	["minLength", "has at least this many items"],
	["maxLength", "has at most this many items"],
	["equalsPath", "equals another path"],
] as const;

/** Unsupported combinations stay intact in JSON instead of losing predicates. */
export function conditionEditorKind(value: Condition): string {
	if (!value || typeof value !== "object") return "json";
	if (own(value, "all")) return "all";
	if (own(value, "any")) return "any";
	if (own(value, "not")) return "not";
	if (own(value, "each")) return "each";
	if (own(value, "some")) return "some";
	if (own(value, "count")) {
		const item = value as { min?: unknown; max?: unknown };
		return [item.min, item.max].every(
			(bound) => bound === undefined || typeof bound === "number",
		)
			? "count"
			: "json";
	}
	if (own(value, "path")) {
		const keys = Object.keys(value).filter((key) => key !== "path");
		if (
			keys.length === 1 &&
			operations.some(([operation]) => operation === keys[0])
		)
			return "field";
	}
	return "json";
}

export function newCondition(kind: string): Condition {
	if (kind === "all" || kind === "any")
		return { [kind]: [initialCondition()] } as Condition;
	if (kind === "not") return { not: initialCondition() };
	if (kind === "each" || kind === "some")
		return { [kind]: "/items", require: initialCondition() } as Condition;
	if (kind === "count") return { count: "/items", max: 0 };
	return initialCondition();
}

/** A JSON draft is separate from its last valid value and blocks recipe saves. */
export function CheckJsonField({
	label,
	value,
	readOnly = false,
	onChange,
	onError,
	object = false,
	rows = 5,
	validate,
}: {
	label: string;
	value: unknown;
	readOnly?: boolean;
	onChange: (value: any) => void;
	onError: (field: string, error: string) => void;
	object?: boolean;
	rows?: number;
	validate?: (value: any) => string | undefined;
}) {
	const serialized = JSON.stringify(value, null, 2) ?? "{}";
	const [text, setText] = useState(serialized);
	const [error, setError] = useState("");
	const emitted = useRef(serialized);
	useEffect(() => {
		if (serialized === emitted.current) return;
		emitted.current = serialized;
		setText(serialized);
		setError("");
	}, [serialized]);
	useEffect(() => {
		onError(label, error ? `${label}: ${error}` : "");
		return () => onError(label, "");
	}, [label, error, onError]);
	return (
		<label className="check-json-field">
			{label}
			<textarea
				className="recipe-prompt"
				aria-label={label}
				aria-invalid={!!error}
				readOnly={readOnly}
				rows={rows}
				value={text}
				onChange={(event) => {
					setText(event.target.value);
					try {
						const parsed = JSON.parse(event.target.value);
						if (
							object &&
							(!parsed || typeof parsed !== "object" || Array.isArray(parsed))
						)
							throw new Error("Enter a JSON object.");
						const issue = validate?.(parsed);
						if (issue) throw new Error(issue);
						emitted.current = JSON.stringify(parsed, null, 2);
						setError("");
						onChange(parsed);
					} catch (failure) {
						setError(
							failure instanceof Error ? failure.message : "Invalid JSON.",
						);
					}
				}}
			/>
			{error && (
				<small className="error" role="alert">
					{error}
				</small>
			)}
		</label>
	);
}

function Literal({
	value,
	label,
	readOnly,
	onChange,
	onError,
}: {
	value: unknown;
	label: string;
	readOnly: boolean;
	onChange: (value: unknown) => void;
	onError: (field: string, error: string) => void;
}) {
	const type =
		value === null ? "null" : typeof value === "object" ? "json" : typeof value;
	return (
		<div className="check-literal">
			<label>
				Value type
				<select
					aria-label={`${label} type`}
					disabled={readOnly}
					value={type}
					onChange={(event) =>
						onChange(
							(
								{
									string: "",
									number: 0,
									boolean: true,
									null: null,
									json: {},
								} as Record<string, unknown>
							)[event.target.value],
						)
					}
				>
					{["string", "number", "boolean", "null", "json"].map((kind) => (
						<option key={kind} value={kind}>
							{kind === "json" ? "JSON value" : kind}
						</option>
					))}
				</select>
			</label>
			{type === "json" ? (
				<CheckJsonField
					label={label}
					value={value}
					readOnly={readOnly}
					onChange={onChange}
					onError={onError}
					rows={3}
				/>
			) : type === "boolean" ? (
				<label>
					Value
					<select
						aria-label={label}
						disabled={readOnly}
						value={String(value)}
						onChange={(event) => onChange(event.target.value === "true")}
					>
						<option value="true">true</option>
						<option value="false">false</option>
					</select>
				</label>
			) : (
				type !== "null" && (
					<label>
						Value
						<input
							aria-label={label}
							readOnly={readOnly}
							type={type === "number" ? "number" : "text"}
							value={String(value ?? "")}
							onChange={(event) =>
								onChange(
									type === "number"
										? Number(event.target.value)
										: event.target.value,
								)
							}
						/>
					</label>
				)
			)}
		</div>
	);
}

export function ConditionEditor({
	value,
	label,
	readOnly,
	onChange,
	onError,
	depth = 0,
}: {
	value: Condition;
	label: string;
	readOnly: boolean;
	onChange: (condition: Condition) => void;
	onError: (field: string, error: string) => void;
	depth?: number;
}) {
	const [advanced, setAdvanced] = useState(false);
	const kind = advanced || depth > 9 ? "json" : conditionEditorKind(value);
	const data = value as any;
	const edit = (patch: object) => onChange({ ...data, ...patch });
	const nested = (
		condition: Condition,
		suffix: string,
		update: (value: Condition) => void,
	) => (
		<ConditionEditor
			value={condition}
			label={`${label} ${suffix}`}
			readOnly={readOnly}
			onChange={update}
			onError={onError}
			depth={depth + 1}
		/>
	);
	const where = () => (
		<>
			<label className="recipe-check">
				<input
					type="checkbox"
					checked={!!data.where}
					disabled={readOnly}
					onChange={(event) => {
						const next = { ...data };
						if (event.target.checked) next.where = initialCondition();
						else delete next.where;
						onChange(next);
					}}
				/>
				Filter items first
			</label>
			{data.where && nested(data.where, "filter", (where) => edit({ where }))}
		</>
	);
	return (
		<fieldset className="check-condition">
			<legend>{label}</legend>
			<label>
				Condition
				<select
					aria-label={`${label} condition`}
					value={kind}
					disabled={readOnly}
					onChange={(event) => {
						setAdvanced(event.target.value === "json");
						if (event.target.value !== "json")
							onChange(newCondition(event.target.value));
					}}
				>
					<option value="field">Compare a field</option>
					<option value="all">All conditions</option>
					<option value="any">Any condition</option>
					<option value="not">Not</option>
					<option value="each">Every item</option>
					<option value="some">At least one item</option>
					<option value="count">Count matching items</option>
					<option value="json">Advanced JSON</option>
				</select>
			</label>
			{kind === "json" ? (
				<CheckJsonField
					label={`${label} JSON`}
					value={value}
					readOnly={readOnly}
					onChange={onChange}
					onError={onError}
					object
					validate={(value) => {
						const parsed = RuleConditionSchema.safeParse(value);
						return parsed.success
							? undefined
							: "Enter a valid rules-v1 condition. Use a JSON Pointer and a supported comparison.";
					}}
				/>
			) : kind === "field" ? (
				(() => {
					const operation = operations.find(([op]) => own(data, op))![0];
					return (
						<>
							<label>
								Path
								<input
									aria-label={`${label} path`}
									value={data.path}
									readOnly={readOnly}
									placeholder="/inputs/review/approved"
									onChange={(event) => edit({ path: event.target.value })}
								/>
							</label>
							<label>
								Comparison
								<select
									aria-label={`${label} comparison`}
									value={operation}
									disabled={readOnly}
									onChange={(event) =>
										onChange({
											path: data.path,
											[event.target.value]: ["exists", "empty"].includes(
												event.target.value,
											)
												? true
												: ["min", "max", "minLength", "maxLength"].includes(
															event.target.value,
														)
													? 0
													: "",
										} as Condition)
									}
								>
									{operations.map(([op, text]) => (
										<option key={op} value={op}>
											{text}
										</option>
									))}
								</select>
							</label>
							<Literal
								value={data[operation]}
								label={`${label} value`}
								readOnly={readOnly}
								onChange={(operand) => edit({ [operation]: operand })}
								onError={onError}
							/>
						</>
					);
				})()
			) : kind === "all" || kind === "any" ? (
				<>
					{data[kind].map((condition: Condition, index: number) => (
						<div className="check-condition-item" key={index}>
							{nested(condition, `${index + 1}`, (next) =>
								edit({
									[kind]: data[kind].map((item: Condition, i: number) =>
										i === index ? next : item,
									),
								}),
							)}
							{!readOnly && data[kind].length > 1 && (
								<button
									type="button"
									className="link"
									onClick={() =>
										edit({
											[kind]: data[kind].filter(
												(_: unknown, i: number) => i !== index,
											),
										})
									}
								>
									Remove condition {index + 1}
								</button>
							)}
						</div>
					))}
					{!readOnly && data[kind].length < 20 && (
						<button
							type="button"
							className="link"
							onClick={() =>
								edit({ [kind]: [...data[kind], initialCondition()] })
							}
						>
							＋ Add condition
						</button>
					)}
				</>
			) : kind === "not" ? (
				nested(data.not, "negated", (not) => edit({ not }))
			) : (
				<>
					<label>
						Collection path
						<input
							aria-label={`${label} collection path`}
							value={data[kind]}
							readOnly={readOnly}
							onChange={(event) => edit({ [kind]: event.target.value })}
						/>
					</label>
					{where()}
					{kind === "count" ? (
						<div className="check-pair">
							{["min", "max"].map((bound) => (
								<label key={bound}>
									{bound === "min" ? "Minimum count" : "Maximum count"}
									<input
										type="number"
										aria-label={`${label} ${bound}`}
										readOnly={readOnly}
										value={data[bound] ?? ""}
										onChange={(event) => {
											const next = { ...data };
											if (event.target.value === "") delete next[bound];
											else next[bound] = Number(event.target.value);
											onChange(next);
										}}
									/>
								</label>
							))}
						</div>
					) : (
						nested(data.require, "requirement", (require) => edit({ require }))
					)}
				</>
			)}
		</fieldset>
	);
}

function ResultEditor({
	value,
	label,
	readOnly,
	onChange,
	onError,
}: {
	value: Expression;
	label: string;
	readOnly: boolean;
	onChange: (value: Expression) => void;
	onError: (field: string, error: string) => void;
}) {
	const aggregate = "aggregate" in value ? value : undefined;
	const select = "select" in value ? value.select : undefined;
	return (
		<div className="check-expression">
			<label>
				Result kind
				<select
					aria-label={`${label} kind`}
					value={
						select !== undefined ? "select" : (aggregate?.aggregate ?? "rule")
					}
					disabled={readOnly}
					onChange={(event) => {
						const kind = event.target.value;
						onChange(
							kind === "select"
								? { select: "/inputs/value" }
								: kind === "rule"
									? initialCondition()
									: {
											aggregate: kind as Collection["aggregate"],
											path: "/inputs/reviews",
											...(kind === "all" || kind === "any"
												? { require: initialCondition() }
												: {}),
										},
						);
					}}
				>
					<option value="rule">Rule · true / false</option>
					<option value="all">All items · true / false</option>
					<option value="any">Any item · true / false</option>
					<option value="count">Count items · number</option>
					<option value="filter">Filter items · collection</option>
					<option value="select">Select a value · original type</option>
				</select>
			</label>
			{select !== undefined ? (
				<label>
					Value path
					<input
						aria-label={`${label} value path`}
						value={select}
						readOnly={readOnly}
						onChange={(event) => onChange({ select: event.target.value })}
					/>
				</label>
			) : aggregate ? (
				<>
					<label>
						Collection path
						<input
							aria-label={`${label} collection path`}
							readOnly={readOnly}
							value={aggregate.path}
							onChange={(event) =>
								onChange({ ...aggregate, path: event.target.value })
							}
						/>
					</label>
					<label className="recipe-check">
						<input
							type="checkbox"
							checked={!!aggregate.where}
							disabled={readOnly}
							onChange={(event) => {
								const next = { ...aggregate };
								if (event.target.checked) next.where = initialCondition();
								else delete next.where;
								onChange(next);
							}}
						/>
						Filter items first
					</label>
					{aggregate.where && (
						<ConditionEditor
							value={aggregate.where}
							label={`${label} filter`}
							readOnly={readOnly}
							onChange={(where) => onChange({ ...aggregate, where })}
							onError={onError}
						/>
					)}
					{(aggregate.aggregate === "all" || aggregate.aggregate === "any") && (
						<ConditionEditor
							value={aggregate.require ?? initialCondition()}
							label={`${label} requirement`}
							readOnly={readOnly}
							onChange={(require) => onChange({ ...aggregate, require })}
							onError={onError}
						/>
					)}
					<small>
						Item conditions use paths such as /approved. $/inputs reads the
						original document.
					</small>
				</>
			) : (
				<ConditionEditor
					value={value as Condition}
					label={label}
					readOnly={readOnly}
					onChange={onChange}
					onError={onError}
				/>
			)}
		</div>
	);
}

function ResultName({
	value,
	index,
	readOnly,
	duplicate,
	onChange,
	onError,
}: {
	value: string;
	index: number;
	readOnly: boolean;
	duplicate: (value: string) => boolean;
	onChange: (value: string) => void;
	onError: (field: string, error: string) => void;
}) {
	const [draft, setDraft] = useState(value);
	const [error, setError] = useState("");
	useEffect(() => {
		setDraft(value);
	}, [value]);
	useEffect(() => {
		onError(`Result ${index + 1} name`, error);
		return () => onError(`Result ${index + 1} name`, "");
	}, [error, index, onError]);
	return (
		<label>
			Result name
			<input
				aria-label={`Result ${index + 1} name`}
				readOnly={readOnly}
				value={draft}
				aria-invalid={!!error}
				onChange={(event) => {
					const next = event.target.value;
					setDraft(next);
					const issue = !/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(next)
						? "Use a letter, then letters, numbers, _ or - (up to 80 characters)."
						: ["passed", "__proto__", "constructor", "prototype"].includes(next)
							? "This result name is reserved."
							: duplicate(next)
								? "Result names must be unique."
								: "";
					setError(issue);
					if (!issue) onChange(next);
				}}
			/>
			{error && (
				<small className="error" role="alert">
					{error}
				</small>
			)}
		</label>
	);
}

export function CheckStepSettings({
	step,
	readOnly,
	onChange,
	onError,
	owner,
}: {
	step: Step;
	owner?: { engineVersion?: string };
	readOnly: boolean;
	onChange: (patch: Partial<Step>) => void;
	onError: (field: string, error: string) => void;
}) {
	const [json, setJson] = useState(false);
	const [jsonError, setJsonError] = useState("");
	const reportJsonError = useCallback(
		(field: string, error: string) => {
			setJsonError(error);
			onError(field, error);
		},
		[onError],
	);
	const check = step.check ?? { results: {} };
	const checkIssue = useMemo(() => {
		const parsed = CheckSchema.safeParse(check);
		if (parsed.success) return "";
		const issue = parsed.error.issues[0]!;
		return `Check configuration ${issue.path.join("/")}: ${issue.message}`;
	}, [check]);
	useEffect(() => {
		onError("Check configuration", checkIssue);
		return () => onError("Check configuration", "");
	}, [checkIssue, onError]);
	const results = Object.entries(check.results);
	const patch = (next: typeof check) =>
		onChange({ configVersion: "step-config-v1", check: next });
	const update = (index: number, name: string, value: Expression) =>
		patch({
			...check,
			results: Object.fromEntries(
				results.map(([key, item], i) =>
					i === index ? [name, value] : [key, item],
				),
			),
		});
	const add = () => {
		let index = 1;
		while (own(check.results, `result${index}`)) index++;
		patch({
			...check,
			results: { ...check.results, [`result${index}`]: initialCondition() },
		});
	};
	const duplicate = (name: string, index: number) =>
		results.some(([key], i) => i !== index && key === name);
	return (
		<section
			className="recipe-section recipe-check-config"
			aria-label="Check configuration"
		>
			<div className="check-section-title">
				<h3>Named results</h3>
				<button
					type="button"
					className="link"
					disabled={!!jsonError}
					onClick={() => setJson(!json)}
				>
					{json ? "Structured editor" : "Edit as JSON"}
				</button>
			</div>
			<p className="recipe-note">
				Evaluates rules without an agent or side effects. Conditions read
				/inputs and declared /evidence. Recipe routes choose what happens next.
			</p>
			{readOnly && (
				<p className="recipe-note">Fork this recipe to edit its Check rules.</p>
			)}
			{checkIssue && (
				<p className="error" role="alert">
					{checkIssue}
				</p>
			)}
			{json ? (
				<CheckJsonField
					label="Check JSON"
					value={check}
					readOnly={readOnly}
					object
					rows={14}
					onChange={patch}
					onError={reportJsonError}
					validate={(value) => {
						const parsed = CheckSchema.safeParse(value);
						if (parsed.success) return undefined;
						const issue = parsed.error.issues[0]!;
						return `${issue.path.join("/")}: ${issue.message}`;
					}}
				/>
			) : (
				<>
					{results.map(([name, expression], index) => (
						<div className="check-result" key={index}>
							<div className="check-result-head">
								<ResultName
									value={name}
									index={index}
									readOnly={readOnly}
									duplicate={(value) => duplicate(value, index)}
									onChange={(value) => update(index, value, expression)}
									onError={onError}
								/>
								{!readOnly && (
									<button
										type="button"
										className="recipe-close"
										aria-label={`Remove result ${name}`}
										onClick={() =>
											patch({
												...check,
												results: Object.fromEntries(
													results.filter((_, i) => i !== index),
												),
											})
										}
									>
										×
									</button>
								)}
							</div>
							<ResultEditor
								value={expression}
								label={name || `Result ${index + 1}`}
								readOnly={readOnly}
								onChange={(value) => update(index, name, value)}
								onError={onError}
							/>
						</div>
					))}
					{!readOnly && (
						<button type="button" className="link" onClick={add}>
							＋ Add named result
						</button>
					)}
					<label className="recipe-check">
						<input
							type="checkbox"
							checked={!!check.passed}
							disabled={readOnly}
							onChange={(event) => {
								const next = { ...check };
								if (event.target.checked) {
									const [name, expression] = results[0] ?? [
										"approved",
										initialCondition(),
									];
									const path = `/results/${name}`;
									next.passed =
										"aggregate" in expression &&
										expression.aggregate === "count"
											? { path, max: 0 }
											: "aggregate" in expression &&
													expression.aggregate === "filter"
												? { path, empty: true }
												: { path, equals: true };
								} else delete next.passed;
								patch(next);
							}}
						/>
						Define a passed rule
					</label>
					{check.passed ? (
						<ConditionEditor
							value={check.passed}
							label="Passed"
							readOnly={readOnly}
							onChange={(passed) => patch({ ...check, passed })}
							onError={onError}
						/>
					) : (
						<small>
							passed is true when every named boolean result is true. Define a
							passed rule if there are no boolean results.
						</small>
					)}
				</>
			)}
			<details
				className="check-inputs"
				open={!Object.keys(step.reads ?? {}).length}
			>
				<summary>
					Reads · {Object.keys(step.reads ?? {}).length} bindings
				</summary>
				<CheckJsonField
					label="Check reads"
					value={step.reads ?? {}}
					object
					readOnly={readOnly}
					onError={onError}
					onChange={(reads) => onChange({ reads })}
				/>
				<small>
					Bind names to step IDs or step/path. For example:{" "}
					{JSON.stringify({ review: "review-step" })}.
				</small>
			</details>
			{owner?.engineVersion !== "nodes-v1" && (
				<details className="check-inputs">
					<summary>
						Declared evidence checks · {step.checks?.length ?? 0}
					</summary>
					<CheckJsonField
						label="Check evidence checks"
						value={step.checks ?? []}
						readOnly={readOnly}
						onError={onError}
						onChange={(checks) => onChange({ checks })}
						validate={(value) =>
							Array.isArray(value)
								? undefined
								: "Enter an array of declared checks."
						}
					/>
					<small>
						Only declared checks from the fixed evidence library may verify
						evidence. Read names do not activate a role.
					</small>
				</details>
			)}
			<section className="check-routes-summary" aria-label="Routes on">
				<b>Routes on</b>
				<p>{["passed", ...results.map(([name]) => name)].join(" · ")}</p>
				{step.branches.length ? (
					<ul>
						{step.branches.map((branch, index) => (
							<li key={index}>
								<code>{branch.when.path}</code> ={" "}
								<code>{JSON.stringify(branch.when.equals)}</code> →{" "}
								{branch.next}
							</li>
						))}
					</ul>
				) : (
					<small>No conditional routes yet. Add them below.</small>
				)}
			</section>
		</section>
	);
}
