import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { DispatchControl } from "bobs-factory-core";

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
	let declined: unknown;
	const guardedFetch: typeof fetch = async (input, init) => {
		if (!invoking || init?.method?.toUpperCase() !== "POST")
			return fetch(input, init);
		try {
			const { value } = await dispatch!.run(() => fetch(input, init));
			return await value;
		} catch (error) {
			declined = error;
			throw error;
		}
	};
	const transport =
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
	if (dispatch && transport instanceof StdioClientTransport) {
		const send = transport.send.bind(transport);
		transport.send = async (
			...args: Parameters<StdioClientTransport["send"]>
		) => {
			if (!invoking) return send(...args);
			try {
				const { value } = await dispatch.run(() => send(...args));
				return await value;
			} catch (error) {
				declined = error;
				throw error;
			}
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
