import { TransformSchema } from "../Rules.js";
import { CheckJsonField, ConditionEditor } from "./check-step-settings.js";
import type { NodeSettingsProps } from "./node-step-settings.js";

export function TransformStepSettings({
	step,
	readOnly,
	onChange,
	onError,
}: NodeSettingsProps) {
	return (
		<section className="recipe-section">
			<h3>Transform fields</h3>
			<p className="recipe-note">
				Fields use rules-v1 expressions, find, or literals. Map supports
				multiple sources and distinctBy. $/inputs reads the original inputs; ^
				reads the parent item; @key and @index retain source keys.
			</p>
			<CheckJsonField
				label="Transform template"
				value={step.transform ?? {}}
				object
				rows={14}
				readOnly={readOnly}
				onError={onError}
				validate={(value) => {
					const result = TransformSchema.safeParse(value);
					return result.success ? undefined : result.error.issues[0]?.message;
				}}
				onChange={(transform) => onChange({ transform })}
			/>
			<CheckJsonField
				label="Transform reads"
				value={step.reads ?? {}}
				object
				readOnly={readOnly}
				onError={onError}
				onChange={(reads) => onChange({ reads })}
			/>
			<label className="recipe-check">
				<input
					type="checkbox"
					disabled={readOnly}
					checked={!!step.output}
					onChange={(e) =>
						onChange({
							output: e.target.checked
								? { schema: { type: "object" } }
								: undefined,
						})
					}
				/>
				Validate output schema
			</label>
			{step.output && "schema" in step.output && (
				<CheckJsonField
					label="Output schema"
					value={step.output.schema}
					object
					readOnly={readOnly}
					onError={onError}
					onChange={(schema) => onChange({ output: { schema } })}
				/>
			)}
		</section>
	);
}
export function WaitStepSettings({
	step,
	readOnly,
	onChange,
	onError,
}: NodeSettingsProps) {
	return (
		<section className="recipe-section">
			<h3>Wait</h3>
			<p className="recipe-note">
				Poll one registered read-only IO node. Durations are milliseconds. Until
				reads /output, /inputs and /polls.
			</p>
			<CheckJsonField
				label="Read-only body node"
				value={step.body?.[0] ?? { id: "poll", name: "Poll", type: "" }}
				object
				rows={10}
				readOnly={readOnly}
				onError={onError}
				onChange={(body) => onChange({ body: [body] })}
			/>
			{(["interval", "timeout"] as const).map((field) => (
				<label key={field}>
					{field === "interval" ? "Poll interval (ms)" : "Timeout (ms)"}
					<input
						type="number"
						min={1}
						readOnly={readOnly}
						value={step[field] ?? ""}
						onChange={(e) => onChange({ [field]: Number(e.target.value) })}
					/>
				</label>
			))}
			<label>
				Failed poll limit (optional)
				<input
					type="number"
					min={1}
					max={10000}
					readOnly={readOnly}
					value={step.maxErrors ?? ""}
					onChange={(e) =>
						onChange({
							maxErrors:
								e.target.value === "" ? undefined : Number(e.target.value),
						})
					}
				/>
			</label>
			<ConditionEditor
				label="Until"
				value={step.until ?? { path: "/output/ready", equals: true }}
				readOnly={readOnly}
				onError={onError}
				onChange={(until) => onChange({ until })}
			/>
			<CheckJsonField
				label="Wait reads"
				value={step.reads ?? {}}
				object
				readOnly={readOnly}
				onError={onError}
				onChange={(reads) => onChange({ reads })}
			/>
		</section>
	);
}
