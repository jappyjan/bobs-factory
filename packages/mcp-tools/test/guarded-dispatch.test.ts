import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { UnsentDispatchError } from "bobs-factory-core";
import { expect, it } from "vitest";
import { callConfiguredTool } from "../src/callConfiguredTool.js";

it("guards actual stdio framing after initialization, preserves typed refusal and leaves provider arguments exact", async () => {
	const home = mkdtempSync(join(tmpdir(), "guarded-stdio-")),
		log = join(home, "calls.jsonl");
	const script = join(home, "server.mjs");
	writeFileSync(
		script,
		`
import {Server} from ${JSON.stringify(import.meta.resolve("@modelcontextprotocol/sdk/server/index.js"))};
import {StdioServerTransport} from ${JSON.stringify(import.meta.resolve("@modelcontextprotocol/sdk/server/stdio.js"))};
import {CallToolRequestSchema} from ${JSON.stringify(import.meta.resolve("@modelcontextprotocol/sdk/types.js"))};
import {appendFileSync} from 'node:fs';
const server = new Server({name:'synthetic',version:'1'},{capabilities:{tools:{}}});
server.setRequestHandler(CallToolRequestSchema, async request => {appendFileSync(${JSON.stringify(log)},JSON.stringify(request.params)+'\\n');return {content:[],structuredContent:{ok:true}}});
await server.connect(new StdioServerTransport());
`,
	);
	const config = { command: process.execPath, args: [script] },
		args = { body: "Immutable text", dispatch: "inert data, never authority" };
	try {
		await expect(
			callConfiguredTool(
				config,
				"comment",
				args,
				AbortSignal.timeout(5000),
				home,
				undefined,
				{
					run: async () => {
						throw new UnsentDispatchError("superseded");
					},
				},
			),
		).rejects.toBeInstanceOf(UnsentDispatchError);
		expect(existsSync(log)).toBe(false);
		await expect(
			callConfiguredTool(
				config,
				"comment",
				args,
				AbortSignal.timeout(5000),
				home,
				undefined,
				{
					run: async (write) => ({ value: write() }),
				},
			),
		).resolves.toEqual({ ok: true });
		expect(JSON.parse(readFileSync(log, "utf8"))).toEqual({
			name: "comment",
			arguments: args,
		});
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});

it("checks the actual SSE POST after endpoint/initialize preparation", async () => {
	let transport: SSEServerTransport | undefined;
	const calls: unknown[] = [];
	const protocol = new Server(
		{ name: "synthetic", version: "1" },
		{ capabilities: { tools: {} } },
	);
	protocol.setRequestHandler(CallToolRequestSchema, async (request) => {
		calls.push(request.params);
		return { content: [] };
	});
	const server = createServer(async (request, response) => {
		if (request.method === "GET") {
			transport = new SSEServerTransport("/messages", response);
			await protocol.connect(transport);
		} else if (request.method === "POST" && transport)
			await transport.handlePostMessage(request, response);
		else response.writeHead(405).end();
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("Missing local address");
	try {
		await expect(
			callConfiguredTool(
				{ type: "sse", url: `http://127.0.0.1:${address.port}/events` },
				"comment",
				{ body: "Old display" },
				AbortSignal.timeout(5000),
				process.cwd(),
				undefined,
				{
					run: async () => {
						throw new UnsentDispatchError("superseded");
					},
				},
			),
		).rejects.toBeInstanceOf(UnsentDispatchError);
		expect(calls).toEqual([]);
	} finally {
		await protocol.close();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});

it("revalidates a same-origin redirected HTTP POST instead of dispatching obsolete content to the final endpoint", async () => {
	let current = true,
		executed = 0;
	const server = createServer(async (request, response) => {
		let raw = "";
		for await (const chunk of request) raw += chunk;
		if (request.method !== "POST") {
			response.writeHead(405).end();
			return;
		}
		const message = JSON.parse(raw);
		if (message.method === "notifications/initialized") {
			response.writeHead(202).end();
			return;
		}
		if (message.method === "tools/call" && request.url === "/mcp") {
			current = false;
			response.writeHead(307, { Location: "/final" }).end();
			return;
		}
		if (message.method === "tools/call") executed++;
		response.writeHead(200, { "Content-Type": "application/json" });
		response.end(
			JSON.stringify({
				jsonrpc: "2.0",
				id: message.id,
				result: {
					protocolVersion: message.params.protocolVersion,
					capabilities: { tools: {} },
					serverInfo: { name: "synthetic", version: "1" },
				},
			}),
		);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("Missing address");
	try {
		await expect(
			callConfiguredTool(
				{ type: "http", url: `http://127.0.0.1:${address.port}/mcp` },
				"comment",
				{ body: "Old display" },
				AbortSignal.timeout(5000),
				process.cwd(),
				undefined,
				{
					run: async (write) => {
						if (!current) throw new UnsentDispatchError("superseded");
						return { value: write() };
					},
				},
			),
		).rejects.toThrow("Original MCP mutation outcome requires reconciliation");
		// The redirected endpoint is never called with obsolete content. The
		// original POST crossed handoff, so its outcome still needs reconciliation.
		expect(executed).toBe(0);
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});

it("does not reauthorize stdio ping replies after an actual accepted tool request", async () => {
	const home = mkdtempSync(join(tmpdir(), "guarded-stdio-protocol-"));
	const script = join(home, "server.mjs"),
		log = join(home, "requests.jsonl");
	writeFileSync(
		script,
		`
import {Server} from ${JSON.stringify(import.meta.resolve("@modelcontextprotocol/sdk/server/index.js"))};
import {StdioServerTransport} from ${JSON.stringify(import.meta.resolve("@modelcontextprotocol/sdk/server/stdio.js"))};
import {CallToolRequestSchema,EmptyResultSchema} from ${JSON.stringify(import.meta.resolve("@modelcontextprotocol/sdk/types.js"))};
import {appendFileSync} from 'node:fs';
const server=new Server({name:'synthetic',version:'1'},{capabilities:{tools:{}}});
server.setRequestHandler(CallToolRequestSchema,async request=>{
 appendFileSync(${JSON.stringify(log)},JSON.stringify(request.params)+'\\n');
 await server.request({method:'ping'},EmptyResultSchema);
 return {content:[],structuredContent:{ok:true}};
});
await server.connect(new StdioServerTransport());
`,
	);
	let checks = 0;
	const args = {
		body: "Original accepted comment",
		method: "tools/call",
		id: 1,
		jsonrpc: "2.0",
		_meta: { dispatch: "inert" },
	};
	try {
		await expect(
			callConfiguredTool(
				{ command: process.execPath, args: [script] },
				"comment",
				args,
				AbortSignal.timeout(5000),
				home,
				undefined,
				{
					run: async (write) => {
						if (++checks !== 1) throw new UnsentDispatchError("superseded");
						return { value: write() };
					},
				},
			),
		).resolves.toEqual({ ok: true });
		expect(checks).toBe(1);
		expect(JSON.parse(readFileSync(log, "utf8"))).toEqual({
			name: "comment",
			arguments: args,
		});
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});

it("allows legacy SSE protocol replies after mutation handoff without changing arguments or obtaining another authority grant", async () => {
	const protocol = new Server(
		{ name: "synthetic", version: "1" },
		{ capabilities: { tools: {} } },
	);
	const { EmptyResultSchema } = await import(
		"@modelcontextprotocol/sdk/types.js"
	);
	let transport: SSEServerTransport | undefined;
	const calls: unknown[] = [];
	protocol.setRequestHandler(CallToolRequestSchema, async (request) => {
		calls.push(request.params);
		await protocol.request({ method: "ping" }, EmptyResultSchema);
		return { content: [], structuredContent: { ok: true } };
	});
	const server = createServer(async (request, response) => {
		if (request.method === "GET") {
			transport = new SSEServerTransport("/messages", response);
			await protocol.connect(transport);
		} else if (request.method === "POST" && transport)
			await transport.handlePostMessage(request, response);
		else response.writeHead(405).end();
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string")
		throw Error("Missing local address");
	let checks = 0;
	const args = {
		body: "Original immutable marker",
		method: "tools/call",
		id: 0,
	};
	try {
		await expect(
			callConfiguredTool(
				{ type: "sse", url: `http://127.0.0.1:${address.port}/events` },
				"comment",
				args,
				AbortSignal.timeout(5000),
				process.cwd(),
				undefined,
				{
					run: async (write) => {
						if (++checks !== 1) throw new UnsentDispatchError("superseded");
						return { value: write() };
					},
				},
			),
		).resolves.toEqual({ ok: true });
		expect(checks).toBe(1);
		expect(calls).toEqual([{ name: "comment", arguments: args }]);
	} finally {
		await protocol.close();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});
