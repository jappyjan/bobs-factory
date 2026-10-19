import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, useAction, useConfig } from "./client";
import { useFormState } from "./form-state";
import { RecipeBuilder } from "./recipe-builder";
import {
	layoutSteps,
	mainPath,
	phasesOf,
	type Recipe,
	recipeGraph,
	routesOf,
	type Step,
	triggers,
} from "./recipe-graph";
import { revisionOf } from "./restoration";
import { Button, Modal, useToast } from "./ui";

export function Recipes() {
	const config = useConfig("recipes").data;
	const [params] = useSearchParams();
	const selected = params.get("recipe");
	if (!config) return <p>Loading recipes…</p>;
	if (selected) return <RecipeBuilder key={selected} id={selected} />;
	return <RecipeGallery config={config} />;
}

/** Enabling is immediate; disabling first shows which unfinished runs stop. */
export function useAvailability() {
	const config = useConfig("recipes").data;
	const action = useAction("workflow-availability");
	const toast = useToast();
	const [disabling, setDisabling] = useFormState<
		{ workflow: Recipe; impact: { runs: string[]; token: string } } | undefined
	>(revisionOf(config?.workflows), undefined);
	const [error, setError] = useFormState(revisionOf(config?.workflows), "");
	const toggle = (workflow: Recipe) => {
		setError("");
		if (workflow.enabled === false)
			void action
				.mutateAsync({
					path: `/api/workflows/${workflow.id}/availability`,
					method: "PUT",
					body: { enabled: true },
				})
				.then(() => toast({ text: `“${workflow.name}” enabled` }))
				.catch((e) => setError(e.message));
		else
			void api<any>(`/api/workflows/${workflow.id}/availability`)
				.then((impact) => setDisabling({ workflow, impact }))
				.catch((e) => setError(e.message));
	};
	const modal = (
		<Modal
			open={Boolean(disabling)}
			onOpenChange={(open) => {
				if (!open) setDisabling(undefined);
			}}
			title={`Disable “${disabling?.workflow.name ?? "recipe"}”`}
			description="Executing work will be interrupted. Saved progress and native conversations are retained. Actions already performed cannot be undone. Re-enabling permits new launches; each blocked run requires its own Resume action."
		>
			<div className="modal-body">
				<p>
					{disabling?.impact.runs.length
						? `${disabling.impact.runs.length} unfinished runs may be interrupted:`
						: "No unfinished runs use this recipe."}
				</p>
				<ul>
					{disabling?.impact.runs.map((id) => (
						<li key={id}>
							<Link to={`/runs/${id}`}>{id}</Link>
						</li>
					))}
				</ul>
				{action.error && (
					<p role="alert" className="error">
						{action.error.message}
					</p>
				)}
				<Button
					requiresConnection
					busy={action.isPending}
					onClick={() => {
						if (!disabling) return;
						void action
							.mutateAsync({
								path: `/api/workflows/${disabling.workflow.id}/availability`,
								method: "PUT",
								body: {
									enabled: false,
									confirm: true,
									token: disabling.impact.token,
								},
							})
							.then(() => setDisabling(undefined))
							.catch(() => {});
					}}
				>
					{disabling?.impact.runs.length
						? "Interrupt work and disable"
						: "Disable"}
				</Button>
			</div>
		</Modal>
	);
	return { toggle, modal, error, pending: action.isPending };
}

/** The default recipe handles launches that match no label or selection. */
export function useDefaultRecipe() {
	const action = useAction("workflows");
	const toast = useToast();
	return {
		pending: action.isPending || action.isBlocked,
		error: action.error,
		set: (workflow: Recipe) =>
			void action
				.mutateAsync({
					path: "/api/workflows/default",
					method: "PUT",
					body: { defaultWorkflow: workflow.id },
				})
				.then(() => toast({ text: `“${workflow.name}” is now the default` }))
				.catch(() => {}),
	};
}

function RecipeGallery({ config }: { config: any }) {
	const [, setParams] = useSearchParams();
	const availability = useAvailability();
	const fallback = useDefaultRecipe();
	const recipes: Recipe[] = config.workflows;
	const groups = [
		{ title: "Recipes", items: recipes.filter((r) => !r.internal) },
		{
			title: "Building blocks",
			hint: "Reused inside other recipes; never started on their own.",
			items: recipes.filter((r) => r.internal),
		},
	];
	return (
		<div className="recipe-gallery">
			<header className="recipe-gallery-head">
				<div>
					<h1>Recipes</h1>
					<p className="intro">
						How Bob cooks each kind of run. Open a recipe to see every step,
						tune its agents and try a run before it happens.
					</p>
					<p className="muted">
						Factory-wide profiles, capacity and run titles are in{" "}
						<Link to="/settings">Settings</Link>.
					</p>
				</div>
				<Button onClick={() => setParams({ recipe: "new" })}>
					＋ New recipe
				</Button>
			</header>
			<Attention config={config} />
			{availability.error && (
				<p className="error" role="alert">
					{availability.error}
				</p>
			)}
			{fallback.error && (
				<p className="error" role="alert">
					{fallback.error.message}
				</p>
			)}
			{groups.map((group) => (
				<section key={group.title} className="recipe-group">
					<h2>
						{group.title}
						{group.hint && <small>{group.hint}</small>}
					</h2>
					<div className="recipe-grid">
						{group.items.map((recipe) => (
							<RecipeCard
								key={recipe.id}
								recipe={recipe}
								recipes={recipes}
								isDefault={config.defaultWorkflow === recipe.id}
								onOpen={() => setParams({ recipe: recipe.id })}
								onDefault={() => fallback.set(recipe)}
								onToggle={() => availability.toggle(recipe)}
								pending={fallback.pending || availability.pending}
							/>
						))}
					</div>
				</section>
			))}
			{availability.modal}
		</div>
	);
}

