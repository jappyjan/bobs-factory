import {
	MutationObserver,
	QueryClient,
	QueryClientProvider,
	QueryObserver,
	useMutation,
	useQueryClient,
} from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { artifactType, RenderArtifact } from "../src/factory/web/artifacts.js";
import {
	accessRequired,
	accessState,
	cancelAccessRequests,
	checkAccess,
	rotateSession,
} from "../src/factory/web/auth-state.js";
import {
	api,
	artifactsOf,
	client,
	refreshFactory,
	refreshQueries,
	runQueryKey,
	useAction,
	validateLiveConnection,
} from "../src/factory/web/client.js";
import { FinalMessage } from "../src/factory/web/focus.js";
import {
	authoritativeReady,
	checkVersion,
	disconnected,
	pwaState,
	uiBuild,
} from "../src/factory/web/pwa.js";
import { qaExecution } from "./fixtures/qa.js";

vi.mock("@tanstack/react-query", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-query")>()),
	useMutation: vi.fn(() => ({
		isPending: false,
		variables: undefined,
		error: null,
	})),
	useIsMutating: vi.fn(() => 0),
	useQueryClient: vi.fn(),
}));

// These mutation-cache checks call mocked hooks outside a mounted form.
vi.mock("../src/factory/web/form-state.js", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("../src/factory/web/form-state.js")
	>()),
	useFormState: (_context: string, initial: unknown) => [
		typeof initial === "function" ? initial() : initial,
		vi.fn(),
	],
}));

vi.mock("../src/factory/web/pwa.js", async (importOriginal) => {
	const original =
		await importOriginal<typeof import("../src/factory/web/pwa.js")>();
	return { ...original, usePwa: () => original.pwaState() };
});
const factoryResponse = (body: unknown, init: ResponseInit = {}) =>
	Response.json(body, {
		...init,
		headers: { ...init.headers, "X-Factory-Build": uiBuild },
	});
const version = () => factoryResponse({ build: uiBuild, protocol: 1 });
beforeEach(async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => version()),
	);
	vi.stubGlobal(
		"fetch",
		vi.fn(async () =>
			factoryResponse({ authenticated: true, expires: Date.now() + 60000 }),
		),
	);
	await checkAccess();
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => version()),
	);
	await checkVersion();
	authoritativeReady();
});

