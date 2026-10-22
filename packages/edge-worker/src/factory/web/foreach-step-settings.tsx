import { useEffect } from "react";
import { foreachPointerSchema } from "../Foreach";
import { CheckJsonField } from "./check-step-settings";
import { kindOf, newStep, type Step } from "./recipe-graph";

export function pointerProblem(value: unknown): string | undefined {
	const parsed = foreachPointerSchema.safeParse(value);
	if (!parsed.success)
		return parsed.error.issues.map((issue) => issue.message).join("; ");
	return undefined;
}

export function mappingProblem(value: unknown): string | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value))
		return "Enter an object mapping input names to JSON Pointers.";
	if (Object.keys(value).length > 30) return "At most 30 call inputs.";
	for (const [name, path] of Object.entries(value)) {
		if (
			!/^[A-Za-z][A-Za-z0-9_-]{0,59}$/u.test(name) ||
			[
				"item",
				"index",
				"inputs",
				"__proto__",
				"prototype",
				"constructor",
			].includes(name)
		)
			return `Invalid input name “${name}”.`;
		const issue = pointerProblem(path);
		if (issue) return `${name}: ${issue}`;
	}
	return undefined;
}

/** Keep malformed bodies in the field until fixed; the server validates the complete recipe. */
export function bodyProblem(value: unknown): string | undefined {
	if (!Array.isArray(value) || value.length < 1 || value.length > 100)
		return "Enter a body containing 1–100 steps.";
	const ids = new Set<string>();
	for (const step of value) {
		if (
			!step ||
			typeof step !== "object" ||
			typeof step.id !== "string" ||
			!/^[A-Za-z0-9_-]{1,80}$/u.test(step.id) ||
			["__proto__", "prototype", "constructor"].includes(step.id)
		)
			return "Every body step needs a safe step ID.";
		if (ids.has(step.id)) return `Duplicate body step ID “${step.id}”.`;
		ids.add(step.id);
		if (
			typeof step.name !== "string" ||
			!step.name.trim() ||
			![
				"agent",
				"check",
				"script",
				"tool",
				"fanout",
				"foreach",
				"workflow",
				"snapshot",
				"file-issues",
				"launch-runs",
				"show",
				"decide",
				"approve",
			].includes(step.type) ||
			!Array.isArray(step.branches)
		)
			return `Step “${step.id}” needs a name, supported type and branches array.`;
		if (
			["decide", "approve"].includes(step.type) ||
			(step.type === "agent" && step.askQuestions) ||
			(step.type === "tool" &&
				[
					"human-review",
					"architecture-decision",
					"external-human-review",
				].includes(step.tool))
		)
			return "Human steps and agents that ask questions cannot run inside For each.";
		if (step.type === "foreach") {
			const issue = bodyProblem(step.body);
			if (issue) return issue;
		}
		for (const group of step.groups ?? []) {
			const issue = bodyProblem(group);
			if (issue) return issue;
		}
	}
	return undefined;
}

