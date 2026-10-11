// Source transport only: reconstructed bytes still require semantic source intake.
import { createHash } from "node:crypto";
import {
	closeSync,
	constants,
	fstatSync,
	lstatSync,
	openSync,
	readSync,
	rmSync,
	writeSync,
} from "node:fs";
import { join } from "node:path";
import { ARCHIVE_LIMITS } from "./bounded-archive.mjs";

export const GITHUB_ASSET_LIMIT = 2 * 1024 ** 3; // Exclusive provider limit.
export const SOURCE_CHUNK_BYTES = 1024 ** 3;
const check = (condition, message) => {
	if (!condition) throw new Error(message);
};
const chunkName = (order) =>
	`source-rebuild.tar.gz.part${String(order).padStart(4, "0")}`;
const validRecord = (record) =>
	record &&
	typeof record.sha256 === "string" &&
	/^[a-f0-9]{64}$/.test(record.sha256) &&
	Number.isSafeInteger(record.size) &&
	record.size > 0;

function validateTransportBounds(source, chunkSize, count) {
	check(
		Number.isSafeInteger(chunkSize) &&
			chunkSize > 0 &&
			chunkSize <= SOURCE_CHUNK_BYTES &&
			source.size <= ARCHIVE_LIMITS.maxCompressedBytes &&
			count === Math.ceil(source.size / chunkSize) &&
			count <= 1000,
		"Invalid source chunk transport/count/bounds",
	);
}

// One policy for manifest inventory, splitting and reconstruction. No filename
// sorting can substitute for the explicitly inventoried order.
export function sourceTransportRecords(source, transport) {
	check(
		source?.file === "source-rebuild.tar.gz" && validRecord(source),
		"Invalid source archive record",
	);
	if (transport === undefined) return [source];
	check(
		transport?.schemaVersion === 1 &&
			transport.type === "chunks" &&
			Array.isArray(transport.chunks),
		"Invalid source chunk transport/count/bounds",
	);
	validateTransportBounds(source, transport.chunkSize, transport.chunks.length);
	for (const [index, record] of transport.chunks.entries()) {
		check(
			validRecord(record) &&
				record.order === index + 1 &&
				record.file === chunkName(index + 1) &&
				record.size ===
					Math.min(
						transport.chunkSize,
						source.size - index * transport.chunkSize,
					),
			"Invalid source chunk order/filename/size/hash",
		);
	}
	return transport.chunks.map(({ file, size, sha256 }) => ({
		file,
		size,
		sha256,
	}));
}

function regularInput(path, size) {
	const fd = openSync(
		path,
		constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
	);
	try {
		const stat = fstatSync(fd);
		check(
			stat.isFile() && stat.nlink === 1 && stat.size === size,
			"Source transport input must be an exact regular file",
		);
		return fd;
	} catch (error) {
		closeSync(fd);
		throw error;
	}
}
function directory(path) {
	check(
		lstatSync(path).isDirectory(),
		"Source transport directory must not be a link",
	);
}
function writeAll(fd, bytes) {
	let offset = 0;
	while (offset < bytes.length) {
		const written = writeSync(fd, bytes, offset, bytes.length - offset);
		check(written > 0, "Source transport write made no progress");
		offset += written;
	}
}
function transfer(input, output, size, archiveHash, buffer) {
	const hash = createHash("sha256");
	let total = 0;
	while (total < size) {
		const count = readSync(
			input,
			buffer,
			0,
			Math.min(buffer.length, size - total),
			null,
		);
		check(count > 0, "Source transport input truncated");
		const bytes = buffer.subarray(0, count);
		hash.update(bytes);
		archiveHash.update(bytes);
		writeAll(output, bytes);
		total += count;
	}
	return hash.digest("hex");
}

// Output directories belong to the caller. Every created file is exclusive;
// failure removes only files created by this invocation, never retained inputs.
export function splitSourceArchive(
	path,
	source,
	outputDirectory,
	chunkSize = SOURCE_CHUNK_BYTES,
) {
	const transport = { schemaVersion: 1, type: "chunks", chunkSize, chunks: [] };
	// Validate bounds before allocating or opening output.
	sourceTransportRecords(source);
	validateTransportBounds(
		source,
		chunkSize,
		Math.ceil(source.size / chunkSize),
	);
	directory(outputDirectory);
	const input = regularInput(path, source.size),
		created = [];
	const archiveHash = createHash("sha256"),
		buffer = Buffer.alloc(1024 ** 2);
	try {
		for (let remaining = source.size, order = 1; remaining > 0; order++) {
			const file = chunkName(order),
				size = Math.min(chunkSize, remaining);
			const destination = join(outputDirectory, file);
			const output = openSync(destination, "wx", 0o600);
			created.push(destination);
			let sha256;
			try {
				sha256 = transfer(input, output, size, archiveHash, buffer);
			} finally {
				closeSync(output);
			}
			transport.chunks.push({ order, file, size, sha256 });
			remaining -= size;
		}
		check(
			readSync(input, buffer, 0, 1, null) === 0 &&
				fstatSync(input).size === source.size &&
				archiveHash.digest("hex") === source.sha256,
			"Source archive changed during transport splitting",
		);
		sourceTransportRecords(source, transport);
		return transport;
	} catch (error) {
		for (const file of created) rmSync(file, { force: true });
		throw error;
	} finally {
		closeSync(input);
	}
}

export function reconstructSourceArchive(
	inputDirectory,
	source,
	transport,
	ownedOutputDirectory,
) {
	const records = sourceTransportRecords(source, transport);
	directory(inputDirectory);
	directory(ownedOutputDirectory);
	const destination = join(ownedOutputDirectory, source.file);
	const output = openSync(destination, "wx", 0o600);
	const archiveHash = createHash("sha256"),
		buffer = Buffer.alloc(1024 ** 2);
	let total = 0,
		success = false;
	try {
		for (const record of records) {
			const input = regularInput(
				join(inputDirectory, record.file),
				record.size,
			);
			try {
				check(
					transfer(input, output, record.size, archiveHash, buffer) ===
						record.sha256 &&
						readSync(input, buffer, 0, 1, null) === 0 &&
						fstatSync(input).size === record.size,
					`Source transport chunk changed: ${record.file}`,
				);
			} finally {
				closeSync(input);
			}
			total += record.size;
		}
		check(
			total === source.size && archiveHash.digest("hex") === source.sha256,
			"Reconstructed source archive integrity failure",
		);
		success = true;
		return destination;
	} finally {
		closeSync(output);
		if (!success) rmSync(destination);
	}
}
