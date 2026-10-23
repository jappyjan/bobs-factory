import { createHash } from "node:crypto";
import type { CapacityRequest } from "../MachineCapacity.js";
import type { StepAttempt } from "./Provenance.js";
import type { FactoryRun } from "./WorkflowRuntime.js";

export type TimingKind =
	| "execution"
	| "capacity"
	| "repository"
	| "qa-resource"
	| "provider-ci"
	| "human"
	| "retry-backoff"
	| "children"
	| "recovery"
	| "unknown";
export interface RunTimingUpdate {
	id: string;
	diagnostics: ReturnType<typeof diagnosticSummary>;
}
export interface TimingOperation {
	kind: TimingKind;
	role?: boolean;
	/** Actual runner attempt, never inferred from a capacity lease. */
	roleIdentity?: string;
	resource?: string;
	blockerRun?: string;
}
interface ActiveTiming extends TimingOperation {
	since: string;
	measuredMs: number;
}
export interface DiagnosticAttempt {
	id: string;
	parentAttemptId?: string;
	step: string;
	stepIdentity: string;
	type: string;
	kind: StepAttempt["kind"];
	reason: StepAttempt["reason"];
	outcome: StepAttempt["outcome"];
	runtimeCommit: string | null;
	workflowHash: string;
	contractHash: string;
	instructionsHash: string;
}
export interface RunDiagnostics {
	version: 1;
	observedAt: string;
	startedAt: string;
	clockChanges: number;
	executionMs: number;
	waitMs: number;
	roleWallMs: number;
	waits: Partial<Record<TimingKind, number>>;
	active: Record<string, ActiveTiming>;
	/** Explicit execution boundaries, separate from capacity ownership. */
	operations: Record<string, TimingOperation>;
	sequence: number;
	transitions: {
		sequence: number;
		key: string;
		keyIdentity: string;
		kind: TimingKind;
		at: string;
		measuredMs: number;
		event: "entered" | "left" | "interrupted";
	}[];
	attemptCount: number;
	attempts: DiagnosticAttempt[];
	reuse: { step: string; digest: string; source: string }[];
	context: {
		pages: number;
		utf8Bytes: number;
		readPages: number;
		listPages: number;
		fullPages: number;
		preparations: number;
		preparationMs: number;
	};
	usage: {
		step: string;
		provider: string;
		inputTokens: number | null;
		outputTokens: number | null;
		costUsd: number | null;
	}[];
}
const KEEP = 64;
const bounded = (value: string) => value.slice(0, 160);
const identity = (value: string) =>
	createHash("sha256").update(value).digest("hex");
