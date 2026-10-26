import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { runEvidenceChecks } from "../src/factory/EvidenceChecks.js";
import { OutputValidationError } from "../src/factory/OutputValidation.js";
import { validateWorkflows, WorkflowSchema } from "../src/factory/Workflow.js";
import type { ExecutionContext } from "../src/factory/WorkflowRuntime.js";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
function fixture() {
	const workspace = mkdtempSync(join(tmpdir(), "step-evidence-"));
	roots.push(workspace);
	const git = (...args: string[]) =>
		execFileSync("git", args, { cwd: workspace, encoding: "utf8" }).trim();
	git("init", "-b", "main");
	git("config", "user.name", "Fixture");
	git("config", "user.email", "fixture@example.test");
	git("config", "commit.gpgsign", "false");
	writeFileSync(join(workspace, "proof.ts"), "first\nsecond\n");
	mkdirSync(join(workspace, "src"));
	writeFileSync(join(workspace, "src", "nested.ts"), "nested file\n");
	git("add", ".");
	git("commit", "-m", "Evidence");
	const headSha = git("rev-parse", "HEAD"),
		evidenceDir = join(workspace, "evidence");
	mkdirSync(evidenceDir);
	const context = {
		run: {
			id: "run",
			history: [],
			repositoryId: "repo",
			workspace,
			outputs: { inventory: { requirements: [{ id: "R1" }] } },
		},
		step: { id: "any-name", type: "agent", reads: { inventory: "inventory" } },
		progress: { currentRevision: { headSha, dirty: false } },
		signal: new AbortController().signal,
		evidenceDir,
	} as unknown as ExecutionContext;
	return { context, workspace, evidenceDir };
}
it("checks committed file/line evidence and bound named IDs independent of step IDs", async () => {
	const { context, workspace } = fixture();
	context.step = {
		...context.step,
		revision: "bound",
		checks: [
			{ check: "files-exist", path: "/files/*" },
			{ check: "code-refs-valid", path: "/refs/*" },
			{
				check: "ids-resolve",
				path: "/requirements/*",
				source: "inventory",
				ids: "/requirements/*/id",
			},
		],
	};
	const output = {
		files: ["proof.ts"],
		refs: ["proof.ts:2"],
		requirements: ["R1"],
	};
	await expect(runEvidenceChecks(context, output)).resolves.toEqual(output);
	for (const directoryEvidence of [
		{ ...output, files: ["src"] },
		{ ...output, refs: ["src:1"] },
	])
		await expect(runEvidenceChecks(context, directoryEvidence)).rejects.toThrow(
			"Repository evidence must reference a file (Git blob)",
		);
	writeFileSync(join(workspace, "uncommitted.ts"), "uncommitted");
	for (const invalid of [
		{ ...output, files: ["uncommitted.ts"] },
		{ ...output, refs: ["proof.ts:3"] },
		{ ...output, requirements: ["invented"] },
		{ ...output, files: ["../outside"] },
	])
		await expect(runEvidenceChecks(context, invalid)).rejects.toBeInstanceOf(
			OutputValidationError,
		);
});
it("rejects escaped media and workspace symlinks while retaining the correction error type", async () => {
	const { context, workspace, evidenceDir } = fixture();
	writeFileSync(
		join(workspace, "outside.png"),
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
	);
	symlinkSync(join(workspace, "outside.png"), join(evidenceDir, "escaped.png"));
	context.step = {
		...context.step,
		checks: [{ check: "media-valid", path: "/images/*", kind: "image" }],
	};
	await expect(
		runEvidenceChecks(context, { images: [join(evidenceDir, "escaped.png")] }),
	).rejects.toThrow("inside this run's evidence directory");
	writeFileSync(join(evidenceDir, "invalid.png"), "not an image");
	await expect(
		runEvidenceChecks(context, { images: [join(evidenceDir, "invalid.png")] }),
	).rejects.toBeInstanceOf(OutputValidationError);
});

it("uses each pinned repository head instead of a grouped revision fingerprint", async () => {
	const { context, workspace } = fixture();
	const secondary = fixture();
	const primaryHead = context.progress!.currentRevision!.headSha;
	context.run.repositories = [
		{
			id: "repo",
			name: "Primary",
			workspace,
			repositoryPath: workspace,
			baseBranch: "main",
		},
		{
			id: "secondary",
			name: "Secondary",
			workspace: secondary.workspace,
			repositoryPath: secondary.workspace,
			baseBranch: "main",
		},
	];
	context.progress!.currentRevision!.headSha = "grouped-revision-fingerprint";
	context.progress!.currentRevision!.repositories = [
		{
			repositoryId: "repo",
			name: "Primary",
			headSha: primaryHead,
			dirty: false,
		},
		{
			repositoryId: "secondary",
			name: "Secondary",
			headSha: secondary.context.progress!.currentRevision!.headSha,
			dirty: false,
		},
	];
	context.step = {
		...context.step,
		revision: "bound",
		checks: [
			{ check: "files-exist", path: "/files/*" },
			{ check: "code-refs-valid", path: "/references/*" },
		],
	};
	await expect(
		runEvidenceChecks(context, {
			files: ["proof.ts"],
			references: ["proof.ts:2"],
		}),
	).resolves.toEqual({ files: ["proof.ts"], references: ["proof.ts:2"] });
});

