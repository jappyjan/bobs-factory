import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { type ReactNode, useEffect, useId, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { ExecutionSelection } from "../ExecutionProfiles";
import { useAction } from "./client";
import { ExecutionSelectors } from "./execution";
import { useCurrentForm, useFormState } from "./form-state";
import { AgentSettings } from "./forms";
import {
	AttachButton,
	AttachmentChips,
	uploadLimitsHint,
	useLaunchUploads,
} from "./launch-uploads";
import {
	ArrowUpIcon,
	BrainIcon,
	ChevronIcon,
	FolderIcon,
	SlidersIcon,
	SparkIcon,
} from "./launcher-icons";
import { revisionOf } from "./restoration";
import { Button, Modal, useToast } from "./ui";

const runners = ["claude", "codex", "gemini", "cursor", "opencode"];
const DEFAULT = "__default__";
const title = (value: string) => value[0]!.toUpperCase() + value.slice(1);

/** Only Simple takes a per-run agent; other recipes own agent settings per step. */
export const takesRunAgent = (workflowId: string | undefined) =>
	workflowId === "simple";

/** The per-run agent overrides a launch may carry for this recipe. */
export const runAgentOverrides = (
	workflowId: string | undefined,
	settings: Record<string, any>,
) => (takesRunAgent(workflowId) ? settings : {});

/** A borderless pill that opens a single-choice menu. */
function PillMenu({
	label,
	icon,
	value,
	options,
	onChange,
	disabled,
	children,
}: {
	label: string;
	icon?: ReactNode;
	value: string;
	options: { value: string; label: ReactNode; hint?: string }[];
	onChange: (value: string) => void;
	disabled?: boolean;
	children: ReactNode;
}) {
	return (
		<Dropdown.Root modal={false}>
			<Dropdown.Trigger asChild disabled={disabled}>
				<button type="button" className="launcher-pill" aria-label={label}>
					{icon}
					<span className="launcher-pill-text">{children}</span>
					<ChevronIcon />
				</button>
			</Dropdown.Trigger>
			<Dropdown.Portal>
				<Dropdown.Content
					className="theme-menu launcher-menu"
					side="bottom"
					align="start"
					sideOffset={8}
					collisionPadding={12}
				>
					<Dropdown.Label className="launcher-menu-label">
						{label}
					</Dropdown.Label>
					<Dropdown.RadioGroup value={value} onValueChange={onChange}>
						{options.map((option) => (
							<Dropdown.RadioItem
								key={option.value}
								value={option.value}
								className="theme-option"
							>
								<span>
									{option.label}
									{option.hint && <small>{option.hint}</small>}
								</span>
								<Dropdown.ItemIndicator>✓</Dropdown.ItemIndicator>
							</Dropdown.RadioItem>
						))}
					</Dropdown.RadioGroup>
				</Dropdown.Content>
			</Dropdown.Portal>
		</Dropdown.Root>
	);
}

/** The project name in the heading is the project selector. */
function ProjectHeading({
	projects,
	value,
	onChange,
	disabled,
}: {
	projects: any[];
	value: string;
	onChange: (id: string) => void;
	disabled: boolean;
}) {
	const selected = projects.find((project) => project.id === value);
	if (!selected)
		return <h1 className="launcher-heading">What should we build?</h1>;
	return (
		<h1 className="launcher-heading">
			What should we build in{" "}
			<Dropdown.Root modal={false}>
				<Dropdown.Trigger asChild disabled={disabled || projects.length < 2}>
					<button
						type="button"
						className="launcher-project"
						aria-label={`Project: ${selected.name}`}
					>
						<span className="launcher-project-name">{selected.name}</span>
					</button>
				</Dropdown.Trigger>
				<Dropdown.Portal>
					<Dropdown.Content
						className="theme-menu launcher-menu launcher-project-menu"
						align="center"
						sideOffset={10}
						collisionPadding={12}
					>
						<Dropdown.Label className="launcher-menu-label">
							Project
						</Dropdown.Label>
						<Dropdown.RadioGroup value={value} onValueChange={onChange}>
							{projects.map((project) => (
								<Dropdown.RadioItem
									key={project.id}
									value={project.id}
									className="theme-option"
								>
									<span>
										{project.name}
										{project.members?.length > 1 && (
											<small>
												{project.members.map((m: any) => m.name).join(" · ")}
											</small>
										)}
									</span>
									<Dropdown.ItemIndicator>✓</Dropdown.ItemIndicator>
								</Dropdown.RadioItem>
							))}
						</Dropdown.RadioGroup>
					</Dropdown.Content>
				</Dropdown.Portal>
			</Dropdown.Root>
			?
		</h1>
	);
}

/** A secondary declared input (for example a Takeover source or a choice). */
function DeclaredField({
	field,
	value,
	onChange,
}: {
	field: any;
	value: string;
	onChange: (value: string) => void;
}) {
	const id = useId();
	return (
		<div className="launcher-field">
			<label htmlFor={id}>
				{field.label}
				{field.required ? (
					<span className="required" aria-hidden="true">
						{" "}
						*
					</span>
				) : (
					<span className="launcher-optional"> optional</span>
				)}
			</label>
			{field.type === "select" ? (
				<select
					id={id}
					required={field.required}
					value={value}
					onChange={(event) => onChange(event.target.value)}
				>
					<option value="">{field.placeholder ?? "Choose…"}</option>
					{field.options?.map((option: any) => (
						<option value={option.value} key={option.value}>
							{option.label}
						</option>
					))}
				</select>
			) : field.type === "textarea" ? (
				<textarea
					id={id}
					rows={2}
					required={field.required}
					value={value}
					placeholder={field.placeholder}
					maxLength={100000}
					onChange={(event) => onChange(event.target.value)}
				/>
			) : (
				<input
					id={id}
					required={field.required}
					value={value}
					placeholder={field.placeholder}
					maxLength={field.name === "source" ? 1000 : 100000}
					onChange={(event) => onChange(event.target.value)}
				/>
			)}
			{field.description && <small>{field.description}</small>}
		</div>
	);
}

function PromptInput({
	field,
	value,
	onChange,
}: {
	field: any;
	value: string;
	onChange: (value: string) => void;
}) {
	const ref = useRef<HTMLTextAreaElement>(null);
	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		void value;
		element.style.height = "auto";
		element.style.height = `${Math.min(320, element.scrollHeight)}px`;
	}, [value]);
	return (
		<>
			<label htmlFor="composer-input" className="sr-only">
				{field.label}
			</label>
			<textarea
				ref={ref}
				id="composer-input"
				className="launcher-prompt"
				rows={3}
				value={value}
				required={field.required}
				placeholder={field.placeholder ?? field.label}
				maxLength={100000}
				onChange={(event) => onChange(event.target.value)}
			/>
		</>
	);
}

