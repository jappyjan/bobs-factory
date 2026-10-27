import { randomUUID } from "node:crypto";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import {
	LaunchAssetStore,
	launchAssetFingerprint,
	launchAssetLimits,
} from "../src/factory/LaunchAssets.js";
import {
	LaunchFieldSchema,
	LaunchRequestSchema,
	resolveLaunchRequest,
} from "../src/factory/LaunchFields.js";
import { WorkflowSchema } from "../src/factory/Workflow.js";

const homes: string[] = [];
afterEach(() => {
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});
function fixture() {
	const home = mkdtempSync(join(tmpdir(), "launch-assets-"));
	homes.push(home);
	const store = new LaunchAssetStore(join(home, "factory"));
	const context = {
		draft: randomUUID(),
		workflow: "custom",
		repositoryId: "app",
		repositoryIds: ["app", "api"],
	};
	const stage = (
		name = "../arbitrary.html",
		bytes = Buffer.from([0, 255, 1]),
	) =>
		store.stage(
			{ ...context, field: "files", name, mime: "" },
			"workflow",
			bytes,
		);
	return { home, store, context, stage };
}
it("claims exact bytes once, preserves metadata on restart and prevents late draft recreation", () => {
	const { home, store, context, stage } = fixture();
	const asset = stage();
	const attachments = store.claim("run", context, "workflow", {
		files: [asset.id],
	});
	expect(readFileSync(attachments.files![0]!.path)).toEqual(
		Buffer.from([0, 255, 1]),
	);
	expect(attachments.files![0]).toMatchObject({
		name: "../arbitrary.html",
		mime: "",
		size: 3,
	});
	expect(statSync(attachments.files![0]!.path).mode & 0o111).toBe(0);
	new LaunchAssetStore(join(home, "factory")).verify("run", attachments);
	expect(() =>
		store.claim("another", context, "workflow", { files: [asset.id] }),
	).toThrow(/missing|submitted/);
	expect(() => stage()).toThrow(/submitted/);
	store.cleanup(Date.now() + 48 * 60 * 60 * 1000);
	store.verify("run", attachments);
	const copied = store.copy("run", "followup", attachments);
	store.verify("followup", copied);
	expect(copied.files![0]!.path).not.toBe(attachments.files![0]!.path);
});
it("rejects stale scope, changed workflow, duplicated IDs and incorrect fields without consuming valid files", () => {
	const { store, context, stage } = fixture();
	const asset = stage();
	expect(() =>
		store.validate({ ...context, repositoryId: "api" }, "workflow", {
			files: [asset.id],
		}),
	).toThrow(/different/);
	expect(() =>
		store.validate(context, "edited-workflow", { files: [asset.id] }),
	).toThrow(/different/);
	expect(() =>
		store.validate(context, "workflow", { files: [asset.id, asset.id] }),
	).toThrow(/selection/);
	expect(() =>
		store.validate(context, "workflow", { other: [asset.id] }),
	).toThrow(/field/);
	store.validate(context, "workflow", { files: [asset.id] });
	store.remove(context.draft, asset.id);
	expect(() =>
		store.validate(context, "workflow", { files: [asset.id] }),
	).toThrow(/field/);
});
it("bounds individual, combined and per-draft file counts", () => {
	const { store, context, stage } = fixture();
	expect(() =>
		stage("big", Buffer.alloc(launchAssetLimits.fileBytes + 1)),
	).toThrow(/25 MiB/);
	for (let i = 0; i < 4; i++)
		stage("maximum", Buffer.alloc(launchAssetLimits.fileBytes));
	expect(() => stage("extra", Buffer.from([1]))).toThrow(/100 MiB/);
	const other = fixture();
	for (let i = 0; i < 10; i++) other.stage();
	expect(() => other.stage()).toThrow(/10 files/);
	expect(() =>
		store.validate({ ...context, draft: "../outside" }, "workflow", {}),
	).toThrow();
});
it("fails visibly when accepted bytes or file links change", () => {
	const { home, store, context, stage } = fixture();
	const asset = stage();
	const attachments = store.claim("run", context, "workflow", {
		files: [asset.id],
	});
	const path = attachments.files![0]!.path;
	chmodSync(path, 0o600);
	writeFileSync(path, "changed");
	expect(() => store.verify("run", attachments)).toThrow(/changed/);
	rmSync(path);
	const outside = join(home, "outside");
	writeFileSync(outside, "secret");
	symlinkSync(outside, path);
	expect(() => store.verify("run", attachments)).toThrow(/unavailable/);
});
it("expires abandoned drafts and rejects symlink storage roots", () => {
	const { home, store, context, stage } = fixture();
	stage();
	store.cleanup(Date.now() + 25 * 60 * 60 * 1000);
	expect(() => store.validate(context, "workflow", {})).toThrow(/missing/);
	const outside = join(home, "outside");
	mkdirSync(outside);
	symlinkSync(outside, join(store.directory, "drafts", context.draft));
	expect(() => stage()).toThrow(/symbolic link/);
});
it("keeps legacy text requests valid and validates explicitly declared file fields", () => {
	const workflow = WorkflowSchema.parse({
		id: "custom",
		name: "Custom",
		launchFields: [
			{ name: "prompt", label: "Prompt", type: "textarea", required: true },
			{ name: "files", label: "Files", type: "files", required: true },
		],
		steps: [
			{
				id: "work",
				name: "Work",
				type: "agent",
				prompt: "Read submitted files",
			},
		],
	});
	const request = {
		repositoryId: "app",
		workflow: "custom",
		inputs: { prompt: "build" },
	};
	expect(() =>
		resolveLaunchRequest(workflow, LaunchRequestSchema.parse(request)),
	).toThrow(/Files is required/);
	const id = randomUUID();
	const resolved = resolveLaunchRequest(
		workflow,
		LaunchRequestSchema.parse({
			...request,
			attachmentDraft: randomUUID(),
			attachments: { files: [id] },
		}),
	);
	expect(resolved.inputs).toEqual({ prompt: "build" });
	expect(resolved.attachments).toEqual({ files: [id] });
	expect(() =>
		LaunchFieldSchema.parse({
			name: "files",
			label: "Files",
			type: "files",
			defaultValue: "path",
		}),
	).toThrow();
	expect(() =>
		LaunchFieldSchema.parse({
			name: "files",
			label: "Files",
			type: "files",
			options: [{ value: "file", label: "File" }],
		}),
	).toThrow();
	const legacy = WorkflowSchema.parse({
		...workflow,
		launchFields: [{ name: "prompt", label: "Prompt" }],
	});
	expect(
		resolveLaunchRequest(legacy, LaunchRequestSchema.parse(request)).inputs,
	).toEqual({ prompt: "build" });
	expect(() =>
		resolveLaunchRequest(
			legacy,
			LaunchRequestSchema.parse({ ...request, attachments: { files: [id] } }),
		),
	).toThrow();
	for (const name of ["factory", "takeover", "simple"])
		expect(
			defaultWorkflows
				.find((item) => item.id === name)!
				.launchFields?.some((field) => field.type === "files"),
		).toBe(true);
	expect(launchAssetFingerprint(workflow)).not.toBe(
		launchAssetFingerprint(legacy),
	);
});

