import { createHash } from "node:crypto";
import {
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EdgeConfigSchema, migrateEdgeConfig } from "bobs-factory-core";
import { afterEach, expect, it, vi } from "vitest";
import {
	linearConnection,
	TicketManagers,
} from "../src/factory/TicketManagers.js";

const homes: string[] = [];
afterEach(() => {
	vi.unstubAllEnvs();
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});
function fixture() {
	const home = mkdtempSync(join(tmpdir(), "factory-ticket-settings-"));
	homes.push(home);
	const path = join(home, "config.json");
	const original = {
		repositories: [
			{
				id: "project",
				name: "Project",
				repositoryPath: home,
				workspaceBaseDir: join(home, "worktrees"),
				baseBranch: "main",
				linearWorkspaceId: "workspace",
			},
		],
		platform: "cli",
		linearWorkspaces: {
			workspace: {
				linearToken: "private-access",
				linearRefreshToken: "private-refresh",
				linearWorkspaceName: "Existing workspace",
			},
		},
	};
	writeFileSync(path, JSON.stringify(original), { mode: 0o600 });
	let config = EdgeConfigSchema.parse(migrateEdgeConfig(original));
	const inspectLinear = vi.fn(async (_token: string) => ({
		id: "new-workspace",
		name: "New workspace",
	}));
	const exchangeLinearCode = vi.fn(async (_parameters: URLSearchParams) => ({
		access_token: "oauth-access",
		refresh_token: "oauth-refresh",
	}));
	const dependencies = {
		config: () => config,
		configPath: () => path,
		reload: async () => {
			config = EdgeConfigSchema.parse(
				migrateEdgeConfig(JSON.parse(readFileSync(path, "utf8"))),
			);
			return true;
		},
		webhookStatus: () => ({}),
		inspectLinear,
		exchangeLinearCode,
	};
	const manager = new TicketManagers(dependencies);
	return {
		home,
		path,
		manager,
		dependencies,
		inspectLinear,
		exchangeLinearCode,
		config: () => config,
	};
}
it("preserves native connections from legacy CLI homes and never exposes secrets", async () => {
	vi.stubEnv("LINEAR_WEBHOOK_SECRET", "private-signing");
	vi.stubEnv("LINEAR_CLIENT_SECRET", "private-client");
	vi.stubEnv("BOBS_FACTORY_BASE_URL", "https://factory.example.test");
	const f = fixture();
	expect(linearConnection(f.config()).enabled).toBe(true);
	const status = f.manager.status();
	expect(status.managers.find((m) => m.id === "linear")?.status).toBe(
		"configured",
	);
	expect(JSON.stringify(status)).not.toMatch(
		/private-(access|refresh|signing|client)/,
	);
	const disabled = await f.manager.configure("linear", {
		expectedRevision: status.revision,
		enabled: false,
	});
	expect(f.config().linearWorkspaces).toEqual({
		workspace: {
			linearToken: "private-access",
			linearRefreshToken: "private-refresh",
			linearWorkspaceName: "Existing workspace",
		},
	});
	expect(JSON.parse(readFileSync(f.path, "utf8"))).not.toHaveProperty(
		"platform",
	);
	expect(
		new TicketManagers(f.dependencies)
			.status()
			.managers.find((m) => m.id === "linear")?.enabled,
	).toBe(false);
	expect(f.config().ticketManagers?.linear?.webhookSecret).toBe(
		"private-signing",
	);
	await f.manager.configure("linear", {
		expectedRevision: disabled.revision,
		enabled: true,
	});
	expect(linearConnection(f.config()).enabled).toBe(true);
	expect(statSync(f.path).mode & 0o777).toBe(0o600);
});
it("rejects stale changes and invalid URLs without replacing saved configuration", async () => {
	const f = fixture();
	const old = f.manager.status().revision;
	await f.manager.configure("taskbot", {
		expectedRevision: old,
		enabled: true,
		url: "https://tasks.example.test/mcp",
		token: "private-taskbot",
	});
	const bytes = readFileSync(f.path, "utf8");
	await expect(
		f.manager.configure("linear", { expectedRevision: old, enabled: false }),
	).rejects.toThrow("Settings changed");
	await expect(
		f.manager.configure("taskbot", {
			expectedRevision: f.manager.status().revision,
			enabled: true,
			url: "file:///etc/passwd",
		}),
	).rejects.toThrow("HTTP or HTTPS");
	expect(readFileSync(f.path, "utf8")).toBe(bytes);
	expect(JSON.stringify(f.manager.status())).not.toContain("private-taskbot");
});
it("binds new credentials to the verified workspace and changes routing only explicitly", async () => {
	const f = fixture();
	await f.manager.connectLinear({
		expectedRevision: f.manager.status().revision,
		accessToken: "new-private-access",
		refreshToken: "new-private-refresh",
	});
	expect(f.inspectLinear).toHaveBeenCalledWith("new-private-access");
	expect(f.config().repositories[0]?.linearWorkspaceId).toBe("workspace");
	await f.manager.assignRepository({
		expectedRevision: f.manager.status().revision,
		repositoryId: "project",
		workspaceId: "new-workspace",
	});
	expect(f.config().repositories[0]?.linearWorkspaceId).toBe("new-workspace");
	expect(f.config().linearWorkspaces?.workspace?.linearToken).toBe(
		"private-access",
	);
});
it("uses single-use OAuth state and PKCE, then privately stores the verified workspace", async () => {
	const f = fixture();
	await f.manager.configure("linear", {
		expectedRevision: f.manager.status().revision,
		enabled: true,
		webhookBaseUrl: "https://factory.example.test",
		clientId: "fixture-client",
		clientSecret: "fixture-client-secret",
		webhookSecret: "fixture-signing",
	});
	const authorization = f.manager.authorizeLinear({
		expectedRevision: f.manager.status().revision,
	});
	const parameters = new URL(authorization.url).searchParams;
	expect(parameters.get("actor")).toBe("app");
	expect(parameters.get("redirect_uri")).toBe(
		"https://factory.example.test/callback",
	);
	expect(authorization.url).not.toContain("fixture-client-secret");
	const state = parameters.get("state")!;
	await f.manager.completeLinearAuthorization({ state, code: "fixture-code" });
	const exchange = f.exchangeLinearCode.mock.calls[0]![0];
	expect(
		createHash("sha256")
			.update(exchange.get("code_verifier")!)
			.digest("base64url"),
	).toBe(parameters.get("code_challenge"));
	expect(f.config().linearWorkspaces?.["new-workspace"]).toMatchObject({
		linearToken: "oauth-access",
		linearRefreshToken: "oauth-refresh",
	});
	await expect(
		f.manager.completeLinearAuthorization({ state, code: "fixture-code" }),
	).rejects.toThrow("expired");
	expect(f.exchangeLinearCode).toHaveBeenCalledOnce();
});
it("rejects uninitiated, expired, and stale OAuth callbacks before exchanging any code", async () => {
	const f = fixture();
	vi.stubEnv("LINEAR_CLIENT_ID", "client");
	vi.stubEnv("LINEAR_CLIENT_SECRET", "secret");
	vi.stubEnv("BOBS_FACTORY_BASE_URL", "https://factory.example.test");
	await expect(
		f.manager.completeLinearAuthorization({
			state: "0".repeat(64),
			code: "untrusted",
		}),
	).rejects.toThrow("expired");
	const authorization = f.manager.authorizeLinear({
		expectedRevision: f.manager.status().revision,
	});
	await f.manager.configure("linear", {
		expectedRevision: f.manager.status().revision,
		enabled: false,
	});
	await expect(
		f.manager.completeLinearAuthorization({
			state: new URL(authorization.url).searchParams.get("state"),
			code: "stale",
		}),
	).rejects.toThrow("Settings changed");
	const pending = f.manager.authorizeLinear({
		expectedRevision: f.manager.status().revision,
	});
	vi.spyOn(Date, "now").mockReturnValue(Date.now() + 11 * 60 * 1000);
	try {
		await expect(
			f.manager.completeLinearAuthorization({
				state: new URL(pending.url).searchParams.get("state"),
				code: "expired",
			}),
		).rejects.toThrow("expired");
	} finally {
		vi.restoreAllMocks();
	}
	expect(f.exchangeLinearCode).not.toHaveBeenCalled();
});

it("constructs the native Linear adapter independently of any legacy startup platform", async () => {
	const { EdgeWorker } = await import("../src/EdgeWorker.js");
	const { LinearIssueTrackerService } = await import(
		"bobs-factory-linear-event-transport"
	);
	const f = fixture();
	const worker = new EdgeWorker({ ...f.config(), factoryHome: f.home });
	const edge = worker as unknown as {
		issueTrackers: Map<string, unknown>;
		runnerSlots: { ready(): Promise<void>; shutdown(): Promise<void> };
	};
	try {
		expect(edge.issueTrackers.get("workspace")).toBeInstanceOf(
			LinearIssueTrackerService,
		);
	} finally {
		await edge.runnerSlots.ready();
		await edge.runnerSlots.shutdown();
	}
});
