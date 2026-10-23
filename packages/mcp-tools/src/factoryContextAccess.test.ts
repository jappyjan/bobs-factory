import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, expect, it, vi } from "vitest";
import {
	createFactoryContextServer,
	createFactoryContextServerFromSnapshot,
	prepareFactoryContextAsync,
} from "./factoryContext.js";
import {
	extendTranscriptAccess,
	type FactoryContextAccess,
	runtimeTranscript,
	runtimeTranscriptField,
	transcriptAccessPath,
} from "./factoryContextAccess.js";
import { FactoryContextSnapshot } from "./factoryContextSnapshot.js";

const homes: string[] = [];
afterEach(() => {
	vi.restoreAllMocks();
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});
const home = () => {
	const value = mkdtempSync(join(tmpdir(), "task149-access-"));
	homes.push(value);
	return value;
};
const source = {
	runId: "synthetic-run",
	role: "prior/reader",
	start: 3,
	end: 4,
};
const access = (
	directory: string,
	pages = 2,
	utf8Bytes = 100,
): FactoryContextAccess => ({
	runId: source.runId,
	work: "custom-call/reviewer",
	directory,
	policy: {
		mode: "outputs-first",
		transcripts: {
			purpose: "Recover one failed tool response",
			ranges: [{ role: source.role, start: 3, end: 4 }],
			pages,
			utf8Bytes,
			extension: { pages: 1, utf8Bytes: 20 },
		},
	},
});
async function connect(server: ReturnType<typeof createFactoryContextServer>) {
	const client = new Client({ name: "synthetic-context149", version: "1" });
	const [a, b] = InMemoryTransport.createLinkedPair();
	await server.connect(a);
	await client.connect(b);
	return {
		client,
		close: async () => {
			await client.close();
			await server.close();
		},
	};
}
const argumentsFor = (path: string, extra: Record<string, unknown> = {}) => ({
	path,
	...extra,
});

it("refuses runtime transcript enumeration/direct/alias/nested/full-export paths while preserving domain JSON and structured evidence", async () => {
	const transcript = runtimeTranscript(
		{ messages: [{ content: "private synthetic predecessor text" }] },
		source,
	);
	const input = {
		accepted: {
			requirements: ["Retain every unresolved finding"],
			decisions: [{ id: "human-1", answer: "Keep compatibility" }],
		},
		findings: [
			{
				id: "old-unresolved",
				evidence: "original://evidence-1",
				status: "open",
			},
		],
		rejection: {
			reason: "The experiment contradicts the criterion",
			source: "original://rejection-1",
		},
		transcript,
		alias: transcript,
		legacy: { baseline: { context: { copied: transcript } } },
		domain: {
			messages: ["product mailbox fixture"],
			history: ["business revision"],
			approved: true,
		},
	};
	const connection = await connect(createFactoryContextServer(input));
	try {
		for (const path of [
			"/transcript",
			"/transcript/messages",
			"/transcript/messages/0/content",
			"/alias/messages/0/content",
			"/legacy/baseline/context/copied",
		]) {
			for (const name of ["read_context", "list_context"]) {
				const result = await connection.client.callTool({
					name,
					arguments: argumentsFor(path, { view: "full" }),
				});
				expect(result.isError, `${name} ${path}`).toBe(true);
				expect(JSON.stringify(result)).not.toContain(
					"private synthetic predecessor text",
				);
			}
		}
		const full = await connection.client.callTool({
			name: "read_context",
			arguments: { path: "", view: "full" },
		});
		expect(full.isError).toBe(true);
		const compact = await connection.client.callTool({
			name: "read_context",
			arguments: { path: "", limit: 16000 },
		});
		expect(compact.isError).not.toBe(true);
		expect(JSON.stringify(compact)).not.toContain(
			"private synthetic predecessor text",
		);
		for (const path of ["/accepted", "/findings", "/rejection", "/domain"]) {
			const result = await connection.client.callTool({
				name: "read_context",
				arguments: { path, view: "full" },
			});
			expect(result.isError).not.toBe(true);
			expect(result.structuredContent?.nextOffset).toBeNull();
		}
		expect(input.transcript.messages[0]!.content).toBe(
			"private synthetic predecessor text",
		);
	} finally {
		await connection.close();
	}
});

