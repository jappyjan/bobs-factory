import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, lstatSync, realpathSync } from "node:fs";
import { open } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { CaptureSchema } from "./FactoryTools.js";
import { runRepositories, scopeRevision } from "./RepositoryScope.js";
import { presentationOutputKeys } from "./RunOutputRoles.js";
import { outputForCheck } from "./ToolBindings.js";
import { evidenceFile, type VideoCapture, videoLimits } from "./Video.js";
import type { ResolvedView } from "./View.js";
import type { FactoryRun } from "./WorkflowRuntime.js";

const exec = promisify(execFile);
async function verifyBytes(
	path: string,
	expected: string,
	limit: number,
	image = false,
	stamps?: (() => boolean)[],
) {
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const before = await handle.stat();
		if (!before.isFile() || before.size > limit)
			throw new Error("View asset is not a bounded regular file");
		const hash = createHash("sha256");
		const chunks: Buffer[] = [];
		let length = 0;
		for await (const chunk of handle.createReadStream({
			autoClose: false,
			start: 0,
			end: limit,
		})) {
			length += chunk.length;
			if (length > limit) throw new Error("View asset exceeds its size limit");
			if (image) chunks.push(chunk);
			hash.update(chunk);
		}
		const after = await handle.stat();
		if (
			before.ino !== after.ino ||
			before.dev !== after.dev ||
			before.size !== after.size ||
			before.ctimeMs !== after.ctimeMs ||
			before.mtimeMs !== after.mtimeMs ||
			hash.digest("hex") !== expected
		)
			throw new Error(
				"Displayed asset content changed. Refresh and review again.",
			);
		// Bounded synchronous identity check at the eventual local handoff.
		// The bytes were hashed outside the human transition; any replacement or
		// write during its queue wait invalidates that authority without re-reading.
		stamps?.push(() => {
			try {
				const now = lstatSync(path);
				return (
					realpathSync(path) === path &&
					now.isFile() &&
					now.dev === after.dev &&
					now.ino === after.ino &&
					now.size === after.size &&
					now.ctimeMs === after.ctimeMs &&
					now.mtimeMs === after.mtimeMs &&
					now.mode === after.mode
				);
			} catch {
				return false;
			}
		});
		if (image) {
			const bytes = Buffer.concat(chunks);
			const png = bytes
				.subarray(0, 8)
				.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
			const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
			if (!png && !jpeg) throw new Error("Screenshot is not a PNG or JPEG");
			return bytes;
		}
		return undefined;
	} finally {
		await handle.close();
	}
}
/** Same-run containment and retained relocation policy, before any image body read. */
export async function readViewScreenshot(
	directory: string,
	run: FactoryRun,
	index: number,
	expected: string,
	stamps?: (() => boolean)[],
): Promise<Buffer> {
	if (
		!Number.isSafeInteger(index) ||
		index < 0 ||
		!/^[a-f0-9]{64}$/.test(expected)
	)
		throw new Error("Invalid screenshot reference");
	const key = presentationOutputKeys(run).capture;
	const shot = CaptureSchema.parse(key ? run.outputs[key] : undefined)
		.screenshots[index];
	if (!shot || shot.imageSha256 !== expected)
		throw new Error(
			"Screenshot reference is not in this run's accepted capture inventory",
		);
	const evidence = join(directory, "evidence", run.id);
	let candidate = resolve(evidence, shot.path);
	const name = relative(resolve(evidence), candidate);
	if (
		!name ||
		name === ".." ||
		name.startsWith(`..${sep}`) ||
		isAbsolute(name)
	) {
		const marker = `${sep}${join("factory", "evidence", run.id)}${sep}`;
		const offset = candidate.lastIndexOf(marker);
		if (!isAbsolute(shot.path) || offset < 0)
			throw new Error(
				"Screenshot must be inside this run's evidence directory",
			);
		candidate = resolve(evidence, candidate.slice(offset + marker.length));
	}
	const path = evidenceFile(candidate, evidence, 10 * 1024 * 1024);
	stamps?.push(() => {
		try {
			return evidenceFile(candidate, evidence, 10 * 1024 * 1024) === path;
		} catch {
			return false;
		}
	});
	return (await verifyBytes(path, expected, 10 * 1024 * 1024, true, stamps))!;
}
/** The display cannot invent filesystem paths or borrow assets from another run. */
export async function prepareViewAssetCheck(
	directory: string,
	run: FactoryRun,
	view: ResolvedView,
) {
	const evidence = join(directory, "evidence", run.id);
	const stamps: (() => boolean)[] = [];
	const protectedFile = (candidate: string, limit: number) => {
		const path = evidenceFile(candidate, evidence, limit);
		stamps.push(() => {
			try {
				return evidenceFile(candidate, evidence, limit) === path;
			} catch {
				return false;
			}
		});
		return path;
	};
	for (const component of view.components) {
		if (component.type === "screenshots") {
			for (const ref of component.data.items) {
				await readViewScreenshot(directory, run, ref.index, ref.sha256, stamps);
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
				protectedFile(video.path, videoLimits.bytes),
				validation.sha256,
				videoLimits.bytes,
				false,
				stamps,
			);
			for (const asset of [validation.poster, validation.captions])
				if (asset)
					await verifyBytes(
						protectedFile(asset.path, 10 * 1024 * 1024),
						asset.sha256,
						10 * 1024 * 1024,
						false,
						stamps,
					);
		}
	}
	return () => stamps.every((unchanged) => unchanged());
}

/** Shared bounded verification for save/render/answer paths without a dispatch handoff. */
export async function verifyViewAssets(
	directory: string,
	run: FactoryRun,
	view: ResolvedView,
) {
	await prepareViewAssetCheck(directory, run, view);
}
