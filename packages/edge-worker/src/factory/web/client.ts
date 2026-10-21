import { fetchEventSource } from "@microsoft/fetch-event-source";
import {
	QueryClient,
	type QueryKey,
	useIsMutating,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
	active,
	attention,
	capacityPhaseLabel,
	finished,
	settleReason,
	workingLabel,
} from "../RunAttention.js";
import {
	accessGeneration,
	accessRequired,
	accessSignal,
	accessState,
	cancelAccessRequests,
	onAccessLost,
	onSessionRotation,
} from "./auth-state";
import { useFormState } from "./form-state";
import {
	authoritativeReady,
	beginWrite,
	checkVersion,
	disconnected,
	pwaState,
	uiBuild,
	usePwa,
	versionMismatch,
} from "./pwa";

export {
	active,
	attention,
	capacityPhaseLabel,
	finished,
	settleReason,
	workingLabel,
};
export const client = new QueryClient({
	defaultOptions: {
		queries: {
			retry: (count) => accessState().status === "authenticated" && count < 2,
			refetchOnWindowFocus: true,
			staleTime: 1000,
		},
	},
});
onAccessLost(() => {
	void client.cancelQueries();
	client.clear();
});
const queryRefreshes = new WeakMap<
	QueryClient,
	Map<string, { epoch: number; again: boolean; promise: Promise<void> }>