export function Composer({
	config,
	onStarted,
}: {
	config: any;
	onStarted: (id: string) => void;
}) {
	const toast = useToast(),
		navigate = useNavigate();
	const launchConfig = revisionOf([
		config.repositories,
		config.workflows.map(
			({
				enabled: _enabled,
				unavailable: _unavailable,
				ownership: _ownership,
				provenance: _provenance,
				...definition
			}: any) => definition,
		),
		config.defaultWorkflow,
		config.defaultRunner,
		config.reasoningLevels,
		config.serviceTierRunners,
		config.executionProfiles,
	]);
	const [workflowId, setWorkflow] = useFormState(
			launchConfig,
			config.defaultWorkflow,
		),
		[repo, setRepo] = useFormState(
			launchConfig,
			config.repositories[0]?.id ?? "",
		);
	const inputContext = `${launchConfig}/${repo}/${workflowId}`;
	const action = useAction("launch", inputContext);
	const isCurrent = useCurrentForm(inputContext);
	// Typed text survives project and recipe switches; fields are matched by name.
	const [values, setValues] = useFormState<Record<string, string>>(
			launchConfig,
			{},
		),
		[settings, setSettings] = useFormState<any>(launchConfig, {}),
		[execution, setExecution] = useFormState<ExecutionSelection>(
			inputContext,
			{},
		),
		[settingsOpen, setSettingsOpen] = useFormState(launchConfig, false),
		[dragging, setDragging] = useFormState(inputContext, false);
	// Building blocks stay startable on their own, listed after full recipes.
	const workflows = config.workflows
			.filter(
				(w: any) =>
					w.enabled !== false &&
					!w.unavailable?.length &&
					w.allowedTriggers.includes("manual"),
			)
			.sort((a: any, b: any) => Number(!!a.internal) - Number(!!b.internal)),
		workflow = workflows.find((w: any) => w.id === workflowId),
		fields: any[] = workflow?.launchFields ?? [];
	const main =
		fields.find(
			(field) => field.name === "prompt" && field.type === "textarea",
		) ?? fields.find((field) => field.type === "textarea");
	const declared = fields.filter(
		(field) => field !== main && field.type !== "files",
	);
	const fileFields = fields.filter((field) => field.type === "files");
	const uploads = useLaunchUploads(
		inputContext,
		config,
		repo,
		workflowId,
		fileFields.map((field) => field.name),
	);
	const project = config.repositories.find((item: any) => item.id === repo);
	const runner = settings.runner || config.defaultRunner;
	const levels: string[] | undefined = config.reasoningLevels?.[runner];
	// Chosen values are kept for Simple but never sent with another recipe.
	const agentChoice = takesRunAgent(workflow?.id);
	const runSettings = runAgentOverrides(workflow?.id, settings);
	const fieldValue = (field: any) =>
		values[field.name] ?? field.defaultValue ?? "";
	const missing = fields.some(
		(field) =>
			field.required &&
			(field.type === "files"
				? !uploads.selection[field.name]?.length
				: !fieldValue(field).trim()),
	);
	const blocked =
		action.isPending ||
		action.isBlocked ||
		!workflow ||
		!project ||
		missing ||
		uploads.blocked;
	const customized =
		["model", "modelVariant", "serviceTier"].some((key) => runSettings[key]) ||
		Boolean(execution.identityProfile || execution.toolProfile);
	const changeScope = (apply: () => void) => {
		uploads.carryOver();
		apply();
	};
	const submit = async () => {
		if (blocked) return;
		try {
			const inputs = Object.fromEntries(
				fields
					.filter((field) => field.type !== "files")
					.map((field) => [field.name, fieldValue(field)]),
			);
			const run = await action.mutateAsync({
				path: "/api/runs",
				body: {
					repositoryId: repo,
					repositoryIds: project.repositoryIds,
					workflow: workflow.id,
					inputs,
					attachments: uploads.selection,
					attachmentDraft: uploads.draft,
					...runSettings,
					execution,
				},
			});
			if (!isCurrent()) return;
			setValues({});
			uploads.reset();
			onStarted(run.id);
			toast({
				text: "Bob's on it 🌈",
				action: "View",
				onAction: () => navigate(`/runs/${run.id}`),
			});
		} catch {
			/* The current draft stays available for correction. */
		}
	};
	const takesFiles = fileFields.length > 0 && !action.isPending;
	const dropFiles = (files: File[]) => {
		if (takesFiles && files.length) uploads.add(fileFields[0].name, files);
	};
	return (
		<section aria-label="Start a run" className="launcher">
			<ProjectHeading
				projects={config.repositories}
				value={repo}
				disabled={action.isPending}
				onChange={(id) => changeScope(() => setRepo(id))}
			/>
			<p className="launcher-subtitle">
				{!config.repositories.length ? (
					<>
						Add a project in <Link to="/settings/setup">Project setup</Link> to
						start a run.
					</>
				) : workflow ? (
					workflow.description
				) : (
					<>
						{workflows.length
							? "Choose a recipe that allows manual starts."
							: "No recipes allow manual starts."}{" "}
						<Link to="/recipes">Enable Start manually in Recipes</Link>.
					</>
				)}
			</p>
			<form
				className="launcher-card"
				data-dragging={dragging || undefined}
				onSubmit={(event) => {
					event.preventDefault();
					void submit();
				}}
				onKeyDown={(event) => {
					if (
						event.key === "Enter" &&
						!event.shiftKey &&
						!event.nativeEvent.isComposing &&
						event.nativeEvent.keyCode !== 229 &&
						event.target === document.getElementById("composer-input")
					) {
						event.preventDefault();
						event.currentTarget.requestSubmit();
					}
				}}
				onDragOver={(event) => {
					if (!takesFiles || !event.dataTransfer.types.includes("Files"))
						return;
					event.preventDefault();
					if (!dragging) setDragging(true);
				}}
				onDragLeave={(event) => {
					if (!event.currentTarget.contains(event.relatedTarget as Node))
						setDragging(false);
				}}
				onDrop={(event) => {
					if (!takesFiles) return;
					event.preventDefault();
					setDragging(false);
					dropFiles(Array.from(event.dataTransfer.files));
				}}
				onPaste={(event) => {
					const files = Array.from(event.clipboardData.files);
					if (!takesFiles || !files.length) return;
					event.preventDefault();
					dropFiles(files);
				}}
			>
				<fieldset className="launcher-body" disabled={action.isPending}>
					<AttachmentChips
						uploads={uploads}
						labels={
							fileFields.length > 1
								? Object.fromEntries(
										fileFields.map((field) => [field.name, field.label]),
									)
								: undefined
						}
					/>
					{declared.length > 0 && (
						<div className="launcher-fields">
							{declared.map((field) => (
								<DeclaredField
									key={field.name}
									field={field}
									value={fieldValue(field)}
									onChange={(value) =>
										setValues({ ...values, [field.name]: value })
									}
								/>
							))}
						</div>
					)}
					{main && (
						<PromptInput
							field={main}
							value={fieldValue(main)}
							onChange={(value) => setValues({ ...values, [main.name]: value })}
						/>
					)}
				</fieldset>
				<div className="launcher-bar">
					<div className="launcher-pills">
						<PillMenu
							label="Recipe"
							value={workflow?.id ?? ""}
							disabled={action.isPending || !workflows.length}
							onChange={(id) => changeScope(() => setWorkflow(id))}
							options={workflows.map((item: any) => ({
								value: item.id,
								label: `${item.icon ?? "🧩"} ${item.name}`,
								hint: item.internal
									? `Building block${item.description ? ` · ${item.description}` : ""}`
									: item.description,
							}))}
						>
							{workflow ? (
								<>
									<span aria-hidden="true">{workflow.icon ?? "🧩"}</span>{" "}
									{workflow.name}
								</>
							) : (
								"Choose recipe"
							)}
						</PillMenu>
						{agentChoice && (
							<>
								<span className="launcher-divider" aria-hidden="true" />
								<PillMenu
									label="Agent"
									icon={<SparkIcon />}
									value={settings.runner ?? DEFAULT}
									disabled={action.isPending}
									onChange={(next) =>
										setSettings({
											...settings,
											runner: next === DEFAULT ? undefined : next,
											model: undefined,
											reasoningEffort: undefined,
											modelVariant: undefined,
											serviceTier: undefined,
										})
									}
									options={[
										{
											value: DEFAULT,
											label: `Default (${title(config.defaultRunner)})`,
											hint: "Uses each step's configured agent",
										},
										...runners.map((value) => ({ value, label: title(value) })),
									]}
								>
									{settings.model || title(runner)}
								</PillMenu>
								{levels?.length ? (
									<span className="launcher-reasoning">
										<span className="launcher-divider" aria-hidden="true" />
										<PillMenu
											label="Reasoning"
											icon={<BrainIcon />}
											value={settings.reasoningEffort ?? DEFAULT}
											disabled={action.isPending}
											onChange={(next) =>
												setSettings({
													...settings,
													reasoningEffort: next === DEFAULT ? undefined : next,
												})
											}
											options={[
												{ value: DEFAULT, label: "Model default" },
												...levels.map((level) => ({
													value: level,
													label: title(level),
												})),
											]}
										>
											{settings.reasoningEffort
												? title(settings.reasoningEffort)
												: "Default"}
										</PillMenu>
									</span>
								) : null}
							</>
						)}
					</div>
					<div className="launcher-actions">
						<button
							type="button"
							className="launcher-icon-button"
							aria-label="Run settings"
							title="Run settings"
							data-active={customized || undefined}
							disabled={action.isPending}
							onClick={() => setSettingsOpen(true)}
						>
							<SlidersIcon />
						</button>
						{fileFields.map((field) => (
							<AttachButton
								key={field.name}
								field={field}
								uploads={uploads}
								disabled={action.isPending || action.isBlocked}
							/>
						))}
						<Button
							type="submit"
							variant="launcher-send"
							aria-label="Start run"
							requiresConnection
							busy={action.isPending}
							disabled={blocked}
						>
							{!action.isPending && <ArrowUpIcon />}
						</Button>
					</div>
				</div>
				{dragging && (
					<div className="launcher-drop" aria-hidden="true">
						Drop files to attach
					</div>
				)}
			</form>
			<div className="launcher-tray">
				<span className="launcher-scope">
					{project && (
						<>
							<FolderIcon />
							<span className="launcher-scope-name">
								{project.members?.length > 1
									? project.members.map((m: any) => m.name).join(" · ")
									: project.name}
							</span>
						</>
					)}
				</span>
				<span className="launcher-tray-hint">
					{takesFiles && <span>{uploadLimitsHint}</span>}
					<span className="keyboard-hint">⏎ start · ⇧⏎ new line</span>
				</span>
			</div>
			{action.error && (
				<p className="error launcher-error" role="alert">
					{action.error.message}
				</p>
			)}
			<Modal
				open={settingsOpen}
				onOpenChange={setSettingsOpen}
				title="Run settings"
				description="Overrides for this run only. Recipes keep their saved defaults."
			>
				<div className="modal-body launcher-settings">
					{agentChoice && (
						<AgentSettings
							config={config}
							value={settings}
							onChange={setSettings}
							label="Default"
						/>
					)}
					<ExecutionSelectors
						key={inputContext}
						config={config}
						repositoryId={repo}
						workflow={workflow?.id}
						model={runSettings.model}
						value={execution}
						onChange={setExecution}
						runner={runSettings.runner}
					/>
					<Button onClick={() => setSettingsOpen(false)}>Done</Button>
				</div>
			</Modal>
		</section>
	);
}
