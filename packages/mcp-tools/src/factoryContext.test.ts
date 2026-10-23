import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	realpathSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { immutableJson } from "bobs-factory-core";
import { expect, it, vi } from "vitest";
import {
	compactFactoryContext,
	createFactoryContextServer,
	createFactoryContextServerFromSnapshot,
	prepareFactoryContext,
	prepareFactoryContextAsync,
} from "./factoryContext.js";
import {
	factoryContextProjectionLimits,
	factoryContextView,
} from "./factoryContextMemory.js";
import { FactoryContextSnapshot } from "./factoryContextSnapshot.js";

async function withContext(
	input: unknown,
	check: (client: Client) => Promise<void>,
	artifacts?: {
		directory: string;
		authorizedRoot?: string;
		runId: string;
		stepKey: string;
		headSha: string;
		baseSha?: string;
	},
	snapshotPath?: string,
) {
	const server = snapshotPath
		? createFactoryContextServerFromSnapshot(snapshotPath, artifacts)
		: createFactoryContextServer(input, artifacts);
	const client = new Client({ name: "factory-test", version: "1" });
	const [a, b] = InMemoryTransport.createLinkedPair();
	await server.connect(a);
	await client.connect(b);
	try {
		await check(client);
	} finally {
		await client.close();
		await server.close();
	}
}