it("passes original uploaded bytes through nested declared reads", async () => {
	const { home, store, context, stage } = fixture();
	const { WorkflowRuntime } = await import("../src/factory/WorkflowRuntime.js");
	const asset = stage("spec.bin", Buffer.from([0, 255, 1]));
	const attachments = store.claim("nested", context, "workflow", {
		files: [asset.id],
	});
	const child = WorkflowSchema.parse({
		engineVersion: "nodes-v1",
		id: "child",
		name: "Child",
		internal: true,
		allowedTriggers: ["workflow"],
		steps: [
			{
				id: "read",
				name: "Read",
				type: "agent",
				prompt: "Read files",
			},
		],
	});
	const parent = WorkflowSchema.parse({
		engineVersion: "nodes-v1",
		id: "parent",
		name: "Parent",
		allowedTriggers: ["manual"],
		steps: [
			{ id: "child", name: "Call child", type: "workflow", workflow: "child" },
			{
				id: "architecture",
				name: "Architecture",
				type: "agent",
				prompt: "Snapshot files",
			},
		],
	});
	const seen: unknown[] = [];
	const runtime = new WorkflowRuntime(home, {
		agent: async (execution) => {
			seen.push(execution.input);
			return { summary: "Read uploaded bytes" };
		},
	});
	try {
		const run = runtime.create({
			id: "nested",
			triggerOrigin: {
				type: "manual",
				workflowId: "parent",
				at: new Date().toISOString(),
			},
			repositoryId: "repo",
			workflow: parent,
			workflowDefinitions: [parent, child],
			workspace: home,
			input: "Use files",
			launchAttachments: attachments,
		});
		await runtime.launch(run);
		expect(run.status).toBe("completed");
		expect(seen[0]).toMatchObject({
			launchAttachments: attachments,
		});
		expect(seen[1]).toMatchObject({ launchAttachments: attachments });
		expect(readFileSync(attachments.files![0]!.path)).toEqual(
			Buffer.from([0, 255, 1]),
		);
	} finally {
		await runtime.shutdown();
	}
});

it("keeps step results intact when their names match attachment fields and ignores inherited names", async () => {
	const { home, store, context, stage } = fixture();
	const { WorkflowRuntime } = await import("../src/factory/WorkflowRuntime.js");
	const asset = stage();
	const attachments = store.claim("collision", context, "workflow", {
		files: [asset.id],
	});
	const workflow = WorkflowSchema.parse({
		engineVersion: "nodes-v1",
		id: "collision",
		name: "Collision",
		allowedTriggers: ["manual"],
		steps: [
			{
				id: "files",
				name: "Compute",
				type: "agent",
				prompt: "Compute a result",
			},
			{
				id: "read",
				name: "Read",
				type: "agent",
				prompt: "Read results and files",
				reads: { files: "files" },
			},
		],
	});
	let seen: any;
	const runtime = new WorkflowRuntime(home, {
		agent: async (execution) => {
			if (execution.step.id === "files")
				return { computed: "preserve this result" };
			seen = execution.input;
			return { summary: "Read" };
		},
	});
	try {
		const run = runtime.create({
			id: "collision",
			triggerOrigin: {
				type: "manual",
				workflowId: workflow.id,
				at: new Date().toISOString(),
			},
			repositoryId: "repo",
			workflow,
			workspace: home,
			input: "Files",
			launchAttachments: attachments,
		});
		await runtime.launch(run);
		expect(run.status).toBe("completed");
		expect(seen.files).toEqual({ computed: "preserve this result" });
		expect(Object.hasOwn(seen, "constructor")).toBe(false);
		expect(seen.launchAttachments).toEqual(attachments);
	} finally {
		await runtime.shutdown();
	}
});
