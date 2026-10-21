import { ReactFlowProvider } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { passiveTools } from "../CapacityPolicy";
import { DEFAULT_STEP_MAX_VISITS, MAX_STEP_VISITS } from "../WorkflowLimits";
import { AgentStepSettings } from "./agent-step-settings";
import { useAction, useConfig } from "./client";
import { AgentSettings } from "./forms";
import { RecipeCanvas, type Simulation } from "./recipe-canvas";
import {
	connect,
	describeCondition,
	draftProblems,
	editableOf,
	fallbackOf,
	findStep,
	insertStepAfter,
	kindOf,
	kinds,
	newStep,
	outcomesOf,
	phasesOf,
	type Recipe,
	recipeGraph,
	removeStep,
	routesOf,
	type Step,
	stepName,
	stepSummary,
	toolText,
	triggers,
	uniqueStepId,
	updateStep,
} from "./recipe-graph";
import { Switch, useAvailability, useDefaultRecipe } from "./recipes";
import { revisionOf } from "./restoration";
import { Button, useToast } from "./ui";

const nativeKeys = [
	"runner",
	"model",
	"reasoningEffort",
	"modelVariant",
	"serviceTier",
] as const;
const forkable = ["factory", "takeover"];
const paletteKinds = [
	"agent",
	"human",
	"tool",
	"script",
	"fanout",
	"workflow",
] as const;
const revision = (recipe?: Recipe) =>
	recipe ? revisionOf(editableOf(recipe)) : "missing";
const isLocal = (recipe?: Recipe) => recipe?.ownership !== "bundled";

/**
 * Edits stay in a draft until saved. Each edited recipe remembers the version
 * it started from, so a change made elsewhere is reported instead of overwritten.
 */
function useRecipeDraft(server: Recipe[], nativeServer: Record<string, any>) {
	const [edits, setEdits] = useState<
		Record<string, { recipe: Recipe; base: string }>
	>({});
	const [native, setNative] = useState<Record<string, any>>();
	const byId = (id: string) => server.find((r) => r.id === id);
	const isDirty = (id: string) =>
		!!edits[id] && revision(edits[id].recipe) !== edits[id].base;
	const dirtyIds = Object.keys(edits).filter(isDirty);
	const nativeDirty =
		!!native && revisionOf(native) !== revisionOf(nativeServer);
	return {
		lookup: (id: string): Recipe | undefined =>
			isDirty(id) ? edits[id]!.recipe : byId(id),
		recipes: server
			.map((r) => (isDirty(r.id) ? edits[r.id]!.recipe : r))
			.concat(
				dirtyIds.filter((id) => !byId(id)).map((id) => edits[id]!.recipe),
			),
		dirtyIds,
		dirty: dirtyIds.length > 0 || nativeDirty,
		conflicts: dirtyIds.filter(
			(id) => byId(id) && revision(byId(id)) !== edits[id]!.base,
		),
		native: native ?? nativeServer,
		nativeDirty,
		edit(id: string, fn: (recipe: Recipe) => Recipe, fresh?: Recipe) {
			setEdits((all) => {
				const existing = all[id];
				const live = existing && revision(existing.recipe) !== existing.base;
				const start = live
					? existing
					: {
							recipe: structuredClone(byId(id) ?? fresh!),
							base: byId(id) ? revision(byId(id)) : "new",
						};
				return { ...all, [id]: { ...start, recipe: fn(start.recipe) } };
			});
		},
		setNative,
		reset() {
			setEdits({});
			setNative(undefined);
		},
	};
}

