/** Controlled source-mode comparison. Run with the selected checkout's tsx. */

import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [checkoutArg, outputArg] = process.argv.slice(2);
const checkout = resolve(checkoutArg!);
const output = resolve(outputArg!);
const require = createRequire(
	join(checkout, "packages/mcp-tools/package.json"),
);
const load = (file: string) => import(pathToFileURL(join(checkout, file)).href);
const { immutableJson } = await import(
	pathToFileURL(require.resolve("bobs-factory-core")).href
);
const { Client } = await import(
	pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/index.js"))
		.href
);
const { InMemoryTransport } = await import(
	pathToFileURL(require.resolve("@modelcontextprotocol/sdk/inMemory.js")).href
);
const { prepareFactoryContextAsync, createFactoryContextServerFromSnapshot } =
	await load("packages/mcp-tools/src/factoryContext.ts");
const { FactoryContextSnapshot } = await load(
	"packages/mcp-tools/src/factoryContextSnapshot.ts",
);
const review = await load(
	"packages/edge-worker/src/factory/SpecialistReview.ts",
);
const { snapshotHistory } = await load(
	"packages/edge-worker/src/factory/WorkflowInput.ts",
);
const home = mkdtempSync(join(process.env.TMPDIR!, "context-comparison-"));
const observations: unknown[] = [];
let nodeCalls = 0;
const node = FactoryContextSnapshot.prototype.node;
FactoryContextSnapshot.prototype.node = function (...args: unknown[]) {
	nodeCalls++;
	return node.apply(this, args);
};
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const inventory = (
	path: string,
): { apparentBytes: number; allocatedBytes: number; files: number } => {
	let apparentBytes = 0,
		allocatedBytes = 0,
		files = 0;
	for (const item of readdirSync(path, { withFileTypes: true })) {
		const child = join(path, item.name);
		if (item.isDirectory()) {
			const nested = inventory(child);
			apparentBytes += nested.apparentBytes;
			allocatedBytes += nested.allocatedBytes;
			files += nested.files;
		} else {
			const stat = statSync(child);
			apparentBytes += stat.size;
			allocatedBytes += stat.blocks * 512;
			files++;
		}
	}
	return { apparentBytes, allocatedBytes, files };
};
const sourceFiles = [
	"packages/core/src/JsonSnapshotStore.ts",
	"packages/mcp-tools/src/factoryContext.ts",
	"packages/mcp-tools/src/factoryContextMemory.ts",
	"packages/mcp-tools/src/factoryContextSnapshot.ts",
	"packages/edge-worker/src/factory/SpecialistReview.ts",
	"packages/edge-worker/src/factory/WorkflowInput.ts",
];
const sourceHashes = () =>
	Object.fromEntries(
		sourceFiles.map((file) => [
			file,
			createHash("sha256")
				.update(readFileSync(join(checkout, file)))
				.digest("hex"),
		]),
	);
