import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	truncateSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { runEvidenceChecks } from "../src/factory/EvidenceChecks.js";
import { resolveView, ViewSourceSchema } from "../src/factory/View.js";
import {
	readViewScreenshot,
	verifyViewAssets,
} from "../src/factory/ViewAssets.js";
import { validateWorkflows } from "../src/factory/Workflow.js";
import { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";

const io = vi.hoisted(() => ({ fullReads: [] as string[] }));
// The regression was an eager full-file read before the bounded verifier ran.
// Observe real I/O while retaining the real filesystem and hash behavior.
vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return {
		...actual,
		readFileSync: (...args: unknown[]) => {
			io.fullReads.push(String(args[0]));
			return Reflect.apply(actual.readFileSync, actual, args);
		},
	};
});
const homes: string[] = [];
const runtimes: WorkflowRuntime[] = [];
afterEach(async () => {
	for (const instance of runtimes.splice(0)) await instance.shutdown();
	for (const directory of homes.splice(0))
		rmSync(directory, { recursive: true, force: true });
	io.fullReads.length = 0;
});
const png = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNNsAAAAASUVORK5CYII=",
	"base64",
);
const originalHash = createHash("sha256").update(png).digest("hex");
const screenshotView = (
	items = [{ index: 0, sha256: originalHash, alt: "Displayed screenshot" }],
) =>
	resolveView(
		ViewSourceSchema.parse({
			version: "view-v1",
			components: [
				{ id: "screens", type: "screenshots", data: { literal: { items } } },
			],
		}),
		{},
	);

async function fixture(
	options: { capture?: boolean; path?: string; sha256?: string } = {},
) {
	const directory = mkdtempSync(join(tmpdir(), "view-assets-"));
	homes.push(directory);
	let image = "";
	const instance = new WorkflowRuntime(directory, {
		agent: async (context) =>
			runEvidenceChecks(
				context,
				context.step.id === "scope"
					? { areas: [] }
					: {
							screenshots: [
								{
									path: options.path ?? image,
									caption: "Retained capture",
									area: "Review",
									imageSha256: options.sha256 ?? originalHash,
								},
							],
							unavailable: [],
						},
			),
	});
	runtimes.push(instance);
	const definitions = validateWorkflows([
		...defaultWorkflows,
		{
			engineVersion: "nodes-v1",
			id: "asset-fixture",
			name: "Asset fixture",
			stepConfigVersion: "step-config-v1",
			steps:
				options.capture === false
					? [
							{
								id: "display",
								name: "Empty screenshots",
								type: "display",
								document: {
									version: "view-v1",
									components: [
										{
											id: "screens",
											type: "screenshots",
											data: { literal: { items: [] } },
										},
									],
								},
							},
						]
					: [
							{
								id: "scope",
								name: "Scope",
								type: "agent",
								prompt: "Fixture scope",
							},
							{
								id: "photos",
								name: "Capture",
								type: "agent",
								prompt: "Fixture capture",
								reads: { scope: "scope" },
								verify: [
									{
										check: "media-valid",
										path: "/screenshots/0/path",
										kind: "image",
									},
								],
							},
						],
		},
	]);
	instance.updateWorkflows(definitions);
	const workflow = definitions.at(-1)!;
	const run = instance.create({
		title: "Own-run view assets",
		repositoryId: "fixture",
		workspace: directory,
		input: "Local controlled image fixture",
		workflow,
		workflowDefinitions: definitions,
		triggerOrigin: {
			type: "manual",
			workflowId: workflow.id,
			at: "2026-10-22T00:00:00.000Z",
		},
	});
	const evidence = join(instance.directory, "evidence", run.id);
	mkdirSync(evidence, { recursive: true });
	image = join(evidence, "image.png");
	writeFileSync(image, png);
	if (options.capture !== false) {
		await instance.launch(run);
		expect(run.status, run.error).toBe("completed");
		expect(run.history.map((event) => event.step)).toEqual(["scope", "photos"]);
	}
	return { directory, instance, run, image, evidence };
}

describe("bounded current-run view asset verification", () => {
	it("allows empty screenshot components without a capture producer and completes a real Show", async () => {
		const { instance, run } = await fixture({ capture: false });
		await expect(
			verifyViewAssets(instance.directory, run, screenshotView([])),
		).resolves.toBeUndefined();
		await instance.launch(run);
		expect(run.status, run.error).toBe("completed");
		expect(run.viewDisplays?.[0]?.view).toEqual({
			version: "view-v1",
			components: [{ id: "screens", type: "screenshots", data: { items: [] } }],
		});
	});

	it("accepts real inventory bytes, then denies in-place changes without rewriting original capture receipts", async () => {
		const { instance, run, image } = await fixture();
		await expect(
			verifyViewAssets(instance.directory, run, screenshotView()),
		).resolves.toBeUndefined();
		expect(
			await readViewScreenshot(instance.directory, run, 0, originalHash),
		).toEqual(png);
		const changed = Buffer.from(png);
		changed[changed.length - 1] ^= 1;
		writeFileSync(image, changed);
		await expect(
			verifyViewAssets(instance.directory, run, screenshotView()),
		).rejects.toThrow(/content changed|digest|hash/i);
		await expect(
			readViewScreenshot(instance.directory, run, 0, originalHash),
		).rejects.toThrow(/content changed|digest|hash/i);
		expect(run.outputs.photos).toMatchObject({
			screenshots: [{ imageSha256: originalHash }],
		});
		expect(run.history.at(-1)?.output).toEqual(run.outputs.photos);
	});

	it("rejects oversized regular PNG files before eager body reads", async () => {
		const { instance, run, image } = await fixture();
		truncateSync(image, 10 * 1024 * 1024 + 1);
		io.fullReads.length = 0;
		await expect(
			verifyViewAssets(instance.directory, run, screenshotView()),
		).rejects.toThrow(/bounded|size|limit|exceed/i);
		await expect(
			readViewScreenshot(instance.directory, run, 0, originalHash),
		).rejects.toThrow(/bounded|size|limit|exceed/i);
		expect(io.fullReads.filter((path) => path === image)).toEqual([]);
	});

	it("denies unknown screenshot indexes and hashes before consuming any capture body", async () => {
		const { instance, run, image } = await fixture();
		for (const reference of [
			{ index: 1, sha256: originalHash, alt: "Unknown" },
			{ index: 0, sha256: "0".repeat(64), alt: "Wrong hash" },
		]) {
			io.fullReads.length = 0;
			await expect(
				verifyViewAssets(instance.directory, run, screenshotView([reference])),
			).rejects.toThrow(/inventory|Screenshot/i);
			await expect(
				readViewScreenshot(
					instance.directory,
					run,
					reference.index,
					reference.sha256,
				),
			).rejects.toThrow(/inventory|Screenshot/i);
			expect(io.fullReads.filter((path) => path === image)).toEqual([]);
		}
	});

	it("cannot borrow same-hash accepted metadata from another run's evidence directory", async () => {
		const other = await fixture();
		await expect(fixture({ path: other.image })).rejects.toThrow(
			/inside.*evidence/,
		);
		const { instance, run } = await fixture();
		run.verifiedMedia![0]!.path = other.image;
		io.fullReads.length = 0;
		await expect(
			verifyViewAssets(instance.directory, run, screenshotView()),
		).rejects.toThrow(/inside|evidence|run/i);
		await expect(
			readViewScreenshot(instance.directory, run, 0, originalHash),
		).rejects.toThrow(/inside|evidence|run/i);
		expect(io.fullReads.filter((path) => path === other.image)).toEqual([]);
	});
});