afterEach(() => {
	client.clear();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

function action(cache: QueryClient) {
	vi.mocked(useQueryClient).mockReturnValue(cache);
	// biome-ignore lint/correctness/useHookAtTopLevel: React hooks are mocked; the mutation runs through a real query observer.
	useAction();
	return new MutationObserver(
		cache,
		vi.mocked(useMutation).mock.calls.at(-1)![0],
	);
}

it("preserves consecutive permission revocations after failed refreshes and a late stale read", async () => {
	const cache = new QueryClient();
	const initial = {
		repositories: [{ id: "repo", name: "Repo" }],
		defaultRunner: "claude",
		defaultWorkflow: "simple",
		workflows: [
			{
				id: "simple",
				allowedTriggers: ["manual", "ticket-assignment"],
				launchFields: [{ name: "prompt", required: true }],
			},
		],
	};
	cache.setQueryData(["config"], initial);
	cache.setQueryData(["config", "settings"], initial);
	const writes: (typeof initial.workflows)[] = [];
	let staleRead: ((response: Response) => void) | undefined;
	vi.stubGlobal(
		"fetch",
		vi.fn(async (_path: string, options: RequestInit = {}) => {
			if (_path === "/api/version") return version();
			if (_path === "/api/auth/status")
				return factoryResponse({
					authenticated: true,
					expires: Date.now() + 60000,
				});
			if (options.method === "PUT") {
				const saved = JSON.parse(options.body as string);
				writes.push(saved.workflows);
				return factoryResponse(saved);
			}
			if (!staleRead)
				return new Promise<Response>((resolve) => {
					staleRead = resolve;
				});
			return factoryResponse(
				{ error: "Config refresh unavailable" },
				{ status: 503 },
			);
		}),
	);
	const query = new QueryObserver(cache, {
		queryKey: ["config"],
		queryFn: ({ signal }) => api("/api/config", { signal }),
		staleTime: Infinity,
		retry: false,
	});
	const unsubscribe = query.subscribe(() => {});
	const oldRead = query.refetch();
	const mutation = action(cache);
	const revoke = (trigger: string) => {
		const current = cache.getQueryData<typeof initial>(["config"])!;
		return mutation.mutate({
			path: "/api/workflows",
			method: "PUT",
			body: {
				defaultWorkflow: current.defaultWorkflow,
				workflows: current.workflows.map((workflow) => ({
					...workflow,
					allowedTriggers: workflow.allowedTriggers.filter(
						(value) => value !== trigger,
					),
				})),
			},
		});
	};
	try {
		await revoke("manual");
		expect(mutation.getCurrentResult().status).toBe("success");
		expect(query.getCurrentResult().error?.message).toBe(
			"Config refresh unavailable",
		);
		staleRead!(factoryResponse(initial));
		await checkAccess();
		await checkVersion();
		authoritativeReady();
		await oldRead;
		await revoke("ticket-assignment");
		expect(writes.map(([workflow]) => workflow.allowedTriggers)).toEqual([
			["ticket-assignment"],
			[],
		]);
		expect(cache.getQueryData(["config"])).toEqual({
			...initial,
			workflows: [{ ...initial.workflows[0], allowedTriggers: [] }],
		});
		expect(cache.getQueryData(["config", "settings"])).toEqual(
			cache.getQueryData(["config"]),
		);
	} finally {
		unsubscribe();
		cache.clear();
	}
});

it.each([
	"retry",
	"answer",
	"review",
	"messages",
])("finishes an accepted %s without refreshing unrelated configuration or runs", async (command) => {
	const cache = new QueryClient();
	const refresh = vi.spyOn(cache, "invalidateQueries");
	vi.stubGlobal(
		"fetch",
		vi.fn(async (path) =>
			path === "/api/version"
				? version()
				: factoryResponse({ accepted: true, id: "selected" }),
		),
	);
	try {
		await action(cache).mutate({ path: `/api/runs/selected/${command}` });
		expect(refresh.mock.calls.map(([filter]) => filter?.queryKey)).toEqual([
			["runs"],
			["run", "selected"],
			["transcript", "selected"],
		]);
	} finally {
		cache.clear();
	}
});

it.each([
	"/api/execution-preview",
	"/api/git-settings/test",
	"/api/workflows/import/impact",
])("does not refetch data after the read-only %s action", async (path) => {
	const cache = new QueryClient();
	const refresh = vi.spyOn(cache, "invalidateQueries");
	vi.stubGlobal(
		"fetch",
		vi.fn(async (path) =>
			path === "/api/version"
				? version()
				: factoryResponse({ validation: "ok" }),
		),
	);
	try {
		await action(cache).mutate({ path });
		expect(refresh).not.toHaveBeenCalled();
	} finally {
		cache.clear();
	}
});

it("lets slow live reads finish and coalesces newer events into one catch-up read", async () => {
	const cache = new QueryClient();
	const responses: ((value: string) => void)[] = [];
	const aborted = vi.fn();
	const queryFn = vi.fn(({ signal }: { signal: AbortSignal }) => {
		signal.addEventListener("abort", aborted);
		return new Promise<string>((resolve) => responses.push(resolve));
	});
	cache.setQueryData(["run", "selected"], "initial");
	const query = new QueryObserver(cache, {
		queryKey: ["run", "selected"],
		queryFn,
		staleTime: Infinity,
	});
	const unsubscribe = query.subscribe(() => {});
	try {
		const first = refreshQueries(cache, ["run", "selected"]);
		const updates = Array.from({ length: 8 }, () =>
			refreshQueries(cache, ["run", "selected"]),
		);
		expect(queryFn).toHaveBeenCalledOnce();
		expect(aborted).not.toHaveBeenCalled();
		responses[0]!("first completed read");
		await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));
		expect(cache.getQueryData(["run", "selected"])).toBe(
			"first completed read",
		);
		responses[1]!("current state");
		await Promise.all([first, ...updates]);
		expect(queryFn).toHaveBeenCalledTimes(2);
		expect(aborted).not.toHaveBeenCalled();
		expect(cache.getQueryData(["run", "selected"])).toBe("current state");
	} finally {
		unsubscribe();
		cache.clear();
	}
});

it("catches a single live change that arrives during an earlier mounted read", async () => {
	const cache = new QueryClient();
	const responses: ((value: string) => void)[] = [];
	const queryFn = vi.fn(
		() => new Promise<string>((resolve) => responses.push(resolve)),
	);
	const query = new QueryObserver(cache, {
		queryKey: ["run", "selected"],
		queryFn,
	});
	const unsubscribe = query.subscribe(() => {});
	try {
		expect(queryFn).toHaveBeenCalledOnce();
		const refresh = refreshQueries(cache, ["run", "selected"]);
		expect(queryFn).toHaveBeenCalledOnce();
		responses[0]!("snapshot before the change");
		await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));
		responses[1]!("state after the change");
		await refresh;
		expect(cache.getQueryData(["run", "selected"])).toBe(
			"state after the change",
		);
	} finally {
		unsubscribe();
		cache.clear();
	}
});

it("keeps focused cards and architecture readers in separate run caches", () => {
	expect(runQueryKey("run", "dashboard")).toEqual(["run", "run"]);
	expect(runQueryKey("run", "focus")).toEqual(["run", "run", "focus"]);
	expect(runQueryKey("run", "architecture")).toEqual([
		"run",
		"run",
		"architecture",
	]);
});