export function initializeDiagnostics(
	run: FactoryRun,
	now = Date.now(),
): RunDiagnostics {
	if (run.diagnostics) return run.diagnostics;
	run.diagnostics = {
		version: 1,
		observedAt: new Date(now).toISOString(),
		startedAt: new Date(now).toISOString(),
		clockChanges: 0,
		executionMs: 0,
		waitMs: 0,
		roleWallMs: 0,
		waits: {},
		active: {},
		operations: {},
		sequence: 0,
		transitions: [],
		attemptCount: 0,
		attempts: [],
		reuse: [],
		usage: [],
		context: {
			pages: 0,
			utf8Bytes: 0,
			readPages: 0,
			listPages: 0,
			fullPages: 0,
			preparations: 0,
			preparationMs: 0,
		},
	};
	return run.diagnostics;
}
export function timingOperation(
	run: FactoryRun,
	key: string,
	operation?: TimingOperation,
): void {
	const data = initializeDiagnostics(run);
	if (operation) data.operations[key] = operation;
	else delete data.operations[key];
}
function transition(
	data: RunDiagnostics,
	key: string,
	state: ActiveTiming,
	event: RunDiagnostics["transitions"][number]["event"],
	at: string,
) {
	data.transitions.push({
		sequence: ++data.sequence,
		key: bounded(key),
		keyIdentity: identity(key),
		kind: state.kind,
		at,
		measuredMs: state.measuredMs,
		event,
	});
	if (data.transitions.length > KEEP)
		data.transitions.splice(0, data.transitions.length - KEEP);
}
/** Resource identities reveal the kind + a stable hash, never repository URLs, paths or settings. */
function resource(scope: string): string {
	let kind = "shared";
	try {
		const parsed = JSON.parse(scope);
		if (Array.isArray(parsed))
			kind =
				parsed[0] === "resource"
					? "QA resource"
					: parsed[0] === "qa"
						? "QA environment"
						: "repository";
		if (
			Array.isArray(parsed) &&
			parsed[0] === "resource" &&
			/^[a-zA-Z0-9_.-]{1,80}$/.test(parsed[1])
		)
			return `QA resource ${parsed[1]}`;
	} catch {
		/* Legacy opaque identity */
	}
	return `${kind} ${createHash("sha256").update(scope).digest("hex").slice(0, 12)}`;
}
function operations(
	run: FactoryRun,
	observing: boolean,
	capacity: ReadonlyMap<string, TimingOperation>,
): Record<string, TimingOperation> {
	if (!observing) return {};
	const active = { ...run.diagnostics?.operations };
	// Capacity leaves are durable scheduling/fairness records. Only callbacks
	// observed by this accounting instance establish a live diagnostic boundary.
	for (const [key, operation] of capacity) {
		if (operation.kind === "capacity" || !active[key]) active[key] = operation;
	}
	for (const [key, reservation] of Object.entries(
		run.deliveryReservations ?? {},
	)) {
		if (reservation.phase !== "queued" || reservation.admissionReady === false)
			continue;
		const owner = key.replace(/:(mutation|resources)$/, "");
		if (active[owner]?.kind === "capacity") continue;
		// A grouped reservation can wait on repository, QA or both. Its suffix
		// describes ownership, not the targets that are actually blocking it.
		delete active[owner];
		if (!reservation.blockers?.length) {
			active[owner] = { kind: "unknown" }; // Eligibility is still being checked.
			continue;
		}
		let primary = true;
		for (const blocker of reservation.blockers) {
			const groups = new Map<TimingKind, string[]>();
			for (const scope of blocker.targets) {
				let kind: TimingKind = "unknown";
				try {
					const parsed = JSON.parse(scope);
					if (Array.isArray(parsed))
						kind = ["resource", "qa"].includes(parsed[0])
							? "qa-resource"
							: "repository";
				} catch {
					/* Opaque legacy targets cannot prove a category. */
				}
				const scopes = groups.get(kind) ?? [];
				scopes.push(scope);
				groups.set(kind, scopes);
			}
			for (const [kind, scopes] of groups) {
				const observationKey = primary
					? owner
					: `${owner}/wait/${kind}/${blocker.runId}/${blocker.operation}`;
				primary = false;
				active[observationKey] = {
					kind,
					resource: scopes.slice(0, 3).map(resource).join(", "),
					blockerRun: blocker.runId,
				};
			}
		}
	}
	if (run.status === "waiting" && !Object.keys(active).length)
		active.run = {
			kind:
				run.questions.length ||
				run.viewDecision ||
				run.reviewGate ||
				run.architectureGate
					? "human"
					: "children",
		};
	return active;
}
/** Incremental sweep over active leaves only. All intervals in this process use a monotonic clock. */
export class RunAccounting {
	private live = new WeakMap<FactoryRun, { mono: number; wall: number }>();
	private capacity = new WeakMap<FactoryRun, Map<string, TimingOperation>>();
	capacityChanged(
		run: FactoryRun,
		key: string,
		request?: CapacityRequest,
	): void {
		let observed = this.capacity.get(run);
		if (!observed) {
			observed = new Map();
			this.capacity.set(run, observed);
		}
		if (request?.phase === "queued" && !request.parked)
			observed.set(key, { kind: "capacity" });
		else if (request?.phase === "executing")
			observed.set(key, { kind: "execution" });
		else observed.delete(key);
	}
	constructor(
		private clock = { wall: () => Date.now(), mono: () => performance.now() },
	) {}
	now(): number {
		return this.clock.wall();
	}
	restore(run: FactoryRun): void {
		this.capacity.delete(run);
		this.live.delete(run);
		const data = run.diagnostics;
		if (!data) return;
		// Only time persisted at an observation boundary is proven. Never close a
		// crashed interval at startup, and never import fairness queuedAt as timing.
		for (const [key, state] of Object.entries(data.active))
			transition(data, key, state, "interrupted", data.observedAt);
		data.active = {};
		data.operations = {};
		this.live.delete(run);
	}
	observe(run: FactoryRun, observing: boolean): void {
		const now = this.clock.wall(),
			mono = this.clock.mono();
		const data = initializeDiagnostics(run, now),
			prior = this.live.get(run);
		if (prior) {
			const elapsed = Math.max(0, mono - prior.mono);
			const delta = Math.min(elapsed, 5000);
			if (Math.abs(now - prior.wall - elapsed) > 1000) data.clockChanges++;
			const states = Object.values(data.active);
			if (states.some((s) => s.kind === "execution")) data.executionMs += delta;
			else if (states.some((s) => !["unknown", "recovery"].includes(s.kind)))
				data.waitMs += delta;
			data.roleWallMs +=
				new Set(
					Object.entries(data.active)
						.filter(([, state]) => state.kind === "execution" && state.role)
						.map(([key, state]) => state.roleIdentity ?? key),
				).size * delta;
			for (const kind of new Set(states.map((s) => s.kind)))
				if (!["execution", "unknown", "recovery"].includes(kind))
					data.waits[kind] = (data.waits[kind] ?? 0) + delta;
			for (const state of states) state.measuredMs += delta;
		}
		const next = operations(
			run,
			observing,
			this.capacity.get(run) ?? new Map(),
		);
		const at = new Date(now).toISOString();
		for (const [key, state] of Object.entries(data.active)) {
			const operation = next[key];
			if (
				!operation ||
				operation.kind !== state.kind ||
				operation.role !== state.role ||
				operation.roleIdentity !== state.roleIdentity ||
				operation.resource !== state.resource ||
				operation.blockerRun !== state.blockerRun
			) {
				transition(data, key, state, "left", at);
				delete data.active[key];
			}
		}
		for (const [key, operation] of Object.entries(next))
			if (!data.active[key]) {
				const state = { ...operation, since: at, measuredMs: 0 };
				data.active[key] = state;
				transition(data, key, state, "entered", at);
			}
		data.observedAt = at;
		this.live.set(run, { wall: now, mono });
	}
}
export function diagnosticAttempt(
	run: FactoryRun,
	attempt: StepAttempt,
	isNew = false,
): void {
	const data = initializeDiagnostics(run);
	const previous = data.attempts.findIndex((a) => a.id === attempt.id);
	const item: DiagnosticAttempt = {
		id: attempt.id,
		parentAttemptId: attempt.parentAttemptId,
		step: bounded(attempt.step),
		stepIdentity: identity(attempt.step),
		type: attempt.type,
		kind: attempt.kind,
		reason: attempt.reason,
		outcome: attempt.outcome,
		runtimeCommit: attempt.runtime.commit ?? null,
		workflowHash: attempt.workflowHash,
		contractHash: attempt.contract.hash,
		instructionsHash: attempt.instructionsHash,
	};
	if (previous >= 0) data.attempts[previous] = item;
	else if (isNew) {
		data.attemptCount++;
		data.attempts.push(item);
		if (data.attempts.length > KEEP) data.attempts.shift();
	}
}
export function diagnosticReuse(
	run: FactoryRun,
	step: string,
	digest: string,
	source: string,
): void {
	const data = initializeDiagnostics(run);
	if (data.reuse.some((r) => r.step === step && r.digest === digest)) return;
	data.reuse.push({ step: bounded(step), digest, source: bounded(source) });
	if (data.reuse.length > KEEP) data.reuse.shift();
}
/** These adapters synthesize zero compatibility fields. Only nonzero tokens are attributable;
 * Claude's native result can also report a genuine zero. Never infer prices. */
