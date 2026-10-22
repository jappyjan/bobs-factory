import {
	Background,
	Controls,
	type Edge,
	Handle,
	MarkerType,
	type Node,
	type NodeProps,
	Position,
	ReactFlow,
	useReactFlow,
} from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";
import {
	agentSummary,
	calledNodeId,
	calledRecipeOf,
	itemSourceSummary,
	kindOf,
	layoutSteps,
	mainPath,
	type Phase,
	phasesOf,
	type Recipe,
	routesOf,
	type Step,
} from "./recipe-graph";

const W = 220,
	H = 68;
/** Matches `.recipe-workspace .react-flow__handle` (9px, centred on the edge). */
const HANDLE = 9;
const handle = (
	type: "source" | "target",
	position: Position,
	x: number,
	y: number,
	id: string | null = null,
) => ({ id, type, position, x, y, width: HANDLE, height: HANDLE });
const stepHandles = (width: number, height: number) => [
	handle("target", Position.Left, -HANDLE / 2, height / 2 - HANDLE / 2),
	handle("source", Position.Right, width - HANDLE / 2, height / 2 - HANDLE / 2),
	handle(
		"target",
		Position.Bottom,
		width * 0.35 - HANDLE / 2,
		height - HANDLE / 2,
		"loop-in",
	),
	handle(
		"source",
		Position.Bottom,
		width * 0.65 - HANDLE / 2,
		height - HANDLE / 2,
		"loop-out",
	),
];
const heightOf = (step: Step) =>
	step.type === "fanout"
		? H + 8 + (step.groups?.length ?? 0) * 22
		: step.type === "foreach"
			? H + 50 + (step.body?.length ?? 0) * 24
			: step.type === "workflow"
				? H + 44
				: H;

export type Simulation = {
	trail: string[];
	visits: Record<string, number>;
	stopped?: string;
};
type StepData = {
	step: Step;
	phase: Phase;
	summary?: string;
	state?: "current" | "visited" | "dim";
	selected: boolean;
	selectedChild?: string;
	visits?: number;
	connectable: boolean;
	width: number;
	height: number;
	ownerId?: string;
	call?: {
		recipe?: Recipe;
		problem?: string;
		expanded: boolean;
		toggle: () => void;
	};
};