export function RecipeBuilder({ id }: { id: string }) {
	const config = useConfig("recipes").data;
	const toast = useToast();
	const [params, setParams] = useSearchParams();
	const [created] = useState(() => `recipe-${Date.now().toString(36)}`);
	const recipeId = id === "new" ? created : id;
	const nativeServer =
		config.workflowConfiguration?.preferences?.simple?.native ?? {};
	const draft = useRecipeDraft(config.workflows, nativeServer);
	const recipe =
		draft.lookup(recipeId) ??
		(id === "new"
			? ({
					id: created,
					icon: "🧩",
					name: "New recipe",
					description: "",
					labels: [],
					allowedTriggers: ["workflow", "manual", "ticket-assignment"],
					ownership: "local",
					stepConfigVersion: "step-config-v1",
					steps: [newStep("agent", "work")],
				} as Recipe)
			: undefined);
	const action = useAction("workflows", `recipe/${recipeId}`);
	const availability = useAvailability();
	const fallback = useDefaultRecipe();
	const [panel, setPanel] = useState<"settings" | "json">();
	const [simulation, setSimulation] = useState<Simulation>();
	const [error, setError] = useState("");
	const [draftGeneration, setDraftGeneration] = useState(0);
	const [settingsErrors, setSettingsErrors] = useState<Record<string, string>>(
		{},
	);
	const selectedId = params.get("step") ?? undefined;
	const reportConfigError = useCallback(
		(field: string, error: string) => {
			setSettingsErrors((current) => {
				const key = `${selectedId}/${field}`;
				return current[key] === error ? current : { ...current, [key]: error };
			});
		},
		[selectedId],
	);
	const select = (step?: string) =>
		setParams(
			(p) => {
				const next = new URLSearchParams(p);
				if (step) next.set("step", step);
				else next.delete("step");
				return next;
			},
			{ replace: true },
		);

	const dirtyRef = useRef(false);
	dirtyRef.current =
		draft.dirty || id === "new" || Object.values(settingsErrors).some(Boolean);
	useEffect(() => {
		const warn = (event: BeforeUnloadEvent) => {
			if (dirtyRef.current) event.preventDefault();
		};
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, []);

	// Escape steps back: close a panel, stop simulating, then clear the selection.
	const onEscape = useRef(() => {});
	onEscape.current = () => {
		if (panel) setPanel(undefined);
		else if (simulation) setSimulation(undefined);
		else select(undefined);
	};
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement;
			if (
				event.key !== "Escape" ||
				target.closest("input, textarea, select, .modal")
			)
				return;
			onEscape.current();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	const graph = useMemo(
		() => (recipe ? recipeGraph(recipe, draft.recipes) : undefined),
		[recipe, draft.recipes],
	);
	if (!recipe || !graph)
		return (
			<div className="recipe-builder recipe-missing">
				<p>This recipe no longer exists.</p>
				<Button onClick={() => setParams({})}>← Recipes</Button>
			</div>
		);

	const steps = graph.steps;
	const ownerOf = (stepId: string) =>
		draft.lookup(graph.owners[stepId] ?? recipe.id) ?? recipe;
	const editableOwner = (stepId?: string) => {
		const owner = stepId ? ownerOf(stepId) : undefined;
		if (owner && isLocal(owner)) return owner;
		const last = steps.at(-1);
		const end = last ? ownerOf(last.id) : recipe;
		return !stepId && isLocal(end) ? end : undefined;
	};
	const edit = (owner: Recipe, fn: (r: Recipe) => Recipe) => {
		// A save problem is about the previous draft; editing is how it gets fixed.
		setError("");
		draft.edit(owner.id, fn, owner.id === recipe.id ? recipe : undefined);
	};
	// A parallel branch is selected as "parent/child"; IDs are only unique per list.
	const [top, child] = selectedId?.includes("/")
		? (selectedId.split("/") as [string, string])
		: [selectedId, undefined];
	const takenIds = new Set(
		draft.recipes.flatMap((r) => {
			const ids: string[] = [];
			const walk = (list: Step[]) => {
				for (const s of list) {
					ids.push(s.id);
					for (const g of s.groups ?? []) walk(g);
				}
			};
			walk(r.steps);
			return ids;
		}),
	);
	const add = (kind: string, after?: string) => {
		const owner = editableOwner(after);
		if (!owner) {
			setError("Bundled steps are read-only. Fork this recipe to add steps.");
			return;
		}
		const stepId = uniqueStepId(takenIds, kind);
		const callable = draft.recipes.find(
			(r) => r.id !== owner.id && r.allowedTriggers.includes("workflow"),
		)?.id;
		const anchor =
			after && graph.owners[after] === owner.id
				? after
				: owner.steps.at(-1)?.id;
		edit(owner, (r) =>
			insertStepAfter(r, anchor, newStep(kind as never, stepId, callable)),
		);
		setSimulation(undefined);
		select(stepId);
	};
	const problems = [
		...Object.values(settingsErrors).filter(Boolean),
		...draft.dirtyIds.flatMap((rid) =>
			draftProblems(draft.lookup(rid)!).map((p) =>
				rid === recipe.id ? p : `${draft.lookup(rid)!.name}: ${p}`,
			),
		),
	];
	const unsaved =
		draft.dirty || id === "new" || Object.values(settingsErrors).some(Boolean);

	async function save() {
		setError("");
		if (problems.length) {
			setError(problems[0]!);
			return;
		}
		try {
			if (draft.dirtyIds.length || id === "new") {
				const changed = new Map(
					[...draft.dirtyIds, ...(id === "new" ? [recipe!.id] : [])].map(
						(rid) => [rid, draft.lookup(rid) ?? recipe!],
					),
				);
				await action.mutateAsync({
					path: "/api/workflows",
					method: "PATCH",
					body: { workflows: [...changed.values()] },
				});
			}
			if (draft.nativeDirty)
				await action.mutateAsync({
					path: "/api/workflows/simple/preferences",
					method: "PUT",
					body: {
						native: Object.fromEntries(
							nativeKeys
								.filter((k) => draft.native[k] !== undefined)
								.map((k) => [k, draft.native[k]]),
						),
					},
				});
			draft.reset();
			toast({ text: "Recipe saved" });
			if (id === "new") setParams({ recipe: created });
		} catch {
			// The action error is shown in the toolbar.
		}
	}
	const leave = () => {
		if (
			unsaved &&
			!window.confirm(
				"Leave without saving? Your changes to this recipe will be lost.",
			)
		)
			return;
		setParams({});
	};
	const simulate = () => {
		setPanel(undefined);
		select(undefined);
		setSimulation(
			simulation || !steps[0]
				? undefined
				: { trail: [steps[0].id], visits: { [steps[0].id]: 1 } },
		);
	};
	const ownedTop =
		top && steps.some((s) => s.id === top)
			? ownerOf(top).steps.find((s) => s.id === top)
			: undefined;
	const selectedStep = child
		? findStep((ownedTop?.groups ?? []).flat(), child)
		: ownedTop;
	const nativeSelected = recipe.id === "simple" && selectedId === "native";

	return (
		<div className="recipe-builder">
			<header className="recipe-topbar">
				<button type="button" className="recipe-back" onClick={leave}>
					← Recipes
				</button>
				{isLocal(recipe) ? (
					<input
						className="recipe-icon-input"
						aria-label="Recipe icon"
						value={recipe.icon ?? ""}
						maxLength={8}
						onChange={(e) =>
							edit(recipe, (r) => ({ ...r, icon: e.target.value || undefined }))
						}
					/>
				) : (
					<span className="recipe-emoji">{recipe.icon ?? "🧩"}</span>
				)}
				<div className="recipe-title">
					{isLocal(recipe) ? (
						<input
							aria-label="Recipe name"
							value={recipe.name}
							onChange={(e) =>
								edit(recipe, (r) => ({ ...r, name: e.target.value }))
							}
						/>
					) : (
						<h1>{recipe.name}</h1>
					)}
					<span className="recipe-badges">
						{!isLocal(recipe) ? (
							<span className="recipe-badge">🔒 Bundled</span>
						) : recipe.provenance ? (
							<span className="recipe-badge local">
								Fork of {recipe.provenance.source}
							</span>
						) : (
							<span className="recipe-badge local">Yours</span>
						)}
						{graph.included.map((included) => (
							<span key={included} className="recipe-badge included">
								🧩 includes {draft.lookup(included)?.name ?? included}
							</span>
						))}
						{recipe.enabled === false && (
							<span className="recipe-badge warn">Disabled</span>
						)}
						{config.defaultWorkflow === recipe.id && (
							<span className="recipe-badge default">★ Default</span>
						)}
					</span>
				</div>
				<div className="recipe-topbar-actions">
					{unsaved && (
						<>
							<span className="recipe-unsaved" role="status">
								Unsaved changes
							</span>
							{id !== "new" && (
								<Button
									variant="ghost"
									onClick={() => {
										draft.reset();
										setSettingsErrors({});
										setDraftGeneration((value) => value + 1);
									}}
								>
									Discard
								</Button>
							)}
							<Button
								requiresConnection
								busy={action.isPending}
								disabled={draft.conflicts.length > 0 || problems.length > 0}
								onClick={() => void save()}
							>
								Save
							</Button>
						</>
					)}
					<Button
						variant="secondary"
						disabled={!steps.length}
						aria-pressed={!!simulation}
						onClick={simulate}
					>
						{simulation ? "■ Stop" : "▶ Simulate"}
					</Button>
					<Button
						variant="secondary"
						aria-pressed={panel === "settings"}
						onClick={() => {
							setPanel(panel === "settings" ? undefined : "settings");
							setSimulation(undefined);
						}}
					>
						⚙ Settings
					</Button>
					<Button
						variant="secondary"
						aria-pressed={panel === "json"}
						onClick={() => {
							setPanel(panel === "json" ? undefined : "json");
							setSimulation(undefined);
						}}
					>
						{"{ }"} JSON
					</Button>
				</div>
			</header>
			{(error ||
				action.error ||
				draft.conflicts.length > 0 ||
				!!recipe.unavailable?.length) && (
				<div className="recipe-alerts">
					{draft.conflicts.length > 0 && (
						<p className="error" role="alert">
							This recipe changed elsewhere while you were editing.{" "}
							<button
								type="button"
								className="link"
								onClick={() => draft.reset()}
							>
								Discard my changes and reload
							</button>
						</p>
					)}
					{!!recipe.unavailable?.length && (
						<p className="error">
							Unavailable: {recipe.unavailable.join(", ")}. Enable the
							dependency or edit a local graph. A disabled default rejects
							launches.
						</p>
					)}
					{(error || action.error) && (
						<p className="error" role="alert">
							{error || action.error?.message}
						</p>
					)}
				</div>
			)}
			<div className="recipe-workspace">
				<ReactFlowProvider>
					{steps.length ? (
						<RecipeCanvas
							steps={steps}
							defaultRunner={config.defaultRunner}
							selected={top}
							selectedChild={child}
							onSelect={(stepId) => {
								setPanel(undefined);
								select(stepId);
							}}
							simulation={simulation}
							connectable={(from, to) => {
								const owner = graph.owners[from];
								return (
									isLocal(draft.lookup(owner ?? "")) &&
									(to === undefined ||
										(to !== from && graph.owners[to] === owner))
								);
							}}
							onConnect={(from, to) => {
								edit(ownerOf(from), (r) => connect(r, from, to));
								select(from);
							}}
							onDropKind={add}
						/>
					) : (
						<NativeCanvas
							recipe={recipe}
							native={draft.native}
							defaultRunner={config.defaultRunner}
							selected={nativeSelected}
							onSelect={() => select("native")}
						/>
					)}
				</ReactFlowProvider>
				{!simulation && steps.length > 0 && (
					<Palette
						disabled={!editableOwner(top)}
						onAdd={(kind) => add(kind, top)}
					/>
				)}
				{panel === "settings" && (
					<SettingsPanel
						recipe={recipe}
						config={config}
						onChange={(fn) => edit(recipe, fn)}
						onClose={() => setPanel(undefined)}
						availability={availability}
						fallback={fallback}
						onForked={(fork) => setParams({ recipe: fork })}
					/>
				)}
				{panel === "json" && (
					<JsonPanel
						recipe={recipe}
						onApply={(value) => edit(recipe, () => value)}
						onClose={() => setPanel(undefined)}
					/>
				)}
				{!panel && !simulation && selectedStep && top && (
					<Inspector
						key={`${selectedId}/${draftGeneration}`}
						step={selectedStep}
						parent={child ? ownedTop : undefined}
						owner={ownerOf(top)}
						opened={recipe}
						displayed={steps}
						recipes={draft.recipes}
						config={config}
						onChange={(patch) =>
							edit(ownerOf(top), (r) =>
								updateStep(r, selectedStep.id, patch, child ? top : undefined),
							)
						}
						onConfigError={reportConfigError}
						onRemove={() => {
							setSettingsErrors({});
							edit(ownerOf(top), (r) => removeStep(r, selectedStep.id));
							select(undefined);
						}}
						onSelect={select}
						onOpenRecipe={(rid) => setParams({ recipe: rid })}
						onClose={() => select(undefined)}
					/>
				)}
				{!panel && !simulation && nativeSelected && (
					<aside className="recipe-panel" aria-label="Simple agent settings">
						<PanelHeader
							title="Native agent run"
							onClose={() => select(undefined)}
						/>
						<p className="muted">
							Simple hands the whole job to one agent conversation with Bob’s
							original prompts and skills. Choose which agent runs it.
						</p>
						<AgentSettings
							config={config}
							value={draft.native}
							onChange={(value) => draft.setNative(value)}
						/>
					</aside>
				)}
				{simulation && (
					<SimulationPanel
						steps={steps}
						recipes={draft.recipes}
						simulation={simulation}
						onChange={setSimulation}
					/>
				)}
			</div>
			{availability.modal}
		</div>
	);
}

function NativeCanvas({
	recipe,
	native,
	defaultRunner,
	selected,
	onSelect,
}: {
	recipe: Recipe;
	native: Record<string, any>;
	defaultRunner: string;
	selected: boolean;
	onSelect: () => void;
}) {
	return (
		<div className="recipe-native">
			<button
				type="button"
				className="recipe-node"
				data-tone="violet"
				data-selected={selected}
				onClick={onSelect}
			>
				<span className="recipe-node-main">
					<span className="recipe-node-icon">{recipe.icon ?? "⚡"}</span>
					<span className="recipe-node-text">
						<b>Native agent run</b>
						<small>
							{native.runner ?? `Default (${defaultRunner})`}
							{native.model ? ` · ${native.model}` : ""}
						</small>
					</span>
				</span>
			</button>
			<span className="recipe-native-arrow">→</span>
			<span className="recipe-end">🏁</span>
		</div>
	);
}

function Palette({
	disabled,
	onAdd,
}: {
	disabled: boolean;
	onAdd: (kind: string) => void;
}) {
	const [open, setOpen] = useState(false);
	return (
		<div className="recipe-palette" data-open={open}>
			<button
				type="button"
				className="recipe-palette-toggle"
				aria-expanded={open}
				onClick={() => setOpen(!open)}
			>
				＋ <span>Add step</span>
			</button>
			<div className="recipe-palette-items">
				<p>{disabled ? "Fork to add steps" : "Click, or drag onto a step"}</p>
				{paletteKinds.map((kind) => (
					<button
						key={kind}
						type="button"
						draggable={!disabled}
						disabled={disabled}
						data-tone={kinds[kind].tone}
						title={kinds[kind].hint}
						onDragStart={(e) => {
							e.dataTransfer.setData("application/x-recipe-step", kind);
							e.dataTransfer.effectAllowed = "copy";
						}}
						onClick={() => {
							onAdd(kind);
							setOpen(false);
						}}
					>
						<span>{kinds[kind].icon}</span>
						{kind === "human" ? "Ask me" : kinds[kind].label}
					</button>
				))}
			</div>
		</div>
	);
}

function PanelHeader({
	title,
	children,
	onClose,
}: {
	title: React.ReactNode;
	children?: React.ReactNode;
	onClose: () => void;
}) {
	return (
		<div className="recipe-panel-head">
			{children}
			<h2>{title}</h2>
			<button
				type="button"
				className="recipe-close"
				onClick={onClose}
				aria-label="Close panel"
			>
				×
			</button>
		</div>
	);
}

function Inspector({
	step,
	parent,
	owner,
	opened,
	displayed,
	recipes,
	config,
	onChange,
	onRemove,
	onConfigError,
	onSelect,
	onOpenRecipe,
	onClose,
}: {
	step: Step;
	parent?: Step;
	owner: Recipe;
	opened: Recipe;
	displayed: Step[];
	recipes: Recipe[];
	config: any;
	onChange: (patch: Partial<Step>) => void;
	onRemove: () => void;
	onConfigError: (field: string, error: string) => void;
	onSelect: (id: string) => void;
	onOpenRecipe: (id: string) => void;
	onClose: () => void;
}) {
	const local = isLocal(owner);
	const kind = kindOf(step);
	const phase = phasesOf(displayed)[parent?.id ?? step.id];
	const [showPrompt, setShowPrompt] = useState(local);
	const targets = [
		...owner.steps.filter((s) => s.id !== step.id),
		{ id: "end", name: "Finish" },
	];
	const topLevel = !parent;
	const fallback = topLevel ? fallbackOf(owner.steps, step) : undefined;
	const heavy = step.type === "script" || step.tool === "exec";
	const comesFrom = routesOf(displayed).filter((r) => r.to === step.id);
	const panel = useRef<HTMLElement>(null);
	const unnamed = step.branches.filter((b) => !b.when.path).length;
	// A route drawn on the canvas still needs its condition; take the user there.
	useEffect(() => {
		if (!unnamed) return;
		const input = panel.current?.querySelector<HTMLInputElement>(
			'.recipe-routes li[data-new="true"] input',
		);
		input?.scrollIntoView({ block: "center", behavior: "smooth" });
		input?.focus({ preventScroll: true });
	}, [unnamed]);
	return (
		<aside
			className="recipe-panel"
			aria-label={`${step.name} settings`}
			ref={panel}
		>
			<PanelHeader
				title={
					local ? (
						<input
							aria-label="Step name"
							value={step.name}
							onChange={(e) => onChange({ name: e.target.value })}
						/>
					) : (
						step.name
					)
				}
				onClose={onClose}
			>
				<span className="recipe-chips">
					<span className="recipe-kind" data-tone={kind.tone}>
						{kind.icon} {kind.label}
					</span>
					{phase && (
						<span
							className="recipe-phase"
							style={{ ["--phase" as string]: phase.color }}
						>
							{phase.label}
						</span>
					)}
				</span>
			</PanelHeader>
			<p className="muted">{stepSummary(step, recipes)}</p>
			{parent && (
				<p className="recipe-note">
					Runs inside{" "}
					<button
						type="button"
						className="link"
						onClick={() => onSelect(parent.id)}
					>
						{parent.name}
					</button>
					. Add or remove parallel branches in the recipe JSON.
				</p>
			)}
			{owner.id !== opened.id && (
				<p className="recipe-note">
					Part of 🧩 {owner.name}
					{local
						? ". Saving also updates that building block."
						: ". Its steps are bundled; you can still tune agents."}
				</p>
			)}

			{step.type === "agent" && (
				<section className="recipe-section">
					<h3>Who does it</h3>
					<AgentSettings
						config={config}
						value={step}
						onChange={(value) => onChange(value)}
					/>
				</section>
			)}
			{step.type === "agent" && (
				<section className="recipe-section">
					<h3>
						Instructions{" "}
						{!local && (
							<button
								type="button"
								className="link"
								onClick={() => setShowPrompt(!showPrompt)}
							>
								{showPrompt ? "hide" : "show"}
							</button>
						)}
					</h3>
					{showPrompt && (
						<textarea
							className="recipe-prompt"
							aria-label="Instructions"
							rows={local ? 9 : 7}
							readOnly={!local}
							value={step.prompt ?? ""}
							onChange={(e) => onChange({ prompt: e.target.value })}
						/>
					)}
					{local && (
						<>
							<label className="recipe-check">
								<input
									type="checkbox"
									checked={!!step.askQuestions}
									onChange={(e) =>
										onChange({ askQuestions: e.target.checked || undefined })
									}
								/>
								May pause to ask you questions
							</label>
							<label className="recipe-check">
								<input
									type="checkbox"
									checked={step.json !== false}
									onChange={(e) => onChange({ json: e.target.checked })}
								/>
								Structured JSON output
							</label>
						</>
					)}
				</section>
			)}
			{step.type === "agent" && (
				<AgentStepSettings
					step={step}
					readOnly={!local}
					onChange={onChange}
					onError={onConfigError}
				/>
			)}
			{(step.type === "tool" || step.type === "script") && local && (
				<section className="recipe-section">
					<h3>What runs</h3>
					{step.type === "tool" ? (
						<label>
							Built-in action
							<input
								list="recipe-tools"
								value={step.tool ?? ""}
								onChange={(e) => onChange({ tool: e.target.value })}
							/>
							<datalist id="recipe-tools">
								{Object.keys(toolText).map((tool) => (
									<option key={tool} value={tool} />
								))}
							</datalist>
						</label>
					) : (
						<label>
							Script
							<textarea
								className="recipe-prompt"
								rows={4}
								value={step.script ?? ""}
								onChange={(e) => onChange({ script: e.target.value })}
							/>
						</label>
					)}
					<label>
						Capacity
						<select
							value={
								step.computeIntensive === undefined
									? "default"
									: String(step.computeIntensive)
							}
							onChange={(e) =>
								onChange({
									computeIntensive:
										e.target.value === "default"
											? undefined
											: e.target.value === "true",
								})
							}
						>
							<option value="default">
								Default ({heavy ? "one slot" : "lightweight"})
							</option>
							<option
								value="true"
								disabled={passiveTools.includes(step.tool ?? "")}
							>
								Intensive (one slot)
							</option>
							<option value="false">Lightweight (no slot)</option>
						</select>
					</label>
				</section>
			)}
			{step.type === "fanout" && (
				<section className="recipe-section">
					<h3>Runs in parallel</h3>
					<ul className="recipe-branches">
						{step.groups?.map((group) => (
							<li key={group[0]!.id}>
								{group.map((child) => (
									<button
										key={child.id}
										type="button"
										onClick={() => onSelect(`${step.id}/${child.id}`)}
									>
										<span>
											{kindOf(child).icon} {child.name}
										</span>
										<small>
											{child.type === "agent"
												? (child.runner ?? `Default (${config.defaultRunner})`)
												: kindOf(child).label}
										</small>
									</button>
								))}
							</li>
						))}
					</ul>
				</section>
			)}
			{step.type === "workflow" && (
				<section className="recipe-section">
					<h3>Recipe to run</h3>
					{local ? (
						<select
							aria-label="Recipe to run"
							value={step.workflow ?? ""}
							onChange={(e) => onChange({ workflow: e.target.value })}
						>
							<option value="">Choose a recipe</option>
							{recipes
								.filter(
									(r) =>
										r.id !== owner.id && r.allowedTriggers.includes("workflow"),
								)
								.map((r) => (
									<option key={r.id} value={r.id}>
										{r.name}
									</option>
								))}
						</select>
					) : null}
					{step.workflow && (
						<Button
							variant="secondary"
							onClick={() => onOpenRecipe(step.workflow!)}
						>
							Open “
							{recipes.find((r) => r.id === step.workflow)?.name ??
								step.workflow}
							”
						</Button>
					)}
				</section>
			)}

			{topLevel && (
				<section className="recipe-section">
					<h3>Where it goes next</h3>
					<ul className="recipe-routes">
						{step.branches.map((branch, index) => (
							<li key={`${index}-${branch.next}`} data-new={!branch.when.path}>
								{local ? (
									<span className="recipe-route-when">
										When
										<input
											aria-label="Output field"
											placeholder="output field"
											value={branch.when.path}
											onChange={(e) =>
												onChange({
													branches: step.branches.map((b, j) =>
														j === index
															? {
																	...b,
																	when: { ...b.when, path: e.target.value },
																}
															: b,
													),
												})
											}
										/>
										is
										<input
											aria-label="Value"
											className="short"
											defaultValue={JSON.stringify(branch.when.equals)}
											onChange={(e) => {
												let equals: unknown = e.target.value;
												try {
													equals = JSON.parse(e.target.value);
												} catch {}
												onChange({
													branches: step.branches.map((b, j) =>
														j === index
															? { ...b, when: { ...b.when, equals } }
															: b,
													),
												});
											}}
										/>
									</span>
								) : (
									<span className="recipe-route-when">
										If <b>{describeCondition(branch.when)}</b>
									</span>
								)}
								<RouteTarget
									value={branch.next}
									targets={targets}
									editable={local}
									onSelect={onSelect}
									onChange={(next) =>
										onChange({
											branches: step.branches.map((b, j) =>
												j === index ? { ...b, next } : b,
											),
										})
									}
								/>
								{local && (
									<button
										type="button"
										className="recipe-close"
										aria-label="Remove route"
										onClick={() =>
											onChange({
												branches: step.branches.filter((_, j) => j !== index),
											})
										}
									>
										×
									</button>
								)}
							</li>
						))}
						<li>
							<span className="recipe-route-when">
								{step.branches.length ? "Otherwise" : "Then"}
							</span>
							<RouteTarget
								value={fallback!}
								targets={targets}
								editable={local}
								onSelect={onSelect}
								onChange={(next) => onChange({ next })}
							/>
						</li>
					</ul>
					{local && (
						<button
							type="button"
							className="link"
							onClick={() =>
								onChange({
									branches: [
										...step.branches,
										{
											when: { path: "approved", equals: false },
											next: fallback!,
										},
									],
								})
							}
						>
							＋ Add a condition
						</button>
					)}
					{local && (
						<p className="muted small">
							Conditions read the step’s JSON output. The first match wins;
							otherwise the run continues as shown. Tip: drag from a step’s
							right edge onto another step to add a route.
						</p>
					)}
					{comesFrom.length > 0 && (
						<p className="recipe-comes-from">
							Reached from{" "}
							{comesFrom.map((r) => (
								<button
									key={`${r.from}-${r.index ?? "next"}`}
									type="button"
									className="link"
									onClick={() => onSelect(r.from)}
								>
									{stepName(displayed, r.from)}
									{r.kind === "branch" ? ` (${r.label})` : ""}
								</button>
							))}
						</p>
					)}
				</section>
			)}
			{topLevel && (
				<section className="recipe-section">
					<h3>Safety limit</h3>
					<label className="recipe-inline">
						Stop after
						<input
							type="number"
							className="short"
							min={1}
							max={MAX_STEP_VISITS}
							disabled={!local}
							value={step.maxVisits ?? DEFAULT_STEP_MAX_VISITS}
							onChange={(e) => onChange({ maxVisits: Number(e.target.value) })}
						/>
						visits to this step
					</label>
				</section>
			)}
			{local && topLevel && owner.steps.length > 1 && (
				<Button variant="danger" onClick={onRemove}>
					Delete step
				</Button>
			)}
		</aside>
	);
}

function RouteTarget({
	value,
	targets,
	editable,
	onChange,
	onSelect,
}: {
	value: string;
	targets: { id: string; name: string }[];
	editable: boolean;
	onChange: (value: string) => void;
	onSelect: (id: string) => void;
}) {
	return editable ? (
		<select
			className="recipe-route-target"
			aria-label="Continue at"
			value={value}
			onChange={(e) => onChange(e.target.value)}
		>
			{targets.map((t) => (
				<option key={t.id} value={t.id}>
					→ {t.name}
				</option>
			))}
		</select>
	) : (
		<button
			type="button"
			className="recipe-route-target"
			disabled={value === "end"}
			onClick={() => onSelect(value)}
		>
			→{" "}
			{value === "end"
				? "Finish"
				: (targets.find((t) => t.id === value)?.name ?? value)}
		</button>
	);
}

function SettingsPanel({
	recipe,
	config,
	onChange,
	onClose,
	availability,
	fallback,
	onForked,
}: {
	recipe: Recipe;
	config: any;
	onChange: (fn: (r: Recipe) => Recipe) => void;
	onClose: () => void;
	availability: ReturnType<typeof useAvailability>;
	fallback: ReturnType<typeof useDefaultRecipe>;
	onForked: (id: string) => void;
}) {
	const fork = useAction("workflows", `fork/${recipe.id}`);
	const toast = useToast();
	const [label, setLabel] = useState("");
	const saved = config.workflows.find((w: Recipe) => w.id === recipe.id);
	const isDefault = config.defaultWorkflow === recipe.id;
	return (
		<aside className="recipe-panel" aria-label="Recipe settings">
			<PanelHeader title="Recipe settings" onClose={onClose} />
			{isLocal(recipe) && (
				<label>
					Description
					<textarea
						rows={3}
						value={recipe.description}
						placeholder="What this recipe is for, shown in the launcher"
						onChange={(e) =>
							onChange((r) => ({ ...r, description: e.target.value }))
						}
					/>
				</label>
			)}
			<section className="recipe-section">
				<h3>How it can start</h3>
				<p className="muted small">
					Applies to new runs once saved. Existing runs keep their definitions.
				</p>
				{triggers.map((t) => {
					const locked = recipe.id === "simple" && t.id === "workflow";
					const on = recipe.allowedTriggers.includes(t.id);
					return (
						<div key={t.id} className="recipe-setting">
							<span>
								{t.icon} {t.label}
								{locked && (
									<small>
										Simple uses native conversations and can’t be nested.
									</small>
								)}
								{t.id === "ticket-assignment" && (
									<small>Covers assignments and @mentions.</small>
								)}
							</span>
							<Switch
								label={t.label}
								checked={on}
								disabled={locked}
								onChange={(value) =>
									onChange((r) => ({
										...r,
										allowedTriggers: value
											? [...r.allowedTriggers, t.id]
											: r.allowedTriggers.filter((x) => x !== t.id),
									}))
								}
							/>
						</div>
					);
				})}
			</section>
			{!recipe.internal && (
				<section className="recipe-section">
					<h3>Routing labels</h3>
					<p className="muted small">
						Tickets with any of these labels use this recipe.
					</p>
					<div className="recipe-labels">
						{recipe.labels.map((l) => (
							<span key={l} className="recipe-label">
								{l}
								<button
									type="button"
									aria-label={`Remove ${l}`}
									onClick={() =>
										onChange((r) => ({
											...r,
											labels: r.labels.filter((x) => x !== l),
										}))
									}
								>
									×
								</button>
							</span>
						))}
						<form
							onSubmit={(e) => {
								e.preventDefault();
								const value = label.trim();
								if (value && !recipe.labels.includes(value))
									onChange((r) => ({ ...r, labels: [...r.labels, value] }));
								setLabel("");
							}}
						>
							<input
								aria-label="Add label"
								placeholder="Add label…"
								value={label}
								onChange={(e) => setLabel(e.target.value)}
							/>
						</form>
					</div>
				</section>
			)}
			<section className="recipe-section">
				<div className="recipe-setting">
					<span>
						💬 Chat steering
						<small>
							{isLocal(recipe)
								? "Let people steer a running recipe by chatting with Bob."
								: "Bundled behavior; fork to change."}
							{recipe.internal &&
								recipe.chat === undefined &&
								" Inherits its caller."}
						</small>
					</span>
					<Switch
						label="Chat steering"
						checked={!!recipe.chat}
						disabled={!isLocal(recipe)}
						onChange={(chat) => onChange((r) => ({ ...r, chat }))}
					/>
				</div>
			</section>
			{saved && (
				<section className="recipe-section">
					<h3>Right away</h3>
					<p className="muted small">These apply immediately, without Save.</p>
					{!recipe.internal && (
						<div className="recipe-setting">
							<span>
								★ Default recipe
								<small>
									Used when no label or selection picks a recipe.
									{isDefault &&
										` Saved: manual starts ${saved.allowedTriggers.includes("manual") ? "allowed" : "rejected"}; ticket starts ${saved.allowedTriggers.includes("ticket-assignment") ? "allowed" : "rejected"}.`}
								</small>
							</span>
							<Switch
								label="Default recipe"
								checked={isDefault}
								disabled={isDefault || fallback.pending}
								onChange={() => fallback.set(saved)}
							/>
						</div>
					)}
					<div className="recipe-setting">
						<span>
							Enabled
							<small>
								Disabling interrupts unfinished runs after you confirm.
							</small>
						</span>
						<Switch
							label="Enabled"
							checked={saved.enabled !== false}
							disabled={availability.pending}
							onChange={() => availability.toggle(saved)}
						/>
					</div>
					{availability.error && <p className="error">{availability.error}</p>}
					{forkable.includes(recipe.id) && (
						<div className="recipe-setting">
							<span>
								Fork
								<small>
									Make an editable private copy, including its building blocks.
								</small>
							</span>
							<Button
								variant="secondary"
								requiresConnection
								busy={fork.isPending}
								onClick={() =>
									void fork
										.mutateAsync({ path: `/api/workflows/${recipe.id}/fork` })
										.then((created: any) => {
											toast({ text: "Private editable fork created" });
											onForked(created.id);
										})
										.catch(() => {})
								}
							>
								Fork
							</Button>
						</div>
					)}
					{fork.error && <p className="error">{fork.error.message}</p>}
				</section>
			)}
			<section className="recipe-section">
				<h3>What Bob asks for when it starts</h3>
				{recipe.launchFields?.length ? (
					<ul className="recipe-fields">
						{recipe.launchFields.map((f) => (
							<li key={f.name}>
								<b>{f.label}</b>
								<small>
									{f.type ?? "text"}
									{f.required ? " · required" : " · optional"}
								</small>
							</li>
						))}
					</ul>
				) : (
					<p className="muted small">
						{recipe.internal
							? "Nothing; the calling recipe provides the input."
							: "The standard task description."}
					</p>
				)}
				{isLocal(recipe) && (
					<p className="muted small">Edit launch fields in the recipe JSON.</p>
				)}
			</section>
		</aside>
	);
}

function JsonPanel({
	recipe,
	onApply,
	onClose,
}: {
	recipe: Recipe;
	onApply: (value: Recipe) => void;
	onClose: () => void;
}) {
	const current = JSON.stringify(editableOf(recipe), null, 2);
	const [text, setText] = useState(current);
	const [error, setError] = useState("");
	const local = isLocal(recipe);
	return (
		<aside className="recipe-panel wide" aria-label="Recipe JSON">
			<PanelHeader title="Recipe JSON" onClose={onClose} />
			<p className="muted small">
				{local
					? "For fields without a visual editor, such as launch fields and review sources. Apply updates the draft; Save stores it."
					: "Bundled recipes are read-only. Fork Factory or Takeover to edit their graph."}
			</p>
			<textarea
				className="code-editor recipe-json"
				aria-label="Recipe JSON"
				readOnly={!local}
				value={local ? text : current}
				onChange={(e) => setText(e.target.value)}
				spellCheck={false}
			/>
			{error && (
				<p className="error" role="alert">
					{error}
				</p>
			)}
			<div className="actions">
				{local && (
					<Button
						disabled={text === current}
						onClick={() => {
							try {
								const value = JSON.parse(text);
								if (value?.id !== recipe.id)
									throw new Error(`Keep the recipe ID “${recipe.id}”.`);
								if (!Array.isArray(value.steps))
									throw new Error("steps must be a list.");
								setError("");
								onApply({
									...recipe,
									...value,
									labels: value.labels ?? [],
									allowedTriggers:
										value.allowedTriggers ?? recipe.allowedTriggers,
								});
							} catch (e) {
								setError((e as Error).message);
							}
						}}
					>
						Apply to draft
					</Button>
				)}
				<Button
					variant="secondary"
					onClick={() => void navigator.clipboard.writeText(current)}
				>
					Copy
				</Button>
			</div>
		</aside>
	);
}

function SimulationPanel({
	steps,
	recipes,
	simulation,
	onChange,
}: {
	steps: Step[];
	recipes: Recipe[];
	simulation: Simulation;
	onChange: (value: Simulation) => void;
}) {
	const current = simulation.trail.at(-1)!;
	const step = steps.find((s) => s.id === current);
	const go = (to: string) => {
		const visits = {
			...simulation.visits,
			[to]: (simulation.visits[to] ?? 0) + 1,
		};
		const target = steps.find((s) => s.id === to);
		const limit = target?.maxVisits ?? DEFAULT_STEP_MAX_VISITS;
		onChange({
			trail: [...simulation.trail, to],
			visits,
			stopped:
				target && visits[to]! > limit
					? `“${target.name}” reached its limit of ${limit} visits. The run would stop and ask for help.`
					: undefined,
		});
	};
	const trail = useRef<HTMLOListElement>(null);
	useEffect(() => {
		const list = trail.current;
		if (list) list.scrollLeft = list.scrollWidth;
	});
	const restart = () =>
		onChange({ trail: [steps[0]!.id], visits: { [steps[0]!.id]: 1 } });
	return (
		<section
			className="recipe-simulation"
			aria-label="Simulated run"
			aria-live="polite"
		>
			<ol className="recipe-trail" ref={trail}>
				{simulation.trail.map((id, i) => (
					<li
						key={`${i}-${id}`}
						data-current={i === simulation.trail.length - 1}
					>
						{stepName(steps, id)}
					</li>
				))}
			</ol>
			{simulation.stopped ? (
				<p>⛔ {simulation.stopped}</p>
			) : current === "end" ? (
				<p>🏁 Finished after {simulation.trail.length - 1} steps.</p>
			) : (
				step && (
					<>
						<p>
							<b>{step.name}</b> — {stepSummary(step, recipes)} What happens?
						</p>
						<div className="actions">
							{outcomesOf(steps, step.id).map((outcome) => (
								<Button
									key={`${outcome.label}-${outcome.to}`}
									variant={outcome.branch ? "secondary" : "primary"}
									onClick={() => go(outcome.to)}
								>
									{outcome.branch ? "" : "✓ "}
									{outcome.label} → {stepName(steps, outcome.to)}
								</Button>
							))}
						</div>
					</>
				)
			)}
			<button type="button" className="link" onClick={restart}>
				Restart
			</button>
		</section>
	);
}