export function diagnosticUsage(
	run: FactoryRun,
	step: string,
	provider: string,
	result: unknown,
): void {
	const value = result as
		| {
				usage?: { input_tokens?: number; output_tokens?: number };
				total_cost_usd?: number;
		  }
		| undefined;
	const number = (n: unknown) =>
		typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
	const input = number(value?.usage?.input_tokens),
		output = number(value?.usage?.output_tokens);
	const reported = provider === "claude" || (input ?? 0) + (output ?? 0) > 0;
	const data = initializeDiagnostics(run);
	data.usage.push({
		step: bounded(step),
		provider,
		inputTokens: reported ? input : null,
		outputTokens: reported ? output : null,
		costUsd: provider === "claude" ? number(value?.total_cost_usd) : null,
	});
	if (data.usage.length > KEEP) data.usage.shift();
}
export function diagnosticSummary(run: FactoryRun, now = Date.now()) {
	const data = run.diagnostics;
	const ageMs = Math.max(0, now - Date.parse(run.createdAt));
	const executionMs = data?.executionMs ?? 0,
		waitMs = data?.waitMs ?? 0;
	return {
		ageMs,
		executionMs,
		waitMs,
		unobservedMs: Math.max(0, ageMs - executionMs - waitMs),
		roleWallMs: data?.roleWallMs ?? 0,
		legacy: !data,
		observedAt: data?.observedAt ?? null,
		startedAt: data?.startedAt ?? null,
		clockChanges: data?.clockChanges ?? 0,
		currentTotal: Object.keys(data?.active ?? {}).length,
		current: Object.entries(data?.active ?? {})
			.slice(0, 32)
			.map(([step, state]) => ({
				step: bounded(step),
				stepIdentity: identity(step),
				...state,
			})),
		waits: data?.waits ?? {},
		context: data?.context ?? null,
	};
}
/** Bounded allowlist; deliberately does not touch history, outputs, prompts, config or native sessions. */
export function runDiagnostics(
	run: FactoryRun,
	offset = 0,
	limit = 20,
	now = Date.now(),
) {
	offset =
		Number.isSafeInteger(offset) && offset >= 0 ? Math.min(offset, KEEP) : 0;
	limit = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 32) : 20;
	const data = run.diagnostics;
	const attempts = data?.attempts ?? [],
		transitions = data?.transitions ?? [];
	const repeats = new Map<string, { step: string; count: number }>();
	for (const attempt of attempts)
		if (attempt.kind === "step")
			repeats.set(attempt.stepIdentity, {
				step: attempt.step,
				count: (repeats.get(attempt.stepIdentity)?.count ?? 0) + 1,
			});
	return {
		schemaVersion: 1,
		runId: run.id,
		...diagnosticSummary(run, now),
		semantics:
			"Execution and exclusive wait are run wall interval unions. Per-reason waits may overlap each other and execution. Role wall is a sum of executing agent leaves, not provider inference time. Unobserved includes legacy gaps, offline time and time after the last checkpoint; wall clock changes can make age differ from monotonic totals.",
		recentWindow: KEEP,
		attemptCount: data?.attemptCount ?? null,
		recentChecks: attempts.filter(
			(a) => a.kind === "step" && a.type === "check",
		).length,
		repeatedRoles: [...repeats]
			.filter(([, value]) => value.count > 1)
			.slice(0, 32)
			.map(([stepIdentity, value]) => ({ stepIdentity, ...value })),
		attempts: attempts
			.slice(
				Math.max(0, attempts.length - offset - limit),
				Math.max(0, attempts.length - offset),
			)
			.reverse(),
		transitions: transitions
			.slice(
				Math.max(0, transitions.length - offset - limit),
				Math.max(0, transitions.length - offset),
			)
			.reverse(),
		reuse: (data?.reuse ?? []).slice(-limit),
		usage: (data?.usage ?? []).slice(-limit),
		usageAttribution:
			"Only available provider-reported values; null is unknown. Per-result values are not summed across native resumes. Adapter compatibility zeros are not cost evidence.",
		offset,
		limit,
		nextOffset:
			offset + limit < Math.max(attempts.length, transitions.length)
				? offset + limit
				: null,
	};
}