it("renders the full final response from its lazy entry cache", () => {
	const cache = new QueryClient();
	const run = {
		id: "run",
		createdAt: "2026-10-19T09:00:00Z",
		entries: [
			{
				type: "result",
				content: "A preview only",
				activityIndex: 42,
				activityTruncated: true,
			},
		],
	};
	cache.setQueryData(["raw-entry", "run", 42], {
		type: "result",
		content: "The complete answer, including its final details.",
	});
	try {
		const html = renderToStaticMarkup(
			createElement(
				QueryClientProvider,
				{ client: cache },
				createElement(FinalMessage, { run }),
			),
		);
		expect(html).toContain("The complete answer, including its final details.");
		expect(html).not.toContain("A preview only");
	} finally {
		cache.clear();
	}
});

it("retains accepted execution profiles in both configuration views", async () => {
	const cache = new QueryClient();
	const original = {
		configRevision: "config",
		executionProfiles: { revision: 1, identities: [{ id: "old" }] },
	};
	const profiles = { revision: 2, identities: [] };
	cache.setQueryData(["config"], original);
	cache.setQueryData(["config", "settings"], original);
	vi.stubGlobal(
		"fetch",
		vi.fn(async (path) =>
			path === "/api/version" ? version() : factoryResponse(profiles),
		),
	);
	try {
		await action(cache).mutate({
			path: "/api/execution-profiles",
			method: "PUT",
		});
		expect(cache.getQueryData(["config"])).toEqual({
			...original,
			executionProfiles: profiles,
		});
		expect(cache.getQueryData(["config", "settings"])).toEqual({
			...original,
			executionProfiles: profiles,
		});
	} finally {
		cache.clear();
	}
});

it("retains a partial recipe permission edit without replacing unrelated recipes", async () => {
	const cache = new QueryClient();
	const original = {
		configRevision: "old",
		workflows: [
			{ id: "edited", allowedTriggers: ["manual", "ticket-assignment"] },
			{ id: "unchanged", allowedTriggers: ["manual"] },
		],
	};
	cache.setQueryData(["config"], original);
	cache.setQueryData(["config", "recipes"], original);
	let staleResponse!: (value: Response) => void;
	vi.stubGlobal(
		"fetch",
		vi.fn(async (path, options: RequestInit = {}) => {
			if (path === "/api/version") return version();
			if (options.method === "PATCH")
				return factoryResponse({
					configRevision: "saved",
					updatedWorkflows: [{ id: "edited", allowedTriggers: [] }],
				});
			return new Promise<Response>((resolve) => {
				staleResponse = resolve;
			});
		}),
	);
	const staleRead = cache.fetchQuery({
		queryKey: ["config", "recipes"],
		queryFn: ({ signal }) => api("/api/config?view=recipes", { signal }),
	});
	try {
		await action(cache).mutate({
			path: "/api/workflows",
			method: "PATCH",
			body: { workflows: [{ id: "edited", allowedTriggers: [] }] },
		});
		staleResponse(factoryResponse(original));
		await staleRead.catch(() => {});
		const expected = {
			configRevision: "saved",
			workflows: [{ id: "edited", allowedTriggers: [] }, original.workflows[1]],
		};
		expect(cache.getQueryData(["config"])).toEqual(expected);
		expect(cache.getQueryData(["config", "recipes"])).toEqual(expected);
	} finally {
		cache.clear();
	}
});

it("does not stamp an unrelated stale recipe graph with a current title-settings revision", async () => {
	const cache = new QueryClient();
	const current = {
		configRevision: "current",
		titleGeneration: {},
		workflows: [{ id: "simple", allowedTriggers: [] }],
	};
	const stale = {
		configRevision: "stale",
		workflows: [{ id: "simple", allowedTriggers: ["manual"] }],
	};
	cache.setQueryData(["config"], current);
	cache.setQueryData(["config", "recipes"], stale);
	vi.stubGlobal(
		"fetch",
		vi.fn(async (path) =>
			path === "/api/version"
				? version()
				: factoryResponse({
						configRevision: "saved",
						titleGeneration: { runner: "codex" },
					}),
		),
	);
	try {
		await action(cache).mutate({ path: "/api/title-settings", method: "PUT" });
		expect(cache.getQueryData(["config"])).toEqual({
			...current,
			configRevision: "saved",
			titleGeneration: { runner: "codex" },
		});
		expect(cache.getQueryData(["config", "recipes"])).toEqual(stale);
		expect(cache.getQueryState(["config", "recipes"])?.isInvalidated).toBe(
			true,
		);
	} finally {
		cache.clear();
	}
});

it("applies canonical workflow availability and preferences before refreshing", async () => {
	const cache = new QueryClient();
	const initial = {
		configRevision: "old",
		workflows: [{ id: "simple", enabled: true }],
		workflowConfiguration: { enabled: {}, preferences: {}, inactive: [] },
	};
	cache.setQueryData(["config"], initial);
	cache.setQueryData(["config", "recipes"], initial);
	vi.stubGlobal(
		"fetch",
		vi.fn(async (path) =>
			path === "/api/version"
				? version()
				: factoryResponse({
						saved: true,
						configRevision: "saved",
						workflowMetadata: [{ id: "simple", enabled: false }],
						workflowConfigurationPatch: {
							enabled: { simple: false },
							preferences: { simple: { native: { allowedTools: [] } } },
						},
					}),
		),
	);
	try {
		await action(cache).mutate({
			path: "/api/workflows/simple/availability",
			method: "PUT",
		});
		expect(cache.getQueryData(["config", "recipes"])).toEqual({
			configRevision: "saved",
			workflows: [{ id: "simple", enabled: false }],
			workflowConfiguration: {
				enabled: { simple: false },
				preferences: { simple: { native: { allowedTools: [] } } },
				inactive: [],
			},
		});
	} finally {
		cache.clear();
	}
});

