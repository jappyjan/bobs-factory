import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { expect, it } from "vitest";
import {
	createFactoryContextServerFromSnapshot,
	prepareFactoryContext,
} from "./factoryContext.js";

it("counts actual UTF-8 response pages across repeated reads, aliases and MCP reconnections", async () => {
	const prepared = prepareFactoryContext({
		text: "é😀".repeat(10000),
		alias: "é😀".repeat(10000),
	});
	let bytes = 0;
	try {
		for (let connection = 0; connection < 2; connection++) {
			const path = prepared.config.args.at(-1)!;
			const server = createFactoryContextServerFromSnapshot(path);
			const client = new Client({ name: "counter-test", version: "1" });
			const [a, b] = InMemoryTransport.createLinkedPair();
			await server.connect(a);
			await client.connect(b);
			try {
				for (const name of ["list_context", "read_context", "read_context"]) {
					const output = await client.callTool({
						name,
						arguments:
							name === "list_context"
								? {}
								: {
										path: connection ? "/alias" : "/text",
										view: "full",
										limit: 10000,
									},
					});
					expect(output.isError).not.toBe(true);
					bytes += Buffer.byteLength(
						JSON.stringify(output.structuredContent),
						"utf8",
					);
				}
				const denied = await client.callTool({
					name: "read_context",
					arguments: { path: "/missing" },
				});
				expect(denied.isError).toBe(true);
			} finally {
				await client.close();
				await server.close();
			}
		}
		expect(prepared.counters()).toEqual({
			pages: 6,
			listPages: 2,
			readPages: 4,
			fullPages: 4,
			utf8Bytes: bytes,
		});
		expect(bytes).toBeGreaterThan(60000);
		if (process.env.F1_CONTEXT_METRICS)
			console.info("CONTEXT_COUNTERS", JSON.stringify(prepared.counters()));
	} finally {
		prepared.cleanup();
	}
});
