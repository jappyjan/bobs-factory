import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { presentationOutputKeys } from "../src/factory/RunOutputRoles.js";
import { hasCheck } from "../src/factory/StepConfig.js";
import { validateWorkflows, WorkflowSchema } from "../src/factory/Workflow.js";
import { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";
import { guideRevision } from "../src/factory/web/review-state.js";
import { roleOutput } from "../src/factory/web/run-output.js";
import { FactoryServer } from "./fixtures/authenticated-factory.js";
import { renamedFactory } from "./fixtures/renamed-factory.js";

it("keeps renamed Factory review cards, lazy guide artifacts and media bound to configured producers", async () => {
	const home = mkdtempSync(join(tmpdir(), "factory-renamed-presentation-"));
	const definitions = validateWorkflows(
		renamedFactory(defaultWorkflows).definitions,
	);
	const workflow = definitions.find((item) => item.id === "renamed-factory")!;
	const pipeline = definitions.find(
		(item) => item.id === "renamed-factory-pipeline",
	)!;
	const guideId = pipeline.steps.find((step) =>
		hasCheck(step, "requirement-coverage"),
	)!.id;
	const captureId = pipeline.steps.find((step) =>
		hasCheck(step, "capture-evidence"),
	)!.id;
	const publicationId = pipeline.steps.find(
		(step) => step.tool === "draft-pr",
	)!.id;
	const prefix = `${workflow.steps[0]!.id}/`;
	const guideKey = `${prefix}${guideId}`,
		captureKey = `${prefix}${captureId}`,
		publicationKey = `${prefix}${publicationId}`;
	let runtime = new WorkflowRuntime(home, {});
	let run = runtime.create({
		id: "renamed-presentation",
		title: "Review the renamed run",
		repositoryId: "repo",
		workspace: home,
		input: "",
		workflow,
		workflowDefinitions: definitions,
		triggerOrigin: {
			type: "manual",
			workflowId: workflow.id,
			at: new Date().toISOString(),
		},
	});
	const png = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNNsAAAAASUVORK5CYII=",
		"base64",
	);
	const evidence = join(runtime.directory, "evidence", run.id);
	mkdirSync(evidence, { recursive: true });
	const image = join(evidence, "renamed.png");
	writeFileSync(image, png);
	const imageSha256 = createHash("sha256").update(png).digest("hex");
	const guide = {
		summary: "Configured guide",
		notes: "guide body".repeat(10000),
	};
	run.outputs[guideKey] = guide;
	run.outputs[publicationKey] = { url: "https://example.com/repo/pull/136" };
	run.outputs[captureKey] = {
		screenshots: [
			{
				path: image,
				area: "Builder",
				state: "saved",
				caption: "Configured capture",
				imageSha256,
			},
		],
		unavailable: [],
	};
	for (const key of [guideKey, captureKey, publicationKey])
		run.history.push({
			step: key,
			at: new Date().toISOString(),
			output: run.outputs[key],
		});
	run.history.push({
		step: "irrelevant",
		at: new Date().toISOString(),
		output: { body: "cold history".repeat(10000) },
	});
	run.status = "stopped";
	await runtime.save(run);
	await runtime.shutdown();
	const manifest = JSON.parse(
		readFileSync(join(runtime.directory, "runs", `${run.id}.json`), "utf8"),
	);
	const chunks = [
		...new Set<string>([
			...manifest.fields.outputs.record[guideKey].reference.chunks,
			...manifest.fields.history.pages.flatMap(
				(page: { chunks: string[] }) => page.chunks,
			),
		]),
	].map((hash) => {
		const path = join(runtime.directory, "run-chunks", `${hash}.json`);
		const bytes = readFileSync(path);
		rmSync(path);
		return { path, bytes };
	});
	runtime = new WorkflowRuntime(home, {});
	run = runtime.get(run.id);
	const server = new FactoryServer(runtime, {
		repositories: () => [],
		sessions: () => [],
		entries: () => [],
		start: async () => run,
		stop: () => {},
	});
	try {
		expect(presentationOutputKeys(run)).toMatchObject({
			guide: guideKey,
			capture: captureKey,
			"draft-pr": publicationKey,
		});
		expect(
			guideRevision({
				outputRoles: { guide: guideKey },
				roleRevisions: {
					[guideKey]: { headSha: "accepted-revision" },
				},
			}),
		).toEqual({ headSha: "accepted-revision" });
		const focus = await server.app.inject({
			url: `/api/runs/${run.id}?view=focus`,
		});
		expect(focus.statusCode).toBe(200);
		expect(focus.json().outputs).toEqual({
			guide: { summary: "Configured guide" },
			"draft-pr": { url: "https://example.com/repo/pull/136" },
		});
		const dashboard = await server.app.inject({
			url: `/api/runs/${run.id}?view=dashboard`,
		});
		expect(dashboard.statusCode).toBe(200);
		expect(dashboard.json().hasGuide).toBe(true);
		expect(roleOutput(dashboard.json(), "guide")).toMatchObject({
			__artifactPreview: true,
			summary: "Configured guide",
		});
		expect(roleOutput(dashboard.json(), "capture").screenshots[0].caption).toBe(
			"Configured capture",
		);
		expect(dashboard.rawPayload.length).toBeLessThan(50000);
		for (const { path, bytes } of chunks) writeFileSync(path, bytes);
		const artifact = await server.app.inject({
			url: `/api/runs/${run.id}/artifacts/guide?v=${roleOutput(dashboard.json(), "guide").__artifactHash}`,
		});
		expect(artifact.statusCode).toBe(200);
		expect(artifact.json()).toEqual(guide);
		const stale = await server.app.inject({
			url: `/api/runs/${run.id}/artifacts/guide?v=${"0".repeat(64)}`,
		});
		expect(stale.statusCode).toBe(409);
		const media = await server.app.inject({
			url: `/api/runs/${run.id}/evidence`,
		});
		expect(media.json().screenshots).toEqual([
			{
				area: "Builder",
				state: "saved",
				caption: "Configured capture",
				imageSha256,
				index: 0,
			},
		]);
		for (const artifactName of [undefined, "capture", captureKey]) {
			const shot = await server.app.inject({
				url: `/api/runs/${run.id}/screenshots/0?v=${imageSha256}${artifactName ? `&artifact=${artifactName}` : ""}`,
			});
			expect(shot.statusCode).toBe(200);
			expect(shot.rawPayload).toEqual(png);
		}
	} finally {
		for (const { path, bytes } of chunks) writeFileSync(path, bytes);
		await server.stop();
		await runtime.shutdown();
		rmSync(home, { recursive: true, force: true });
	}
});