function StepNode({ data }: NodeProps<Node<StepData>>) {
	const { step } = data;
	const kind = kindOf(step);
	return (
		<div
			className="recipe-node"
			data-tone={kind.tone}
			data-state={data.state}
			data-selected={data.selected}
			data-expanded={data.call?.expanded}
			style={{
				["--phase" as string]: data.phase.color,
				width: data.width,
				height: data.height,
			}}
		>
			<Handle
				type="target"
				position={Position.Left}
				isConnectableStart={false}
				isConnectableEnd={data.connectable}
			/>
			<Handle
				type="target"
				id="loop-in"
				position={Position.Bottom}
				style={{ left: "35%" }}
				isConnectable={false}
			/>
			<div className="recipe-node-main">
				<span className="recipe-node-icon" title={kind.hint}>
					{kind.icon}
				</span>
				<span className="recipe-node-text">
					<b>{step.name}</b>
					<small>
						{data.summary ?? kind.label}
						{step.askQuestions && " · may ask you"}
					</small>
				</span>
			</div>
			{step.type === "fanout" && (
				<ul className="recipe-node-groups">
					{step.groups?.map((group) => (
						<li
							key={group[0]!.id}
							data-selected={group.some((s) => s.id === data.selectedChild)}
						>
							{group.map((s) => s.name).join(" → ")}
						</li>
					))}
				</ul>
			)}
			{step.type === "foreach" && (
				<div className="recipe-node-foreach">
					<small title={itemSourceSummary(step)}>
						{itemSourceSummary(step)}
					</small>
					<small>
						↔ {step.concurrency ?? 4} at once · max {step.maxItems ?? 100}
					</small>
					<ul className="recipe-node-groups">
						{step.body?.map((child) => (
							<li
								key={child.id}
								data-selected={data.selectedChild?.split("/")[0] === child.id}
							>
								{kindOf(child).icon} {child.name}
								{child.type === "foreach" ? " ↻" : ""}
							</li>
						))}
					</ul>
				</div>
			)}
			{data.call && (
				<div className="recipe-call-controls">
					{data.call.problem ? (
						<small role="status">{data.call.problem}</small>
					) : (
						<button
							type="button"
							className="recipe-call-toggle nodrag nopan"
							aria-expanded={data.call.expanded}
							onKeyDown={(event) => event.stopPropagation()}
							aria-label={`${data.call.expanded ? "Collapse" : "Expand"} ${data.call.recipe?.name ?? step.workflow} in ${step.name}`}
							onClick={(event) => {
								event.stopPropagation();
								data.call!.toggle();
							}}
						>
							<span aria-hidden="true">{data.call.expanded ? "▾" : "▸"}</span>
							{data.call.expanded ? "Collapse" : "Expand"} ·{" "}
							{data.call.recipe?.steps.length} steps
						</button>
					)}
				</div>
			)}
			{!!data.visits && (
				<span className="recipe-node-visits">×{data.visits}</span>
			)}
			<Handle
				type="source"
				position={Position.Right}
				isConnectable={data.connectable}
				title={data.connectable ? "Drag to add a conditional route" : undefined}
			/>
			<Handle
				type="source"
				id="loop-out"
				position={Position.Bottom}
				style={{ left: "65%" }}
				isConnectable={false}
			/>
		</div>
	);
}
function EndNode({
	data,
}: NodeProps<
	Node<{
		state?: string;
		returning?: boolean;
		outcome?: string;
		missing?: boolean;
	}>
>) {
	return (
		<div
			className="recipe-end"
			data-state={data.state}
			data-outcome={!!data.outcome}
			title={
				data.outcome
					? `${data.missing ? "Missing step" : "Return outcome"}: ${data.outcome}`
					: data.returning
						? "Return to caller"
						: "Finish"
			}
		>
			<Handle type="target" position={Position.Left} isConnectable={false} />
			{data.outcome ? (
				<small>
					{data.missing ? "Missing step" : "Return"}
					<b>{data.outcome}</b>
				</small>
			) : data.returning ? (
				<small>Return</small>
			) : (
				"🏁"
			)}
		</div>
	);
}
function LaneNode({
	data,
}: NodeProps<
	Node<{ label: string; color: string; width: number; height: number }>
>) {
	return (
		<div
			className="recipe-lane"
			style={{
				width: data.width,
				height: data.height,
				["--phase" as string]: data.color,
			}}
		>
			<span className="recipe-lane-label">{data.label}</span>
		</div>
	);
}
const nodeTypes = { step: StepNode, end: EndNode, lane: LaneNode };

type CanvasLayout = {
	positions: Record<string, { x: number; y: number }>;
	sizes: Record<string, { width: number; height: number }>;
	calls: Record<
		string,
		ReturnType<typeof calledRecipeOf> & { graph?: CanvasLayout }
	>;
	width: number;
	height: number;
	terminals: { id: string; missing?: boolean }[];
};