it("submits a large artifact as a bounded envelope bound to the current role and revision", async () => {
	const directory = mkdtempSync(join(tmpdir(), "factory-artifact-test-"));
	const value = {
		chapters: [
			{ files: Array.from({ length: 3781 }, (_, i) => `feature/path-${i}.ts`) },
		],
	};
	writeFileSync(join(directory, "guide.json"), JSON.stringify(value));
	try {
		await withContext(
			{},
			async (client) => {
				const output = await client.callTool({
					name: "submit_result_artifact",
					arguments: { path: "guide.json" },
				});
				expect(output.isError).not.toBe(true);
				expect(output.structuredContent).toMatchObject({
					factoryArtifact: {
						path: "guide.json",
						runId: "run-one",
						stepKey: "pipeline/guide",
						headSha: "revision-one",
						baseSha: "base-one",
						sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
					},
				});
				expect(JSON.stringify(output.structuredContent).length).toBeLessThan(
					400,
				);
			},
			{
				directory,
				runId: "run-one",
				stepKey: "pipeline/guide",
				headSha: "revision-one",
				baseSha: "base-one",
			},
		);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

it.each([
	"role",
	"parent",
])("rejects a result artifact when its authorized %s directory is replaced with an escaping symlink", async (replacement) => {
	const directory = realpathSync(
		mkdtempSync(join(tmpdir(), "factory-artifact-root-")),
	);
	const outside = mkdtempSync(join(tmpdir(), "factory-artifact-outside-"));
	const parent = join(directory, "role-results");
	const role = join(parent, "guide");
	mkdirSync(role, { recursive: true });
	writeFileSync(join(outside, "guide.json"), "{}");
	if (replacement === "role") {
		rmSync(role, { recursive: true });
		symlinkSync(outside, role, "dir");
	} else {
		mkdirSync(join(outside, "guide"));
		writeFileSync(join(outside, "guide", "guide.json"), "{}");
		rmSync(parent, { recursive: true });
		symlinkSync(outside, parent, "dir");
	}
	try {
		await withContext(
			{},
			async (client) => {
				const result = await client.callTool({
					name: "submit_result_artifact",
					arguments: { path: "guide.json" },
				});
				expect(result.isError).toBe(true);
			},
			{
				directory: role,
				authorizedRoot: realpathSync(directory),
				runId: "run",
				stepKey: "guide",
				headSha: "head",
			},
		);
	} finally {
		rmSync(directory, { recursive: true, force: true });
		rmSync(outside, { recursive: true, force: true });
	}
});

it("pages oversized values and all discussion entries without dropping data", async () => {
	const text = "Ticket detail: 🏭\n".repeat(70000);
	const comments = Array.from({ length: 103 }, (_, id) => ({
		id,
		body: `Comment ${id}`,
	}));
	await withContext(
		{ outputs: { ticket: { description: text, comments } } },
		async (client) => {
			const paths: string[] = [];
			let offset: number | null = 0;
			while (offset !== null) {
				const page = (
					await client.callTool({
						name: "list_context",
						arguments: {
							path: "/outputs/ticket/comments",
							offset,
						},
					})
				).structuredContent as {
					entries: { path: string }[];
					nextOffset: number | null;
				};
				paths.push(...page.entries.map((entry) => entry.path));
				offset = page.nextOffset;
			}
			expect(paths).toEqual(
				comments.map((_, id) => `/outputs/ticket/comments/${id}`),
			);
			let recovered = "";
			offset = 0;
			while (offset !== null) {
				const page = (
					await client.callTool({
						name: "read_context",
						arguments: {
							path: "/outputs/ticket/description",
							offset,
							limit: 16000,
						},
					})
				).structuredContent as { text: string; nextOffset: number | null };
				expect(page.text.length).toBeLessThanOrEqual(16000);
				recovered += page.text;
				offset = page.nextOffset;
			}
			expect(recovered).toBe(text);
			expect(
				(
					await client.callTool({
						name: "read_context",
						arguments: {
							path: paths.at(-1),
						},
					})
				).structuredContent,
			).toMatchObject({
				encoding: "json",
				text: JSON.stringify(comments.at(-1)),
				nextOffset: null,
			});
		},
	);
});

it("caps oversized read requests and reports the applied character page without losing text", async () => {
	const description = "Complete issue evidence 🏭".repeat(2200);
	await withContext({ description }, async (client) => {
		let recovered = "";
		let offset: number | null = 0;
		while (offset !== null) {
			const result = await client.callTool({
				name: "read_context",
				arguments: { path: "/description", offset, limit: 1000000 },
			});
			expect(result.isError).not.toBe(true);
			const page = result.structuredContent as {
				text: string;
				limit: number;
				nextOffset: number | null;
			};
			expect(page.limit).toBe(16000);
			expect(page.text.length).toBeLessThanOrEqual(16000);
			recovered += page.text;
			offset = page.nextOffset;
		}
		expect(recovered).toBe(description);
	});
});

it("caps oversized entry listings and keeps escaped paths completely discoverable", async () => {
	const entries = Object.fromEntries(
		Array.from({ length: 103 }, (_, i) => [`file/${i}~`, { file: i }]),
	);
	await withContext({ entries }, async (client) => {
		const paths: string[] = [];
		let offset: number | null = 0;
		while (offset !== null) {
			const result = await client.callTool({
				name: "list_context",
				arguments: { path: "/entries", offset, limit: 1000 },
			});
			expect(result.isError).not.toBe(true);
			const page = result.structuredContent as {
				limit: number;
				entries: { path: string }[];
				nextOffset: number | null;
			};
			expect(page.limit).toBe(50);
			expect(page.entries.length).toBeLessThanOrEqual(50);
			paths.push(...page.entries.map((entry) => entry.path));
			offset = page.nextOffset;
		}
		expect(paths).toHaveLength(103);
		expect(paths.at(-1)).toBe("/entries/file~1102~0");
		expect(
			(
				await client.callTool({
					name: "read_context",
					arguments: { path: paths.at(-1) },
				})
			).structuredContent,
		).toMatchObject({ text: '{"file":102}', nextOffset: null, limit: 12000 });
	});
});

it("exposes only declared inputs, supports escaped paths, and rejects invalid reads", async () => {
	await withContext({ plan: { "a/b~c": "Accepted plan" } }, async (client) => {
		expect(
			(await client.callTool({ name: "list_context", arguments: {} }))
				.structuredContent,
		).toMatchObject({
			entries: [{ path: "/plan", type: "object", entries: 1 }],
			total: 1,
			nextOffset: null,
		});
		expect(
			(
				await client.callTool({
					name: "read_context",
					arguments: { path: "/plan/a~1b~0c" },
				})
			).structuredContent,
		).toMatchObject({ text: "Accepted plan", encoding: "text" });
		for (const path of [
			"/originalInput",
			"/history",
			"/__proto__",
			"/plan/toString",
			"/plan/a~2",
		])
			expect(
				(await client.callTool({ name: "read_context", arguments: { path } }))
					.isError,
			).toBe(true);
		expect(
			(
				await client.callTool({
					name: "read_context",
					arguments: { limit: 0 },
				})
			).isError,
		).toBe(true);
	});
});

it("isolates snapshots across roles/rounds and removes private files on cleanup", () => {
	const previous = {
		history: [{ step: "code-review", output: { findings: ["old finding"] } }],
	};
	const first = prepareFactoryContext(previous);
	const second = prepareFactoryContext({ plan: "Plan only" });
	try {
		previous.history.push({
			step: "code-fix",
			output: { findings: ["fixed"] },
		});
		const firstPath = first.config.args.at(-1)!;
		const secondPath = second.config.args.at(-1)!;
		expect(firstPath).not.toBe(secondPath);
		const firstSnapshot = FactoryContextSnapshot.open(firstPath),
			secondSnapshot = FactoryContextSnapshot.open(secondPath);
		expect(firstSnapshot.keys(firstSnapshot.resolve("/history"))).toHaveLength(
			1,
		);
		expect(
			JSON.parse(secondSnapshot.read(secondSnapshot.root, 0, 16000).text),
		).toEqual({
			plan: "Plan only",
		});
		expect(statSync(firstPath).mode & 0o777).toBe(0o600);
		first.cleanup();
		expect(existsSync(firstPath)).toBe(false);
		expect(existsSync(secondPath)).toBe(true);
	} finally {
		first.cleanup();
		second.cleanup();
	}
});

it("prepares and pages a large shared review history without serializing the whole context", async () => {
	const evidence = { receipt: "Exact original evidence 🏭\n".repeat(16000) };
	const input = {
		history: Array.from({ length: 64 }, (_, index) => ({
			step: `review/${index}`,
			output: {
				baseline: { context: evidence },
				nativeSessionId: `native-${index}`,
			},
		})),
	};
	const stringify = JSON.stringify;
	const observed = vi
		.spyOn(JSON, "stringify")
		.mockImplementation((value, ...args) => {
			if (
				value &&
				typeof value === "object" &&
				(value === input || "history" in value)
			)
				throw new Error(
					"The full history must not be materialized as one JSON string",
				);
			return stringify(value, ...args);
		});
	try {
		const prepared = prepareFactoryContext(input);
		prepared.cleanup();
		await withContext(input, async (client) => {
			const full = await readValue(
				client,
				"/history/63/output/baseline/context",
				"full",
			);
			expect(full).toEqual(evidence);
			const tail = (
				await client.callTool({
					name: "read_context",
					arguments: {
						path: "/history/63/output/nativeSessionId",
						view: "full",
					},
				})
			).structuredContent;
			expect(tail).toMatchObject({ text: "native-63" });
		});
	} finally {
		observed.mockRestore();
	}
});

it("yields during cold history handoff and retains the exact declared snapshot", async () => {
	const text = "Original evidence 🏭\n".repeat(3000),
		evidence = { receipt: text };
	const history = new Array(96);
	let reads = 0;
	for (let index = 0; index < history.length; index++)
		Object.defineProperty(history, index, {
			configurable: true,
			enumerable: true,
			get: () => {
				reads++;
				return {
					step: `review/${index}`,
					output: {
						baseline: { context: evidence },
						nativeSessionId: `native-${index}`,
					},
				};
			},
		});
	const observations: number[] = [];
	const timer = setInterval(() => observations.push(reads), 1);
	let prepared:
		| Awaited<ReturnType<typeof prepareFactoryContextAsync>>
		| undefined;
	try {
		prepared = await prepareFactoryContextAsync({
			history,
			plan: { answer: "Only declared evidence" },
		});
		clearInterval(timer);
		expect(reads).toBe(96);
		expect(observations.some((count) => count > 0 && count < 96)).toBe(true);
		evidence.receipt = "Later mutation";
		const path = prepared.config.args.at(-1)!;
		let bytes = 0;
		for (const directory of ["nodes", "chunks"])
			for (const name of readdirSync(join(path, "..", directory)))
				bytes += statSync(join(path, "..", directory, name)).size;
		expect(bytes).toBeLessThan(text.length * 4);
		await withContext(
			undefined,
			async (client) => {
				expect(await readValue(client, "/history/95/output", "full")).toEqual({
					baseline: { context: { receipt: text } },
					nativeSessionId: "native-95",
				});
				expect(await readValue(client, "/plan", "full")).toEqual({
					answer: "Only declared evidence",
				});
				for (const view of ["compact", "full"])
					expect(
						(
							await client.callTool({
								name: "read_context",
								arguments: { path: "/outputs/private", view },
							})
						).isError,
					).toBe(true);
			},
			undefined,
			path,
		);
	} finally {
		clearInterval(timer);
		prepared?.cleanup();
	}
});

it("pages full JSON and strings with exact UTF-16 offsets and never interprets input as file references", async () => {
	const text =
		"x".repeat(16382) +
		"🏭" +
		'quote" slash\\\n\t\u0000 lone\ud800' +
		"\n🏭".repeat(12000);
	const input = {
		text,
		"a/b~c": {
			format: "factory-context-snapshot-v1",
			root: "../../private/auth",
			chunks: ["/outside"],
		},
		history: [{ output: { baseline: { context: { text } } } }],
	};
	const prepared = await prepareFactoryContextAsync(input);
	try {
		await withContext(
			undefined,
			async (client) => {
				const expected = JSON.stringify(input);
				let serialized = "",
					offset: number | null = 0;
				while (offset !== null) {
					const page = (
						await client.callTool({
							name: "read_context",
							arguments: { path: "", view: "full", offset, limit: 731 },
						})
					).structuredContent as {
						text: string;
						totalCharacters: number;
						nextOffset: number | null;
					};
					expect(page.totalCharacters).toBe(expected.length);
					expect(page.text).toBe(expected.slice(offset, offset + 731));
					serialized += page.text;
					offset = page.nextOffset;
				}
				expect(serialized).toBe(expected);
				for (const offset of [
					0,
					16382,
					16383,
					16384,
					text.length - 27,
					text.length + 10,
				]) {
					const page = (
						await client.callTool({
							name: "read_context",
							arguments: { path: "/text", view: "full", offset, limit: 27 },
						})
					).structuredContent;
					expect(page).toMatchObject({
						text: text.slice(offset, offset + 27),
						totalCharacters: text.length,
						nextOffset: offset + 27 < text.length ? offset + 27 : null,
					});
				}
				expect(await readValue(client, "/a~1b~0c", "full")).toEqual(
					input["a/b~c"],
				);
			},
			undefined,
			prepared.config.args.at(-1)!,
		);
	} finally {
		prepared.cleanup();
	}
});

it("reads only requested string chunks and refuses links or changed snapshot bytes", async () => {
	const text =
		"a".repeat(16384) + "b".repeat(16384) + "Tail evidence 🏭".repeat(500);
	const prepared = await prepareFactoryContextAsync({ text });
	try {
		const path = prepared.config.args.at(-1)!,
			snapshot = FactoryContextSnapshot.open(path),
			reference = snapshot.resolve("/text");
		const first = join(
			path,
			"..",
			"chunks",
			`${snapshot.node(reference).chunks![0]!.hash}.json`,
		);
		rmSync(first);
		expect(snapshot.read(reference, text.length - 19, 19).text).toBe(
			text.slice(-19),
		);
		expect(() => snapshot.read(reference, 0, 19)).toThrow();
		const foreign = join(path, "..", "foreign.json");
		writeFileSync(foreign, '"Not role evidence"', { mode: 0o600 });
		symlinkSync(foreign, first);
		expect(() => snapshot.read(reference, 0, 19)).toThrow();
		rmSync(first);
		writeFileSync(first, '"Changed role evidence"', { mode: 0o600 });
		expect(() => snapshot.read(reference, 0, 19)).toThrow("integrity");
	} finally {
		prepared.cleanup();
	}
});

it("retains JSON conversion semantics and rejects circular data or foreign snapshot handles", async () => {
	const self = {
		answer: 42,
		toJSON() {
			return this;
		},
	};
	const keyed = {
		toJSON(key: string) {
			return `Value for ${key}`;
		},
	};
	const replacement = {
		answer: "Replacement object",
		toJSON() {
			return "Do not invoke twice";
		},
	};
	const empty = new Array<unknown>(4);
	empty[0] = undefined;
	empty[2] = null;
	empty[3] = () => "omitted";
	const input = {
		self,
		a: keyed,
		b: keyed,
		converted: {
			toJSON() {
				return replacement;
			},
		},
		date: new Date("2026-10-19T00:00:00Z"),
		empty,
	};
	const prepared = await prepareFactoryContextAsync(input);
	try {
		const snapshot = FactoryContextSnapshot.open(prepared.config.args.at(-1)!);
		expect(snapshot.read(snapshot.root, 0, 16000).text).toBe(
			JSON.stringify(input),
		);
		const other = new FactoryContextSnapshot(
			join(tmpdir(), "unused-context-path"),
		);
		expect(() => other.append(snapshot.root)).toThrow(
			"Foreign context snapshot reference",
		);
	} finally {
		prepared.cleanup();
	}
	const circular: { child?: unknown } = {};
	circular.child = circular;
	await expect(prepareFactoryContextAsync(circular)).rejects.toThrow(
		"circular",
	);
});

it("projects machine provenance in outputs, history and correction without dropping requirements", () => {
	const hashes = Object.fromEntries(
		Array.from({ length: 16000 }, (_, i) => [`build/${i}`, "a".repeat(64)]),
	);
	const shot = {
		area: "Reader",
		state: "Paid",
		path: "reader.png",
		imageSha256: "image",
		dependencyHashes: hashes,
	};
	const input = {
		outputs: { capture: { screenshots: [shot] } },
		history: [{ output: { screenshots: [shot] } }],
		outputCorrection: { output: { screenshots: [shot] } },
		requirements: ["Keep every requirement"],
		current: { dependencyManifests: { digest: hashes } },
	};
	const projected = compactFactoryContext(input);
	expect(JSON.stringify(projected).length).toBeLessThan(2000);
	expect(projected).toMatchObject({
		outputs: {
			capture: {
				screenshots: [
					{
						area: "Reader",
						state: "Paid",
						path: "reader.png",
						imageSha256: "image",
						sourceFingerprint: { entries: 16000, version: 1 },
					},
				],
			},
		},
		requirements: input.requirements,
		current: { manifestInventory: { count: 1, runtimeOnly: true } },
	});
	expect(input.outputs.capture.screenshots[0]!.dependencyHashes).toBe(hashes);
});

async function readValue(client: Client, path: string, view = "compact") {
	let text = "";
	let offset: number | null = 0;
	while (offset !== null) {
		const page = (
			await client.callTool({
				name: "read_context",
				arguments: { path, view, offset, limit: 16000 },
			})
		).structuredContent as { text: string; nextOffset: number | null };
		text += page.text;
		offset = page.nextOffset;
	}
	return JSON.parse(text);
}

// Full-history reads paginate several megabytes over MCP, including under suite load.
it("compacts repeated history while preserving current inputs and all original evidence", async () => {
	const finding = {
		id: "access",
		rating: 3,
		status: "open",
		summary: "Access still fails",
		evidence: "Readback rejected",
	};
	const history = Array.from({ length: 92 }, (_, i) => ({
		step: i % 2 ? "pipeline/capture" : "pipeline/visual-review",
		at: `round-${i}`,
		output:
			i % 2
				? { receipt: "Raw QA evidence 🏭".repeat(3000) }
				: { findings: [finding], summary: "Reviewed" },
	}));
	const input = {
		outputs: {
			decisions: { requirements: ["Exact requirement"], answer: "Keep it" },
		},
		answers: [{ answer: "No waiver", questions: ["Access?"], at: "today" }],
		history,
		progress: { visit: 6, newHistory: history.slice(-10), diff: "Exact diff" },
	};
	const before = JSON.stringify(input);
	await withContext(input, async (client) => {
		const compact = await readValue(client, "");
		expect(JSON.stringify(compact).length).toBeLessThan(before.length / 20);
		expect(compact.outputs).toEqual(input.outputs);
		expect(compact.answers).toEqual(input.answers);
		expect(compact.progress.diff).toBe("Exact diff");
		expect(compact.history).toMatchObject({
			format: "factory-context-ref-v2",
			fullPath: "/history",
			entries: 92,
		});
		expect(compact.contextMemory.format).toBe("factory-context-memory-v2");
		expect(compact.contextMemory.reviewLedger).toMatchObject({
			deferred: true,
		});
		const ledger = await readValue(client, "/contextMemory/reviewLedger");
		expect(ledger).toHaveLength(1);
		expect(ledger[0].findings).toEqual([
			{
				value: finding,
				firstPath: "/history/0/output/findings/0",
				latestPath: "/history/90/output/findings/0",
				firstRound: 0,
				latestRound: 90,
				occurrences: 46,
			},
		]);
		expect(await readValue(client, "/history", "full")).toEqual(history);
		expect(await readValue(client, "/history/91/output", "full")).toEqual(
			history[91]!.output,
		);
		expect(
			await readValue(client, "/progress/newHistory/9/output", "full"),
		).toEqual(history[91]!.output);
		expect(await readValue(client, "/progress/newHistory", "full")).toEqual(
			history.slice(-10),
		);
	});
	expect(JSON.stringify(input)).toBe(before);
}, 15000);

it("retains rejected fixes, distinct evidence and identical reopened claims without inferring resolution", async () => {
	const finding = {
		id: "bug",
		rating: 2,
		status: "open",
		evidence: "First probe",
	};
	const rejection = {
		id: "bug",
		status: "rejected",
		reason: "Original boundary is intentional",
	};
	const fixed = { id: "bug", status: "fixed", reason: "Applied correction" };
	const revised = { ...finding, evidence: "New failure after correction" };
	const observation = {
		id: "note",
		summary: "Nonblocking wording",
		evidence: "Recorded text",
	};
	const input = {
		history: [
			{
				step: "pipeline/code-review",
				output: { findings: [finding], observations: [observation] },
			},
			{ step: "pipeline/code-fix", output: { dispositions: [rejection] } },
			{
				step: "pipeline/code-review",
				output: {
					findings: [finding],
					summary: "Rejection denied: boundary still fails",
				},
			},
			{ step: "pipeline/code-fix", output: { dispositions: [fixed] } },
			{ step: "pipeline/code-review", output: { findings: [revised] } },
			{
				step: "pipeline/review-gate",
				output: {
					approved: true,
					findings: [],
					summary: "Correction accepted after fresh review",
				},
			},
			{
				step: "other/code-review",
				output: {
					findings: [{ ...finding, evidence: "Independent workflow" }],
				},
			},
		],
	};
	await withContext(input, async (client) => {
		const ledger = await readValue(client, "/contextMemory/reviewLedger");
		const bug = ledger.find(
			(item: { scope: string; id: string }) =>
				item.scope === "pipeline" && item.id === "bug",
		);
		expect(
			bug.findings.map((claim: { value: unknown }) => claim.value),
		).toEqual([finding, revised]);
		expect(bug.findings[0]).toMatchObject({
			firstRound: 0,
			latestRound: 2,
			occurrences: 2,
		});
		expect(
			bug.dispositions.map((claim: { value: unknown }) => claim.value),
		).toEqual([rejection, fixed]);
		expect(bug.findings[1].latestRound).toBeGreaterThan(
			bug.dispositions[1].latestRound,
		);
		expect(bug).not.toHaveProperty("resolved");
		expect(
			ledger.find((item: { id: string }) => item.id === "note").observations[0]
				.value,
		).toEqual(observation);
		expect(
			ledger.filter((item: { id: string }) => item.id === "bug"),
		).toHaveLength(2);
		for (const claim of [...bug.findings, ...bug.dispositions])
			expect(await readValue(client, claim.latestPath)).toEqual(claim.value);
		expect(await readValue(client, "/history/5/output")).toEqual({
			approved: true,
			findings: [],
			summary: "Correction accepted after fresh review",
		});
		const rounds = await readValue(client, "/contextMemory/reviewRounds");
		expect(rounds[2].summary).toBe("Rejection denied: boundary still fails");
		expect(rounds[5]).toMatchObject({
			approved: true,
			summary: "Correction accepted after fresh review",
			outputPath: "/history/5/output",
		});
	});
});

it("lists role identities in pages without one read per historical step", async () => {
	const history = Array.from({ length: 103 }, (_, i) => ({
		step: `pipeline/role-${i}`,
		at: `round-${i}`,
		output: { receipt: i },
	}));
	await withContext({ history }, async (client) => {
		const entries: {
			path: string;
			preview: { step: string; outputPath: string };
		}[] = [];
		let offset: number | null = 0;
		let calls = 0;
		while (offset !== null) {
			const page = (
				await client.callTool({
					name: "list_context",
					arguments: { path: "/history", limit: 50, offset },
				})
			).structuredContent as {
				entries: typeof entries;
				nextOffset: number | null;
			};
			entries.push(...page.entries);
			offset = page.nextOffset;
			calls++;
		}
		expect(calls).toBe(3);
		expect(entries.map((item) => item.preview.step)).toEqual(
			history.map((item) => item.step),
		);
		expect(await readValue(client, entries[102]!.preview.outputPath)).toEqual({
			receipt: 102,
		});
	});
});

it("keeps compact and full views scoped, immutable and compatible with unlabelled legacy claims", async () => {
	const input = {
		history: [
			{ step: "code-review", output: { findings: ["Legacy complaint"] } },
		],
	};
	await withContext(input, async (client) => {
		input.history.push({
			step: "code-review",
			output: { findings: ["Later mutation"] },
		});
		const compact = await readValue(client, "");
		expect(compact.history).toHaveLength(1);
		const ledger = await readValue(client, "/contextMemory/reviewLedger");
		expect(ledger[0].findings[0].value).toBe("Legacy complaint");
		expect(await readValue(client, "/history", "full")).toHaveLength(1);
		for (const view of ["compact", "full"])
			for (const path of [
				"/outputs/ticket",
				"/__proto__",
				"/history/0/toString",
				"/history/~2",
			])
				expect(
					(
						await client.callTool({
							name: "read_context",
							arguments: { path, view },
						})
					).isError,
				).toBe(true);
	});
	const scoped = {
		plan: { requirements: ["Declared only"] },
		progress: { newHistory: [] },
	};
	expect(factoryContextView(scoped)).toEqual(scoped);
	const collision = {
		history: [],
		contextMemory: { answer: "Declared input" },
	};
	expect(factoryContextView(collision)).toEqual(collision);
});

it("keeps the complete v1 native review view unchanged", () => {
	const finding = { id: "bug", status: "open", evidence: "Original" };
	const rejected = { id: "bug", status: "rejected", reason: "Intentional" };
	const history = [
		{
			step: "flow/review",
			at: "first",
			output: { findings: [finding], summary: "Open" },
		},
		{ step: "flow/fix", at: "second", output: { dispositions: [rejected] } },
		{
			step: "flow/review",
			at: "third",
			output: { findings: [finding], summary: "Reopened" },
		},
	];
	const index = history.map((item, round) => ({
		fullPath: `/history/${round}`,
		step: item.step,
		at: item.at,
		outputPath: `/history/${round}/output`,
		outputCharacters: JSON.stringify(item.output).length,
	}));
	expect(
		factoryContextView({
			history,
			progress: { visit: 2, newHistory: [history[2]] },
			current: finding,
		}),
	).toEqual({
		history: index,
		progress: {
			visit: 2,
			newHistory: [
				{
					...index[2],
					fullPath: "/progress/newHistory/0",
					outputPath: "/progress/newHistory/0/output",
				},
			],
		},
		current: finding,
		contextMemory: {
			format: "factory-context-memory-v1",
			historyCount: 3,
			latestSteps: [index[2], index[1]],
			reviewLedger: [
				{
					scope: "flow",
					id: "bug",
					findings: [
						{
							value: finding,
							firstPath: "/history/0/output/findings/0",
							latestPath: "/history/2/output/findings/0",
							firstRound: 0,
							latestRound: 2,
							occurrences: 2,
						},
					],
					dispositions: [
						{
							value: rejected,
							firstPath: "/history/1/output/dispositions/0",
							latestPath: "/history/1/output/dispositions/0",
							firstRound: 1,
							latestRound: 1,
							occurrences: 1,
						},
					],
					observations: [],
				},
			],
			reviewRounds: history.map((item, round) => ({
				round,
				step: item.step,
				at: item.at,
				outputPath: `/history/${round}/output`,
				...("summary" in item.output ? { summary: item.output.summary } : {}),
			})),
		},
	});
});

it("bounds nested outputs, baselines and progress with distinct immutable original paths", async () => {
	const body = "Exact baseline evidence 🏭\n".repeat(500);
	const shared = {
		rows: Array.from({ length: 103 }, (_, id) => ({ id, body })),
		files: Object.fromEntries(
			Array.from({ length: 103 }, (_, id) => [`a/${id}~`, body]),
		),
	};
	const input = {
		outputs: {
			current: { answer: "usable", baseline: { context: shared } },
			sibling: shared,
		},
		progress: { visit: 4, baseline: { context: shared }, newHistory: [] },
	};
	await withContext(input, async (client) => {
		const current = await readValue(client, "/outputs/current");
		expect(current.answer).toBe("usable");
		expect(current.baseline.context.rows).toMatchObject({
			format: "factory-context-ref-v2",
			fullPath: "/outputs/current/baseline/context/rows",
			view: "full",
			entries: 103,
		});
		const sibling = await readValue(client, "/outputs/sibling");
		expect(sibling.rows.fullPath).toBe("/outputs/sibling/rows");
		expect(sibling.rows.snapshotRoot).toBe(
			current.baseline.context.rows.snapshotRoot,
		);
		const progress = await readValue(client, "/progress");
		expect(progress.baseline.context.files.fullPath).toBe(
			"/progress/baseline/context/files",
		);
		const compact = await readValue(client, "");
		expect(JSON.stringify(compact).length).toBeLessThanOrEqual(
			factoryContextProjectionLimits.subtreeCharacters,
		);
		expect(JSON.stringify(compact)).not.toContain(body);
		const paths: string[] = [];
		let offset: number | null = 0;
		while (offset !== null) {
			const page = (
				await client.callTool({
					name: "list_context",
					arguments: {
						path: "/outputs/sibling/files",
						offset,
						limit: 50,
						snapshotRoot: sibling.rows.snapshotRoot,
					},
				})
			).structuredContent as {
				entries: { path: string; fullPath: string }[];
				nextOffset: number | null;
			};
			for (const entry of page.entries) expect(entry.fullPath).toBe(entry.path);
			paths.push(...page.entries.map((entry) => entry.path));
			offset = page.nextOffset;
		}
		expect(paths).toEqual(
			Object.keys(shared.files).map(
				(key) =>
					`/outputs/sibling/files/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`,
			),
		);
		expect(
			await readValue(client, "/outputs/current/baseline/context", "full"),
		).toEqual(shared);
		const record = await readValue(client, "/outputs/sibling/rows/102");
		expect(record).toEqual({
			id: 102,
			body: expect.objectContaining({
				fullPath: "/outputs/sibling/rows/102/body",
				type: "string",
			}),
		});
		expect(
			await readValue(client, "/outputs/sibling/rows/102", "full"),
		).toEqual(shared.rows[102]);
		expect(
			(
				await client.callTool({
					name: "read_context",
					arguments: { path: "/outputs/current", snapshotRoot: "0".repeat(64) },
				})
			).isError,
		).toBe(true);
	});
});

it("does no hidden history traversal at startup or on small reads and indexes only on explicit navigation", async () => {
	const history = Array.from({ length: 240 }, (_, round) => ({
		step: "flow/review",
		output: {
			findings: [{ id: `bug-${round}`, evidence: "verbatim" }],
			summary: `round-${round}`,
		},
	}));
	const prepared = await prepareFactoryContextAsync({
		history,
		plan: { answer: "read me" },
	});
	const nodes = vi.spyOn(FactoryContextSnapshot.prototype, "node");
	try {
		await withContext(
			undefined,
			async (client) => {
				expect(nodes.mock.calls.length).toBeLessThan(10);
				nodes.mockClear();
				expect(await readValue(client, "/plan")).toEqual({ answer: "read me" });
				expect(nodes.mock.calls.length).toBeLessThan(60);
				nodes.mockClear();
				const compact = await readValue(client, "");
				expect(compact.history.entries).toBe(240);
				expect(nodes.mock.calls.length).toBeLessThan(400);
				nodes.mockClear();
				const first = (
					await client.callTool({
						name: "list_context",
						arguments: { path: "/contextMemory/reviewLedger", limit: 1 },
					})
				).structuredContent as { total: number };
				expect(first.total).toBe(240);
				expect(nodes.mock.calls.length).toBeGreaterThan(1000);
				nodes.mockClear();
				const next = (
					await client.callTool({
						name: "list_context",
						arguments: {
							path: "/contextMemory/reviewLedger",
							offset: 239,
							limit: 1,
						},
					})
				).structuredContent as { entries: { preview: { id: string } }[] };
				expect(next.entries[0]!.preview.id).toBe("bug-239");
				expect(nodes.mock.calls.length).toBeLessThan(100);
				nodes.mockClear();
			},
			undefined,
			prepared.config.args.at(-1)!,
		);
		nodes.mockClear();
		await withContext(
			undefined,
			async (client) => {
				await client.callTool({
					name: "list_context",
					arguments: {
						path: "/contextMemory/reviewLedger",
						offset: 239,
						limit: 1,
					},
				});
				expect(nodes.mock.calls.length).toBeLessThan(100);
			},
			undefined,
			prepared.config.args.at(-1)!,
		);
	} finally {
		nodes.mockRestore();
		prepared.cleanup();
	}
});

it("reuses only core-published immutable receipts across private cached handoffs", async () => {
	const cacheDirectory = mkdtempSync(
		join(tmpdir(), "factory-context-cache-test-"),
	);
	const receipt = immutableJson({
		rows: Array.from({ length: 500 }, (_, id) => ({
			id,
			body: `original-${id}`,
		})),
	});
	const mutable = { answer: "before" };
	const shallow = Object.freeze({ child: mutable });
	const first = await prepareFactoryContextAsync(
		{ outputs: { receipt, shallow } },
		undefined,
		undefined,
		{ cacheDirectory },
	);
	const serialized = vi.spyOn(JSON, "stringify");
	let second:
		| Awaited<ReturnType<typeof prepareFactoryContextAsync>>
		| undefined;
	try {
		mutable.answer = "after";
		second = await prepareFactoryContextAsync(
			{ outputs: { receipt, shallow } },
			undefined,
			undefined,
			{ cacheDirectory },
		);
		// A warm handoff captures the few mutable wrappers, not the 500-row payload.
		expect(serialized.mock.calls.length).toBeLessThan(40);
		serialized.mockRestore();
		await withContext(
			undefined,
			async (client) => {
				expect(await readValue(client, "/outputs/shallow", "full")).toEqual({
					child: { answer: "before" },
				});
				expect(await readValue(client, "/outputs/receipt", "full")).toEqual(
					receipt,
				);
			},
			undefined,
			first.config.args.at(-1)!,
		);
		first.cleanup();
		expect(existsSync(join(cacheDirectory, "nodes"))).toBe(true);
		await withContext(
			undefined,
			async (client) => {
				expect(await readValue(client, "/outputs/shallow", "full")).toEqual({
					child: { answer: "after" },
				});
				expect(
					await readValue(client, "/outputs/receipt/rows/499", "full"),
				).toEqual(receipt.rows[499]);
			},
			undefined,
			second.config.args.at(-1)!,
		);
	} finally {
		serialized.mockRestore();
		first.cleanup();
		second?.cleanup();
		rmSync(cacheDirectory, { recursive: true, force: true });
	}
});

it("keeps large distinct ledger values and rejection reasons at their original full-view pointers", async () => {
	const first = { id: "bug", evidence: "First evidence ".repeat(300) };
	const second = { id: "bug", evidence: "Changed evidence ".repeat(300) };
	const rejection = {
		id: "bug",
		status: "rejected",
		reason: "Preserve this entire rejection ".repeat(300),
	};
	await withContext(
		{
			history: [
				{ step: "flow/review", output: { findings: [first] } },
				{ step: "flow/fix", output: { dispositions: [rejection] } },
				{
					step: "flow/review",
					output: {
						findings: [second],
						summary: "Rejected fix is still wrong",
					},
				},
				{ step: "flow/review", output: { findings: [first] } },
			],
		},
		async (client) => {
			const ledger = await readValue(client, "/contextMemory/reviewLedger/0");
			expect(ledger.findings).toHaveLength(2);
			expect(ledger.findings[0]).toMatchObject({
				occurrences: 2,
				firstRound: 0,
				latestRound: 3,
			});
			expect(ledger.findings[0].value.evidence).toMatchObject({
				fullPath: "/history/0/output/findings/0/evidence",
				view: "full",
			});
			expect(ledger.findings[1].value.evidence.fullPath).toBe(
				"/history/2/output/findings/0/evidence",
			);
			const ref = ledger.dispositions[0].value.reason;
			expect(ref).toMatchObject({
				fullPath: "/history/1/output/dispositions/0/reason",
				snapshotRoot: expect.stringMatching(/^[a-f0-9]{64}$/),
				view: "full",
			});
			let recovered = "",
				offset: number | null = 0;
			while (offset !== null) {
				const page = (
					await client.callTool({
						name: "read_context",
						arguments: {
							path: ref.fullPath,
							snapshotRoot: ref.snapshotRoot,
							view: ref.view,
							limit: 701,
							offset,
						},
					})
				).structuredContent as { text: string; nextOffset: number | null };
				recovered += page.text;
				offset = page.nextOffset;
			}
			expect(recovered).toBe(rejection.reason);
			expect(
				await readValue(client, "/history/0/output/findings/0", "full"),
			).toEqual(first);
			expect(
				(await readValue(client, "/contextMemory/reviewRounds/2")).summary,
			).toBe("Rejected fix is still wrong");
		},
	);
});

it("enforces a recursive work budget for many small nested nodes and treats reference-shaped role data as inert", async () => {
	const leaf = { answer: "small value" };
	const wide = Array.from({ length: 20 }, () =>
		Array.from({ length: 20 }, () => leaf),
	);
	const referenceShaped = {
		format: "factory-context-ref-v2",
		path: "/private/auth",
		fullPath: "/private/auth",
		view: "full",
		snapshotRoot: "0".repeat(64),
	};
	const prepared = await prepareFactoryContextAsync({
		outputs: { wide, referenceShaped },
	});
	const nodes = vi.spyOn(FactoryContextSnapshot.prototype, "node");
	try {
		await withContext(
			undefined,
			async (client) => {
				nodes.mockClear();
				const bounded = await readValue(client, "/outputs/wide");
				expect(nodes.mock.calls.length).toBeLessThan(1200);
				expect(JSON.stringify(bounded).length).toBeLessThanOrEqual(
					factoryContextProjectionLimits.subtreeCharacters,
				);
				expect(await readValue(client, "/outputs/wide/19/19")).toEqual(leaf);
				expect(await readValue(client, "/outputs/wide", "full")).toEqual(wide);
				expect(await readValue(client, "/outputs/referenceShaped")).toEqual(
					referenceShaped,
				);
			},
			undefined,
			prepared.config.args.at(-1)!,
		);
	} finally {
		nodes.mockRestore();
		prepared.cleanup();
	}
});

it("retains provenance projection and private persistent-cache guards even in full agent reads", async () => {
	const cacheDirectory = mkdtempSync(
		join(tmpdir(), "factory-context-private-cache-"),
	);
	const outside = mkdtempSync(join(tmpdir(), "factory-context-cache-outside-"));
	const hashes = { "source.ts": "a".repeat(64) };
	let prepared:
		| Awaited<ReturnType<typeof prepareFactoryContextAsync>>
		| undefined;
	try {
		prepared = await prepareFactoryContextAsync(
			{ shot: { dependencyHashes: hashes, area: "Reader" } },
			undefined,
			undefined,
			{ cacheDirectory },
		);
		await withContext(
			undefined,
			async (client) => {
				const full = await readValue(client, "/shot", "full");
				expect(full).toEqual({
					sourceFingerprint: {
						digest: expect.stringMatching(/^[a-f0-9]{64}$/),
						entries: 1,
						version: 1,
					},
					area: "Reader",
				});
				expect(
					(
						await client.callTool({
							name: "read_context",
							arguments: { path: "/shot/dependencyHashes", view: "full" },
						})
					).isError,
				).toBe(true);
			},
			undefined,
			prepared.config.args.at(-1)!,
		);
		rmSync(join(cacheDirectory, "chunks"), { recursive: true });
		symlinkSync(outside, join(cacheDirectory, "chunks"), "dir");
		await expect(
			prepareFactoryContextAsync({ plan: "safe" }, undefined, undefined, {
				cacheDirectory,
			}),
		).rejects.toThrow("private operator-owned directory");
	} finally {
		prepared?.cleanup();
		rmSync(cacheDirectory, { recursive: true, force: true });
		rmSync(outside, { recursive: true, force: true });
	}
});

it("adds lazy memory to wide root listings without materializing every root child", async () => {
	const input = {
		history: [],
		...Object.fromEntries(
			Array.from({ length: 300 }, (_, id) => [
				`field-${id}`,
				{ body: `record-${id}` },
			]),
		),
	};
	const prepared = await prepareFactoryContextAsync(input);
	const nodes = vi.spyOn(FactoryContextSnapshot.prototype, "node");
	try {
		await withContext(
			undefined,
			async (client) => {
				nodes.mockClear();
				const compact = await readValue(client, "");
				expect(compact).toMatchObject({
					format: "factory-context-ref-v2",
					fullPath: "",
					entries: 301,
				});
				expect(nodes.mock.calls.length).toBeLessThan(40);
				nodes.mockClear();
				const page = (
					await client.callTool({
						name: "list_context",
						arguments: { offset: 301, limit: 1 },
					})
				).structuredContent;
				expect(page).toMatchObject({
					total: 302,
					entries: [{ path: "/contextMemory" }],
					nextOffset: null,
				});
				expect(nodes.mock.calls.length).toBeLessThan(150);
			},
			undefined,
			prepared.config.args.at(-1)!,
		);
	} finally {
		nodes.mockRestore();
		prepared.cleanup();
	}
});
