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
	git("add", ".");
	git("commit", "-m", "Evidence");
	const headSha = git("rev-parse", "HEAD"),
		evidenceDir = join(workspace, "evidence");
	mkdirSync(evidenceDir);
	const context = {
		run: {
			id: "run",
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
