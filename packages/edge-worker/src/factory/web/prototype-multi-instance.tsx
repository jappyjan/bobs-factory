// PROTOTYPE — throwaway. Taskbot bobs-factory#84 "multi instance support".
// Refined "Unified inbox" design: one Factory UI shows and steers several
// Factory instances. Active only with `?prototype` in the URL (before `#`).
// Instance connections are simulated in memory/localStorage; run data comes
// from scripts/prototype-multi-instance-server.ts which tags each run and
// repository with an `instanceId`.
import {
	type ReactNode,
	useEffect,
	useState,
	useSyncExternalStore,
} from "react";
import { attention, settleReason, useRuns } from "./client";
import { Button, Modal, useToast } from "./ui";

export const prototypeOn = new URLSearchParams(location.search).has(
	"prototype",
);
if (prototypeOn) document.documentElement.classList.add("prototype");

// ---------- design tokens ----------
/** Instance identity palette, taken from the brand rainbow. Order = assignment order. */
export const INSTANCE_COLORS = [
	"#7b61ff",
	"#3ddc97",
	"#ff9f43",
	"#4cc9f0",
	"#ff5d73",
	"#c77dff",
	"#ffd23f",
];
const STATUS = {
	connected: { color: "#3ddc97", label: "Connected" },
	connecting: { color: "#ffd23f", label: "Connecting…" },
	offline: { color: "#ff5d73", label: "Offline" },
	outdated: { color: "#ff9f43", label: "Needs update" },
} as const;
type Status = keyof typeof STATUS;
export type Instance = {
	id: string;
	name: string;
	host: string;
	color: string;
	status: Status;
	home?: boolean;
	lastSeen?: string;
	build: string;
	slots: { busy: number; limit: number };
};

// ---------- store ----------
const minutesAgo = (n: number) =>
	new Date(Date.now() - n * 60000).toISOString();
const seed: Instance[] = [
	{
		id: "local",
		name: "This machine",
		host: location.host,
		color: INSTANCE_COLORS[0]!,
		status: "connected",
		home: true,
		build: "981c315",
		slots: { busy: 2, limit: 4 },
	},
	{
		id: "homelab",
		name: "homelab",
		host: "factory.homelab.ts.net",
		color: INSTANCE_COLORS[1]!,
		status: "connected",
		build: "981c315",
		slots: { busy: 1, limit: 2 },
	},
	{
		id: "ci-box",
		name: "ci-box",
		host: "10.0.4.12:3457",
		color: INSTANCE_COLORS[2]!,
		status: "offline",
		lastSeen: minutesAgo(134),
		build: "65267ec",
		slots: { busy: 0, limit: 4 },
	},
];
type State = { instances: Instance[]; filter: string; dialog: boolean };
let state: State = (() => {
	try {
		const saved = JSON.parse(localStorage.getItem("prototype-instances") ?? "");
		if (saved?.instances?.length) return { ...saved, dialog: false };
	} catch {}
	return { instances: seed, filter: "all", dialog: false };
})();
const listeners = new Set<() => void>();
function set(next: Partial<State>) {
	state = { ...state, ...next };
	localStorage.setItem(
		"prototype-instances",
		JSON.stringify({ instances: state.instances, filter: state.filter }),
	);
	for (const l of listeners) l();
}
const patch = (id: string, change: Partial<Instance>) =>
	set({
		instances: state.instances.map((i) =>
			i.id === id ? { ...i, ...change } : i,
		),
	});
export function useInstances() {
	return useSyncExternalStore(
		(l) => (listeners.add(l), () => listeners.delete(l)),
		() => state,
	);
}
export const openInstances = () => set({ dialog: true });
export function instanceOf(
	item: { instanceId?: string } | undefined,
): Instance {
	return (
		state.instances.find((i) => i.id === (item?.instanceId ?? "local")) ??
		state.instances[0]!
	);
}
/** Only show instance identity once there is more than one instance. */
const multi = () => state.instances.length > 1;
export const isOffline = (run: any) =>
	prototypeOn && instanceOf(run).status !== "connected";
