import { useEffect, useState } from "react";
import { api } from "./client";
import type { Step } from "./recipe-graph";

type Catalog = {
	formats: { id: string; version: number }[];
	checks: string[];
	instructions: string[];
	access: string[];
	contextSources: string[];
};

/** JSON stays text while editing; invalid drafts prevent a recipe save. */
function JsonSetting({
	label,
	value,
	empty,
	readOnly,
	onChange,
	onError,
	help,
}: {
	label: string;
	value: unknown;
	empty: unknown;
	readOnly: boolean;
	onChange: (value: any) => void;
	onError: (field: string, error: string) => void;
	help?: string;
}) {
	const [text, setText] = useState(() =>
		JSON.stringify(value ?? empty, null, 2),
	);
	const [error, setError] = useState("");
	useEffect(() => {
		onError(label, error);
		return () => onError(label, "");
	}, [label, error, onError]);
	return (
		<label>
			{label}
			<textarea
				className="recipe-prompt"
				aria-label={label}
				rows={Math.min(7, Math.max(3, text.split("\n").length))}
				readOnly={readOnly}
				value={text}
				aria-invalid={!!error}
				onChange={(event) => {
					const next = event.target.value;
					setText(next);
					try {
						const parsed = JSON.parse(next || JSON.stringify(empty));
						if (
							(Array.isArray(empty) && !Array.isArray(parsed)) ||
							(!Array.isArray(empty) &&
								(!parsed ||
									typeof parsed !== "object" ||
									Array.isArray(parsed)))
						)
							throw new Error(
								Array.isArray(empty)
									? "Enter a JSON array."
									: "Enter a JSON object.",
							);
						setError("");
						onChange(parsed);
					} catch (failure) {
						setError(
							failure instanceof Error ? failure.message : "Invalid JSON",
						);
					}
				}}
			/>
			{help && <small>{help}</small>}
			{error && <small role="alert">{error}</small>}
		</label>
	);
}