/** Child coordinates are local to the call; routes never escape their definition. */
export function layoutRecipeCanvas(
	steps: Step[],
	recipes: Recipe[],
	expanded: Set<string>,
	scope?: string,
	ancestors: string[] = [],
	compact = false,
	outcomes: string[] = [],
): CanvasLayout {
	const sizes: CanvasLayout["sizes"] = {};
	const calls: CanvasLayout["calls"] = {};
	for (const step of steps) {
		const id = scope ? calledNodeId(scope, step.id) : step.id;
		const target = calledRecipeOf(step, recipes, ancestors);
		const graph =
			target.recipe && !target.problem && expanded.has(id)
				? layoutRecipeCanvas(
						target.recipe.steps,
						recipes,
						expanded,
						id,
						[...ancestors, target.recipe.id],
						compact,
						target.recipe.outcomes,
					)
				: undefined;
		if (step.type === "workflow") calls[step.id] = { ...target, graph };
		sizes[step.id] = graph
			? {
					width: Math.max(W, graph.width + 48),
					height: H + 44 + graph.height + 48,
				}
			: { width: W, height: heightOf(step) };
	}
	const terminals = [
		...new Set(["end", ...routesOf(steps).map((route) => route.to)]),
	]
		.filter((id) => !steps.some((step) => step.id === id))
		.map((id) => ({ id, missing: id !== "end" && !outcomes.includes(id) }));
	for (const terminal of terminals)
		if (terminal.id !== "end") sizes[terminal.id] = { width: 128, height: 60 };
	const positions = layoutSteps(steps, {
		terminal: { width: 128, height: 60 },
		size: (step) => sizes[step.id]!,
		direction: compact ? "TB" : "LR",
	});
	if (compact) for (const id of mainPath(steps)) positions[id]!.x = 0;
	const left = Math.min(...Object.values(positions).map((p) => p.x));
	const top = Math.min(...Object.values(positions).map((p) => p.y));
	for (const p of Object.values(positions)) {
		p.x -= left;
		p.y -= top;
	}
	// Keep space for labelled correction routes around the graph.
	return {
		positions,
		sizes,
		calls,
		terminals,
		width:
			Math.max(
				...Object.entries(positions).map(
					([id, p]) => p.x + (sizes[id]?.width ?? 60),
				),
			) + 32,
		height:
			Math.max(
				...Object.entries(positions).map(
					([id, p]) => p.y + (sizes[id]?.height ?? 60),
				),
			) + 60,
	};
}