it("charges exact UTF-8 bytes across aliases, repeated pages, reopened snapshots and a recorded bounded extension", async () => {
	const directory = home(),
		grant = access(directory, 2, 16);
	const original = runtimeTranscript({ message: "é😀証é😀証" }, source); // each three-code-unit page is 6 bytes; each four is 9.
	const prepared = await prepareFactoryContextAsync(
		{ original, alias: original },
		undefined,
		undefined,
		{ cacheDirectory: directory, access: grant },
	);
	try {
		for (const [index, path] of [
			"/original/message",
			"/alias/message",
		].entries()) {
			const connection = await connect(
				createFactoryContextServerFromSnapshot(prepared.config.args.at(-1)!),
			);
			try {
				const result = await connection.client.callTool({
					name: "read_context",
					arguments: { path, limit: 3 },
				});
				expect(result.isError).not.toBe(true);
				expect(result.structuredContent?.text).toBe("é😀");
				expect(result.structuredContent?.nextOffset).toBe(3);
				const saved = JSON.parse(
					readFileSync(transcriptAccessPath(grant), "utf8"),
				);
				expect(saved.pages).toBe(index + 1);
				expect(saved.utf8Bytes).toBe((index + 1) * 6);
			} finally {
				await connection.close();
			}
		}
		const connection = await connect(
			createFactoryContextServerFromSnapshot(prepared.config.args.at(-1)!),
		);
		try {
			const reads = vi.spyOn(FactoryContextSnapshot.prototype, "read");
			const denied = await connection.client.callTool({
				name: "read_context",
				arguments: { path: "/original/message", offset: 3, limit: 4 },
			});
			expect(denied.isError).toBe(true);
			expect(reads).not.toHaveBeenCalled();
			expect(() =>
				extendTranscriptAccess(grant, {
					work: grant.work,
					reason: "Inspect the remaining failure byte range",
					expectedPages: 1,
					expectedUtf8Bytes: 12,
					expectedGrants: 0,
				}),
			).toThrow("changed");
			const extension = extendTranscriptAccess(grant, {
				work: grant.work,
				reason: "Inspect the remaining failure byte range",
				expectedPages: 2,
				expectedUtf8Bytes: 12,
				expectedGrants: 0,
			});
			expect(extension).toMatchObject({
				pages: 1,
				utf8Bytes: 20,
				reason: "Inspect the remaining failure byte range",
			});
			const page = await connection.client.callTool({
				name: "read_context",
				arguments: { path: "/alias/message", offset: 3, limit: 4 },
			});
			expect(page.isError).not.toBe(true);
			const deniedAgain = await connection.client.callTool({
				name: "read_context",
				arguments: { path: "/original/message", limit: 1 },
			});
			expect(deniedAgain.isError).toBe(true);
			const saved = JSON.parse(
				readFileSync(transcriptAccessPath(grant), "utf8"),
			);
			expect(saved).toMatchObject({ pages: 3, utf8Bytes: 21 });
			expect(saved.grants).toHaveLength(1);
		} finally {
			await connection.close();
		}
	} finally {
		prepared.cleanup();
	}
});

it("refuses byte overrun before a page read, scalar aliases and foreign roles/ranges without laundering user keys", async () => {
	const directory = home(),
		grant = access(directory, 10, 5);
	const input = {
		scalar: "é😀",
		domain: { messages: "é😀" },
		foreign: runtimeTranscript(
			{ text: "other role" },
			{ ...source, role: "unrelated" },
		),
	};
	runtimeTranscriptField(input, "scalar", source);
	const connection = await connect(
		createFactoryContextServer(input, undefined, grant),
	);
	try {
		const reads = vi.spyOn(FactoryContextSnapshot.prototype, "read");
		const denied = await connection.client.callTool({
			name: "read_context",
			arguments: { path: "/scalar", limit: 3 },
		});
		expect(denied.isError).toBe(true);
		expect(reads).not.toHaveBeenCalled();
		const foreign = await connection.client.callTool({
			name: "read_context",
			arguments: { path: "/foreign/text" },
		});
		expect(foreign.isError).toBe(true);
		const domain = await connection.client.callTool({
			name: "read_context",
			arguments: { path: "/domain/messages" },
		});
		expect(domain.isError).not.toBe(true);
		expect(domain.structuredContent?.text).toBe("é😀");
		expect(
			JSON.parse(readFileSync(transcriptAccessPath(grant), "utf8")),
		).toMatchObject({ pages: 0, utf8Bytes: 0 });
	} finally {
		await connection.close();
	}
});

it("invalidates cached immutable projections when a runtime source is classified later", async () => {
	const directory = home();
	const { immutableJson } = await import("bobs-factory-core");
	const input = immutableJson({
		nested: { messages: ["runtime-owned after restoration"] },
	});
	const first = await prepareFactoryContextAsync(input, undefined, undefined, {
		cacheDirectory: directory,
	});
	expect(
		JSON.parse(readFileSync(first.config.args.at(-1)!, "utf8")).format,
	).toBe("factory-context-snapshot-v1");
	first.cleanup();
	runtimeTranscript(input.nested, source);
	const second = await prepareFactoryContextAsync(input, undefined, undefined, {
		cacheDirectory: directory,
	});
	expect(
		JSON.parse(readFileSync(second.config.args.at(-1)!, "utf8")).format,
	).toBe("factory-context-snapshot-v2");
	const connection = await connect(
		createFactoryContextServerFromSnapshot(second.config.args.at(-1)!),
	);
	try {
		expect(
			(
				await connection.client.callTool({
					name: "read_context",
					arguments: { path: "/nested/messages/0" },
				})
			).isError,
		).toBe(true);
	} finally {
		await connection.close();
		second.cleanup();
	}
});