>();
/** Finish the current read and catch up once, instead of restarting it on every event. */
export function refreshQueries(cache: QueryClient, queryKey: QueryKey) {
	let pending = queryRefreshes.get(cache);
	if (!pending) {
		pending = new Map();
		queryRefreshes.set(cache, pending);
	}
	const key = JSON.stringify(queryKey),
		epoch = accessGeneration(),
		previous = pending.get(key);
	if (previous?.epoch === epoch) {
		previous.again = true;
		return previous.promise;
	}
	const refresh = { epoch, again: false, promise: Promise.resolve() };
	let catchUp = cache.isFetching({ queryKey }) > 0;
	pending.set(key, refresh);
	refresh.promise = (async () => {
		try {
			do {
				refresh.again = false;
				await cache.invalidateQueries({ queryKey }, { cancelRefetch: false });
				if (catchUp) {
					refresh.again = true;
					catchUp = false;
				}
			} while (refresh.again && epoch === accessGeneration());
		} finally {
			if (pending.get(key) === refresh) pending.delete(key);
		}
	})();
	return refresh.promise;
}
export function useLiveUpdates() {
	const cache = useQueryClient();
	const [error, setError] = useState<string>();
	useEffect(() => {
		let controller: AbortController;
		let failureTimer: ReturnType<typeof setTimeout> | undefined;
		const cancelFailure = () => clearTimeout(failureTimer);
		const stop = () => {
			cancelFailure();
			controller.abort();
		};
		const connect = () => {
			cancelFailure();
			const connection = new AbortController();
			controller = connection;
			void fetchEventSource("/api/events", {
				signal: connection.signal,
				async onopen(response) {
					if (connection.signal.aborted) {
						await response.body?.cancel();
						return;
					}
					await validateLiveConnection(response);
					if (connection.signal.aborted) return;
					cancelFailure();
					setError(undefined);
					// validateLiveConnection already refreshed the current routes and caches.
				},
				onmessage(event) {
					if (event.event !== "change") return;
					const change = JSON.parse(event.data);
					if (change.ids?.length || change.config)
						void refreshQueries(cache, ["runs"]);
					if (change.config) {
						void refreshQueries(cache, ["config"]);
						void refreshQueries(cache, ["ticket-managers"]);
					}
					if (change.capacity) void refreshQueries(cache, ["capacity"]);
					for (const id of change.ids ?? []) {
						void refreshQueries(cache, ["run", id]);
						void refreshQueries(cache, ["transcript", id]);
					}
				},
				onclose() {
					throw new Error("Live connection closed");
				},
				onerror(cause) {
					if (
						connection.signal.aborted ||
						accessState().status !== "authenticated" ||
						pwaState().status === "mismatch"
					)
						throw cause; // Await an explicit update; do not accumulate rejected SSE streams.
					// Browsers can reject the request just before pagehide. Give the
					// navigation event time to cancel cleanup; real failures still clear
					// private state promptly, before the stream's retry interval.
					cancelFailure();
					failureTimer = setTimeout(() => {
						if (
							connection.signal.aborted ||
							controller !== connection ||
							accessState().status !== "authenticated" ||
							pwaState().status === "mismatch"
						)
							return;
						disconnected();
						setError(
							cause instanceof Error
								? cause.message
								: "Live connection unavailable",
						);
					}, 250);
					return 2000;
				},
			}).catch(() => {
				/* Aborted during unmount; library reconnects other failures. */
			});
		};
		connect();
		let mounted = true;
		// Full-page navigation does not unmount React before requests are torn
		// down. Abort the live stream first so that teardown is not treated as
		// a connection failure that clears private reading state.
		const hide = () => {
			stop();
			cancelAccessRequests();
		};
		const show = (event: PageTransitionEvent) => {
			if (
				event.persisted &&
				mounted &&
				accessState().status === "authenticated"
			)
				connect();
		};
		window.addEventListener("beforeunload", hide);
		window.addEventListener("pagehide", hide);
		window.addEventListener("pageshow", show);
		const unsubscribe = onSessionRotation(() => {
			stop();
			void cache.cancelQueries();
			return () => {
				if (mounted && accessState().status === "authenticated") connect();
			};
		});
		return () => {
			mounted = false;
			window.removeEventListener("beforeunload", hide);
			window.removeEventListener("pagehide", hide);
			window.removeEventListener("pageshow", show);
			unsubscribe();
			stop();
		};
	}, [cache]);
	return error;
}
export async function validateLiveConnection(response: Response) {
	try {
		if (response.status === 401) {
			accessRequired("Your session expired. Sign in again.");
			throw new Error("Sign in required");
		}
		if (
			!response.ok ||
			!response.headers.get("content-type")?.includes("text/event-stream")
		)
			throw new Error("Live connection unavailable");
		await refreshFactory();
	} catch (error) {
		// onopen runs before the SSE reader is created. Release its response on rejection.
		await response.body?.cancel();
		throw error;
	}
}
function requestConfigRevision(
	cache: QueryClient,
	path: string,
): string | undefined {
	const recipe =
		path === "/api/workflows" ||
		path.startsWith("/api/workflows/") ||
		path.startsWith("/api/workflow-preferences/");
	const execution = ["/api/execution-profiles", "/api/git-settings"].includes(
		path,
	);
	if (
		!recipe &&
		!execution &&
		path !== "/api/title-settings" &&
		path !== "/api/runs" &&
		!path.startsWith("/api/launch-assets")
	)
		return undefined;
	return (
		cache.getQueryData<any>(
			recipe
				? ["config", "recipes"]
				: execution
					? ["config", "settings"]
					: ["config"],
		) ?? cache.getQueryData<any>(["config"])
	)?.configRevision;
}
export async function api<T = any>(
	path: string,
	options: RequestInit = {},
): Promise<T> {
	const epoch = accessGeneration();
	const authSignal = accessSignal();
	if (accessState().status !== "authenticated")
		throw new Error("Sign in required");
	const write = !["GET", "HEAD"].includes(
		(options.method ?? "GET").toUpperCase(),
	);
	const finish = write ? beginWrite() : undefined;
	// Bind the write to the configuration shown when it began, before async checks.
	const configRevision = write
		? requestConfigRevision(client, path)
		: undefined;
	try {
		if ((write || pwaState().status !== "ready") && !(await checkVersion()))
			throw new Error(
				"Factory connection or version unavailable. Reconnect or update before continuing.",
			);
		const response = await fetch(path, {
			...options,
			signal: options.signal
				? AbortSignal.any([options.signal, authSignal])
				: authSignal,
			cache: "no-store",
			headers: {
				"Content-Type": "application/json",
				"X-Factory-Request": "1",
				...(configRevision ? { "X-Factory-Config": configRevision } : {}),
				...options.headers,
				"X-Factory-Build": uiBuild,
			},
		});
		if (epoch !== accessGeneration()) throw new Error("Session changed");
		if (response.status === 401) {
			accessRequired("Your session expired. Sign in again.");
			throw new Error("Sign in required");
		}
		const responseBuild = response.headers.get("X-Factory-Build");
		if (!responseBuild) {
			const message =
				response.status === 403
					? "Factory request was blocked (HTTP 403). Check the public connection and reconnect."
					: "Factory response could not be verified. Check the public connection and reconnect.";
			disconnected(message);
			await response.body?.cancel();
			throw new Error(message);
		}
		if (responseBuild !== uiBuild) {
			versionMismatch(responseBuild);
			throw new Error("Factory version changed. Update before continuing.");
		}
		const body = await response.json();
		if (epoch !== accessGeneration()) throw new Error("Session changed");
		if (!response.ok) {
			if (response.status >= 500) disconnected();
			throw new Error(body.error ?? `Request failed (${response.status})`);
		}
		return body;
	} catch (error) {
		if (
			error instanceof TypeError &&
			epoch === accessGeneration() &&
			!authSignal.aborted &&
			!options.signal?.aborted
		)
			disconnected();
		throw error;
	} finally {
		finish?.();
	}
}
let refreshing: Promise<void> | undefined;
export function refreshFactory() {
	if (accessState().status !== "authenticated") return Promise.resolve();
	refreshing ??= refreshFactoryData().finally(() => {
		refreshing = undefined;
	});
	return refreshing;
}
async function refreshFactoryData() {
	if (!(await checkVersion()))
		throw new Error("Factory connection or version unavailable");
	// Session loss aborts old requests. Reuse reads already started by the mounted
	// page, so opening the event stream does not cancel and download them again.
	const refreshedRoute = location.hash;
	const route = /^#\/runs\/([^/]+)(?:\/(review|architecture))?$/.exec(
		refreshedRoute,
	);
	const id = route ? decodeURIComponent(route[1]!) : undefined;
	const view = route?.[2] === "architecture" ? "architecture" : "dashboard";
	const routeKey = id ? runQueryKey(id, view) : undefined;
	await Promise.all([
		client.fetchQuery({
			queryKey: ["config"],
			queryFn: ({ signal }) => api("/api/config?view=dashboard", { signal }),
			staleTime: 0,
		}),
		client.fetchQuery({
			queryKey: ["runs"],
			queryFn: ({ signal }) => api("/api/runs", { signal }),
			staleTime: 0,
		}),
		// Validate the restored gate in parallel with the shell before enabling writes.
		id && routeKey
			? client
					.fetchQuery({
						queryKey: routeKey,
						queryFn: ({ signal }) =>
							api(`/api/runs/${encodeURIComponent(id)}?view=${view}`, {
								signal,
							}),
						staleTime: 0,
					})
					.catch((error) => {
						if (error.message !== "Run not found") throw error;
						client.setQueryData(routeKey, null);
					})
			: undefined,
	]);
	await client.invalidateQueries(
		{
			predicate: (query) =>
				(["run", "transcript", "capacity", "ticket-managers"].includes(
					String(query.queryKey[0]),
				) &&
					JSON.stringify(query.queryKey) !== JSON.stringify(routeKey)) ||
				(query.queryKey[0] === "config" && query.queryKey.length > 1),
		},
		{ throwOnError: true, cancelRefetch: false },
	);
	if (location.hash !== refreshedRoute) return refreshFactoryData();
	authoritativeReady();
}
export function useConfig(
	view: "dashboard" | "settings" | "recipes" = "dashboard",
) {
	return useQuery({
		queryKey: view === "dashboard" ? ["config"] : ["config", view],
		queryFn: ({ signal }) => api(`/api/config?view=${view}`, { signal }),
	});
}
export function useCapacity() {
	return useQuery({
		queryKey: ["capacity"],
		queryFn: ({ signal }) => api("/api/capacity", { signal }),
	});
}
export function useRuns() {
	return useQuery({
		queryKey: ["runs"],
		queryFn: ({ signal }) => api<any[]>("/api/runs", { signal }),
	});
}
type RunView = "dashboard" | "focus" | "architecture";
export function runQueryKey(id: string | undefined, view: RunView) {
	return view === "dashboard" ? ["run", id] : ["run", id, view];
}
export function useRun(id?: string, view: RunView = "dashboard") {
	return useQuery({
		queryKey: runQueryKey(id, view),
		enabled: Boolean(id),
		queryFn: ({ signal }) =>
			api(`/api/runs/${encodeURIComponent(id!)}?view=${view}`, { signal }),
	});
}
const pendingActions = new Set<string>();
const actionRequests = new WeakMap<
	object,
	{ revision?: string; epoch: number }