export function RecipeCanvas({
	steps,
	recipes = [],
	recipeId,
	onOpenRecipe,
	defaultRunner,
	selected,
	selectedChild,
	onSelect,
	simulation,
	connectable,
	onConnect,
	onDropKind,
}: {
	steps: Step[];
	recipes?: Recipe[];
	recipeId?: string;
	onOpenRecipe?: (recipeId: string, stepId?: string) => void;
	defaultRunner: string;
	selected?: string;
	selectedChild?: string;
	onSelect: (id: string | undefined) => void;
	simulation?: Simulation;
	connectable: (from: string, to?: string) => boolean;
	onConnect: (from: string, to: string) => void;
	onDropKind: (kind: string, after?: string) => void;
}) {
	const flow = useReactFlow();
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [compact, setCompact] = useState(
		() => window.matchMedia("(max-width: 760px)").matches,
	);
	const [expandedFocus, setExpandedFocus] = useState<string>();
	useEffect(() => {
		const media = window.matchMedia("(max-width: 760px)");
		const update = () => setCompact(media.matches);
		media.addEventListener("change", update);
		return () => media.removeEventListener("change", update);
	}, []);
	// biome-ignore lint/correctness/useExhaustiveDependencies: changing recipe resets its local expansion state
	useEffect(() => {
		setExpanded(new Set());
		setExpandedFocus(undefined);
	}, [recipeId]);
	const layout = useMemo(
		() =>
			layoutRecipeCanvas(
				steps,
				recipes,
				expanded,
				undefined,
				recipeId ? [recipeId] : [],
				compact,
				recipes.find((recipe) => recipe.id === recipeId)?.outcomes,
			),
		[steps, recipes, expanded, recipeId, compact],
	);
	// biome-ignore lint/correctness/useExhaustiveDependencies: preserve navigation during edits
	useEffect(() => {
		const timer = setTimeout(() => {
			if (compact && !selected) {
				const first = layout.positions[steps[0]?.id ?? ""];
				if (first)
					void flow.setViewport({
						x: (window.innerWidth - W) / 2 - first.x,
						y: 32 - first.y,
						zoom: 1,
					});
				return;
			}
			void flow.fitView({
				padding: 0.15,
				maxZoom: 1,
				nodes: (selected
					? [selected]
					: mainPath(steps).slice(0, compact ? 2 : 8)
				).map((id) => ({ id })),
			});
		}, 60);
		return () => clearTimeout(timer);
		// Only a different recipe or viewport direction resets the user's pan/zoom.
	}, [recipeId, compact]);
	const { positions } = layout;
	const main = mainPath(steps),
		phases = phasesOf(steps);
	const at = (id: string) => positions[id] ?? { x: 0, y: 0 };
	const routes = routesOf(steps);

	// One lane per run of consecutive main-path steps in the same phase.
	const lanes: Node[] = [];
	const ys = Object.values(positions).map((p) => p.y);
	const top = Math.min(...ys) - 64,
		bottom =
			Math.max(...steps.map((s) => at(s.id).y + layout.sizes[s.id]!.height)) +
			140;
	let run: string[] = [];
	const flush = () => {
		if (!run.length) return;
		const xs = run.map((id) => at(id).x);
		const phase = phases[run[0]!]!;
		lanes.push({
			id: `lane-${lanes.length}`,
			type: "lane",
			position: { x: Math.min(...xs) - 24, y: top },
			width:
				Math.max(...run.map((id) => at(id).x + layout.sizes[id]!.width)) -
				Math.min(...xs) +
				48,
			height: bottom - top,
			handles: [],
			draggable: false,
			selectable: false,
			focusable: false,
			zIndex: -1,
			data: {
				label: phase.label,
				color: phase.color,
				width:
					Math.max(...run.map((id) => at(id).x + layout.sizes[id]!.width)) -
					Math.min(...xs) +
					48,
				height: bottom - top,
			},
		});
		run = [];
	};
	for (const id of main) {
		if (run.length && phases[run[0]!]!.id !== phases[id]!.id) flush();
		run.push(id);
	}
	flush();
	const showLanes =
		!compact &&
		!expanded.size &&
		new Set(Object.values(phases).map((p) => p.id)).size > 1;

	const current = simulation?.trail.at(-1);
	// biome-ignore lint/correctness/useExhaustiveDependencies: explicit selection/simulation takes focus from expansion
	useEffect(() => setExpandedFocus(undefined), [selected, current]);
	const stateOf = (id: string) =>
		!simulation
			? undefined
			: id === current
				? "current"
				: simulation.trail.includes(id)
					? "visited"
					: "dim";
	const nodes: Node[] = [...(showLanes ? lanes : [])];
	const nestedEdges: (Edge & {
		pathOptions: { offset: number; borderRadius: number };
	})[] = [];
	const absolutePositions = { ...positions };
	const append = (
		list: Step[],
		graph: CanvasLayout,
		parentId?: string,
		ownerId?: string,
		origin = { x: 0, y: 0 },
	) => {
		const innerPhases = phasesOf(list);
		const idOf = (id: string) => (parentId ? calledNodeId(parentId, id) : id);
		for (const step of list) {
			const id = idOf(step.id);
			const size = graph.sizes[step.id]!;
			const call = graph.calls[step.id];
			const p = graph.positions[step.id]!;
			const position = {
				x: p.x + (parentId ? 24 : 0),
				y: p.y + (parentId ? H + 44 : 0),
			};
			absolutePositions[id] = {
				x: position.x + origin.x,
				y: position.y + origin.y,
			};
			nodes.push({
				id,
				type: "step",
				parentId,
				position,
				...size,
				handles: stepHandles(size.width, size.height),
				ariaLabel: `${step.name}, ${kindOf(step).label}${ownerId ? ` in ${recipes.find((r) => r.id === ownerId)?.name ?? ownerId}` : ""}. Press Enter to inspect.`,
				data: {
					step,
					phase: innerPhases[step.id]!,
					...size,
					ownerId,
					summary: call?.recipe
						? `Call ${call.recipe.name}`
						: agentSummary(step, defaultRunner),
					state: parentId ? undefined : stateOf(step.id),
					selected: !parentId && step.id === selected,
					selectedChild: parentId ? undefined : selectedChild,
					visits: parentId ? undefined : simulation?.visits[step.id],
					connectable: !parentId && !simulation && connectable(step.id),
					call: call && {
						recipe: call.recipe,
						problem: call.problem,
						expanded: !!call.graph,
						toggle: () => {
							setExpanded((current) => {
								const next = new Set(current);
								if (next.has(id)) next.delete(id);
								else next.add(id);
								return next;
							});
							setExpandedFocus(id);
						},
					},
				} satisfies StepData,
			});
			if (call?.graph && call.recipe)
				append(
					call.recipe.steps,
					call.graph,
					id,
					call.recipe.id,
					absolutePositions[id],
				);
		}
		for (const terminal of graph.terminals) {
			const point = graph.positions[terminal.id]!;
			nodes.push({
				id: idOf(terminal.id),
				type: "end",
				parentId,
				position: {
					x: point.x + (parentId ? 24 : 0),
					y: point.y + (parentId ? H + 44 : 0),
				},
				width: terminal.id === "end" ? 60 : 128,
				height: 60,
				handles: [
					handle("target", Position.Left, -HANDLE / 2, 30 - HANDLE / 2),
				],
				focusable: false,
				ariaLabel:
					terminal.id !== "end"
						? `${terminal.missing ? "Missing step" : "Return outcome"}: ${terminal.id}`
						: undefined,
				data: {
					state: parentId ? undefined : stateOf(terminal.id),
					returning: !!parentId,
					outcome: terminal.id !== "end" ? terminal.id : undefined,
					missing: terminal.missing,
				},
			});
		}
		if (parentId)
			for (const [i, route] of routesOf(list).entries()) {
				nestedEdges.push({
					id: `${parentId}:${i}`,
					source: idOf(route.from),
					target: idOf(route.to),
					sourceHandle: route.back ? "loop-out" : undefined,
					targetHandle: route.back ? "loop-in" : undefined,
					type: "smoothstep",
					label: route.label,
					pathOptions: {
						offset: route.back ? 30 + (i % 6) * 12 : 20,
						borderRadius: 18,
					},
					labelBgPadding: [6, 3],
					labelBgBorderRadius: 8,
					className: `recipe-edge ${route.back ? "loop" : "main"}`,
					markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
					focusable: false,
				});
			}
	};
	append(steps, layout);
	const walked = (from: string, to: string) =>
		!!simulation?.trail.some(
			(id, i) => id === from && simulation.trail[i + 1] === to,
		);
	const edges: Edge[] = [
		...nestedEdges,
		...routes.map((r, i) => {
			const hot = !!selected && (r.from === selected || r.to === selected);
			const classes = [
				"recipe-edge",
				r.back && "loop",
				r.kind === "flow" && !r.back && main.includes(r.from) && "main",
				hot && "hot",
				walked(r.from, r.to) && "walked",
				simulation && !walked(r.from, r.to) && "faint",
			];
			return {
				id: `${r.from}>${r.to}#${r.index ?? "next"}`,
				source: r.from,
				target: r.to,
				sourceHandle: r.back ? "loop-out" : undefined,
				targetHandle: r.back ? "loop-in" : undefined,
				type: "smoothstep",
				pathOptions: {
					offset: r.back ? 30 + (i % 6) * 12 : 20,
					borderRadius: 18,
				},
				label:
					hot || r.entry || (!r.back && r.kind === "branch")
						? r.label
						: undefined,
				labelBgPadding: [6, 3] as [number, number],
				labelBgBorderRadius: 8,
				className: classes.filter(Boolean).join(" "),
				markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
				focusable: false,
			};
		}),
	];

	// Follow the simulated run, and bring deep-linked or jumped-to steps into view.
	const focus = expandedFocus ?? current ?? selected;
	// biome-ignore lint/correctness/useExhaustiveDependencies: recentre only when the focused step changes
	useEffect(() => {
		if (!focus || !absolutePositions[focus]) return;
		const p = absolutePositions[focus];
		// Panels cover the bottom on phones and the simulator on every screen.
		const covered = compact
			? selected
				? window.innerHeight * 0.3
				: 0
			: current
				? 110
				: 0;
		const timer = setTimeout(() => {
			const zoom = Math.max(flow.getZoom(), 0.8);
			void flow.setCenter(
				p.x + W / 2,
				p.y +
					(expandedFocus && expanded.has(focus) ? 160 : H / 2) +
					covered / zoom,
				{
					zoom,
					duration: 350,
				},
			);
		}, 60);
		return () => clearTimeout(timer);
	}, [focus, simulation?.trail.length, expanded]);

	return (
		<ReactFlow
			nodes={nodes}
			edges={edges}
			nodeTypes={nodeTypes}
			fitView
			fitViewOptions={{
				padding: 0.15,
				maxZoom: 1,
				nodes: (selected ? [selected] : main.slice(0, compact ? 2 : 8)).map(
					(id) => ({ id }),
				),
			}}
			minZoom={0.15}
			nodesDraggable={false}
			nodesConnectable={!simulation}
			deleteKeyCode={null}
			autoPanOnNodeFocus
			onNodeClick={(_, node) => {
				if (node.type !== "step") return;
				const data = node.data as StepData;
				setExpandedFocus(undefined);
				if (data.ownerId) onOpenRecipe?.(data.ownerId, data.step.id);
				else onSelect(node.id);
			}}
			onPaneClick={() => onSelect(undefined)}
			onKeyDown={(event) => {
				const target = event.target as Element;
				if (target.closest("button, input, textarea, select, a")) return;
				const id = target.closest(".react-flow__node")?.getAttribute("data-id");
				if (!id || !["Enter", " "].includes(event.key)) return;
				const node = nodes.find((n) => n.id === id && n.type === "step");
				if (!node) return;
				event.preventDefault();
				const data = node.data as StepData;
				setExpandedFocus(undefined);
				if (data.ownerId) onOpenRecipe?.(data.ownerId, data.step.id);
				else onSelect(id);
			}}
			isValidConnection={(c) =>
				steps.some((step) => step.id === c.source) &&
				steps.some((step) => step.id === c.target) &&
				connectable(c.source, c.target)
			}
			onConnect={(c) => {
				if (
					c.source &&
					c.target &&
					steps.some((step) => step.id === c.source) &&
					steps.some((step) => step.id === c.target)
				)
					onConnect(c.source, c.target);
			}}
			onConnectEnd={(event, state) => {
				// Dropping anywhere on a step connects to it, not only on its handle.
				if (state.isValid || !state.fromNode) return;
				const point =
					"changedTouches" in event ? event.changedTouches[0] : event;
				if (!point) return;
				const to = document
					.elementFromPoint(point.clientX, point.clientY)
					?.closest(".react-flow__node")
					?.getAttribute("data-id");
				const from = state.fromNode.id;
				if (to && steps.some((s) => s.id === to) && connectable(from, to))
					onConnect(from, to);
			}}
			onDragOver={(event) => {
				if (event.dataTransfer.types.includes("application/x-recipe-step")) {
					event.preventDefault();
					event.dataTransfer.dropEffect = "copy";
				}
			}}
			onDrop={(event) => {
				const kind = event.dataTransfer.getData("application/x-recipe-step");
				if (!kind) return;
				event.preventDefault();
				const target = (event.target as Element)
					.closest(".react-flow__node")
					?.getAttribute("data-id");
				// A child belongs to another definition. Open it to edit that recipe.
				if (target && nodes.find((node) => node.id === target)?.parentId)
					return;
				onDropKind(
					kind,
					target && steps.some((s) => s.id === target) ? target : selected,
				);
			}}
			proOptions={{ hideAttribution: true }}
		>
			<Background gap={24} size={1.4} />
			<Controls showInteractive={false} position="bottom-right" />
		</ReactFlow>
	);
}
