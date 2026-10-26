import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
	createReadStream,
	existsSync,
	lstatSync,
	readdirSync,
	realpathSync,
	statSync,
	unlinkSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

import type { FactoryRun } from "./WorkflowRuntime.js";

export const VIDEO_CONTRACT = "video-v1" as const;
export const videoLimits = {
	clips: 3,
	seconds: 120,
	bytes: 50 * 1024 * 1024,
	runBytes: 512 * 1024 * 1024,
	temporaryMs: 24 * 3600000,
	terminalMs: 30 * 24 * 3600000,
};
const text = z.string().trim().min(1);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const id = text.regex(/^[a-zA-Z0-9_-]{1,80}$/);
export const VideoTaskSchema = z.object({
	id,
	title: text.max(120),
	storyIds: z.array(text).min(1),
	criterionIds: z.array(text).min(1),
	rationale: text,
	steps: z.array(text).min(1),
	dependencies: z.array(text).min(1),
	environment: text,
	targetSeconds: z.number().min(1).max(videoLimits.seconds),
	required: z.boolean().default(false),
	changed: z.boolean().default(true),
});
export const VideoScopeFields = {
	videoContract: z.literal(VIDEO_CONTRACT).optional(),
	videoTasks: z.array(VideoTaskSchema).max(videoLimits.clips).optional(),
	videoReason: text.optional(),
};
export const VideoReceiptSchema = z.object({
	taskId: id,
	sha256: hash,
	inspectedPlayback: z.literal(true),
});
const asset = z.object({ path: text, sha256: hash });
export const VideoSchema = z.object({
	taskId: id,
	path: text,
	caption: text.max(600),
	recorder: text,
	receipt: z.object({ executed: z.literal(true), action: text, details: text }),
	storyIds: z.array(text).min(1),
	criterionIds: z.array(text).min(1),
	viewport: z.object({
		width: z.number().int().min(1).max(7680),
		height: z.number().int().min(1).max(4320),
	}),
	transcript: text.max(16000),
	environment: text,
	posterPath: text,
	captionsPath: text.optional(),
	reused: z.boolean().optional(),
	validation: z
		.object({
			mime: z.enum(["video/mp4", "video/webm"]),
			codecs: z.array(text),
			duration: z.number().positive().max(videoLimits.seconds),
			bytes: z.number().int().positive().max(videoLimits.bytes),
			sha256: hash,
			captureRevision: text,
			validatedRevision: text,
			dirty: z.boolean(),
			taskDigest: hash,
			scopeDigest: hash,
			dependencyFingerprint: hash.optional(),
			poster: asset,
			captions: asset.optional(),
		})
		.optional(),
});
export const VideoCaptureFields = {
	videoContract: z.literal(VIDEO_CONTRACT).optional(),
	videos: z.array(VideoSchema).max(videoLimits.clips).optional(),
	videoUnavailable: z
		.array(
			z.object({
				taskId: id,
				reason: text,
				cause: z.enum(["tooling", "export", "product"]),
			}),
		)
		.max(videoLimits.clips)
		.optional(),
	videoDependencyManifests: z
		.record(hash, z.record(z.string(), z.string()))
		.optional(),
};
export type Video = z.infer<typeof VideoSchema>;
export type VideoTask = z.infer<typeof VideoTaskSchema>;
export type VideoScope = {
	videoContract?: "video-v1";
	videoTasks?: VideoTask[];
	videoReason?: string;
	nonVisualFiles?: string[];
	stories: { id: string; criteria: { id: string }[] }[];
};
export type VideoCapture = {
	videos?: Video[];
	videoContract?: "video-v1";
	videoUnavailable?: z.infer<typeof VideoCaptureFields.videoUnavailable>;
	videoDependencyManifests?: Record<string, Record<string, string>>;
};

export function videoScopeIssues(scope: VideoScope): string[] {
	if (!scope.videoContract) return [];
	const tasks = scope.videoTasks ?? [],
		issues: string[] = [];
	if (!tasks.length && !scope.videoReason)
		issues.push("No demonstrations selected requires a concrete videoReason");
	if (new Set(tasks.map((t) => t.id)).size !== tasks.length)
		issues.push("Video task IDs must be unique");
	for (const t of tasks) {
		if (
			new Set(t.storyIds).size !== t.storyIds.length ||
			new Set(t.criterionIds).size !== t.criterionIds.length ||
			t.storyIds.some((id) => !scope.stories.some((s) => s.id === id)) ||
			t.criterionIds.some(
				(id) =>
					!scope.stories.some(
						(s) =>
							t.storyIds.includes(s.id) && s.criteria.some((c) => c.id === id),
					),
			)
		)
			issues.push(
				`Unknown or duplicate video story/criterion reference: ${t.id}`,
			);
	}
	return issues;
}

