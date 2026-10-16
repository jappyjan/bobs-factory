import { createHash, randomUUID } from "node:crypto";
import {
	closeSync,
	constants,
	existsSync,
	lstatSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";

import { launchAssetLimits } from "./LaunchAssetLimits.js";

export { launchAssetLimits } from "./LaunchAssetLimits.js";
export const UploadIdSchema = z.string().uuid();
export const AttachmentSelectionSchema = z.record(
	z.string(),
	z.array(UploadIdSchema).max(launchAssetLimits.count),
);
export const UploadContextSchema = z.object({
	draft: UploadIdSchema,
	workflow: z.string().min(1),
	repositoryId: z.string().min(1),
	repositoryIds: z.array(z.string().min(1)).min(1).max(50),
});
export const UploadMetadataSchema = UploadContextSchema.extend({
	field: z
		.string()
		.regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/)
		.max(80),
	name: z.string().min(1).max(255),
	mime: z.string().max(255).default(""),
});
export type UploadContext = z.infer<typeof UploadContextSchema>;
export interface LaunchAsset {
	id: string;
	field: string;
	name: string;
	mime: string;
	size: number;
	sha256: string;
	path: string;
}
export type LaunchAttachments = Record<string, LaunchAsset[]>;
interface Draft {
	context: UploadContext;
	fingerprint: string;
	createdAt: number;
	assets: Omit<LaunchAsset, "path">[];
}
const hash = (bytes: Buffer | string) =>
	createHash("sha256").update(bytes).digest("hex");
const scope = (context: UploadContext) =>
	JSON.stringify({
		...context,
		repositoryIds: [...context.repositoryIds].sort(),
	});

/** Private, bounded binary storage. Names are metadata; only generated IDs form paths.
 * Synchronous admission/rename keeps claims atomic within the instance. A claimed
 * directory survives a crash before run setup and is never reclaimed as a draft.
 */