export function AgentStepSettings({
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
	const [catalog, setCatalog] = useState<Catalog>();
	const [catalogError, setCatalogError] = useState("");
	const [schemaIssue, setSchemaIssue] = useState("");
	const [schemaPending, setSchemaPending] = useState(false);
	useEffect(() => {
		let alive = true;
		api<Catalog>("/api/workflows/step-config/catalog").then(
			(value) => {
				if (alive) setCatalog(value);
			},
			(error) => {
				if (alive) setCatalogError(error.message);
			},
		);
		return () => {
			alive = false;
		};
	}, []);
	const schema =
		step.output && "schema" in step.output ? step.output.schema : undefined;
	const serialized = JSON.stringify(schema);
	useEffect(() => {
		if (!serialized) {
			setSchemaIssue("");
			setSchemaPending(false);
			return;
		}
		let alive = true;
		setSchemaPending(true);
		const timer = window.setTimeout(() => {
			api<{ valid: boolean; issues: string[] }>(
				"/api/workflows/step-config/validate",
				{
					method: "POST",
					body: JSON.stringify({ schema: JSON.parse(serialized) }),
				},
			).then(
				(result) => {
					if (alive) {
						setSchemaIssue(result.issues.join("; "));
						setSchemaPending(false);
					}
				},
				(error) => {
					if (alive) {
						setSchemaIssue(error.message);
						setSchemaPending(false);
					}
				},
			);
		}, 300);
		return () => {
			alive = false;
			window.clearTimeout(timer);
		};
	}, [serialized]);
	useEffect(() => {
		onError(
			"Output schema",
			schemaPending ? "Output schema validation is pending." : schemaIssue,
		);
		return () => onError("Output schema", "");
	}, [schemaIssue, schemaPending, onError]);
	const patch = (value: Partial<Step>) =>
		onChange({ configVersion: "step-config-v1", ...value });
	const format =
		step.output && "format" in step.output
			? step.output.format
			: schema
				? "custom"
				: "";
	const access =
		typeof step.access === "string"
			? step.access
			: (step.access?.mode ?? "workspace");
	const tools = typeof step.access === "object" ? step.access.tools : undefined;
	return (
		<section
			className="recipe-section recipe-agent-config"
			aria-label="Agent step configuration"
		>
			<h3>Agent step configuration</h3>
			{readOnly && (
				<p className="recipe-note">
					Bundled configuration is read-only. Fork this recipe to change its
					behavior.
				</p>
			)}
			{catalogError && (
				<p role="alert">Settings library unavailable: {catalogError}</p>
			)}
			<JsonSetting
				label="Reads"
				value={step.reads}
				empty={{}}
				readOnly={readOnly}
				onError={onError}
				onChange={(reads) => patch({ reads })}
				help={`Bind names to step IDs or step/path. Context: ${(catalog?.contextSources ?? []).map((name) => `@${name}`).join(", ")}.`}
			/>
			<label>
				Output format
				<select
					aria-label="Output format"
					disabled={readOnly}
					value={format}
					onChange={(event) =>
						patch({
							output:
								event.target.value === "custom"
									? { schema: { type: "object" } }
									: event.target.value
										? { format: event.target.value as any }
										: undefined,
						})
					}
				>
					<option value="">No output format</option>
					{!catalog && format && format !== "custom" && (
						<option value={format}>{format}</option>
					)}
					{catalog?.formats.map(({ id, version }) => (
						<option key={id} value={id}>
							{id} · version {version}
						</option>
					))}
					<option value="custom">Custom JSON Schema</option>
				</select>
			</label>
			{schema && (
				<>
					<JsonSetting
						key={format}
						label="Custom JSON Schema"
						value={schema}
						empty={{}}
						readOnly={readOnly}
						onError={onError}
						onChange={(schema) => patch({ output: { schema } })}
						help="Validated on the Factory server. Only local $ref values are allowed."
					/>
					<small role={schemaIssue ? "alert" : "status"}>
						{schemaPending
							? "Validating schema…"
							: schemaIssue || "Schema is valid."}
					</small>
				</>
			)}
			<JsonSetting
				label="Rules"
				value={step.rules}
				empty={[]}
				readOnly={readOnly}
				onError={onError}
				onChange={(rules) => patch({ rules })}
				help='Declarative rules: {"id":"complete","when":{"path":"/status","equals":"completed"},"require":{"path":"/blockers","empty":true},"message":"Completed output cannot retain blockers"}.'
			/>
			<JsonSetting
				label="Checks"
				value={step.checks}
				empty={[]}
				readOnly={readOnly}
				onError={onError}
				onChange={(checks) => patch({ checks })}
				help={`Evidence library: ${(catalog?.checks ?? []).join(", ")}. Use an ID or {"check":"id", ...arguments}.`}
			/>
			<label className="recipe-check">
				<input
					aria-label="Revision binding"
					type="checkbox"
					disabled={readOnly}
					checked={step.revision === "bound"}
					onChange={(event) =>
						patch({ revision: event.target.checked ? "bound" : undefined })
					}
				/>
				Bind output to revisions and inputs
			</label>
			<small>
				Bound evidence becomes stale when a repository revision or a read
				changes.
			</small>
			<label>
				Access
				<select
					aria-label="Access"
					disabled={readOnly}
					value={access}
					onChange={(event) =>
						patch({
							access: {
								mode: event.target.value as any,
								...(tools ? { tools } : {}),
							},
						})
					}
				>
					{["read-only", "workspace", "push"].map((mode) => (
						<option key={mode} value={mode}>
							{mode}
						</option>
					))}
				</select>
			</label>
			<JsonSetting
				label="Allowed tools"
				value={tools}
				empty={[]}
				readOnly={readOnly}
				onError={onError}
				onChange={(tools) =>
					patch({
						access: {
							mode: access as any,
							tools: tools.length ? tools : undefined,
						},
					})
				}
				help="An empty list uses the access mode’s default tools."
			/>
			<label>
				Shared instructions
				<select
					aria-label="Shared instructions"
					multiple
					size={5}
					disabled={readOnly}
					value={step.instructions ?? []}
					onChange={(event) =>
						patch({
							instructions: Array.from(
								event.target.selectedOptions,
								(option) => option.value,
							) as any,
						})
					}
				>
					{(catalog?.instructions ?? step.instructions ?? []).map((id) => (
						<option key={id} value={id}>
							{id}
						</option>
					))}
				</select>
				<small>
					Selected snippets are added automatically. Use {"{{instruction:id}}"}{" "}
					in the prompt to choose their exact position. Runtime instruction IDs
					add role guidance.
				</small>
			</label>
		</section>
	);
}