it.each([
	"running",
	"waiting",
])("shows an acknowledged %s state before slow reads finish", async (status) => {
	const cache = new QueryClient();
	const run = { id: "run", status: "waiting", questions: ["Old question"] };
	cache.setQueryData(["runs"], [run]);
	cache.setQueryData(["run", "run"], run);
	cache.setQueryData(["run", "run", "focus"], run);
	vi.stubGlobal(
		"fetch",
		vi.fn(async (path) =>
			path === "/api/version"
				? version()
				: factoryResponse({
						accepted: true,
						id: "run",
						status,
						title: "Canonical title",
					}),
		),
	);
	try {
		await action(cache).mutate({ path: "/api/runs/run/answer" });
		for (const key of [
			["run", "run"],
			["run", "run", "focus"],
		])
			expect(cache.getQueryData(key)).toEqual({
				...run,
				status,
				title: "Canonical title",
				pendingContext: status === "waiting",
			});
		expect(cache.getQueryData(["runs"])).toEqual([
			{
				...run,
				status,
				title: "Canonical title",
				pendingContext: status === "waiting",
			},
		]);
	} finally {
		cache.clear();
	}
});

it.each([
	["/api/workflows/default", "recipes"],
	["/api/workflows/recipe/preferences", "recipes"],
	["/api/execution-profiles", "settings"],
	["/api/git-settings", "settings"],
	["/api/runs", undefined],
])("binds %s to the configuration its editor displayed", async (path, view) => {
	client.setQueryData(["config"], { configRevision: "dashboard" });
	client.setQueryData(["config", "settings"], { configRevision: "settings" });
	client.setQueryData(["config", "recipes"], { configRevision: "recipes" });
	let revision: string | null = null;
	vi.stubGlobal(
		"fetch",
		vi.fn(async (requestPath, options: RequestInit = {}) => {
			if (requestPath === "/api/version") return version();
			revision = new Headers(options.headers).get("X-Factory-Config");
			return factoryResponse({ saved: true });
		}),
	);
	await api(path!, { method: "PUT", body: "{}" });
	expect(revision).toBe(view ?? "dashboard");
});

it("retains saved config when a workflow write is rejected", async () => {
	const cache = new QueryClient();
	const saved = {
		defaultWorkflow: "simple",
		workflows: [{ id: "simple", allowedTriggers: [] }],
	};
	cache.setQueryData(["config"], saved);
	vi.stubGlobal(
		"fetch",
		vi.fn(async (path) =>
			path === "/api/version"
				? version()
				: factoryResponse({ error: "Invalid workflow call" }, { status: 409 }),
		),
	);
	try {
		await expect(
			action(cache).mutate({ path: "/api/workflows", method: "PUT", body: {} }),
		).rejects.toThrow("Invalid workflow call");
		expect(cache.getQueryData(["config"])).toEqual(saved);
	} finally {
		cache.clear();
	}
});

it("blocks offline and stale writes without sending a mutation", async () => {
	const fetch = vi.fn(async () =>
		factoryResponse({ build: "different", protocol: 1 }),
	);
	vi.stubGlobal("fetch", fetch);
	disconnected();
	await expect(
		api("/api/runs", { method: "POST", body: "{}" }),
	).rejects.toThrow("Sign in required");
	expect(fetch).not.toHaveBeenCalled();
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => version()),
	);
	vi.stubGlobal(
		"fetch",
		vi.fn(async () =>
			factoryResponse({ authenticated: true, expires: Date.now() + 60000 }),
		),
	);
	await checkAccess();
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => version()),
	);
	await checkVersion();
	authoritativeReady();
	vi.stubGlobal("fetch", fetch);
	await expect(
		api("/api/runs", { method: "POST", body: "{}" }),
	).rejects.toThrow("version");
	expect(fetch.mock.calls).toEqual([["/api/version", expect.any(Object)]]);
	expect(pwaState().status).toBe("mismatch");
});
it("checks response versions before consuming potentially incompatible data", async () => {
	const response = factoryResponse(
		{ sensitive: "incompatible" },
		{ headers: {} },
	);
	response.headers.set("X-Factory-Build", "different");
	const json = vi.spyOn(response, "json");
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => response),
	);
	await expect(api("/api/config")).rejects.toThrow("version changed");
	expect(json).not.toHaveBeenCalled();
	expect(pwaState().status).toBe("mismatch");
});