/** Resolve every asset against a canonical evidence root. Never accept arbitrary paths. */
export function evidenceFile(
	path: string,
	directory: string,
	maxBytes = videoLimits.bytes,
	allowEmpty = false,
): string {
	if (!isAbsolute(path)) throw new Error("Video assets require absolute paths");
	if (lstatSync(directory).isSymbolicLink())
		throw new Error("Run evidence directory cannot be a symlink");
	const root = realpathSync(directory),
		real = realpathSync(path),
		name = relative(root, real),
		stat = statSync(real);
	if (
		!name ||
		name === ".." ||
		name.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
		isAbsolute(name) ||
		!stat.isFile()
	)
		throw new Error(
			"Video asset must be a file inside this run's evidence directory",
		);
	if ((!allowEmpty && !stat.size) || stat.size > maxBytes)
		throw new Error("Video asset is empty or exceeds its size limit");
	return real;
}
export async function fileHash(path: string): Promise<string> {
	const digest = createHash("sha256");
	for await (const chunk of createReadStream(path)) digest.update(chunk);
	return digest.digest("hex");
}
const exec = promisify(execFile);
export async function probeVideo(path: string, signal?: AbortSignal) {
	const { stdout } = await exec(
		"ffprobe",
		[
			"-v",
			"error",
			"-protocol_whitelist",
			"file,pipe",
			"-show_format",
			"-show_streams",
			"-of",
			"json",
			path,
		],
		{ timeout: 15000, maxBuffer: 1024 * 1024, signal },
	);
	const probe = JSON.parse(stdout),
		streams = probe.streams ?? [],
		videos = streams.filter(
			(s: { codec_type: string }) => s.codec_type === "video",
		);
	const duration = Number(probe.format?.duration);
	const mp4 = String(probe.format?.format_name).split(",").includes("mp4"),
		webm = String(probe.format?.format_name).split(",").includes("webm");
	const codecs = streams.map((s: { codec_name: string }) => s.codec_name);
	if (
		(!mp4 && !webm) ||
		videos.length !== 1 ||
		!Number.isFinite(duration) ||
		duration <= 0 ||
		duration > videoLimits.seconds ||
		!Number.isFinite(videos[0].width) ||
		videos[0].width <= 0 ||
		!Number.isFinite(videos[0].height) ||
		videos[0].height <= 0 ||
		streams.some(
			(s: { codec_type: string; codec_name: string; pix_fmt: string }) =>
				s.codec_type === "video"
					? mp4
						? s.codec_name !== "h264" ||
							!["yuv420p", "yuvj420p"].includes(s.pix_fmt)
						: !["vp8", "vp9", "av1"].includes(s.codec_name)
					: s.codec_type !== "audio" ||
						!(mp4 ? ["aac", "mp3"] : ["opus", "vorbis"]).includes(s.codec_name),
		)
	)
		throw new Error("Unsupported container/codecs or invalid video duration");
	// Probe headers alone can accept truncated files. Decode all frames with a bounded process.
	await exec(
		"ffmpeg",
		[
			"-nostdin",
			"-v",
			"error",
			"-xerror",
			"-protocol_whitelist",
			"file,pipe",
			"-i",
			path,
			"-f",
			"null",
			"-",
		],
		{ timeout: 30000, maxBuffer: 1024 * 1024, signal },
	);
	return {
		mime: mp4 ? ("video/mp4" as const) : ("video/webm" as const),
		codecs,
		duration,
		audio: streams.some(
			(s: { codec_type: string }) => s.codec_type === "audio",
		),
	};
}
export async function captionAsset(path: string, directory: string) {
	const real = evidenceFile(path, directory, 1024 * 1024),
		content = await readFile(real, "utf8");
	const blocks = content
		.replace(/^\uFEFF/, "")
		.replace(/\r\n?/g, "\n")
		.split(/\n(?:[ \t]*\n)+/);
	const header = blocks.shift() ?? "";
	if (
		!/^WEBVTT(?:[ \t][^\n]*)?(?:\n|$)/.test(header) ||
		header.includes("-->") ||
		/<script|<iframe/i.test(content)
	)
		throw new Error("Captions must be a bounded WebVTT track with timed cues");
	let count = 0,
		previousStart = -1;
	for (const block of blocks) {
		if (!block.trim() || /^NOTE(?:[ \t\n]|$)/.test(block)) continue;
		if (/^(?:STYLE|REGION)[ \t]*(?:\n|$)/.test(block)) {
			if (count || block.includes("-->"))
				throw new Error("Caption styles and regions must precede timed cues");
			continue;
		}
		const lines = block.split("\n"),
			timingIndex = (lines[0] ?? "").includes("-->") ? 0 : 1,
			timingLine = lines[timingIndex] ?? "",
			timing = /^(\S+)[ \t]+-->[ \t]+(\S+)(?:[ \t]+[^\n]*)?$/.exec(timingLine);
		const start = captionTimestamp(timing?.[1] ?? ""),
			end = captionTimestamp(timing?.[2] ?? "");
		if (
			start === undefined ||
			end === undefined ||
			timingLine.split("-->").length !== 2 ||
			end <= start ||
			start < previousStart ||
			!lines
				.slice(timingIndex + 1)
				.join("\n")
				.trim() ||
			lines.slice(timingIndex + 1).some((line) => line.includes("-->"))
		)
			throw new Error(
				`Captions require valid timed cues: cue ${count + 1} must have valid timestamps, end after start, ordered starts and text`,
			);
		previousStart = start;
		count++;
	}
	if (!count) throw new Error("Captions require at least one valid timed cue");
	return { path: real, sha256: await fileHash(real) };
}