export class LaunchAssetStore {
	readonly directory: string;
	constructor(factoryDirectory: string) {
		this.directory = resolve(factoryDirectory, "launch-assets");
		for (const kind of ["drafts", "runs", "claimed"]) {
			const path = join(this.directory, kind);
			for (const parent of [this.directory, path])
				if (existsSync(parent) && lstatSync(parent).isSymbolicLink())
					throw new Error("Attachment storage contains a symbolic link");
			mkdirSync(path, { recursive: true, mode: 0o700 });
		}
		this.cleanup();
	}
	private folder(kind: "drafts" | "runs", id: string) {
		if (kind === "drafts") UploadIdSchema.parse(id);
		else if (!/^[\w-]+$/.test(id)) throw new Error("Invalid attachment run ID");
		const folder = join(this.directory, kind, id);
		// Reject links in every existing parent, including the private storage root.
		for (const path of [this.directory, join(this.directory, kind), folder]) {
			if (existsSync(path) && lstatSync(path).isSymbolicLink())
				throw new Error("Attachment storage contains a symbolic link");
		}
		return folder;
	}
	private read(folder: string): Draft {
		const path = join(folder, "manifest.json");
		if (lstatSync(path).isSymbolicLink())
			throw new Error("Invalid attachment manifest");
		return JSON.parse(readFileSync(path, "utf8"));
	}
	private save(folder: string, draft: Draft) {
		const temporary = join(folder, `${randomUUID()}.tmp`);
		try {
			writeFileSync(temporary, JSON.stringify(draft), {
				flag: "wx",
				mode: 0o600,
			});
			renameSync(temporary, join(folder, "manifest.json"));
		} finally {
			rmSync(temporary, { force: true });
		}
	}
	stage(
		metadata: z.infer<typeof UploadMetadataSchema>,
		fingerprint: string,
		bytes: Buffer,
	) {
		metadata = UploadMetadataSchema.parse(metadata);
		if (bytes.length > launchAssetLimits.fileBytes)
			throw new Error("Each file must be 25 MiB or smaller");
		if (existsSync(join(this.directory, "claimed", metadata.draft)))
			throw new Error("Uploads already submitted; start a new draft");
		const folder = this.folder("drafts", metadata.draft);
		const fresh = !existsSync(folder);
		const draft: Draft = !fresh
			? this.read(folder)
			: {
					context: {
						draft: metadata.draft,
						workflow: metadata.workflow,
						repositoryId: metadata.repositoryId,
						repositoryIds: metadata.repositoryIds,
					},
					fingerprint,
					createdAt: Date.now(),
					assets: [],
				};
		this.checkContext(draft, metadata, fingerprint);
		if (draft.assets.length >= launchAssetLimits.count)
			throw new Error("A launch supports up to 10 files; remove a file first");
		if (
			draft.assets.reduce((sum, asset) => sum + asset.size, bytes.length) >
			launchAssetLimits.totalBytes
		)
			throw new Error("Files must total 100 MiB or less; remove a file first");
		mkdirSync(folder, { recursive: true, mode: 0o700 });
		const asset = {
			id: randomUUID(),
			field: metadata.field,
			name: metadata.name,
			mime: metadata.mime,
			size: bytes.length,
			sha256: hash(bytes),
		};
		const path = join(folder, asset.id);
		try {
			writeFileSync(path, bytes, { flag: "wx", mode: 0o400 });
			this.save(folder, { ...draft, assets: [...draft.assets, asset] });
		} catch (error) {
			rmSync(path, { force: true });
			if (fresh) rmSync(folder, { recursive: true, force: true });
			throw error;
		}
		return asset;
	}
	private checkContext(
		draft: Draft,
		context: UploadContext,
		fingerprint: string,
	) {
		if (Date.now() - draft.createdAt >= 24 * 60 * 60 * 1000)
			throw new Error("Uploads expired; select the files again");
		if (
			scope(draft.context) !== scope(UploadContextSchema.parse(context)) ||
			draft.fingerprint !== fingerprint
		)
			throw new Error(
				"Upload draft belongs to a different project or workflow; select the files again",
			);
	}
	private bytes(folder: string, asset: Omit<LaunchAsset, "path">) {
		UploadIdSchema.parse(asset.id);
		const path = join(folder, asset.id);
		if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile())
			throw new Error(`Attachment unavailable: ${asset.name}`);
		const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
		try {
			const bytes = readFileSync(fd);
			if (bytes.length !== asset.size || hash(bytes) !== asset.sha256)
				throw new Error(
					`Attachment changed: ${asset.name}; restore the submitted file before retrying`,
				);
			return bytes;
		} finally {
			closeSync(fd);
		}
	}
	validate(
		context: UploadContext,
		fingerprint: string,
		selection: Record<string, string[]>,
	) {
		AttachmentSelectionSchema.parse(selection);
		const folder = this.folder("drafts", context.draft);
		if (!existsSync(folder))
			throw new Error(
				"Uploads are missing or already submitted; select the files again",
			);
		const draft = this.read(folder);
		this.checkContext(draft, context, fingerprint);
		const ids = Object.values(selection).flat();
		if (
			new Set(ids).size !== ids.length ||
			ids.length > launchAssetLimits.count
		)
			throw new Error("Invalid attachment selection");
		const assets = Object.entries(selection).flatMap(([field, ids]) =>
			ids.map((id) => {
				const asset = draft.assets.find(
					(asset) => asset.id === id && asset.field === field,
				);
				if (!asset)
					throw new Error(
						"Selected attachment does not belong to this field or draft",
					);
				this.bytes(folder, asset);
				return asset;
			}),
		);
		if (
			assets.reduce((sum, asset) => sum + asset.size, 0) >
			launchAssetLimits.totalBytes
		)
			throw new Error("Files must total 100 MiB or less");
		return { folder, draft, assets };
	}
	claim(
		runId: string,
		context: UploadContext,
		fingerprint: string,
		selection: Record<string, string[]>,
	): LaunchAttachments {
		const { folder, draft, assets } = this.validate(
			context,
			fingerprint,
			selection,
		);
		const destination = this.folder("runs", runId);
		if (existsSync(destination))
			throw new Error("Run attachments already claimed");
		// Keep a tombstone so a late upload cannot recreate a submitted draft.
		const marker = join(this.directory, "claimed", context.draft);
		writeFileSync(marker, runId, { flag: "wx", mode: 0o600 });
		try {
			renameSync(folder, destination);
		} catch (error) {
			rmSync(marker, { force: true });
			throw error;
		}
		this.save(destination, { ...draft, assets });
		for (const unused of draft.assets.filter(
			(a) => !assets.some((b) => a.id === b.id),
		))
			rmSync(join(destination, unused.id), { force: true });
		return this.manifest(destination, assets);
	}
	private manifest(
		folder: string,
		assets: Omit<LaunchAsset, "path">[],
	): LaunchAttachments {
		const result: LaunchAttachments = Object.create(null);
		for (const asset of assets) {
			result[asset.field] ??= [];
			result[asset.field]!.push({
				...asset,
				path: join(folder, asset.id),
			});
		}
		return result;
	}
	verify(runId: string, attachments: LaunchAttachments = {}) {
		const assets = Object.values(attachments).flat();
		if (!assets.length) return;
		const folder = this.folder("runs", runId);
		const retained = this.manifest(folder, this.read(folder).assets);
		if (JSON.stringify(retained) !== JSON.stringify(attachments))
			throw new Error("Submitted attachment manifest changed");
		for (const asset of assets) this.bytes(folder, asset);
	}
	copy(
		sourceRunId: string,
		runId: string,
		attachments: LaunchAttachments,
	): LaunchAttachments {
		this.verify(sourceRunId, attachments);
		const assets = Object.values(attachments).flat();
		if (!assets.length) return {};
		const folder = this.folder("runs", runId);
		mkdirSync(folder, { mode: 0o700 });
		try {
			for (const asset of assets)
				writeFileSync(
					join(folder, asset.id),
					this.bytes(this.folder("runs", sourceRunId), asset),
					{ flag: "wx", mode: 0o400 },
				);
			const draft = this.read(this.folder("runs", sourceRunId));
			this.save(folder, {
				...draft,
				assets: assets.map(({ path: _path, ...asset }) => asset),
			});
			return this.manifest(
				folder,
				assets.map(({ path: _path, ...asset }) => asset),
			);
		} catch (error) {
			rmSync(folder, { recursive: true, force: true });
			throw error;
		}
	}
	remove(draftId: string, id: string) {
		UploadIdSchema.parse(id);
		const folder = this.folder("drafts", draftId);
		const draft = this.read(folder);
		this.save(folder, {
			...draft,
			assets: draft.assets.filter((a) => a.id !== id),
		});
		rmSync(join(folder, id), { force: true });
	}
	cleanupRuns(retainedRunIds: Set<string>, now = Date.now()) {
		for (const id of readdirSync(join(this.directory, "runs"))) {
			if (retainedRunIds.has(id)) continue;
			const folder = this.folder("runs", id);
			if (now - lstatSync(folder).mtimeMs >= 24 * 60 * 60 * 1000)
				rmSync(folder, { recursive: true, force: true });
		}
	}
	cleanup(now = Date.now()) {
		for (const id of readdirSync(join(this.directory, "drafts"))) {
			const folder = this.folder("drafts", id);
			const createdAt = existsSync(join(folder, "manifest.json"))
				? this.read(folder).createdAt
				: lstatSync(folder).mtimeMs;
			if (now - createdAt >= 24 * 60 * 60 * 1000)
				rmSync(folder, { recursive: true, force: true });
		}
	}
}

export function attachmentDirectories(attachments: LaunchAttachments = {}) {
	return [
		...new Set(
			Object.values(attachments)
				.flat()
				.map((asset) => join(asset.path, "..")),
		),
	];
}

export const launchAssetFingerprint = (workflow: unknown) =>
	hash(JSON.stringify(workflow));
