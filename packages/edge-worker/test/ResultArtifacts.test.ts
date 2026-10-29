import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { submitFactoryResultArtifact } from "bobs-factory-mcp-tools";
import { expect, it } from "vitest";
import {
	resolveRoleResult,
	roleResultArtifactBinding,
} from "../src/factory/ResultArtifacts.js";
import type { ExecutionContext } from "../src/factory/WorkflowRuntime.js";

function roleContext(dirty: boolean, evidenceDir: string) {
	return {
		evidenceDir,
		run: { id: "run-1", step: "review/code-fix" },
		step: { id: "code-fix" },
		stepKey: "review/code-fix",
		progress: { currentRevision: { headSha: "abc", dirty } },
	} as unknown as ExecutionContext;
}

it("resolves a submitted result after the role edited the worktree", async () => {
	const evidenceDir = mkdtempSync(join(tmpdir(), "result-artifact-"));
	const start = roleContext(false, evidenceDir);
	const binding = roleResultArtifactBinding(start);
	mkdirSync(binding.directory, { recursive: true });
	writeFileSync(join(binding.directory, "result.json"), '{"ok":true}');
	const envelope = await submitFactoryResultArtifact(binding, "result.json");

	const finished = roleContext(true, evidenceDir);
	await expect(resolveRoleResult(finished, envelope)).rejects.toThrow(
		/clean revision/,
	);
	finished.resultArtifactBinding = binding;
	await expect(resolveRoleResult(finished, envelope)).resolves.toEqual({
		ok: true,
	});
});