export function ForeachStepSettings({
	step,
	readOnly,
	selection,
	onChange,
	onError,
	onSelect,
}: {
	step: Step;
	readOnly: boolean;
	selection: string;
	onChange: (patch: Partial<Step>) => void;
	onError: (field: string, error: string) => void;
	onSelect: (id: string) => void;
}) {
	const from = step.items && "from" in step.items ? step.items.from : undefined;
	const itemId = step.itemId ?? "/id";
	useEffect(() => {
		const source = from !== undefined ? pointerProblem(from) : undefined;
		const identity = pointerProblem(itemId);
		onError("Items path", source ?? "");
		onError("Item ID path", identity ?? "");
		return () => {
			onError("Items path", "");
			onError("Item ID path", "");
		};
	}, [from, itemId, onError]);
	return (
		<section className="recipe-section foreach-settings">
			<h3>Items and limits</h3>
			<CheckJsonField
				label="Named item reads"
				value={step.reads ?? {}}
				object
				readOnly={readOnly}
				onError={onError}
				onChange={(reads) =>
					onChange({ configVersion: "step-config-v1", reads })
				}
			/>
			<small>
				For example {`{"assignments":"coordinate/assignments"}`} makes the list
				available at /inputs/assignments.
			</small>
			<label>
				Item source
				<select
					aria-label="Item source"
					disabled={readOnly}
					value={from === undefined ? "inline" : "path"}
					onChange={(e) =>
						onChange({
							items:
								e.target.value === "path"
									? { from: "/coordinate/assignments" }
									: { values: [{ id: "first", name: "First item" }] },
						})
					}
				>
					<option value="path">Earlier output or named read</option>
					<option value="inline">Inline list</option>
				</select>
			</label>
			{from !== undefined ? (
				<label>
					Items JSON path
					<input
						aria-label="Items JSON path"
						readOnly={readOnly}
						value={from}
						onChange={(e) => onChange({ items: { from: e.target.value } })}
					/>
					<small>
						For example /coordinate/assignments, /inputs/assignments, or
						/item/assignments in a nested body.
					</small>
				</label>
			) : (
				<CheckJsonField
					label="Inline items"
					value={step.items && "values" in step.items ? step.items.values : []}
					readOnly={readOnly}
					onError={onError}
					validate={(value) =>
						Array.isArray(value) ? undefined : "Enter a JSON array."
					}
					onChange={(values) => onChange({ items: { values } })}
				/>
			)}
			<label>
				Item ID path
				<input
					aria-label="Item ID path"
					readOnly={readOnly}
					value={itemId}
					onChange={(e) => onChange({ itemId: e.target.value })}
				/>
				<small>
					Stable unique IDs: letters, numbers, _ and -. An empty pointer uses
					each string item as its ID. Missing or duplicate IDs reject the whole
					source.
				</small>
			</label>
			<div className="check-pair">
				<label>
					Concurrency
					<input
						aria-label="Concurrency"
						type="number"
						min={1}
						max={32}
						disabled={readOnly}
						value={step.concurrency ?? 4}
						onChange={(e) => onChange({ concurrency: Number(e.target.value) })}
					/>
				</label>
				<label>
					Maximum items
					<input
						aria-label="Maximum items"
						type="number"
						min={1}
						max={1000}
						disabled={readOnly}
						value={step.maxItems ?? 100}
						onChange={(e) => onChange({ maxItems: Number(e.target.value) })}
					/>
				</label>
			</div>
			<small>
				Machine capacity also bounds work. Sources above the maximum are
				rejected before any item starts.
			</small>
			<label>
				On item failure
				<select
					aria-label="On item failure"
					disabled={readOnly}
					value={step.failure ?? "all-must-succeed"}
					onChange={(e) =>
						onChange({ failure: e.target.value as Step["failure"] })
					}
				>
					<option value="all-must-succeed">
						All must succeed — stop siblings
					</option>
					<option value="keep-successful">
						Keep successful — record limitations
					</option>
				</select>
			</label>
			<h3>Body for every item</h3>
			<p className="recipe-note">
				The current item is /item and its original zero-based position is
				/index. Nested bodies get their own item. Completed item results stay
				saved on restart.
			</p>
			<ul className="recipe-branches">
				{step.body?.map((child) => (
					<li key={child.id}>
						<button
							type="button"
							onClick={() => onSelect(`${selection}/${child.id}`)}
						>
							<span>
								{kindOf(child).icon} {child.name}
							</span>
							<small>{kindOf(child).label}</small>
						</button>
					</li>
				))}
			</ul>
			{!readOnly && (
				<div className="actions">
					<button
						className="link"
						type="button"
						onClick={() => {
							const id = `${step.id}-work-${(step.body?.length ?? 0) + 1}`;
							onChange({ body: [...(step.body ?? []), newStep("agent", id)] });
						}}
					>
						＋ Add agent
					</button>
					<button
						className="link"
						type="button"
						onClick={() =>
							onChange({ body: [newStep("workflow", `${step.id}-call`)] })
						}
					>
						Use Call recipe body
					</button>
				</div>
			)}
			<CheckJsonField
				label="Body steps JSON"
				rows={8}
				value={step.body ?? []}
				readOnly={readOnly}
				onError={onError}
				validate={bodyProblem}
				onChange={(body) => onChange({ body })}
			/>
		</section>
	);
}

export function CallInputMapping({
	step,
	readOnly,
	onChange,
	onError,
}: {
	step: Step;
	readOnly: boolean;
	onChange: (patch: Partial<Step>) => void;
	onError: (field: string, error: string) => void;
}) {
	return (
		<div className="foreach-settings">
			<CheckJsonField
				label="Recipe input mapping"
				value={step.inputMapping ?? {}}
				object
				readOnly={readOnly}
				onError={onError}
				validate={mappingProblem}
				onChange={(inputMapping) => onChange({ inputMapping })}
			/>
			<small>
				Map launch input names to paths, such as{" "}
				{`{"topic":"/item/name","position":"/index"}`}. Mapped call results
				retain the child outputs.
			</small>
		</div>
	);
}