it("reports a proxy rejection without trapping the app in an update loop", async () => {
	const response = new Response("<html>403 Forbidden</html>", {
		status: 403,
		headers: { "Content-Type": "text/html" },
	});
	const json = vi.spyOn(response, "json");
	vi.stubGlobal(
		"fetch",
		vi.fn(async (path) => (path === "/api/version" ? version() : response)),
	);
	await expect(
		api("/api/capacity", {
			method: "PUT",
			body: '{"concurrency":4}',
		}),
	).rejects.toThrow("blocked (HTTP 403)");
	expect(json).not.toHaveBeenCalled();
	expect(pwaState().status).toBe("offline");
	await checkVersion();
	authoritativeReady();
	expect(pwaState().status).toBe("ready");
});

it("rejects unverified successful responses without treating them as a new build", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => Response.json({ capacity: { limit: 4 } })),
	);
	await expect(api("/api/config")).rejects.toThrow("could not be verified");
	expect(pwaState().status).toBe("offline");
});

it("releases a rejected SSE response before retrying or waiting for an update", async () => {
	const cancel = vi.fn();
	const response = new Response(new ReadableStream({ cancel }), {
		headers: { "Content-Type": "text/event-stream" },
	});
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => factoryResponse({ build: "different", protocol: 1 })),
	);
	await expect(validateLiveConnection(response)).rejects.toThrow("version");
	expect(cancel).toHaveBeenCalledOnce();
});

it("sends the original title-settings revision despite a refresh during the version check", async () => {
	client.setQueryData(["config"], { configRevision: "old-tab" });
	let sentRevision: string | null = null;
	vi.stubGlobal(
		"fetch",
		vi.fn(async (path: string, options: RequestInit = {}) => {
			if (path === "/api/version") {
				client.setQueryData(["config"], { configRevision: "new-tab" });
				return version();
			}
			sentRevision = new Headers(options.headers).get("X-Factory-Config");
			return factoryResponse(
				{
					error:
						"Recipe settings changed. Refresh and review your draft before sending.",
				},
				{ status: 409 },
			);
		}),
	);
	await expect(
		api("/api/title-settings", { method: "PUT", body: '{"model":"unsaved"}' }),
	).rejects.toThrow("settings changed");
	expect(sentRevision).toBe("old-tab");
});

it("retains title settings through a stale refresh and unrelated recipe saves", async () => {
	const cache = new QueryClient();
	const original = {
		configRevision: "original",
		workflows: [{ id: "simple" }],
		titleGeneration: { runner: "claude" },
	};
	cache.setQueryData(["config"], original);
	let resolveStale!: (response: Response) => void;
	vi.stubGlobal(
		"fetch",
		vi.fn(async (_path: string, options: RequestInit = {}) =>
			_path === "/api/version"
				? version()
				: options.method === "PUT"
					? factoryResponse(
							_path === "/api/title-settings"
								? {
										titleGeneration: JSON.parse(options.body as string),
										configRevision: "saved",
									}
								: JSON.parse(options.body as string),
						)
					: new Promise<Response>((resolve) => {
							resolveStale = resolve;
						}),
		),
	);
	const oldRead = cache.fetchQuery({
		queryKey: ["config"],
		queryFn: () => api("/api/config"),
	});
	const mutation = action(cache);
	await mutation.mutate({
		path: "/api/title-settings",
		method: "PUT",
		body: { runner: "codex", model: "cheap" },
	});
	resolveStale(factoryResponse(original));
	await oldRead.catch(() => {});
	await mutation.mutate({
		path: "/api/workflows",
		method: "PUT",
		body: { workflows: [{ id: "simple", name: "Updated" }] },
	});
	expect(cache.getQueryData(["config"])).toEqual({
		configRevision: "saved",
		workflows: [{ id: "simple", name: "Updated" }],
		titleGeneration: { runner: "codex", model: "cheap" },
	});
	cache.clear();
});

it("settles failures only through explicit follow-up provenance, independently of mutable titles", async () => {
	const { settleReason } = await import("../src/factory/web/client.js");
	const now = Date.now();
	const run = {
		id: "first",
		title: "Same title",
		status: "failed",
		createdAt: new Date(now - 1000).toISOString(),
	};
	const unrelated = {
		id: "second",
		title: "Same title",
		createdAt: new Date(now).toISOString(),
	};
	expect(settleReason(run, [run, unrelated], now)).toBeUndefined();
	const followup = {
		...unrelated,
		title: "A different generated title",
		triggerOrigin: { type: "manual", manual: { sourceRunId: "first" } },
	};
	expect(settleReason(run, [run, followup], now)).toBe(
		"↻ Replaced by a newer run",
	);
});

it("keeps capacity queues active without rendering human attention", async () => {
	const { active, attention } = await import("../src/factory/web/client.js");
	expect(active("capacity-waiting")).toBe(true);
	expect(active("stopping")).toBe(true);
	expect(attention({ status: "capacity-waiting" })).toBeUndefined();
});

