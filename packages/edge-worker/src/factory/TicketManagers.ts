import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { LinearClient } from "@linear/sdk";
import {
	type EdgeConfig,
	EdgeConfigSchema,
	migrateEdgeConfig,
} from "bobs-factory-core";
import { z } from "zod";
import { atomicPrivateFile, privateFile } from "./FactoryAuthStore.js";

const secret = z.string().trim().min(1).max(4096).nullable().optional();
const url = z.url().refine((value) => {
	const u = new URL(value);
	return (
		["http:", "https:"].includes(u.protocol) &&
		!u.username &&
		!u.password &&
		!u.hash
	);
}, "Use an HTTP or HTTPS URL without credentials or a fragment");
const definitions = {
	linear: {
		name: "Linear",
		description: "Assignments, agent conversations and ticket synchronization",
		fields: [
			{ id: "webhookBaseUrl", label: "Public webhook base URL", type: "url" },
			{
				id: "webhookSecret",
				label: "Webhook signing secret",
				type: "password",
			},
			{ id: "clientId", label: "OAuth client ID", type: "text" },
			{ id: "clientSecret", label: "OAuth client secret", type: "password" },
		],
	},
	taskbot: {
		name: "Taskbot",
		description:
			"Track tasks from a Taskbot ticket URL through its MCP connection",
		fields: [
			{ id: "url", label: "MCP URL", type: "url" },
			{ id: "token", label: "Access token", type: "password" },
		],
	},
} as const;
export type TicketManagerId = keyof typeof definitions;

/** Saved connection settings take precedence over legacy environment defaults. */
export function linearConnection(config: EdgeConfig, env = process.env) {
	const saved = config.ticketManagers?.linear;
	return {
		enabled:
			saved?.enabled ??
			!!(
				Object.keys(config.linearWorkspaces ?? {}).length ||
				env.LINEAR_WEBHOOK_SECRET ||
				env.BOBS_FACTORY_API_KEY
			),
		webhookBaseUrl: saved?.webhookBaseUrl ?? env.BOBS_FACTORY_BASE_URL ?? "",
		webhookSecret: saved?.webhookSecret ?? env.LINEAR_WEBHOOK_SECRET ?? "",
		clientId: saved?.clientId ?? env.LINEAR_CLIENT_ID ?? "",
		clientSecret: saved?.clientSecret ?? env.LINEAR_CLIENT_SECRET ?? "",
	};
}