it("does not turn modern generic outputs named guide, capture or draft-pr into review roles", async () => {
	const home = mkdtempSync(join(tmpdir(), "factory-generic-presentation-"));
	const runtime = new WorkflowRuntime(home, {});
	const workflow = WorkflowSchema.parse({
		id: "generic",
		name: "Generic",
		stepConfigVersion: "step-config-v1",
		steps: [
			{
				id: "guide",
				name: "Generic guide",
				type: "agent",
				prompt: "Return data",
				next: "capture",
			},
			{
				id: "capture",
				name: "Generic capture",
				type: "agent",
				prompt: "Return data",
				next: "draft-pr",
			},
			{
				id: "draft-pr",
				name: "Generic publication",
				type: "agent",
				prompt: "Return data",
				next: "end",
			},
		],
	});
	const run = runtime.create({
		id: "generic-presentation",
		title: "Generic",
		repositoryId: "repo",
		workspace: home,
		input: "",
		workflow,
		triggerOrigin: {
			type: "manual",
			workflowId: workflow.id,
			at: new Date().toISOString(),
		},
	});
	run.outputs.guide = { summary: "Ordinary data" };
	run.outputs.capture = { screenshots: [] };
	run.outputs["draft-pr"] = { url: "https://example.com/ordinary-data" };
	const server = new FactoryServer(runtime, {
		repositories: () => [],
		sessions: () => [],
		entries: () => [],
		start: async () => run,
		stop: () => {},
	});
	try {
		expect(presentationOutputKeys(run)).toEqual({});
		const focus = await server.app.inject({
			url: `/api/runs/${run.id}?view=focus`,
		});
		expect(focus.json().outputs).toEqual({});
		const media = await server.app.inject({
			url: `/api/runs/${run.id}/evidence`,
		});
		expect(media.json()).toEqual({
			videos: [],
			videoUnavailable: [],
			screenshots: [],
		});
		const dashboard = await server.app.inject({
			url: `/api/runs/${run.id}?view=dashboard`,
		});
		expect(dashboard.json().outputs.guide).toEqual({
			summary: "Ordinary data",
		});
		expect(roleOutput(dashboard.json(), "guide")).toBeUndefined();
		expect(dashboard.json().hasGuide).toBe(false);
		const genericArtifact = await server.app.inject({
			url: `/api/runs/${run.id}/artifacts/guide`,
		});
		expect(genericArtifact.json()).toEqual({ summary: "Ordinary data" });
	} finally {
		await server.stop();
		await runtime.shutdown();
		rmSync(home, { recursive: true, force: true });
	}
});