it.each([
	"stopped",
	"cancelled",
])("keeps a brought-back %s run visible for operator recovery without restarting it", async (status) => {
	const { active, attention, settleReason } = await import(
		"../src/factory/web/client.js"
	);
	const run = {
		id: "brought-back",
		status,
		createdAt: "2026-10-01T00:00:00.000Z",
		viewState: { keptOpen: true },
	};
	expect(settleReason(run, [run])).toBeUndefined();
	expect(attention(run)).toBe("stuck");
	expect(active(run.status)).toBe(false);
	const settled = { ...run, viewState: {} };
	expect(settleReason(settled, [settled])).toBe("■ Stopped");
	expect(attention(settled)).toBeUndefined();
});

it("classifies QA before screenshot artifacts, including previews, and renders zero-image receipts and observations", () => {
	const qa = qaExecution("blocked");
	qa.observations = [
		{
			id: "help",
			summary: "Optional help wording",
			evidence: "Observed ambiguous text",
		},
	];
	expect(artifactType(qa)).toBe("qa");
	expect(
		artifactType({
			__artifactPreview: true,
			keys: ["qaContract", "results", "screenshots"],
			size: 10000,
		}),
	).toBe("qa");
	expect(artifactType({ screenshots: [] })).toBe("screenshots");
	const html = renderToStaticMarkup(
		createElement(RenderArtifact, {
			name: "capture",
			v: qa,
			run: { id: "qa" },
			onImage: () => {},
		}),
	);
	expect(html).toContain("Test account unavailable");
	expect(html).toContain("Optional help wording");
	expect(html).toContain("Record is persisted");
	expect(html).toContain("0/1 criteria passed");
	expect(
		artifactsOf({ outputs: { capture: { screenshots: [] } } })[0].title,
	).toBe("Screenshots");
	expect(artifactsOf({ outputs: { capture: qa } })[0].title).toBe(
		"QA and screenshots",
	);
});

it("refreshes review deep links and their current gate before enabling writes", async () => {
	disconnected();
	vi.stubGlobal(
		"fetch",
		vi.fn(async () =>
			factoryResponse({ authenticated: true, expires: Date.now() + 60000 }),
		),
	);
	await checkAccess();
	vi.stubGlobal("location", { hash: "#/runs/run/review" });
	const fetch = vi.fn(async (path: string) =>
		path === "/api/version"
			? version()
			: factoryResponse(
					path.startsWith("/api/runs/run?")
						? { id: "run", reviewGate: { id: "current", status: "approve" } }
						: [],
				),
	);
	vi.stubGlobal("fetch", fetch);
	await refreshFactory();
	expect(fetch.mock.calls.map(([path]) => path)).toContain(
		"/api/runs/run?view=dashboard",
	);
	expect(client.getQueryData(["run", "run"])).toEqual({
		id: "run",
		reviewGate: { id: "current", status: "approve" },
	});
	expect(pwaState().status).toBe("ready");
});

it.each([
	"review",
	"architecture",
])("reuses mounted reads while refreshing a %s deep link", async (page) => {
	vi.stubGlobal("location", { hash: `#/runs/run/${page}` });
	const view = page === "architecture" ? "architecture" : "dashboard";
	const routePath = `/api/runs/run?view=${view}`;
	const responses = new Map<string, (response: Response) => void>();
	const aborted = vi.fn();
	const fetch = vi.fn(async (path: string, options: RequestInit = {}) => {
		if (path === "/api/version") return version();
		options.signal?.addEventListener("abort", aborted);
		return new Promise<Response>((resolve) => responses.set(path, resolve));
	});
	vi.stubGlobal("fetch", fetch);
	const queries = [
		{
			queryKey: ["config"],
			path: "/api/config?view=dashboard",
			value: { workflows: [] },
		},
		{ queryKey: ["runs"], path: "/api/runs", value: [] },
		{
			queryKey: runQueryKey("run", view),
			path: routePath,
			value: { id: "run", reviewGate: { id: "current" } },
		},
	];
	const unsubscribers = queries.map(({ queryKey, path }) =>
		new QueryObserver(client, {
			queryKey,
			queryFn: ({ signal }) => api(path, { signal }),
			staleTime: Infinity,
		}).subscribe(() => {}),
	);
	try {
		const refresh = refreshFactory();
		await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
		expect(aborted).not.toHaveBeenCalled();
		for (const { path, value } of queries)
			responses.get(path)!(factoryResponse(value));
		await refresh;
		expect(fetch.mock.calls.map(([path]) => path).sort()).toEqual(
			[
				"/api/config?view=dashboard",
				"/api/runs",
				routePath,
				"/api/version",
			].sort(),
		);
		expect(client.getQueryData(runQueryKey("run", view))).toEqual(
			queries[2]!.value,
		);
		expect(aborted).not.toHaveBeenCalled();
	} finally {
		for (const unsubscribe of unsubscribers) unsubscribe();
	}
});