export function useInstanceFilter<T extends { instanceId?: string }>(
	runs: T[],
) {
	const s = useInstances();
	if (!prototypeOn || s.filter === "all") return runs;
	return runs.filter((r) => (r.instanceId ?? "local") === s.filter);
}
const forYou = (runs: any[], id?: string) =>
	runs.filter(
		(r) =>
			!settleReason(r, runs) &&
			attention(r) &&
			(!id || (r.instanceId ?? "local") === id),
	).length;
function ago(at?: string) {
	const m = Math.floor((Date.now() - Date.parse(at ?? "")) / 60000);
	return m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`;
}

// ---------- atoms ----------
export function StatusDot({
	status,
	ring,
}: {
	status: Status;
	ring?: boolean;
}) {
	return (
		<span
			role="img"
			aria-label={STATUS[status].label}
			className={`inline-block size-2.5 shrink-0 rounded-full ${status === "connecting" ? "animate-pulse" : ""} ${ring ? "ring-2 ring-[var(--surface)]" : ""}`}
			style={{ background: STATUS[status].color }}
		/>
	);
}
export function Swatch({
	instance,
	size = 28,
}: {
	instance: Instance;
	size?: number;
}) {
	return (
		<span
			aria-hidden="true"
			className="grid shrink-0 place-items-center rounded-[30%] font-black text-[#120c25]"
			style={{
				background: instance.color,
				width: size,
				height: size,
				fontSize: Math.round(size * 0.46),
				filter: instance.status === "offline" ? "grayscale(.7)" : undefined,
			}}
		>
			{instance.home ? "⌂" : instance.name[0]?.toUpperCase()}
		</span>
	);
}
/** Replaces the purple repo dot: the dot now carries the instance colour. */
export function InstanceDot({ item }: { item: any }) {
	if (!prototypeOn) return <span className="repo-dot" />;
	const i = instanceOf(item);
	return (
		<span
			className="repo-dot"
			title={i.name}
			style={{ background: i.color, opacity: i.status === "offline" ? 0.5 : 1 }}
		/>
	);
}
/** "homelab / Attraccess" in run meta; just the repo name with one instance. */
export function InstanceRepoLabel({ item, repo }: { item: any; repo: string }) {
	if (!prototypeOn || !multi()) return <>{repo}</>;
	const i = instanceOf(item);
	return (
		<>
			<span className="font-bold text-[var(--text)]">{i.name}</span>
			{i.status === "offline" && <span> (offline)</span>} / {repo}
		</>
	);
}
/** Pill naming the instance where there's no meta line (working rows, up next, lists). */
export function InstanceTag({ item }: { item: any; compact?: boolean }) {
	if (!prototypeOn || !multi()) return null;
	const i = instanceOf(item),
		offline = i.status !== "connected";
	return (
		<span
			className={`instance-tag inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[0.72rem] leading-4 font-bold ${offline ? "offline" : ""}`}
			style={{
				background: `color-mix(in srgb, ${i.color} 18%, transparent)`,
				color: "var(--text)",
				marginRight: 0,
			}}
		>
			<span
				className="size-1.5 rounded-full"
				style={{
					background: offline ? STATUS[i.status].color : i.color,
					marginRight: 0,
				}}
			/>
			{i.name}
			{offline && ` · ${STATUS[i.status].label.toLowerCase()}`}
		</span>
	);
}
/** Settled pebbles take their instance's colour instead of the cycling palette. */
export function pebbleStyle(item: any) {
	if (!prototypeOn) return undefined;
	const i = instanceOf(item);
	return {
		background: `color-mix(in srgb, ${i.color} 30%, var(--surface))`,
		color: "var(--text)",
		boxShadow: `inset 0 0 0 2px ${i.color}`,
	};
}

// ---------- header cluster ----------
export function HeaderInstances() {
	const s = useInstances();
	const trouble = s.instances.filter((i) => i.status !== "connected");
	return (
		<button
			type="button"
			onClick={openInstances}
			aria-label={`Instances: ${s.instances.length} connected${trouble.length ? `, ${trouble.length} need attention` : ""}`}
			className={`instance-cluster ${trouble.length ? "trouble" : ""}`}
		>
			<span className="flex -space-x-1.5">
				{s.instances.slice(0, 4).map((i) => (
					<span
						key={i.id}
						className="relative rounded-[30%] ring-2 ring-[var(--surface)]"
					>
						<Swatch instance={i} size={24} />
						<span className="absolute -right-0.5 -bottom-0.5 leading-none">
							<StatusDot status={i.status} ring />
						</span>
					</span>
				))}
			</span>
			<span className="hidden text-sm font-bold sm:inline">
				{trouble.length
					? `${trouble.length} offline`
					: `${s.instances.length} instances`}
			</span>
		</button>
	);
}

// ---------- filter bar (Today) ----------
export function InstanceFilterBar() {
	const s = useInstances(),
		runs = useRuns().data ?? [];
	if (!multi()) return null;
	const chip = (
		id: string,
		label: ReactNode,
		count: number,
		extra?: ReactNode,
	) => (
		<button
			type="button"
			key={id}
			aria-pressed={s.filter === id}
			onClick={() => set({ filter: id })}
			className="instance-chip"
		>
			{extra}
			{label}
			{count > 0 && <span className="attention-count">{count}</span>}
		</button>
	);
	return (
		<nav
			aria-label="Filter by instance"
			className="-mx-1 mb-1 flex gap-2 overflow-x-auto px-1 pt-1 pb-2 [scrollbar-width:none]"
		>
			{chip("all", "Everywhere", forYou(runs))}
			{s.instances.map((i) =>
				chip(
					i.id,
					i.name,
					forYou(runs, i.id),
					<span className="relative">
						<Swatch instance={i} size={20} />
						{i.status !== "connected" && (
							<span className="absolute -right-1 -bottom-1">
								<StatusDot status={i.status} ring />
							</span>
						)}
					</span>,
				),
			)}
			<button
				type="button"
				onClick={openInstances}
				className="instance-chip connect"
			>
				＋ Connect instance
			</button>
		</nav>
	);
}

// ---------- offline treatment ----------
/** Banner shown on cards and run pages belonging to an unreachable instance. */
export function OfflineNotice({ item }: { item: any }) {
	if (!isOffline(item)) return null;
	const i = instanceOf(item);
	return (
		<div
			role="status"
			className="mb-3 flex items-center gap-3 rounded-2xl border-2 border-dashed px-3 py-2 text-sm"
			style={{ borderColor: STATUS[i.status].color }}
		>
			<StatusDot status={i.status} />
			<span className="flex-1">
				<strong>
					{i.name} is{" "}
					{i.status === "outdated" ? "on an older version" : "offline"}.
				</strong>{" "}
				{i.status === "outdated"
					? "Update it to act on this run."
					: `Showing what it last reported ${ago(i.lastSeen)}. Actions come back when it reconnects.`}
			</span>
			<Button variant="ghost" onClick={() => reconnect(i.id)}>
				Retry
			</Button>
		</div>
	);
}
/** Wrap controls of an offline instance's run: visible but not interactive. */
export function OfflineGate({
	item,
	children,
}: {
	item: any;
	children: ReactNode;
}) {
	if (!isOffline(item)) return <>{children}</>;
	return (
		<div inert className="opacity-50 grayscale-[.4]">
			{children}
		</div>
	);
}
function reconnect(id: string) {
	const before = instanceOf({ instanceId: id }).status;
	patch(id, { status: "connecting" });
	setTimeout(
		() => patch(id, { status: before === "connecting" ? "offline" : before }),
		1800,
	);
}

// ---------- composer target ----------
/** Repository options grouped by instance; unreachable instances are disabled. */
export function RepoOptions({ repositories }: { repositories: any[] }) {
	const s = useInstances();
	if (!prototypeOn || !multi())
		return (
			<>
				{repositories.map((r) => (
					<option value={r.id} key={r.id}>
						{r.name}
					</option>
				))}
			</>
		);
	return (
		<>
			{s.instances.map((i) => {
				const repos = repositories.filter(
					(r) => (r.instanceId ?? "local") === i.id,
				);
				if (!repos.length) return null;
				return (
					<optgroup
						key={i.id}
						label={`${i.name}${i.status !== "connected" ? ` — ${STATUS[i.status].label.toLowerCase()}` : ""}`}
					>
						{repos.map((r) => (
							<option
								value={r.id}
								key={r.id}
								disabled={i.status !== "connected"}
							>
								{r.name}
							</option>
						))}
					</optgroup>
				);
			})}
		</>
	);
}
export function RepoPickerIcon({
	repositories,
	value,
}: {
	repositories: any[];
	value: string;
}) {
	useInstances();
	if (!prototypeOn || !multi()) return <span aria-hidden="true">📁</span>;
	const i = instanceOf(repositories.find((r) => r.id === value));
	return (
		<span title={i.name} aria-hidden="true" className="flex">
			<Swatch instance={i} size={20} />
		</span>
	);
}

// ---------- recipes scope ----------
export function RecipesInstanceBar() {
	const s = useInstances(),
		[current, setCurrent] = useState("local");
	if (!prototypeOn || !multi()) return null;
	return (
		<div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-3 shadow-[var(--shadow)]">
			<span className="text-sm font-bold text-[var(--muted)]">
				Recipes & capacity on
			</span>
			<div className="toggle instance-scope">
				{s.instances.map((i) => (
					<button
						type="button"
						key={i.id}
						aria-pressed={current === i.id}
						disabled={i.status !== "connected"}
						onClick={() => setCurrent(i.id)}
						className="inline-flex items-center gap-1.5"
					>
						<Swatch instance={i} size={18} />
						{i.name}
					</button>
				))}
			</div>
			<small className="text-[var(--muted)]">
				Each instance keeps its own recipes, agent defaults and slots.
			</small>
		</div>
	);
}

// ---------- instances dialog ----------
export function InstancesDialog() {
	const s = useInstances(),
		runs = useRuns().data ?? [],
		[adding, setAdding] = useState(false),
		[editing, setEditing] = useState<string>();
	useEffect(() => {
		if (!s.dialog) {
			setAdding(false);
			setEditing(undefined);
		}
	}, [s.dialog]);
	return (
		<Modal
			open={s.dialog}
			onOpenChange={(dialog) => set({ dialog })}
			title="Instances"
			description="Every Factory you connect shows up in one inbox. Each keeps running its own agents on its own machine."
		>
			<div className="modal-body grid gap-4">
				<ul className="m-0 grid list-none gap-2 p-0">
					{s.instances.map((i) =>
						editing === i.id ? (
							<EditRow
								key={i.id}
								instance={i}
								onDone={() => setEditing(undefined)}
							/>
						) : (
							<li
								key={i.id}
								className="flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-3"
							>
								<span className="flex">
									<Swatch instance={i} size={36} />
								</span>
								<div className="instance-row-info min-w-0 flex-1 basis-[calc(100%-56px)] sm:basis-0">
									<div className="flex items-center gap-2">
										<strong className="truncate">{i.name}</strong>
										<span
											className="inline-flex items-center gap-1 rounded-full px-2 text-xs font-bold"
											style={{
												background: `color-mix(in srgb, ${STATUS[i.status].color} 22%, transparent)`,
											}}
										>
											<StatusDot status={i.status} />
											{i.home ? "Serving this UI" : STATUS[i.status].label}
										</span>
									</div>
									<small className="block truncate text-[var(--muted)]">
										{i.host} · build {i.build}
										{i.status === "offline"
											? ` · last seen ${ago(i.lastSeen)}`
											: ` · ${i.slots.busy} of ${i.slots.limit} slots busy`}
									</small>
								</div>
								<span className="chip">{forYou(runs, i.id)} for you</span>
								<div className="flex gap-1">
									{i.status === "offline" && (
										<Button variant="secondary" onClick={() => reconnect(i.id)}>
											Retry
										</Button>
									)}
									<Button variant="ghost" onClick={() => setEditing(i.id)}>
										Edit
									</Button>
								</div>
							</li>
						),
					)}
				</ul>
				{adding ? (
					<PairForm onDone={() => setAdding(false)} />
				) : (
					<Button variant="secondary" onClick={() => setAdding(true)}>
						＋ Connect another instance
					</Button>
				)}
			</div>
		</Modal>
	);
}
function ColorPicker({
	value,
	onChange,
}: {
	value: string;
	onChange: (c: string) => void;
}) {
	return (
		<fieldset
			aria-label="Colour"
			className="m-0 flex flex-wrap gap-2 border-0 p-0"
		>
			{INSTANCE_COLORS.map((c) => (
				<button
					type="button"
					aria-pressed={value === c}
					aria-label={c}
					key={c}
					onClick={() => onChange(c)}
					className="color-option"
					style={{ background: c }}
				/>
			))}
		</fieldset>
	);
}
const field =
	"w-full rounded-xl border-2 border-[var(--line)] bg-[var(--field)] px-3 py-2 font-normal focus:border-[var(--lip)] focus:outline-none";
function EditRow({
	instance,
	onDone,
}: {
	instance: Instance;
	onDone: () => void;
}) {
	const [name, setName] = useState(instance.name),
		[color, setColor] = useState(instance.color),
		[confirm, setConfirm] = useState(false),
		toast = useToast();
	return (
		<li className="grid gap-3 rounded-2xl border-2 border-[var(--lip)] bg-[var(--surface)] p-3">
			<div className="flex items-center gap-3">
				<Swatch instance={{ ...instance, color, name }} size={36} />
				<label className="grid flex-1 gap-1 text-sm font-bold">
					Name
					<input
						className={field}
						value={name}
						onChange={(e) => setName(e.target.value)}
					/>
				</label>
			</div>
			<ColorPicker value={color} onChange={setColor} />
			<div className="flex flex-wrap items-center gap-2">
				<Button
					onClick={() => {
						patch(instance.id, { name: name.trim() || instance.name, color });
						onDone();
					}}
				>
					Save
				</Button>
				<Button variant="ghost" onClick={onDone}>
					Cancel
				</Button>
				<span className="flex-1" />
				{!instance.home &&
					(confirm ? (
						<>
							<small>
								Its runs keep going there. You can reconnect any time.
							</small>
							<Button
								variant="danger"
								onClick={() => {
									set({
										instances: state.instances.filter(
											(i) => i.id !== instance.id,
										),
										filter: state.filter === instance.id ? "all" : state.filter,
									});
									toast({ text: `Disconnected ${instance.name}` });
								}}
							>
								Disconnect
							</Button>
						</>
					) : (
						<Button variant="ghost" onClick={() => setConfirm(true)}>
							Disconnect…
						</Button>
					))}
			</div>
		</li>
	);
}
/** Pair a new instance: paste the link the other Factory prints. */
export function PairForm({ onDone }: { onDone: () => void }) {
	const toast = useToast(),
		[link, setLink] = useState(""),
		[name, setName] = useState(""),
		[color, setColor] = useState(
			INSTANCE_COLORS.find(
				(c) => !state.instances.some((i) => i.color === c),
			) ?? INSTANCE_COLORS[state.instances.length % INSTANCE_COLORS.length]!,
		),
		[phase, setPhase] = useState<"idle" | "checking" | "error">("idle"),
		[error, setError] = useState("");
	const host =
		link
			.trim()
			.replace(/^https?:\/\//, "")
			.split(/[/#?]/)[0] ?? "";
	const submit = () => {
		if (!/#pair=/.test(link)) {
			setPhase("error");
			setError(
				"That isn't a pairing link. It ends in #pair=… — copy the whole line the other Factory printed.",
			);
			return;
		}
		setPhase("checking");
		setTimeout(() => {
			if (/fail|offline/.test(link)) {
				setPhase("error");
				setError(
					`Couldn't reach ${host}. Check that it's running and reachable from this device (same tailnet or network).`,
				);
				return;
			}
			if (/used/.test(link)) {
				setPhase("error");
				setError(
					"This pairing link was already used. Run the pair command again for a fresh one.",
				);
				return;
			}
			const id = `i${Date.now()}`;
			set({
				instances: [
					...state.instances,
					{
						id,
						name: name.trim() || host.split(".")[0] || "instance",
						host,
						color,
						status: "connecting",
						build: "981c315",
						slots: { busy: 0, limit: 4 },
					},
				],
			});
			setTimeout(() => patch(id, { status: "connected" }), 1200);
			toast({ text: `Connected ${name.trim() || host} 🌈` });
			onDone();
		}, 1400);
	};
	return (
		<form
			className="grid gap-4 rounded-2xl border-2 border-[var(--line)] bg-[var(--quiet)] p-4"
			onSubmit={(e) => {
				e.preventDefault();
				submit();
			}}
		>
			<strong className="text-base">Connect an instance</strong>
			<ol className="m-0 grid gap-2 pl-0 text-sm text-[var(--secondary)]">
				{[
					<>
						On the machine you want to add, run <code>pnpm factory pair</code>.
					</>,
					<>
						It prints a one-time pairing link (and a QR code for your phone).
					</>,
					<>Paste the link here. It's valid for 10 minutes.</>,
				].map((text, n) => (
					<li key={n} className="flex list-none items-start gap-2">
						<span className="grid size-5 shrink-0 place-items-center rounded-full bg-[var(--primary)] text-[0.7rem] font-bold text-[var(--primary-text)]">
							{n + 1}
						</span>
						<span>{text}</span>
					</li>
				))}
			</ol>
			<label className="grid gap-1 text-sm font-bold">
				Pairing link
				<input
					className={field}
					placeholder="https://factory.homelab.ts.net/#pair=4F9A-K2QX"
					value={link}
					aria-invalid={phase === "error"}
					onChange={(e) => {
						setLink(e.target.value);
						if (phase === "error") setPhase("idle");
					}}
				/>
			</label>
			<div className="grid gap-4 sm:grid-cols-2">
				<label className="grid content-start gap-1 text-sm font-bold">
					<span>
						Name{" "}
						<small className="font-normal text-[var(--muted)]">optional</small>
					</span>
					<input
						className={field}
						placeholder={host.split(".")[0] || "homelab"}
						value={name}
						onChange={(e) => setName(e.target.value)}
					/>
				</label>
				<div className="grid content-start gap-1 text-sm font-bold">
					Colour
					<ColorPicker value={color} onChange={setColor} />
				</div>
			</div>
			{phase === "error" && (
				<p role="alert" className="error m-0">
					{error}
				</p>
			)}
			<div className="flex gap-2">
				<Button
					type="submit"
					busy={phase === "checking"}
					disabled={!link.trim()}
				>
					{phase === "checking" ? `Reaching ${host}…` : "Connect"}
				</Button>
				<Button variant="ghost" onClick={onDone}>
					Cancel
				</Button>
			</div>
		</form>
	);
}