it("executes all four new agent verifications against current named reads", async () => {
	const { context, evidenceDir } = fixture();
	const image = join(evidenceDir, "proof.png");
	writeFileSync(image, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]));
	const workflow = WorkflowSchema.parse({
		id: "generic",
		name: "Generic",
		engineVersion: "nodes-v1",
		steps: [
			{
				id: "produce",
				name: "Produce",
				type: "agent",
				prompt: "Return evidence",
				reads: { inventory: "@callInputs/items" },
				verify: [
					{ check: "files-exist", path: "/files/*" },
					{ check: "code-refs-valid", path: "/refs/*" },
					{ check: "media-valid", path: "/images/*", kind: "image" },
					{
						check: "ids-resolve",
						path: "/selected/*",
						source: "inventory",
						ids: "/items/*/id",
					},
				],
			},
		],
	});
	context.step = workflow.steps[0]!;
	context.input = { inventory: { items: [{ id: "current" }] } };
	const output = {
		files: ["proof.ts"],
		refs: ["proof.ts:2"],
		images: [image],
		selected: ["current"],
	};
	await expect(runEvidenceChecks(context, output)).resolves.toEqual(output);
	for (const invalid of [
		{ ...output, files: ["missing.ts"] },
		{ ...output, refs: ["proof.ts:900"] },
		{ ...output, images: ["missing.png"] },
		{ ...output, selected: ["R1"] }, // Prior run.outputs inventory is not this visit's read.
	])
		await expect(runEvidenceChecks(context, invalid)).rejects.toBeInstanceOf(
			OutputValidationError,
		);
	const invalid = structuredClone(workflow);
	invalid.steps[0]!.verify![3] = {
		check: "ids-resolve",
		path: "/selected/*",
		source: "undeclared",
		ids: "/items/*/id",
	};
	expect(() => validateWorkflows([invalid])).toThrow(
		"ids-resolve requires a named source read",
	);
});

it("verifies nested Display code and code tours, including old-side notes at the common base", async () => {
	const { context, workspace } = fixture();
	const git = (...args: string[]) =>
		execFileSync("git", args, { cwd: workspace, encoding: "utf8" }).trim();
	git("update-ref", "refs/remotes/origin/main", "HEAD");
	writeFileSync(join(workspace, "proof.ts"), "replacement\n");
	git("add", "proof.ts");
	git("commit", "-m", "Replace");
	context.progress!.currentRevision!.headSha = git("rev-parse", "HEAD");
	context.run.repositories = [
		{
			id: "repo",
			name: "Fixture",
			workspace,
			repositoryPath: workspace,
			baseBranch: "main",
		},
	];
	context.step = {
		...context.step,
		checks: [{ check: "code-refs-valid", path: "/components/*" }],
	};
	const component = (type: string, data: unknown) => ({
		type,
		data: { literal: data },
	});
	const output = {
		components: [
			component("markdown", { text: "No reference" }),
			component("section", {
				components: [
					component("code", { file: "proof.ts", startLine: 1, endLine: 1 }),
					component("codeTour", {
						files: [{ path: "proof.ts", notes: [{ line: 2, side: "old" }] }],
					}),
				],
			}),
		],
	};
	await expect(runEvidenceChecks(context, output)).resolves.toEqual(output);
	for (const invalid of [
		component("code", { file: "proof.ts", startLine: 2 }),
		component("codeTour", { files: [{ path: "missing.ts", notes: [] }] }),
		component("codeTour", {
			files: [{ path: "proof.ts", notes: [{ line: 3, side: "old" }] }],
		}),
		{ type: "codeTour", data: { path: "/inputs/tour" } },
	])
		await expect(
			runEvidenceChecks(context, { components: [invalid] }),
		).rejects.toBeInstanceOf(OutputValidationError);
});

it("checks new-engine absolute artifacts only under the run evidence root", async () => {
	const { context, workspace, evidenceDir } = fixture();
	const { registerWorkflowConfig } = await import(
		"../src/factory/StepConfig.js"
	);
	const workflow = WorkflowSchema.parse({
		id: "artifact-files",
		name: "Artifact files",
		engineVersion: "nodes-v1",
		steps: [
			{
				id: "assets",
				name: "Assets",
				type: "agent",
				prompt: "Collect files",
				verify: [{ check: "files-exist", path: "/files/*" }],
			},
		],
	});
	registerWorkflowConfig(workflow);
	context.step = workflow.steps[0]!;
	const artifact = join(evidenceDir, "receipt.txt");
	writeFileSync(artifact, "executed evidence");
	await expect(
		runEvidenceChecks(context, { files: [artifact] }),
	).resolves.toEqual({ files: [artifact] });
	await expect(
		runEvidenceChecks(context, { files: [join(workspace, "proof.ts")] }),
	).rejects.toBeInstanceOf(OutputValidationError);
	symlinkSync(join(workspace, "proof.ts"), join(evidenceDir, "escaped.txt"));
	await expect(
		runEvidenceChecks(context, { files: [join(evidenceDir, "escaped.txt")] }),
	).rejects.toBeInstanceOf(OutputValidationError);
});