/** WebVTT permits overlapping cues and two-or-more-digit hours, but not overflowing minutes/seconds. */
function captionTimestamp(value: string): number | undefined {
	const match = /^(?:(\d{2,}):)?([0-5]\d):([0-5]\d)\.(\d{3})$/.exec(value);
	if (!match) return undefined;
	const milliseconds =
		((Number(match[1] ?? 0) * 60 + Number(match[2])) * 60 + Number(match[3])) *
			1000 +
		Number(match[4]);
	return Number.isSafeInteger(milliseconds) ? milliseconds : undefined;
}

/** Only linked stories affect reuse; include their fixtures, actions and criteria. */

export function byteRange(
	header: string | undefined,
	size: number,
): { start: number; end: number } | undefined {
	if (header === undefined) return;
	const m = /^bytes=(\d*)-(\d*)$/.exec(header);
	if (!m || (!m[1] && !m[2])) throw new Error("Invalid byte range");
	const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
	const end = m[1]
		? m[2]
			? Math.min(Number(m[2]), size - 1)
			: size - 1
		: size - 1;
	if (
		!Number.isSafeInteger(start) ||
		!Number.isSafeInteger(end) ||
		start < 0 ||
		start >= size ||
		end < start ||
		(!m[1] && Number(m[2]) <= 0)
	)
		throw new Error("Unsatisfiable byte range");
	return { start, end };
}

/** Startup maintenance is bounded; active and waiting runs are never pruned. */
export function cleanupVideoEvidence(
	root: string,
	runs: Iterable<FactoryRun>,
	now = Date.now(),
	assetsFor?: (run: FactoryRun) => string[] | undefined,
): void {
	let budget = 200;
	for (const run of runs) {
		if (
			!budget ||
			!["completed", "stopped"].includes(run.status) ||
			!/^[a-zA-Z0-9_-]+$/.test(run.id)
		)
			continue;
		const directory = join(root, run.id);
		if (!existsSync(directory) || lstatSync(directory).isSymbolicLink())
			continue;
		const terminalExpired =
			now - Date.parse(run.updatedAt) > videoLimits.terminalMs;
		const referenced = new Set(
			assetsFor?.(run) ?? [
				...Object.values(run.outputs).flatMap(videoAssetPaths),
				...run.history.flatMap((entry) => videoAssetPaths(entry.output)),
			],
		);
		const assets = terminalExpired ? [...referenced] : [];
		for (const name of readdirSync(directory).slice(0, 200))
			if (/^video-temp-[\w.-]+\.(mp4|webm|vtt|png|jpe?g)$/.test(name)) {
				const path = join(directory, name);
				let stat: ReturnType<typeof lstatSync>;
				try {
					stat = lstatSync(path);
				} catch {
					continue;
				}
				if (!stat.isFile()) continue;
				if (
					now - stat.mtimeMs > videoLimits.temporaryMs &&
					!referenced.has(path)
				)
					assets.push(path);
			}
		for (const path of new Set(assets)) {
			if (!budget) return;
			try {
				if (lstatSync(path).isSymbolicLink()) continue;
				unlinkSync(
					evidenceFile(path, directory, Number.MAX_SAFE_INTEGER, true),
				);
				budget--;
			} catch {
				/* Missing, symlink escape or already expired: retain metadata. */
			}
		}
	}
}

export function videoAssetPaths(output: unknown): string[] {
	if (!output || typeof output !== "object") return [];
	const videos = (output as VideoCapture).videos;
	if (!Array.isArray(videos)) return [];
	return videos.flatMap((video) =>
		video && typeof video === "object"
			? [video.path, video.posterPath, video.captionsPath].filter(
					(path): path is string => typeof path === "string",
				)
			: [],
	);
}

/** Bound scanning as well as storage; do not follow directory symlinks. */
