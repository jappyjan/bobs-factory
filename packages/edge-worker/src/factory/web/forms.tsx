const runners = ["claude", "codex", "gemini", "cursor", "opencode"];
export function AgentSettings({
	value,
	onChange,
	config,
	label = "Run default",
	modelPlaceholder = "Repository default",
}: {
	value: any;
	onChange: (value: any) => void;
	config: any;
	label?: string;
	modelPlaceholder?: string;
}) {
	const runner = value.runner || config.defaultRunner;
	const set = (key: string, v: string) =>
		onChange({ ...value, [key]: v || undefined });
	return (
		<div className="agent-settings">
			<label>
				Agent
				<select
					value={value.runner ?? ""}
					onChange={(e) =>
						onChange({
							...value,
							runner: e.target.value || undefined,
							model: undefined,
							reasoningEffort: undefined,
							modelVariant: undefined,
							serviceTier: undefined,
						})
					}
				>
					<option value="">
						{label} ({config.defaultRunner})
					</option>
					{runners.map((r) => (
						<option key={r} value={r}>
							{r[0]!.toUpperCase() + r.slice(1)}
						</option>
					))}
				</select>
			</label>
			<label>
				Model
				<input
					value={value.model ?? ""}
					placeholder={modelPlaceholder}
					onChange={(e) => set("model", e.target.value)}
				/>
			</label>
			{runner === "opencode" ? (
				<label>
					Model variant
					<input
						value={value.modelVariant ?? ""}
						placeholder="Provider default"
						onChange={(e) => set("modelVariant", e.target.value)}
					/>
				</label>
			) : (
				<label>
					Reasoning
					<select
						value={value.reasoningEffort ?? ""}
						disabled={!config.reasoningLevels?.[runner]}
						onChange={(e) => set("reasoningEffort", e.target.value)}
					>
						<option value="">
							{config.reasoningLevels?.[runner]
								? "Model default"
								: "Native settings"}
						</option>
						{config.reasoningLevels?.[runner]?.map((level: string) => (
							<option key={level}>{level}</option>
						))}
					</select>
				</label>
			)}
			{config.serviceTierRunners?.includes(runner) && (
				<label>
					Service tier
					<select
						value={value.serviceTier ?? ""}
						onChange={(e) => set("serviceTier", e.target.value)}
					>
						<option value="">Default (native config)</option>
						<option value="standard">Standard</option>
						<option value="fast">Fast</option>
					</select>
					<small>
						Fast depends on model/account support and may cost more.
						{runner === "claude" ? " Requires compatible Opus." : ""}
					</small>
				</label>
			)}
		</div>
	);
}