it("measures two controlled retrieval strategies on the identical artifact/transcript fixture and retains the same unresolved outcome", async () => {
	const directory = home();
	const prior = runtimeTranscript(
		{
			messages: Array.from({ length: 24 }, (_, index) => ({
				index,
				content: `Synthetic predecessor ${index}: ${"analysis é😀 ".repeat(160)}`,
			})),
		},
		{ ...source, start: 0, end: 24 },
	);
	const input = {
		accepted: {
			constraint: "Keep original evidence",
			source: "synthetic://human/clarification",
		},
		finding: {
			id: "missing-proof",
			status: "open",
			reason: "No independent final evidence",
			source: "synthetic://evidence/required",
		},
		rejection: {
			reason: "Reject blanket approval from a summary",
			source: "synthetic://decision/rejected",
		},
		prior,
	};
	const measurements = [];
	for (const strategy of [
		"conversation-reconstruction",
		"outputs-first",
	] as const) {
		const grant: FactoryContextAccess = {
			runId: source.runId,
			work: strategy,
			directory,
			policy:
				strategy === "outputs-first"
					? { mode: "outputs-first" }
					: {
							mode: "outputs-first",
							transcripts: {
								purpose:
									"Controlled comparison of the same synthetic conversation",
								ranges: [{ role: source.role, start: 0, end: 24 }],
								pages: 128,
								utf8Bytes: 2 * 1024 * 1024,
							},
						},
		};
		const prepared = await prepareFactoryContextAsync(
			input,
			undefined,
			undefined,
			{ cacheDirectory: directory, access: grant },
		);
		const connection = await connect(
			createFactoryContextServerFromSnapshot(prepared.config.args.at(-1)!),
		);
		try {
			if (strategy === "conversation-reconstruction") {
				let offset: number | null = 0;
				while (offset !== null) {
					const response = await connection.client.callTool({
						name: "read_context",
						arguments: { path: "/prior", view: "full", offset, limit: 4000 },
					});
					expect(response.isError).not.toBe(true);
					offset = response.structuredContent!.nextOffset as number | null;
				}
			}
			const records: Record<string, Record<string, unknown>> = {};
			for (const path of ["/accepted", "/finding", "/rejection"]) {
				const response = await connection.client.callTool({
					name: "read_context",
					arguments: { path, view: "full" },
				});
				expect(response.isError).not.toBe(true);
				expect(response.structuredContent?.nextOffset).toBeNull();
				records[path] = JSON.parse(response.structuredContent!.text as string);
			}
			const outcome =
				records["/finding"]?.status === "open" &&
				records["/accepted"]?.constraint === "Keep original evidence" &&
				records["/rejection"]?.source === "synthetic://decision/rejected"
					? "needs-evidence"
					: "missing-record";
			expect(outcome).toBe("needs-evidence");
			const measured = prepared.counters();
			const transcriptBytes =
				strategy === "outputs-first"
					? 0
					: JSON.parse(readFileSync(transcriptAccessPath(grant), "utf8"))
							.utf8Bytes;
			measurements.push({
				strategy,
				calls: measured.pages,
				utf8Bytes: measured.utf8Bytes,
				transcriptBytes,
				outcome,
				snapshotRoot: JSON.parse(
					readFileSync(prepared.config.args.at(-1)!, "utf8"),
				).root,
				finding: "missing-proof",
			});
		} finally {
			await connection.close();
			prepared.cleanup();
		}
	}
	expect(measurements[1]!.outcome).toBe(measurements[0]!.outcome);
	expect(measurements[1]!.snapshotRoot).toBe(measurements[0]!.snapshotRoot);
	expect(measurements[1]!.transcriptBytes).toBe(0);
	expect(measurements[0]!.transcriptBytes).toBeGreaterThan(50000);
	expect(measurements[1]!.utf8Bytes).toBeLessThan(measurements[0]!.utf8Bytes);
	if (process.env.F1_OUTPUTS_FIRST_COMPARISON)
		writeFileSync(
			process.env.F1_OUTPUTS_FIRST_COMPARISON,
			JSON.stringify(
				{
					scope:
						"Identical synthetic fixture; two scripted retrieval strategies, not a production before/after or model judgment",
					measurements,
				},
				null,
				2,
			),
		);
});
