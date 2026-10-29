import { createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { join } from "node:path";
import {
	type FactoryArtifactBinding,
	resolveFactoryResultArtifact,
} from "bobs-factory-mcp-tools";
import { outputValidationError } from "./OutputValidation.js";

import type { ExecutionContext } from "./WorkflowRuntime.js";

export function roleResultArtifactBinding(
	context: ExecutionContext,
): FactoryArtifactBinding {
	const stepKey = context.stepKey ?? context.run.step ?? context.step.id;
	const revision = context.progress?.currentRevision;
	if (!revision || revision.dirty)
		throw new Error("Result artifact requires a current clean revision");
	if (lstatSync(context.evidenceDir).isSymbolicLink())
		throw new Error("Authorized result evidence root must not be a symlink");
	const authorizedRoot = realpathSync(context.evidenceDir);
	return {
		directory: join(
			authorizedRoot,
			"role-results",
			createHash("sha256").update(stepKey).digest("hex"),
		),
		authorizedRoot,
		runId: context.run.id,
		stepKey,
		headSha: revision.headSha,
	};
}

export async function resolveRoleResult(
	context: ExecutionContext,
	value: unknown,
): Promise<unknown> {
	let output = value;
	try {
		if (
			value &&
			typeof value === "object" &&
			Object.hasOwn(value, "factoryArtifact")
		)
			output = await resolveFactoryResultArtifact(
				context.resultArtifactBinding ?? roleResultArtifactBinding(context),
				value,
			);
	} catch (error) {
		throw outputValidationError(value, error);
	}
	return output;
}