/** Owns the protected settings contract; never returns a credential to the browser. */
export class TicketManagers {
	private readonly authorizations = new Map<
		string,
		{
			expires: number;
			revision: string;
			verifier: string;
			redirectUri: string;
			clientId: string;
			clientSecret: string;
		}
	>();
	constructor(
		private readonly dependencies: {
			config: () => EdgeConfig;
			configPath: () => string | undefined;
			reload: () => Promise<boolean>;
			webhookStatus: () => { lastAcceptedAt?: string };
			exchangeLinearCode?: (input: URLSearchParams) => Promise<unknown>;
			inspectLinear?: (token: string) => Promise<{ id: string; name: string }>;
		},
	) {}
	private source() {
		const path = this.dependencies.configPath();
		if (!path)
			throw new Error(
				"Ticket settings need a writable Factory configuration file",
			);
		const raw = existsSync(path)
			? privateFile(path)
			: JSON.stringify(this.dependencies.config());
		return { path, raw, config: migrateEdgeConfig(JSON.parse(raw)) };
	}
	private revision() {
		return createHash("sha256").update(this.source().raw).digest("hex");
	}
	private async update(
		expectedRevision: string,
		change: (config: Record<string, unknown>) => void,
	) {
		if (this.revision() !== expectedRevision)
			throw new Error("Settings changed. Refresh before saving again.");
		const { path, config } = this.source();
		change(config);
		EdgeConfigSchema.parse(config);
		mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
		atomicPrivateFile(path, `${JSON.stringify(config, null, 2)}\n`);
		if (!(await this.dependencies.reload()))
			throw new Error(
				"Settings were saved, but could not be applied. Inspect the service before retrying.",
			);
		return this.status();
	}
	status() {
		const config = this.dependencies.config();
		const linear = linearConnection(config);
		const taskbot = config.ticketManagers?.taskbot;
		const workspaces = Object.entries(config.linearWorkspaces ?? {}).map(
			([id, ws]) => ({ id, name: ws.linearWorkspaceName ?? id }),
		);
		return {
			revision: this.revision(),
			managers: Object.entries(definitions).map(([id, definition]) => {
				const values =
					id === "linear" ? linear : (taskbot ?? { enabled: true });
				const missing =
					id === "linear"
						? [
								...(!workspaces.length ? ["Connect a workspace"] : []),
								...(!linear.webhookSecret && !process.env.BOBS_FACTORY_API_KEY
									? ["Add a webhook signing secret"]
									: []),
								...(!linear.webhookBaseUrl
									? ["Add the public webhook base URL"]
									: []),
							]
						: !taskbot?.url
							? ["Add an MCP URL, or use an existing project MCP connection"]
							: [];
				return {
					id,
					...definition,
					enabled: values.enabled,
					status: !values.enabled
						? "disabled"
						: missing.length
							? "needs-configuration"
							: "configured",
					diagnostic: missing.join(". "),
					fields: definition.fields.map((field) => ({
						...field,
						...(field.type === "password"
							? { configured: !!(values as Record<string, unknown>)[field.id] }
							: { value: (values as Record<string, unknown>)[field.id] ?? "" }),
					})),
					...(id === "linear"
						? {
								workspaces,
								canAuthorize: !!(
									linear.clientId &&
									linear.clientSecret &&
									linear.webhookBaseUrl
								),
								webhookUrl: linear.webhookBaseUrl
									? `${linear.webhookBaseUrl.replace(/\/$/, "")}/linear-webhook`
									: undefined,
								...this.dependencies.webhookStatus(),
							}
						: {}),
				};
			}),
			repositories: config.repositories.map((repo) => ({
				id: repo.id,
				name: repo.name,
				workspaceId: repo.linearWorkspaceId ?? "",
			})),
		};
	}
	async configure(id: string, input: unknown) {
		const common = {
			expectedRevision: z.string().length(64),
			enabled: z.boolean(),
		};
		if (id === "linear") {
			const { expectedRevision, ...patch } = z
				.object({
					...common,
					webhookBaseUrl: url.nullable().optional(),
					webhookSecret: secret,
					clientId: secret,
					clientSecret: secret,
				})
				.strict()
				.parse(input);
			return this.update(expectedRevision, (config) => {
				const current = linearConnection(this.dependencies.config());
				config.ticketManagers = {
					...((config.ticketManagers as object) ?? {}),
					linear: {
						...current,
						...Object.fromEntries(
							Object.entries(patch).map(([key, value]) => [
								key,
								value === null ? "" : value,
							]),
						),
					},
				};
			});
		}
		if (id === "taskbot") {
			const { expectedRevision, ...patch } = z
				.object({ ...common, url: url.nullable().optional(), token: secret })
				.strict()
				.parse(input);
			return this.update(expectedRevision, (config) => {
				config.ticketManagers = {
					...((config.ticketManagers as object) ?? {}),
					taskbot: {
						...this.dependencies.config().ticketManagers?.taskbot,
						...Object.fromEntries(
							Object.entries(patch).map(([key, value]) => [
								key,
								value === null ? "" : value,
							]),
						),
					},
				};
			});
		}
		throw new Error("Unknown ticket manager");
	}
	/** Only a protected dashboard action can mint this single-use OAuth state. */
	authorizeLinear(input: unknown) {
		const body = z
			.object({ expectedRevision: z.string().length(64) })
			.strict()
			.parse(input);
		if (this.revision() !== body.expectedRevision)
			throw new Error("Settings changed. Refresh before connecting.");
		const connection = linearConnection(this.dependencies.config());
		if (
			!connection.clientId ||
			!connection.clientSecret ||
			!connection.webhookBaseUrl
		)
			throw new Error(
				"Save the OAuth client details and public webhook base URL first",
			);
		for (const [id, flow] of this.authorizations)
			if (flow.expires <= Date.now()) this.authorizations.delete(id);
		if (this.authorizations.size >= 32)
			throw new Error(
				"Too many pending connections. Wait for them to expire before retrying.",
			);
		const state = randomBytes(32).toString("hex"),
			verifier = randomBytes(32).toString("base64url");
		const redirectUri = `${connection.webhookBaseUrl.replace(/\/$/, "")}/callback`;
		const expires = Date.now() + 10 * 60 * 1000;
		this.authorizations.set(state, {
			expires,
			revision: body.expectedRevision,
			verifier,
			redirectUri,
			clientId: connection.clientId,
			clientSecret: connection.clientSecret,
		});
		const parameters = new URLSearchParams({
			client_id: connection.clientId,
			redirect_uri: redirectUri,
			response_type: "code",
			scope: "read,write,app:assignable,app:mentionable",
			actor: "app",
			prompt: "consent",
			state,
			code_challenge: createHash("sha256").update(verifier).digest("base64url"),
			code_challenge_method: "S256",
		});
		return { url: `https://linear.app/oauth/authorize?${parameters}`, expires };
	}
	async completeLinearAuthorization(input: unknown): Promise<void> {
		const body = z
			.object({
				state: z.string().length(64),
				code: z.string().min(1).max(4096),
			})
			.parse(input);
		const flow = this.authorizations.get(body.state);
		this.authorizations.delete(body.state);
		if (!flow || flow.expires <= Date.now())
			throw new Error(
				"Linear authorization expired. Start a new connection from Settings.",
			);
		if (this.revision() !== flow.revision)
			throw new Error(
				"Settings changed during authorization. Start a new connection.",
			);
		const parameters = new URLSearchParams({
			grant_type: "authorization_code",
			code: body.code,
			redirect_uri: flow.redirectUri,
			client_id: flow.clientId,
			client_secret: flow.clientSecret,
			code_verifier: flow.verifier,
		});
		const exchange =
			this.dependencies.exchangeLinearCode ??
			(async (body: URLSearchParams) => {
				const response = await fetch("https://api.linear.app/oauth/token", {
					method: "POST",
					headers: { "Content-Type": "application/x-www-form-urlencoded" },
					body,
					signal: AbortSignal.timeout(15000),
				});
				if (!response.ok)
					throw new Error("Linear authorization could not be completed");
				return response.json();
			});
		const tokens = z
			.object({
				access_token: z.string().min(1),
				refresh_token: z.string().min(1).optional(),
			})
			.parse(await exchange(parameters));
		await this.connectLinear({
			expectedRevision: flow.revision,
			accessToken: tokens.access_token,
			refreshToken: tokens.refresh_token,
		});
	}

