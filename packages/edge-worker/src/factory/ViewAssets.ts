import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { CaptureSchema, verifiedScreenshot } from "./FactoryTools.js";
import { runRepositories, scopeRevision } from "./RepositoryScope.js";
import { presentationOutputKeys } from "./RunOutputRoles.js";
import { outputForCheck } from "./ToolBindings.js";
import { evidenceFile, type VideoCapture, videoLimits } from "./Video.js";
import type { ResolvedView } from "./View.js";
import type { FactoryRun } from "./WorkflowRuntime.js";

const exec = promisify(execFile);
async function verifyBytes(path: string, expected: string, limit: number) {
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const before = await handle.stat();
		if (!before.isFile() || before.size > limit)
			throw new Error("View asset is not a bounded regular file");
		const hash = createHash("sha256");
		for await (const chunk of handle.createReadStream({
			autoClose: false,
			start: 0,
		}))
			hash.update(chunk);
		const after = await handle.stat();
		if (
			before.ino !== after.ino ||
			before.size !== after.size ||
			before.ctimeMs !== after.ctimeMs ||
			hash.digest("hex") !== expected
		)
			throw new Error(
				"Displayed asset content changed. Refresh and review again.",
			);
	} finally {
		await handle.close();
	}
}
/** The display cannot invent filesystem paths or borrow assets from another run. */
export async function verifyViewAssets(
	directory: string,
	run: FactoryRun,
	view: ResolvedView,
) {
	const evidence = join(directory, "evidence", run.id);
	for (const component of view.components) {
		if (component.type === "screenshots") {
			const key = presentationOutputKeys(run).capture;
			const capture = CaptureSchema.parse(key ? run.outputs[key] : undefined);
			for (const ref of component.data.items) {
				const shot = capture.screenshots[ref.index];
				if (!shot || shot.imageSha256 !== ref.sha256)
					throw new Error(
						"Screenshot reference is not in this run's accepted capture inventory",
					);
				await verifyBytes(
					verifiedScreenshot(shot.path, evidence, ref.sha256),
					ref.sha256,
					10 * 1024 * 1024,
				);
			}
		}
		if (component.type === "video") {
			const ref = component.data,
				video = (
					outputForCheck(run, "capture-evidence") as VideoCapture | undefined
				)?.videos?.find((video) => video.taskId === ref.taskId),
				validation = video?.validation;
			if (
				!video ||
				!validation ||
				validation.dirty ||
				validation.sha256 !== ref.sha256
			)
				throw new Error(
					"Video reference is not in this run's verified capture inventory",
				);
			const revisions = await Promise.all(
				runRepositories(run).map(async (repository) => {
					const options = { cwd: repository.workspace, timeout: 10000 };
					return {
						repositoryId: repository.id,
						headSha: (
							await exec("git", ["rev-parse", "HEAD"], options)
						).stdout.trim(),
						dirty: (
							await exec("git", ["status", "--porcelain"], options)
						).stdout.trim(),
					};
				}),
			);
			if (
				revisions.some((r) => r.dirty) ||
				scopeRevision(revisions) !== validation.validatedRevision
			)
				throw new Error(
					"Displayed video belongs to an earlier or dirty revision",
				);
			await verifyBytes(
				evidenceFile(video.path, evidence, videoLimits.bytes),
				validation.sha256,
				videoLimits.bytes,
			);
			for (const asset of [validation.poster, validation.captions])
				if (asset)
					await verifyBytes(
						evidenceFile(asset.path, evidence, 10 * 1024 * 1024),
						asset.sha256,
						10 * 1024 * 1024,
					);
		}
	}
}