it("handles 401 before version errors, clears sensitive caches and prevents late response repopulation", async () => {
	client.setQueryData(["run", "private"], { transcript: "private content" });
	let complete!: (response: Response) => void;
	vi.stubGlobal(
		"fetch",
		vi.fn(async (path: string) =>
			path === "/api/version"
				? version()
				: new Promise<Response>((resolve) => {
						complete = resolve;
					}),
		),
	);
	const late = api("/api/runs");
	while (!complete) await new Promise((resolve) => setTimeout(resolve, 0));
	accessRequired("Signed out");
	complete(factoryResponse([{ transcript: "late private content" }]));
	await expect(late).rejects.toThrow("Session changed");
	expect(client.getQueryData(["run", "private"])).toBeUndefined();
	expect(accessState().status).toBe("required");
});

it("does not restore mutation data after access is lost during cache cancellation", async () => {
	client.setQueryData(["capacity"], { capacity: { limit: 4 } });
	vi.stubGlobal(
		"fetch",
		vi.fn(async (path) =>
			path === "/api/version"
				? version()
				: factoryResponse({ capacity: { limit: 5 } }),
		),
	);
	const cancel = vi
		.spyOn(client, "cancelQueries")
		.mockImplementationOnce(async () => {
			accessRequired("Signed out during the request");
		});
	try {
		await action(client).mutate({ path: "/api/capacity", method: "PUT" });
		expect(accessState().status).toBe("required");
		expect(client.getQueryData(["capacity"])).toBeUndefined();
	} finally {
		cancel.mockRestore();
	}
});

it("ignores old-cookie denials after API key sign-in while retaining private state", async () => {
	client.setQueryData(["run", "private"], { transcript: "private content" });
	let respond!: (response: Response) => void;
	vi.stubGlobal(
		"fetch",
		vi.fn(
			() =>
				new Promise<Response>((resolve) => {
					respond = resolve;
				}),
		),
	);
	const late = api("/api/runs");
	await rotateSession(async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				factoryResponse({ authenticated: true, expires: Date.now() + 120000 }),
			),
		);
		await checkAccess();
	});
	respond(factoryResponse({}, { status: 401 }));
	await expect(late).rejects.toThrow("Session changed");
	expect(accessState().status).toBe("authenticated");
	expect(client.getQueryData(["run", "private"])).toEqual({
		transcript: "private content",
	});
	// A denial sent with the current cookie must still clear private content.
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => factoryResponse({}, { status: 401 })),
	);
	await expect(api("/api/runs")).rejects.toThrow("Sign in required");
	expect(accessState().status).toBe("required");
	expect(client.getQueryData(["run", "private"])).toBeUndefined();
});

it("accepts server-validated local access without a session deadline and still clears private state on connection loss", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () =>
			factoryResponse({
				authenticated: true,
				access: "local",
				setupRequired: false,
			}),
		),
	);
	await checkAccess();
	expect(accessState()).toEqual({ status: "authenticated", access: "local" });
	client.setQueryData(["run", "private"], { transcript: "local content" });
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => factoryResponse({}, { status: 403 })),
	);
	await checkAccess();
	expect(accessState().status).toBe("required");
	expect(client.getQueryData(["run", "private"])).toBeUndefined();
});

it("keeps credential management mounted during verified-session refresh, but clears private state on denial", async () => {
	client.setQueryData(["run", "private"], { transcript: "private content" });
	let respond!: (response: Response) => void;
	vi.stubGlobal(
		"fetch",
		vi.fn(
			() =>
				new Promise<Response>((resolve) => {
					respond = resolve;
				}),
		),
	);
	const refreshed = checkAccess();
	expect(accessState().status).toBe("authenticated");
	const expires = Date.now() + 120000;
	respond(factoryResponse({ authenticated: true, expires }));
	await refreshed;
	expect(accessState()).toEqual({ status: "authenticated", expires });
	expect(client.getQueryData(["run", "private"])).toEqual({
		transcript: "private content",
	});

	const revoked = checkAccess();
	respond(factoryResponse({ authenticated: false, setupRequired: false }));
	await revoked;
	expect(accessState().status).toBe("required");
	expect(client.getQueryData(["run", "private"])).toBeUndefined();

	const signedOut = checkAccess();
	expect(accessState().status).toBe("checking");
	respond(factoryResponse({}, { status: 401 }));
	await signedOut;
	expect(accessState().status).toBe("required");
});

it("clears private state after failed access checks and restores only a verified session", async () => {
	for (const failure of [
		() => Promise.reject(new TypeError("Failed to fetch")),
		() => Promise.resolve(factoryResponse({}, { status: 502 })),
	]) {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				factoryResponse({ authenticated: true, expires: Date.now() + 60000 }),
			),
		);
		await checkAccess();
		client.setQueryData(["run", "draft"], { input: "unsent" });
		vi.stubGlobal("fetch", vi.fn(failure));
		await checkAccess();
		expect(accessState().status).toBe("required");
		expect(pwaState().status).toBe("offline");
		expect(client.getQueryData(["run", "draft"])).toBeUndefined();
	}
	vi.stubGlobal(
		"fetch",
		vi.fn(async () =>
			factoryResponse({ authenticated: true, expires: Date.now() + 60000 }),
		),
	);
	await checkAccess();
	expect(accessState().status).toBe("authenticated");
	expect(client.getQueryData(["run", "draft"])).toBeUndefined();
});