function RecipeCard({
	recipe,
	recipes,
	isDefault,
	onOpen,
	onDefault,
	onToggle,
	pending,
}: {
	recipe: Recipe;
	recipes: Recipe[];
	isDefault: boolean;
	onOpen: () => void;
	onDefault: () => void;
	onToggle: () => void;
	pending: boolean;
}) {
	const graph = useMemo(() => recipeGraph(recipe, recipes), [recipe, recipes]);
	const starts = recipe.allowedTriggers
		.filter((t) => t !== "workflow")
		.map((t) => triggers.find((x) => x.id === t)?.short)
		.filter(Boolean);
	return (
		<article
			className="recipe-card"
			data-internal={recipe.internal ?? false}
			data-disabled={recipe.enabled === false}
		>
			<button
				type="button"
				className="recipe-card-open"
				onClick={onOpen}
				aria-label={`Open ${recipe.name}`}
			>
				<span className="recipe-thumb">
					{graph.steps.length ? (
						<Thumbnail steps={graph.steps} />
					) : (
						<span className="recipe-thumb-native">
							⚡ One native agent conversation
						</span>
					)}
				</span>
				<span className="recipe-card-body">
					<span className="recipe-emoji">{recipe.icon ?? "🧩"}</span>
					<span className="recipe-card-text">
						<b>{recipe.name}</b>
						<small>
							{recipe.internal
								? "Building block"
								: starts.length
									? starts.join(" · ")
									: "No launch methods"}
							{graph.steps.length > 0 && ` · ${graph.steps.length} steps`}
							{recipe.ownership === "local" &&
								(recipe.provenance ? " · your fork" : " · yours")}
						</small>
					</span>
				</span>
			</button>
			{!!recipe.unavailable?.length && (
				<p className="error recipe-card-warning">
					Unavailable: {recipe.unavailable.join(", ")}. Enable the dependency or
					edit a local graph.
				</p>
			)}
			<footer>
				{!recipe.internal && (
					<button
						type="button"
						className="recipe-default"
						aria-pressed={isDefault}
						disabled={pending}
						onClick={onDefault}
						title="Used when no label or selection picks a recipe"
					>
						{isDefault ? "★ Default" : "☆ Make default"}
					</button>
				)}
				<span className="recipe-switch-label">
					<Switch
						label={`${recipe.name} enabled`}
						checked={recipe.enabled !== false}
						disabled={pending}
						onChange={onToggle}
					/>
					{recipe.enabled === false ? "Disabled" : "Enabled"}
				</span>
			</footer>
		</article>
	);
}

/** A miniature of the run: main path solid, detours faded, loops dashed. */
export function Thumbnail({ steps }: { steps: Step[] }) {
	const view = useMemo(() => {
		const pos = layoutSteps(steps, {
			size: () => ({ width: 40, height: 14 }),
			end: { width: 14, height: 14 },
			nodesep: 8,
			ranksep: 10,
		});
		const xs = Object.values(pos).map((p) => p.x);
		const ys = Object.values(pos).map((p) => p.y);
		return {
			pos,
			box: [
				Math.min(...xs) - 10,
				Math.min(...ys) - 24,
				Math.max(...xs) - Math.min(...xs) + 60,
				Math.max(...ys) - Math.min(...ys) + 62,
			].join(" "),
			routes: routesOf(steps),
			main: new Set(mainPath(steps)),
			phases: phasesOf(steps),
		};
	}, [steps]);
	const c = (id: string) => ({
		x: view.pos[id]!.x + (id === "end" ? 7 : 20),
		y: view.pos[id]!.y + 7,
	});
	return (
		<svg viewBox={view.box} preserveAspectRatio="xMidYMid meet" role="img">
			<title>{`Map of ${steps.length} steps, main path highlighted`}</title>
			{view.routes.map((r) => {
				const a = c(r.from),
					b = c(r.to),
					low = Math.max(a.y, b.y) + 40;
				return r.back ? (
					<path
						key={`${r.from}-${r.to}-${r.index ?? "next"}`}
						d={`M${a.x},${a.y + 7} C${a.x},${low} ${b.x},${low} ${b.x},${b.y + 7}`}
						className="loop"
					/>
				) : (
					<line
						key={`${r.from}-${r.to}-${r.index ?? "next"}`}
						x1={a.x}
						y1={a.y}
						x2={b.x}
						y2={b.y}
						className={
							r.kind === "flow" && view.main.has(r.from) ? "main" : undefined
						}
					/>
				);
			})}
			{steps.map((s) => (
				<rect
					key={s.id}
					x={view.pos[s.id]!.x}
					y={view.pos[s.id]!.y}
					width={40}
					height={14}
					rx={7}
					style={{ fill: view.phases[s.id]!.color }}
					opacity={view.main.has(s.id) ? 1 : 0.45}
				/>
			))}
			<circle cx={c("end").x} cy={c("end").y} r={7} className="end" />
		</svg>
	);
}