	async connectLinear(input: unknown) {
		const body = z
			.object({
				expectedRevision: z.string().length(64),
				accessToken: z.string().trim().min(1).max(4096),
				refreshToken: secret,
			})
			.strict()
			.parse(input);
		if (this.revision() !== body.expectedRevision)
			throw new Error("Settings changed. Refresh before connecting.");
		let workspace: { id: string; name: string };
		try {
			workspace = this.dependencies.inspectLinear
				? await this.dependencies.inspectLinear(body.accessToken)
				: await new LinearClient({ accessToken: body.accessToken })
						.organization;
		} catch {
			throw new Error(
				"Linear could not verify this token. Check its access and try again.",
			);
		}
		return this.update(body.expectedRevision, (config) => {
			const workspaces =
				(config.linearWorkspaces as NonNullable<
					EdgeConfig["linearWorkspaces"]
				>) ?? {};
			config.linearWorkspaces = {
				...workspaces,
				[workspace.id]: {
					...workspaces[workspace.id],
					linearToken: body.accessToken,
					linearWorkspaceName: workspace.name,
					...(body.refreshToken !== undefined
						? { linearRefreshToken: body.refreshToken ?? undefined }
						: {}),
				},
			};
		});
	}
	async assignRepository(input: unknown) {
		const body = z
			.object({
				expectedRevision: z.string().length(64),
				repositoryId: z.string().min(1),
				workspaceId: z.string().min(1),
			})
			.strict()
			.parse(input);
		return this.update(body.expectedRevision, (config) => {
			const current = EdgeConfigSchema.parse(config);
			if (!current.linearWorkspaces?.[body.workspaceId])
				throw new Error("Connect this workspace first");
			const repo = current.repositories.find((r) => r.id === body.repositoryId);
			if (!repo) throw new Error("Project no longer exists");
			config.repositories = current.repositories.map((r) =>
				r.id === repo.id ? { ...r, linearWorkspaceId: body.workspaceId } : r,
			);
		});
	}
}