it("discards private caches and late reads when the connection is lost", async () => {
	client.setQueryData(["run", "private"], { transcript: "private content" });
	let complete!: (response: Response) => void;
	vi.stubGlobal(
		"fetch",
		vi.fn(
			async () =>
				new Promise<Response>((resolve) => {
					complete = resolve;
				}),
		),
	);
	const late = api("/api/runs");
	while (!complete) await new Promise((resolve) => setTimeout(resolve, 0));
	disconnected();
	complete(factoryResponse([{ transcript: "late private content" }]));
	await expect(late).rejects.toThrow("Session changed");
	expect(accessState().status).toBe("required");
	expect(client.getQueryData(["run", "private"])).toBeUndefined();
});

it("keeps private state when navigation cancels a protected read that later fails", async () => {
	authoritativeReady();
	client.setQueryData(["run", "private"], { transcript: "retained content" });
	let fail!: (error: Error) => void;
	vi.stubGlobal(
		"fetch",
		vi.fn(
			() =>
				new Promise<Response>((_, reject) => {
					fail = reject;
				}),
		),
	);
	const pending = api("/api/runs/private");
	const rejected = expect(pending).rejects.toThrow(
		"Navigation interrupted fetch",
	);
	cancelAccessRequests();
	fail(new TypeError("Navigation interrupted fetch"));
	await rejected;
	expect(accessState().status).toBe("authenticated");
	expect(pwaState().status).not.toBe("offline");
	expect(client.getQueryData(["run", "private"])).toEqual({
		transcript: "retained content",
	});
});

it("ignores late version and access failures from the document being left", async () => {
	authoritativeReady();
	client.setQueryData(["run", "private"], { transcript: "retained content" });
	for (const check of [checkVersion, checkAccess]) {
		let fail!: (error: Error) => void;
		let signal!: AbortSignal;
		vi.stubGlobal(
			"fetch",
			vi.fn((_, options) => {
				signal = options.signal;
				return new Promise<Response>((_, reject) => {
					fail = reject;
				});
			}),
		);
		const pending = check();
		cancelAccessRequests();
		expect(signal.aborted).toBe(true);
		fail(new TypeError("Navigation interrupted fetch"));
		await pending;
		expect(accessState().status).toBe("authenticated");
		expect(pwaState().status).not.toBe("offline");
		expect(client.getQueryData(["run", "private"])).toEqual({
			transcript: "retained content",
		});
	}
});

it("accepts no-expiry remote sessions without a deadline while current-session denial still clears access", async () => {
	const timer = vi.spyOn(globalThis, "setTimeout");
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => factoryResponse({ authenticated: true, expires: null })),
	);
	await checkAccess();
	expect(accessState()).toEqual({ status: "authenticated", expires: null });
	expect(timer).not.toHaveBeenCalled();
	timer.mockRestore();
	client.setQueryData(["run", "private"], { transcript: "persistent content" });
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => factoryResponse({}, { status: 401 })),
	);
	await checkAccess();
	expect(accessState().status).toBe("required");
	expect(client.getQueryData(["run", "private"])).toBeUndefined();
});

it("projects accepted recipe calls inside generic foreach activity rows", async () => {
	const { stepsOf } = await import("../src/factory/web/client.js");
	const run = {
		workflow: {
			steps: [
				{
					id: "research",
					name: "Research perspectives",
					type: "foreach",
					body: [
						{
							id: "worker",
							name: "Research assignment",
							type: "workflow",
							workflow: "shared-research",
							inputMapping: { topic: "/item/topic" },
						},
					],
				},
			],
		},
		workflowDefinitions: [
			{
				id: "shared-research",
				steps: [
					{
						id: "read",
						name: "Inspect scope",
						type: "agent",
						model: "accepted-model",
					},
				],
			},
		],
		foreach: {
			research: {
				completed: 1,
				total: 2,
				items: [{ id: "security" }, { id: "architecture" }],
			},
		},
	};
	const rows = stepsOf(run, {
		workflows: [
			{
				id: "shared-research",
				steps: [{ id: "changed", name: "Changed catalog" }],
			},
		],
	});
	expect(
		rows.map(({ key, name, iterationStatus, model }) => ({
			key,
			name,
			iterationStatus,
			model,
		})),
	).toEqual([
		{
			key: "research",
			name: "Research perspectives",
			iterationStatus: "1/2 completed",
			model: undefined,
		},
		{
			key: "research/security/worker",
			name: "Research assignment · security",
			iterationStatus: undefined,
			model: undefined,
		},
		{
			key: "research/security/worker/read",
			name: "Inspect scope · security",
			iterationStatus: undefined,
			model: "accepted-model",
		},
		{
			key: "research/architecture/worker",
			name: "Research assignment · architecture",
			iterationStatus: undefined,
			model: undefined,
		},
		{
			key: "research/architecture/worker/read",
			name: "Inspect scope · architecture",
			iterationStatus: undefined,
			model: "accepted-model",
		},
	]);
});