export function Switch({
	checked,
	onChange,
	label,
	disabled,
}: {
	checked: boolean;
	onChange: (value: boolean) => void;
	label: string;
	disabled?: boolean;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			aria-label={label}
			disabled={disabled}
			className="toggle-switch"
			onClick={() => onChange(!checked)}
		>
			<span className="toggle-switch-thumb" />
		</button>
	);
}

/** Migration conflicts and preferences that no longer match a bundled role. */
function Attention({ config }: { config: any }) {
	const action = useAction("workflows");
	const conflicts = Object.entries(
		config.workflowConfiguration?.migration?.conflicts ?? {},
	);
	const inactive = config.workflowConfiguration?.inactive ?? [];
	const migration = config.workflowConfiguration?.migration;
	if (!conflicts.length && !inactive.length && !migration) return null;
	return (
		<section className="recipe-attention" aria-label="Needs attention">
			{conflicts.map(([id, message]) => (
				<div key={id} className="error" role="alert">
					<p>
						{id === "simple" ? "Simple" : id}: {String(message)}
					</p>
					{id === "simple" && (
						<Button
							requiresConnection
							disabled={action.isPending}
							onClick={() =>
								void action
									.mutateAsync({
										path: "/api/workflows/simple/resolve-migration",
										method: "POST",
										body: { useBundledSimple: true },
									})
									.catch(() => {})
							}
						>
							Use bundled native Simple
						</Button>
					)}
				</div>
			))}
			{migration && (
				<p className="muted">
					Original configuration backup: {migration.backup}. Preserved custom
					IDs: {JSON.stringify(migration.mappings)}. Update external ticket
					selectors to use the preserved custom IDs.
				</p>
			)}
			{inactive.map((item: any, index: number) => (
				<InactivePreference
					key={`${item.workflow}/${item.role}`}
					item={item}
					index={index}
					config={config}
				/>
			))}
		</section>
	);
}

function InactivePreference({
	item,
	index,
	config,
}: {
	item: any;
	index: number;
	config: any;
}) {
	const action = useAction("workflows"),
		[target, setTarget] = useFormState(revisionOf(config), "");
	const roles = config.workflows
		.filter((w: any) => w.ownership === "bundled")
		.flatMap((w: any) =>
			w.id === "simple"
				? [{ value: "simple/native", name: "Simple agent" }]
				: ownRoles(w.steps).map(({ step }: any) => ({
						value: `${w.id}/${semanticRole(w.steps, step.id)}`,
						name: `${w.name}: ${step.name}`,
					})),
		);
	return (
		<div className="recipe-inactive">
			<p>
				Inactive preference: {item.workflow}/{item.role}. {item.reason}
			</p>
			<pre>{JSON.stringify(item.settings)}</pre>
			<label>
				Reassign to
				<select value={target} onChange={(e) => setTarget(e.target.value)}>
					<option value="">Choose a role</option>
					{roles.map((r: any) => (
						<option key={r.value} value={r.value}>
							{r.name}
						</option>
					))}
				</select>
			</label>
			<div className="actions">
				<Button
					requiresConnection
					disabled={!target || action.isPending}
					onClick={() => {
						const [workflow, ...role] = target.split("/");
						void action
							.mutateAsync({
								path: `/api/workflow-preferences/inactive/${index}`,
								body: { target: { workflow, role: role.join("/") } },
							})
							.catch(() => {});
					}}
				>
					Reassign
				</Button>
				<Button
					variant="secondary"
					requiresConnection
					disabled={action.isPending}
					onClick={() =>
						void action
							.mutateAsync({
								path: `/api/workflow-preferences/inactive/${index}`,
							})
							.catch(() => {})
					}
				>
					Remove
				</Button>
			</div>
			{action.error && <p role="alert">{action.error.message}</p>}
		</div>
	);
}
function ownRoles(
	steps: any[],
	path: (string | number)[] = [],
): { step: any; path: (string | number)[] }[] {
	return steps.flatMap((step, i) =>
		step.type === "agent"
			? [{ step, path: [...path, i] }]
			: step.type === "fanout"
				? (step.groups ?? []).flatMap((group: any[], j: number) =>
						ownRoles(group, [...path, i, "groups", j]),
					)
				: [],
	);
}
function semanticRole(steps: any[], id: string, parent = ""): string {
	for (const step of steps) {
		const key = `${parent}${step.id}`;
		if (step.id === id) return key;
		for (const group of step.groups ?? []) {
			const role = semanticRole(group, id, `${key}/`);
			if (role) return role;
		}
	}
	return "";
}
