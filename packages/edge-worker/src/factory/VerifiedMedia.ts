import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { digest } from "./Delivery.js";
import { freshNodeOutput } from "./NodeGuarantees.js";
import { stepForRun } from "./ToolBindings.js";
import { evidenceFile, probeVideo, videoLimits } from "./Video.js";
import type { ExecutionContext, FactoryRun } from "./WorkflowRuntime.js";

/** Verified bytes, independent of any recipe's acceptance or presentation policy. */
export interface VerifiedMedia {
	id: string;
	index: number;
	kind: "image" | "video";
	path: string;
	sha256: string;
	bytes: number;
	stepKey: string;
	outputDigest: string;
	video?: Awaited<ReturnType<typeof probeVideo>> & {
		poster: { path: string; sha256: string };
		captions?: { path: string; sha256: string };
		transcript: string;
	};
}
export type MediaCandidate = Omit<
	VerifiedMedia,
	"id" | "index" | "stepKey" | "outputDigest"
>;
export const mediaHash = (path: string) =>
	createHash("sha256").update(readFileSync(path)).digest("hex");

export function retainVerifiedMedia(
	context: ExecutionContext,
	output: unknown,
	candidates: MediaCandidate[],
) {
	if (!candidates.length) return;
	if (
		candidates.filter((asset) => asset.kind === "video").length >
		videoLimits.clips
	)
		throw new Error("Too many video clips in one output");
	context.run.verifiedMedia ??= [];
	const inventory = context.run.verifiedMedia;
	const stepKey = context.stepKey ?? context.step.id,
		outputDigest = digest(output);
	// This output replaces the previous capture for its step. Historical entries
	// retain stable URLs/indices, but do not consume the active evidence budget.
	const active = new Map(
		acceptedMedia(context.run)
			.filter((asset) => asset.stepKey !== stepKey)
			.map((asset) => [asset.id, asset]),
	);
	const additions = new Map<string, VerifiedMedia>();
	for (const candidate of candidates) {
		const id = `asset-${digest({ stepKey, outputDigest, path: candidate.path, sha256: candidate.sha256 }).slice(0, 32)}`;
		const asset = inventory.find((asset) => asset.id === id) ??
			additions.get(id) ?? {
				...candidate,
				id,
				index: inventory.length + additions.size,
				stepKey,
				outputDigest,
			};
		active.set(id, asset);
		if (!inventory.some((asset) => asset.id === id)) additions.set(id, asset);
	}
	if (
		[...active.values()].reduce((sum, asset) => sum + asset.bytes, 0) >
		videoLimits.runBytes
	)
		throw new Error("Verified media exceeds the run byte budget");
	if (active.size > 2048)
		throw new Error("Verified media inventory limit reached");
	inventory.push(...additions.values());
}

/** Rejected output candidates never enter the accepted inventory. */
export function acceptedMedia(run: FactoryRun): VerifiedMedia[] {
	const latest = new Map(run.history.map((receipt) => [receipt.step, receipt]));
	return (run.verifiedMedia ?? []).filter((asset) => {
		const receipt = latest.get(asset.stepKey);
		return (
			!!receipt?.guarantee && digest(receipt.output) === asset.outputDigest
		);
	});
}
export async function mediaCurrent(run: FactoryRun, asset: VerifiedMedia) {
	const step = stepForRun(run, asset.stepKey);
	if (!step) return false;
	return freshNodeOutput(
		{
			run,
			step,
			stepKey: asset.stepKey,
			outputs: run.outputs,
			input: {},
			signal: new AbortController().signal,
			log: () => {},
			evidenceDir: "",
		} as ExecutionContext,
		`/${asset.stepKey}`,
	);
}

/** The existing player/streamer can consume generic verified video receipts too. */
export function verifiedVideo(run: FactoryRun, id: string) {
	const asset = acceptedMedia(run).find(
		(a) => a.kind === "video" && a.id === id,
	);
	if (!asset?.video) return undefined;
	return {
		taskId: asset.id,
		path: asset.path,
		transcript: asset.video.transcript,
		validation: {
			...asset.video,
			sha256: asset.sha256,
			dirty: false,
			validatedRevision: "",
			bytes: asset.bytes,
		},
		asset,
	};
}

export async function inspectMedia(
	context: ExecutionContext,
	value: unknown,
	kind: "image" | "video",
): Promise<MediaCandidate> {
	const metadata =
		typeof value === "object" && value !== null
			? (value as Record<string, unknown>)
			: {};
	const supplied = typeof value === "string" ? value : metadata.path;
	if (typeof supplied !== "string")
		throw new Error("Media requires a path string or {path,...} object");
	const path = evidenceFile(
		supplied,
		context.evidenceDir,
		kind === "video" ? videoLimits.bytes : 10 * 1024 * 1024,
	);
	const sha256 = mediaHash(path),
		bytesLength = statSync(path).size;
	if (kind === "image") {
		const bytes = readFileSync(path);
		if (
			!bytes
				.subarray(0, 8)
				.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
			!(bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
		)
			throw new Error("Image is not PNG or JPEG");
		return { kind, path, sha256, bytes: bytesLength };
	}
	const probe = await probeVideo(path, context.signal);
	if (typeof value === "string")
		return { kind, path, sha256, bytes: bytesLength };
	if (
		typeof metadata.posterPath !== "string" ||
		typeof metadata.transcript !== "string" ||
		!metadata.transcript.trim()
	)
		throw new Error("Video objects need a real posterPath and transcript");
	const poster = await inspectMedia(context, metadata.posterPath, "image");
	let captions: { path: string; sha256: string } | undefined;
	if (metadata.captionsPath !== undefined) {
		const { captionAsset } = await import("./Video.js");
		captions = await captionAsset(
			String(metadata.captionsPath),
			context.evidenceDir,
		);
	}
	if (probe.audio && !captions)
		throw new Error("Video with audio requires timed WebVTT captions");
	return {
		kind,
		path,
		sha256,
		bytes: bytesLength,
		video: {
			...probe,
			poster: { path: poster.path, sha256: poster.sha256 },
			captions,
			transcript: metadata.transcript,
		},
	};
}
