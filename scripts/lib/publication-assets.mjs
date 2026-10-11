// Publication expectations come from checked bytes, never a later directory hash.
import { createHash } from "node:crypto";
import {
	closeSync,
	constants,
	createReadStream,
	fchmodSync,
	fstatSync,
	lstatSync,
	mkdtempSync,
	openSync,
	readdirSync,
	readSync,
	rmSync,
	writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
	requireValue,
	sha256,
	validateReleaseManifest,
} from "./binary-release.mjs";
import { GITHUB_ASSET_LIMIT } from "./source-transport.mjs";

function regularInput(path, record) {
	const fd = openSync(
		path,
		constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
	);
	try {
		checkInput(fstatSync(fd), record);
		return fd;
	} catch (error) {
		closeSync(fd);
		throw error;
	}
}
function checkInput(stat, record) {
	requireValue(
		stat.isFile() &&
			stat.nlink === 1 &&
			stat.size === record.size &&
			!(stat.mode & 0o7022),
		`Unsafe or changed publication asset: ${record.file}`,
	);
}
function checkNames(directory, records) {
	requireValue(
		lstatSync(directory).isDirectory(),
		"Publication assets directory must not be a link",
	);
	requireValue(
		JSON.stringify(readdirSync(directory).sort()) ===
			JSON.stringify(records.map((r) => r.file)),
		"Publication asset names differ from manifest snapshot",
	);
}

export function snapshotPublicationAssets(
	directory,
	manifestBytes,
	sidecars = {},
) {
	const manifest = validateReleaseManifest(JSON.parse(manifestBytes));
	requireValue(
		manifest.schemaVersion === 2,
		"Publication snapshot requires schema-2 inventory",
	);
	const buffers = { "release.json": manifestBytes, ...sidecars };
	requireValue(
		(Object.keys(sidecars).length === 0 ||
			Object.keys(sidecars).length === 2) &&
			Object.entries(sidecars).every(
				([file, bytes]) =>
					["release.json.sig", "release.json.key-id"].includes(file) &&
					Buffer.isBuffer(bytes),
			),
		"Unexpected publication sidecar",
	);
	const records = Object.freeze(
		[
			...manifest.assets.map(({ file, sha256, size }) => ({
				file,
				sha256,
				size,
			})),
			...Object.entries(buffers).map(([file, bytes]) => ({
				file,
				sha256: sha256(bytes),
				size: bytes.length,
			})),
		]
			.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
			.map(Object.freeze),
	);
	requireValue(
		records.length <= 1000,
		"Release exceeds GitHub asset count limit",
	);
	for (const record of records)
		requireValue(
			record.size < GITHUB_ASSET_LIMIT,
			`Release asset exceeds GitHub transport limit: ${record.file}`,
		);
	checkNames(directory, records);
	const snapshot = mkdtempSync(join(tmpdir(), "factory-publication-snapshot-"));
	try {
		const buffer = Buffer.alloc(1024 ** 2);
		for (const record of records) {
			const input = regularInput(join(directory, record.file), record);
			try {
				const before = fstatSync(input);
				const output = openSync(join(snapshot, record.file), "wx", 0o600);
				try {
					const hash = createHash("sha256");
					for (let remaining = record.size; remaining > 0; ) {
						const count = readSync(
							input,
							buffer,
							0,
							Math.min(buffer.length, remaining),
							null,
						);
						requireValue(
							count > 0,
							`Publication asset truncated: ${record.file}`,
						);
						hash.update(buffer.subarray(0, count));
						for (let offset = 0; offset < count; )
							offset += writeSync(output, buffer, offset, count - offset);
						remaining -= count;
					}
					checkInput(fstatSync(input), record);
					requireValue(
						fstatSync(input).mode === before.mode &&
							readSync(input, buffer, 0, 1, null) === 0 &&
							hash.digest("hex") === record.sha256,
						`Publication asset differs from manifest snapshot: ${record.file}`,
					);
					fchmodSync(output, 0o400);
				} finally {
					closeSync(output);
				}
			} finally {
				closeSync(input);
			}
		}
		checkNames(directory, records);
		return {
			records,
			directory: snapshot,
			cleanup: () => rmSync(snapshot, { recursive: true, force: true }),
		};
	} catch (error) {
		rmSync(snapshot, { recursive: true, force: true });
		throw error;
	}
}

// A private snapshot protects against source-directory changes. Hashing the
// actual upload stream also catches mutation of staging, including after open.
export function verifiedPublicationStream(directory, record) {
	const fd = regularInput(join(directory, record.file), record);
	const before = fstatSync(fd);
	const input = createReadStream(join(directory, record.file), {
		fd,
		autoClose: false,
	});
	const hash = createHash("sha256");
	let size = 0,
		integrityError;
	const changed = () => {
		integrityError = new Error(
			`Publication upload bytes differ from manifest snapshot: ${record.file}`,
		);
		return integrityError;
	};
	const body = new Transform({
		transform(bytes, _encoding, callback) {
			size += bytes.length;
			if (size > record.size) return callback(changed());
			hash.update(bytes);
			callback(null, bytes);
		},
		flush(callback) {
			try {
				checkInput(fstatSync(fd), record);
				requireValue(
					fstatSync(fd).mode === before.mode,
					`Publication upload mode changed: ${record.file}`,
				);
				callback(
					size === record.size && hash.digest("hex") === record.sha256
						? null
						: changed(),
				);
			} catch (error) {
				integrityError = error;
				callback(error);
			}
		},
	});
	const completed = pipeline(input, body).finally(() => closeSync(fd));
	// Transport may fail before consuming the body; its catch must destroy it.
	completed.catch(() => {});
	return { body, completed, integrityError: () => integrityError };
}