const beforeHashes = sourceHashes();
try {
	for (const rounds of [12, 48]) {
		const run = {
			id: "controlled-owner",
			history: [] as { step: string; at: string; output: unknown }[],
		};
		let latest = {} as { baseline?: object; [field: string]: unknown };
		const contexts: unknown[] = [];
		for (let round = 0; round < rounds; round++) {
			const claims = {
				findings:
					round === 0
						? [
								{
									id: "old-unresolved",
									status: "open",
									evidence: "original source receipt",
									requirementIds: ["R1"],
								},
							]
						: [],
				dispositions:
					round === 1
						? [
								{
									id: "old-unresolved",
									status: "rejected",
									reason:
										"The proposed correction does not cover the failing dependency",
									evidence: ["original rejection proof"],
								},
							]
						: [],
				dependency: {
					id: "shared-interface",
					revision: round === rounds - 1 ? "dependency-v2" : "dependency-v1",
				},
				summary: `review-${round}`,
				notes: `retained-${round}:${"evidence Ω".repeat(1200)}`,
			};
			run.history.push(
				immutableJson({
					step: `outer/items/${round}/called/parallel/0/perspective`,
					at: `review-${round}`,
					output: claims,
				}),
			);
			const input = {
				originalInput: "Accepted generic scope",
				history: snapshotHistory(run.history),
				outputs: { nestedGate: latest },
			};
			const retained = review.captureReviewContext
				? review.captureReviewContext(
						input,
						run,
						run.history.map(({ step, at }: { step: string; at: string }) => ({
							step,
							at,
						})),
					)
				: { context: review.frozenReviewContext(input) };
			const baseline = immutableJson({
				key: `outer/items/${round}/called/review`,
				round,
				headSha: `revision-${round}`,
				historyLength: run.history.length,
				...retained,
			});
			contexts.push(baseline);
			latest = immutableJson({
				approved: false,
				baseline,
				findings: claims.findings,
				reviewers: [{ evidence: claims.notes }],
				summary: `gate-${round}`,
			});
			run.history.push(
				immutableJson({
					step: `outer/items/${round}/called/decision`,
					at: `gate-${round}`,
					output: latest,
				}),
			);
		}
		const input = {
			history: snapshotHistory(run.history),
			outputs: { arbitraryGate: structuredClone(latest) },
			impact: { priorOutput: latest, baseline: latest.baseline },
			reviewBaseline: latest.baseline,
			progress: {
				previousOutput: latest,
				newHistory: snapshotHistory(run.history, run.history.length - 2),
				changedFiles: ["shared-interface"],
				uncertain: true,
			},
			currentInputs: {
				dependency: "dependency-v2",
				requiredFinding: "old-unresolved",
				status: "blocked",
			},
		};
		const logical = {
			historyBytes: bytes(run.history),
			inputBytes: bytes(input),
			baselineBytes: bytes(contexts),
		};
		const cacheDirectory = join(home, `cache-${rounds}`);
		const phases: unknown[] = [];
		for (const phase of ["cold", "warm"] as const) {
			nodeCalls = 0;
			const start = performance.now();
			const prepared = await prepareFactoryContextAsync(
				input,
				undefined,
				undefined,
				{ cacheDirectory },
			);
			const preparedMs = performance.now() - start,
				preparationNodeCalls = nodeCalls;
			const path = prepared.config.args.at(-1)!;
			const manifest = JSON.parse(readFileSync(path, "utf8"));
			const storeDirectory = manifest.directory ?? dirname(path);
			const manifestStat = statSync(path);
			const diskInventory = () => {
				const result = inventory(storeDirectory);
				if (storeDirectory === dirname(path)) {
					result.apparentBytes -= manifestStat.size;
					result.allocatedBytes -= manifestStat.blocks * 512;
					result.files--;
				}
				return result;
			};
			const disk = diskInventory();
			nodeCalls = 0;
			const servingStart = performance.now();
			const server = createFactoryContextServerFromSnapshot(path);
			const startupMs = performance.now() - servingStart,
				startupNodeCalls = nodeCalls;
			const [clientTransport, serverTransport] =
				InMemoryTransport.createLinkedPair();
			await server.connect(serverTransport);
			const client = new Client({
				name: "controlled-context-probe",
				version: "1",
			});
			await client.connect(clientTransport);
			let calls = 0,
				returnedCharacters = 0,
				returnedUtf8Bytes = 0;
			const call = async (name: string, args: Record<string, unknown>) => {
				calls++;
				const result = await client.callTool({ name, arguments: args });
				if (result.isError) throw new Error(JSON.stringify(result));
				const text = result.content.find(
					(part: { type: string; text?: string }) => part.type === "text",
				).text;
				returnedCharacters += text.length;
				returnedUtf8Bytes += Buffer.byteLength(text);
				return JSON.parse(text);
			};
			const read = async (path: string, view = "compact") => {
				let offset: number | null = 0;
				const pages: string[] = [];
				while (offset !== null) {
					const page = await call("read_context", {
						path,
						offset,
						limit: 12000,
						view,
					});
					pages.push(page.text);
					offset = page.nextOffset;
				}
				const body = pages.join("");
				try {
					return JSON.parse(body);
				} catch {
					return body;
				}
			};
			nodeCalls = 0;
			const pageStart = performance.now();
			const defaultView = await read("");
			const defaultRead = {
				calls,
				returnedCharacters,
				returnedUtf8Bytes,
				elapsedMs: performance.now() - pageStart,
				nodeCalls,
				logicalViewBytes: bytes(defaultView),
			};
			const current = await read("/currentInputs");
			if (
				current.dependency !== "dependency-v2" ||
				current.status !== "blocked"
			)
				throw new Error("Current declared dependency lost");
			const original = await read("/history/0/output/findings/0", "full");
			const rejection = await read("/history/2/output/dispositions/0", "full");
			if (
				original.id !== "old-unresolved" ||
				rejection.reason !==
					"The proposed correction does not cover the failing dependency"
			)
				throw new Error("Historical finding/rejection lost");
			const ledgerStart = performance.now();
			nodeCalls = 0;
			const ledger = await call("list_context", {
				path: "/contextMemory/reviewLedger",
				limit: 25,
			});
			if (ledger.total < 1) throw new Error("Historical ledger absent");
			const ledgerFirst = await read("/contextMemory/reviewLedger/0");
			if (!ledgerFirst) throw new Error("Ledger entry missing");
			const ledgerIndex = {
				elapsedMs: performance.now() - ledgerStart,
				nodeCalls,
			};
			const paginationStart = performance.now();
			nodeCalls = 0;
			const originalTail = await call("read_context", {
				path: "/history/0/output/notes",
				view: "full",
				offset: 8000,
				limit: 64,
			});
			if (originalTail.text.length !== 64)
				throw new Error("Original page missing");
			const pagination = {
				elapsedMs: performance.now() - paginationStart,
				nodeCalls,
			};
			phases.push({
				phase,
				preparedMs,
				preparationNodeCalls,
				startupMs,
				startupNodeCalls,
				disk,
				diskAfterPages: diskInventory(),
				transportManifestBytes: manifestStat.size,
				defaultRead,
				roleProtocol: { calls, returnedCharacters, returnedUtf8Bytes },
				ledgerIndex,
				pagination,
			});
			await client.close();
			await server.close();
			prepared.cleanup();
		}
		observations.push({ rounds, logical, phases });
	}
	const afterHashes = sourceHashes();
	if (JSON.stringify(beforeHashes) !== JSON.stringify(afterHashes))
		throw new Error("Source changed during comparison");
	mkdirSync(resolve(output, ".."), { recursive: true });
	writeFileSync(
		output,
		`${JSON.stringify(
			{
				checkout,
				sourceHashes: beforeHashes,
				observations,
				scope:
					"Synthetic source-mode context/baseline comparison; no agent judgment, native CLI or remote delivery",
			},
			null,
			2,
		)}\n`,
	);
} finally {
	FactoryContextSnapshot.prototype.node = node;
	rmSync(home, { recursive: true, force: true });
}