>();
function mergeConfig(previous: any, saved: any, revision?: string) {
	// A response to another view's edit cannot make an older snapshot current.
	if (!previous || previous.configRevision !== revision) return previous;
	const next = { ...previous };
	for (const key of [
		"configRevision",
		"workflows",
		"defaultWorkflow",
		"titleGeneration",
		"executionProfiles",
		"gitSettings",
		"workflowConfiguration",
	])
		if (
			Object.hasOwn(saved, key) &&
			(key === "configRevision" || Object.hasOwn(previous, key))
		)
			next[key] = saved[key];
	if (next.workflows && saved.updatedWorkflows) {
		const updated = new Map<string, any>(
			saved.updatedWorkflows.map((workflow: any) => [workflow.id, workflow]),
		);
		const existing = new Set(
			next.workflows.map((workflow: any) => workflow.id),
		);
		next.workflows = [
			...next.workflows.map(
				(workflow: any) => updated.get(workflow.id) ?? workflow,
			),
			...saved.updatedWorkflows.filter(
				(workflow: any) => !existing.has(workflow.id),
			),
		];
	}
	if (next.workflows && saved.workflowMetadata) {
		const metadata = new Map<string, any>(
			saved.workflowMetadata.map((workflow: any) => [workflow.id, workflow]),
		);
		next.workflows = next.workflows.map((workflow: any) => ({
			...workflow,
			...metadata.get(workflow.id),
		}));
	}
	if (next.workflowConfiguration && saved.workflowConfigurationPatch)
		next.workflowConfiguration = {
			...next.workflowConfiguration,
			...saved.workflowConfigurationPatch,
		};
	return next;
}
export function useAction(scope?: string, context?: string) {
	const cache = useQueryClient();
	const connection = usePwa();
	const [formContext] = useFormState(context ?? "", () => ({}));
	const pendingCount = useIsMutating({ mutationKey: ["action", scope] });
	const mutation = useMutation({
		mutationKey: ["action", scope],
		mutationFn: (request: {
			path: string;
			body?: any;
			method?: string;
			formContext?: object;
		}) => {
			const { path, body = {}, method = "POST" } = request;
			const revision = requestConfigRevision(cache, path);
			actionRequests.set(request, { revision, epoch: accessGeneration() });
			return api(path, {
				method,
				body: JSON.stringify(body),
				...(revision ? { headers: { "X-Factory-Config": revision } } : {}),
			});
		},
		onSuccess: async (data, request) => {
			const original = actionRequests.get(request);
			const current = () =>
				original?.epoch === accessGeneration() &&
				accessState().status === "authenticated";
			if (!current()) return;
			const { path, method = "POST" } = request;
			const configWrite =
				[
					"/api/workflows",
					"/api/workflow-preferences",
					"/api/title-settings",
					"/api/execution-profiles",
					"/api/git-settings",
					"/api/onboarding",
					"/api/ticket-managers",
				].some((prefix) => path === prefix || path.startsWith(`${prefix}/`)) &&
				!["/api/git-settings/test", "/api/workflows/import/impact"].includes(
					path,
				);
			if (configWrite) {
				// Cancel older reads before applying accepted permissions. A failed
				// refresh must not let the next edit restore a revoked permission.
				await cache.cancelQueries({ queryKey: ["config"] });
				if (!current()) return;
				const saved =
					path === "/api/execution-profiles"
						? { executionProfiles: data }
						: data;
				cache.setQueriesData({ queryKey: ["config"] }, (previous: any) =>
					mergeConfig(previous, saved, original?.revision),
				);
			}
			const runId = /^\/api\/runs\/([^/]+)/.exec(path)?.[1];
			if (runId || path === "/api/runs") {
				if (typeof data.id === "string" && typeof data.status === "string") {
					await Promise.all([
						cache.cancelQueries({ queryKey: ["run", data.id] }),
						cache.cancelQueries({ queryKey: ["runs"] }),
					]);
					if (!current()) return;
					const accepted = {
						status: data.status,
						...(typeof data.title === "string" ? { title: data.title } : {}),
						// A waiting acknowledgment does not include its new questions or gate.
						pendingContext: data.status === "waiting",
					};
					cache.setQueriesData(
						{ queryKey: ["run", data.id] },
						(previous: any) =>
							previous ? { ...previous, ...accepted } : previous,
					);
					cache.setQueryData<any[]>(["runs"], (previous) =>
						previous?.map((run) =>
							run.id === data.id ? { ...run, ...accepted } : run,
						),
					);
				}
				void refreshQueries(cache, ["runs"]);
				if (runId) {
					const id = decodeURIComponent(runId);
					void refreshQueries(cache, ["run", id]);
					void refreshQueries(cache, ["transcript", id]);
				}
			}
			if (path.startsWith("/api/updates/"))
				void refreshQueries(cache, ["updates"]);
			if (path === "/api/capacity" && method === "PUT") {
				await cache.cancelQueries({ queryKey: ["capacity"] });
				if (!current()) return;
				cache.setQueryData(["capacity"], data);
			}
			if (path.startsWith("/api/ticket-managers")) {
				if (data.managers) cache.setQueryData(["ticket-managers"], data);
				else void refreshQueries(cache, ["ticket-managers"]);
			}
			// Configuration edits wait for current permissions; accepted run actions
			// must not wait on unrelated setup, capacity or update reads.
			if (configWrite) {
				if (
					path.startsWith("/api/workflows") &&
					path !== "/api/workflows/default"
				) {
					void refreshQueries(cache, ["runs"]);
					void refreshQueries(cache, ["run"]);
				}
				await refreshQueries(cache, ["config"]);
			}
		},
	});
	return {
		...mutation,
		error:
			mutation.variables?.formContext === formContext ? mutation.error : null,
		isPending: mutation.isPending || (scope !== undefined && pendingCount > 0),
		mutateAsync: async (...args: Parameters<typeof mutation.mutateAsync>) => {
			if (scope && pendingActions.has(scope))
				throw new Error("This request is already pending.");
			if (scope) pendingActions.add(scope);
			try {
				const [request, options] = args;
				return await mutation.mutateAsync({ ...request, formContext }, options);
			} finally {
				if (scope) pendingActions.delete(scope);
			}
		},
		isBlocked: connection.status !== "ready" || connection.updating,
	};
}
export function ago(at?: string) {
	if (!at) return "just now";
	const minutes = Math.max(
		0,
		Math.floor((Date.now() - Date.parse(at)) / 60000),
	);
	return minutes < 1
		? "just now"
		: minutes < 60
			? `${minutes}m ago`
			: minutes < 1440
				? `${Math.floor(minutes / 60)}h ago`
				: `${Math.floor(minutes / 1440)}d ago`;
}
export function elapsed(at: string) {
	return ago(at).replace(" ago", "");
}
export const icons: Record<string, string> = {
	"existing-work": "🔎",
	"assess-existing": "🧭",
	clarify: "💬",
	decisions: "📌",
	plan: "🗺️",
	"plan-review": "🧐",
	implement: "🔨",
	"draft-pr": "🚀",
	"code-review": "👀",
	"review-gate": "🚦",
	"code-fix": "🔧",
	ci: "🧪",
	"ci-fix": "🧪",
	"visual-scope": "🎯",
	capture: "🧪",
	"visual-review": "👀",
	"visual-gate": "✅",
	"visual-fix": "🔧",
	guide: "📖",
	handoff: "🎁",
	"human-review": "🙋",
	"human-fix": "🔧",
	merge: "🎉",
	simple: "⚡",
};
export function phase(id: string) {
	if (/visual|capture/.test(id)) return "indigo";
	if (/ci|merge-readiness/.test(id)) return "blue";
	if (/guide|handoff|human|merge/.test(id)) return "violet";
	if (/review|code-fix/.test(id)) return "green";
	if (/plan/.test(id)) return "orange";
	if (/implement|draft|simple/.test(id)) return "yellow";
	return "red";
}
export function stepsOf(
	run: any,
	config: any,
	researchJobs?: Record<string, { role: string; status: string }>,
): any[] {
	if (run.improvement && researchJobs) {
		const roles = workflowOf(run, config)?.steps ?? [];
		return Object.entries(researchJobs).map(([key, job]) => {
			const role = roles.find((s: any) => s.id === job.role);
			const detail = key
				.replace(/^worker-/, "")
				.replace(/^([^-]+)-\1-/, "$1 · ")
				.replaceAll("-", " ");
			return {
				...role,
				id: job.role,
				key,
				name: `${role?.name ?? "Research assignment"}${key === job.role ? "" : ` · ${detail}`}`,
				researchStatus: job.status,
			};
		});
	}
	const walk = (steps: any[], prefix = "", seen: string[] = []): any[] =>
		steps.flatMap((step) => {
			const key = prefix + step.id;
			if (step.type === "workflow") {
				if (seen.includes(step.workflow)) return [];
				const target = (
					run.workflowDefinitions ??
					config?.workflows ??
					[]
				).find((item: any) => item.id === step.workflow);
				return walk(target?.steps ?? [], `${key}/`, [...seen, step.workflow]);
			}
			return [
				{ ...step, key },
				...(step.groups ?? []).flatMap((group: any[], i: number) =>
					walk(group, `${key}/${i}/`, seen),
				),
			];
		});
	return walk(workflowOf(run, config)?.steps ?? []);
}
export function workflowOf(run: any, config: any) {
	return typeof run.workflow === "object"
		? run.workflow
		: (config?.workflows?.find((item: any) => item.id === run.workflow) ?? {
				id: "simple",
				name: "Simple / Bob’s Factory",
			});
}
export const friendly: Record<string, string> = {
	ticket: "Ticket",
	source: "Source pull request",
	repository: "Repository",
	"existing-work": "Existing work",
	"assess-existing": "Assessment",
	clarify: "Clarification",
	decisions: "Decision record",
	plan: "Implementation plan",
	"plan-review": "Plan review",
	implement: "Implementation report",
	"draft-pr": "Draft PR",
	"code-review": "Code review",
	"review-gate": "Review gate",
	ci: "CI checks",
	"merge-readiness": "Merge readiness",
	"ci-fix": "CI fix report",
	"visual-scope": "QA stories and screenshots",
	capture: "QA and screenshots",
	"visual-review": "QA and screenshot review",
	"visual-gate": "QA gate",
	guide: "Review guide",
	handoff: "Hand-off",
	"human-review": "Human review",
	merge: "Merge",
};
export function artifactsOf(
	run: any,
): { name: string; value: any; title: string }[] {
	const seen = new Set<string>();
	return Object.entries(run.outputs ?? {})
		.filter(([, v]) => {
			const hash = JSON.stringify(v);
			if (seen.has(hash)) return false;
			seen.add(hash);
			return true;
		})
		.map(([name, value]) => ({
			name,
			value,
			title:
				(value as any)?.stamp?.reviewer ??
				(!(value as any)?.qaContract &&
				["capture", "visual-scope", "visual-review", "visual-gate"].includes(
					name,
				)
					? (
							{
								capture: "Screenshots",
								"visual-scope": "Visual scope",
								"visual-review": "Visual review",
								"visual-gate": "Visual gate",
							} as Record<string, string>
						)[name]!
					: (friendly[name] ?? name)),
		}));
}
export function screenshotUrl(run: any, index: number, artifact = "capture") {
	const value = run.outputs?.[artifact];
	const shot = value?.screenshots?.[index];
	const version =
		shot?.imageSha256 ??
		value?.__artifactHash ??
		shot?.path ??
		value?.revision ??
		"";
	return `/api/runs/${encodeURIComponent(run.id)}/screenshots/${index}?artifact=${encodeURIComponent(artifact)}&v=${encodeURIComponent(version)}`;
}
