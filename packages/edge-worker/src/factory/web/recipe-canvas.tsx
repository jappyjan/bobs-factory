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
import { useEffect, useMemo } from "react";
import {
	agentSummary,
	itemSourceSummary,
	kindOf,
	layoutSteps,
	mainPath,
	type Phase,
	phasesOf,
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
const stepHandles = (height: number) => [
	handle("target", Position.Left, -HANDLE / 2, height / 2 - HANDLE / 2),
	handle("source", Position.Right, W - HANDLE / 2, height / 2 - HANDLE / 2),
	handle(
		"target",
		Position.Bottom,
		W * 0.35 - HANDLE / 2,
		height - HANDLE / 2,
		"loop-in",
	),
	handle(
		"source",
		Position.Bottom,
		W * 0.65 - HANDLE / 2,
		height - HANDLE / 2,
		"loop-out",
	),
];
const heightOf = (step: Step) =>
	step.type === "fanout"
		? H + 8 + (step.groups?.length ?? 0) * 22
		: step.type === "foreach"
			? H + 50 + (step.body?.length ?? 0) * 24
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
			style={{
				["--phase" as string]: data.phase.color,
				height: heightOf(step),
			}}
		>
			<Handle
				type="target"
				position={Position.Left}
				isConnectableStart={false}
				isConnectableEnd
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
function EndNode({ data }: NodeProps<Node<{ state?: string }>>) {
	return (
		<div className="recipe-end" data-state={data.state} title="Finish">
			<Handle type="target" position={Position.Left} isConnectable={false} />🏁
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

export function RecipeCanvas({
	steps,
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
	const structure = JSON.stringify([routesOf(steps), steps.map(heightOf)]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: layout follows routes and sizes, not text edits
	const layout = useMemo(() => {
		const positions = layoutSteps(steps, {
			size: (s) => ({ width: W, height: heightOf(s) }),
		});
		return { positions, main: mainPath(steps), phases: phasesOf(steps) };
	}, [structure]);
	const { positions, main, phases } = layout;
	const at = (id: string) => positions[id] ?? { x: 0, y: 0 };
	const routes = routesOf(steps);

	// One lane per run of consecutive main-path steps in the same phase.
	const lanes: Node[] = [];
	const ys = Object.values(positions).map((p) => p.y);
	const top = Math.min(...ys) - 64,
		bottom = Math.max(...ys) + H + 140;
	let run: string[] = [];
	const flush = () => {
		if (!run.length) return;
		const xs = run.map((id) => at(id).x);
		const phase = phases[run[0]!]!;
		lanes.push({
			id: `lane-${lanes.length}`,
			type: "lane",
			position: { x: Math.min(...xs) - 24, y: top },
			width: Math.max(...xs) - Math.min(...xs) + W + 48,
			height: bottom - top,
			handles: [],
			draggable: false,
			selectable: false,
			focusable: false,
			zIndex: -1,
			data: {
				label: phase.label,
				color: phase.color,
				width: Math.max(...xs) - Math.min(...xs) + W + 48,
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
	const showLanes = new Set(Object.values(phases).map((p) => p.id)).size > 1;

	const current = simulation?.trail.at(-1);
	const stateOf = (id: string) =>
		!simulation
			? undefined
			: id === current
				? "current"
				: simulation.trail.includes(id)
					? "visited"
					: "dim";
	const nodes: Node[] = [
		...(showLanes ? lanes : []),
		...steps.map((step) => ({
			id: step.id,
			type: "step",
			position: at(step.id),
			// Sizes and handles are fixed by the layout and CSS. Declaring them means
			// xyflow never waits on re-measuring, which it may skip after edits and
			// leave nodes hidden or unconnectable.
			width: W,
			height: heightOf(step),
			handles: stepHandles(heightOf(step)),
			ariaLabel: `${step.name}, ${kindOf(step).label}. Press Enter to inspect.`,
			data: {
				step,
				phase: phases[step.id]!,
				summary: agentSummary(step, defaultRunner),
				state: stateOf(step.id),
				selected: step.id === selected,
				selectedChild,
				visits: simulation?.visits[step.id],
				connectable: !simulation && connectable(step.id),
			} satisfies StepData,
		})),
		{
			id: "end",
			type: "end",
			position: at("end"),
			width: 60,
			height: 60,
			handles: [handle("target", Position.Left, -HANDLE / 2, 30 - HANDLE / 2)],
			data: { state: stateOf("end") },
		},
	];
	const walked = (from: string, to: string) =>
		!!simulation?.trail.some(
			(id, i) => id === from && simulation.trail[i + 1] === to,
		);
	const edges: Edge[] = routes.map((r, i) => {
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
			label: hot || (!r.back && r.kind === "branch") ? r.label : undefined,
			labelBgPadding: [6, 3] as [number, number],
			labelBgBorderRadius: 8,
			className: classes.filter(Boolean).join(" "),
			markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
			focusable: false,
		};
	});

	// Follow the simulated run, and bring deep-linked or jumped-to steps into view.
	const focus = current ?? selected;
	// biome-ignore lint/correctness/useExhaustiveDependencies: recentre only when the focused step changes
	useEffect(() => {
		if (!focus || !positions[focus]) return;
		const p = positions[focus];
		// Panels cover the bottom on phones and the simulator on every screen.
		const covered = window.matchMedia("(max-width: 760px)").matches
			? window.innerHeight * 0.3
			: current
				? 110
				: 0;
		const timer = setTimeout(() => {
			const zoom = Math.max(flow.getZoom(), 0.8);
			void flow.setCenter(p.x + W / 2, p.y + H / 2 + covered / zoom, {
				zoom,
				duration: 350,
			});
		}, 60);
		return () => clearTimeout(timer);
	}, [focus, simulation?.trail.length]);

	return (
		<ReactFlow
			nodes={nodes}
			edges={edges}
			nodeTypes={nodeTypes}
			fitView
			fitViewOptions={{
				padding: 0.15,
				maxZoom: 1,
				nodes: (selected ? [selected] : main.slice(0, 8)).map((id) => ({ id })),
			}}
			minZoom={0.15}
			nodesDraggable={false}
			nodesConnectable={!simulation}
			deleteKeyCode={null}
			onlyRenderVisibleElements
			onNodeClick={(_, node) => {
				if (node.type === "step") onSelect(node.id);
			}}
			onPaneClick={() => onSelect(undefined)}
			onKeyDown={(event) => {
				const id = (event.target as Element)
					.closest(".react-flow__node")
					?.getAttribute("data-id");
				if (!id || !["Enter", " "].includes(event.key)) return;
				if (!steps.some((s) => s.id === id)) return;
				event.preventDefault();
				onSelect(id);
			}}
			isValidConnection={(c) =>
				!!c.source && !!c.target && connectable(c.source, c.target)
			}
			onConnect={(c) => {
				if (c.source && c.target) onConnect(c.source, c.target);
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
