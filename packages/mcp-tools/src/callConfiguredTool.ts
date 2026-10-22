import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { type DispatchControl, UnsentDispatchError } from "bobs-factory-core";

export type ToolServerConfig =
	| {
			type?: "stdio";
			command: string;
			args?: string[];
			env?: Record<string, string>;
	  }
	| { type: "http" | "sse"; url: string; headers?: Record<string, string> };

/** Invoke one configured MCP tool without launching an agent. */
export async function callConfiguredTool(
	config: ToolServerConfig,
	name: string,
	args: Record<string, unknown>,
	signal: AbortSignal,
	cwd: string,
	childEnvironment?: Record<string, string>,
	dispatch?: DispatchControl,
): Promise<unknown> {
	return withConfiguredClient(
		config,
		signal,
		cwd,
		childEnvironment,
		async (client) => {
			const result = await client.callTool(
				{ name, arguments: args },
				undefined,
				{
					signal,
					timeout: 10 * 60 * 1000,
				},
			);
			if (result.isError) {
				const message = Array.isArray(result.content)
					? result.content
							.filter((block) => block.type === "text")
							.map((block) =>
								typeof block.text === "string" ? block.text.trim() : "",
							)
							.filter(Boolean)
							.join("\n")
					: "";
				throw new Error(
					`MCP tool failed: ${message || "Provider returned an error without a text message."}`,
				);
			}
			return result.structuredContent ?? result;
		},
		dispatch,
	);
}

/** Read only the first catalog page; no provider tools are invoked. */
export async function listConfiguredTools(
	config: ToolServerConfig,
	signal: AbortSignal,
	cwd: string,
	childEnvironment?: Record<string, string>,
): Promise<void> {
	await withConfiguredClient(
		config,
		signal,
		cwd,
		childEnvironment,
		async (client) => {
			await client.listTools({}, { signal });
		},
	);
}

async function withConfiguredClient<T>(
	config: ToolServerConfig,
	signal: AbortSignal,
	cwd: string,
	childEnvironment: Record<string, string> | undefined,
	operation: (client: Client) => Promise<T>,
	dispatch?: DispatchControl,
): Promise<T> {
	const client = new Client({ name: "cyrus-factory", version: "1.0.0" });
	let invoking = false;
	let mutationBody: string | undefined;
	let handedOff = false;
	let declined: unknown;
	const refusal = (error: unknown) => {
		// A second attempt cannot turn a prior uncertain mutation into proof
		// that nothing was sent. Preserve uncertainty for original-ID reconciliation.
		return handedOff && error instanceof UnsentDispatchError
			? new Error("Original MCP mutation outcome requires reconciliation", {
					cause: error,
				})
			: error;
	};
	const guardedFetch: typeof fetch = async (input, init) => {
		if (init?.method?.toUpperCase() !== "POST") return fetch(input, init);
		// SDK send() supplies one JSON-RPC object. Bind the locally generated
		// request, including its ID, before headers/auth/connection preparation.
		// Ping replies and cancellation are protocol traffic, never a new mutation.
		if (init.body !== mutationBody || mutationBody === undefined) {
			if (typeof init.body !== "string")
				throw new Error("Unsupported guarded MCP request framing");
			const message = JSON.parse(init.body);
			if (Array.isArray(message) || message?.method === "tools/call")
				throw new Error("Uncorrelated guarded MCP tool request");
			return fetch(input, init);
		}
		let dispatched: { value: Promise<Response> };
		try {
			dispatched = await dispatch!.run(() => {
				handedOff = true;
				return fetch(input, init);
			});
		} catch (error) {
			declined = refusal(error);
			throw declined;
		}
		// A response/stream failure is ambiguous after handoff. It must not be
		// replaced by a later protocol-frame failure or treated as definitely unsent.
		return dispatched.value;
	};
	const transport: Transport =
		"command" in config
			? new StdioClientTransport({
					command: config.command,
					args: config.args,
					cwd,
					env: {
						...Object.fromEntries(
							Object.entries(childEnvironment ?? process.env).filter(
								(entry): entry is [string, string] => entry[1] !== undefined,
							),
						),
						...config.env,
					},
				})
			: config.type === "sse"
				? new SSEClientTransport(new URL(config.url), {
						requestInit: { headers: config.headers },
						...(dispatch ? { fetch: guardedFetch } : {}),
					})
				: new StreamableHTTPClientTransport(new URL(config.url), {
						requestInit: { headers: config.headers },
						...(dispatch ? { fetch: guardedFetch } : {}),
					});
	if (dispatch) {
		const send = transport.send.bind(transport);
		transport.send = async (...args: Parameters<typeof transport.send>) => {
			const message = args[0];
			if (Array.isArray(message))
				throw new Error("Unsupported guarded MCP batch framing");
			if (!("method" in message) || message.method !== "tools/call")
				return send(...args);
			const body = JSON.stringify(message);
			if (!invoking || (mutationBody !== undefined && mutationBody !== body))
				throw new Error("Uncorrelated guarded MCP tool request");
			mutationBody = body;
			if (!(transport instanceof StdioClientTransport)) return send(...args);
			let dispatched: { value: Promise<void> };
			try {
				dispatched = await dispatch.run(() => {
					handedOff = true;
					return send(...args);
				});
			} catch (error) {
				declined = refusal(error);
				throw declined;
			}
			return dispatched.value;
		};
	}
	let closing: Promise<void> | undefined;
	const close = () =>
		(closing ??= client.close().finally(() => transport.close()));
	const stop = () => {
		void close().catch(() => {});
	};
	signal.addEventListener("abort", stop, { once: true });
	try {
		signal.throwIfAborted();
		await client.connect(transport);
		signal.throwIfAborted();
		invoking = true;
		return await operation(client);
	} catch (error) {
		throw declined ?? error;
	} finally {
		invoking = false;
		signal.removeEventListener("abort", stop);
		await close();
	}
}
