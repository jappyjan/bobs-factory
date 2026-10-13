// Durable nightly bootstrap from an immutable, hash-pinned public GitHub release.
import {
	createWriteStream,
	mkdirSync,
	openSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
	fileRecord,
	REPOSITORY,
	requireValue,
	sha256File,
} from "./binary-release.mjs";
import { ARCHIVE_LIMITS, inspectArchive } from "./bounded-archive.mjs";
import { verifyPublishedRelease } from "./github-release.mjs";
import { recoverAcceptedMaterials } from "./nightly-source.mjs";
import { canonical, validateCandidate } from "./release-candidate.mjs";
import { validateSourceArchive } from "./release-material.mjs";
import {
	reconstructSourceArchive,
	sourceTransportRecords,
} from "./source-transport.mjs";

export async function downloadPinned(record, url, path, transport = fetch) {
	const u = new URL(url);
	requireValue(
		u.protocol === "https:" &&
			!u.username &&
			!u.password &&
			/^[a-f0-9]{64}$/.test(record.sha256) &&
			Number.isSafeInteger(record.size) &&
			record.size > 0 &&
			record.size <= ARCHIVE_LIMITS.maxCompressedBytes,
		"Invalid pinned baseline input",
	);
	// Never forward GitHub API credentials to public assets or their redirects.
	const response = await transport(u);
	requireValue(
		response.ok && response.body && new URL(response.url).protocol === "https:",
		"Baseline HTTPS download failed",
	);
	let count = 0;
	const fd = openSync(path, "wx", 0o600);
	try {
		await pipeline(
			Readable.fromWeb(response.body),
			new Transform({
				transform(chunk, _encoding, cb) {
					count += chunk.length;
					cb(
						count > record.size
							? new Error("Baseline size limit exceeded")
							: null,
						chunk,
					);
				},
			}),
			createWriteStream(path, { fd }),
		);
		requireValue(
			count === record.size && sha256File(path) === record.sha256,
			"Baseline input integrity mismatch",
		);
	} catch (error) {
		// Destination belongs to the caller's fresh temporary directory.
		rmSync(path, { force: true });
		throw error;
	}
}

export async function restoreNightlyBaseline(client, baseline, temporary) {
	validateCandidate(baseline.candidate);
	requireValue(
		baseline.schemaVersion === 1 &&
			typeof baseline.acceptedBy === "string" &&
			baseline.acceptedBy.trim() &&
			baseline.source?.file === "source-rebuild.tar.gz" &&
			baseline.receiptArchive?.file === "validation-receipts.tar.gz" &&
			/^[a-f0-9]{64}$/.test(baseline.publishedSource?.manifestSha256) &&
			/^v\d+\.\d+\.\d+-nightly\.\d{8}\.\d+$/.test(
				baseline.publishedSource?.tag,
			),
		"Accepted published nightly baseline required",
	);
	const release = await client.api(
		`releases/tags/${baseline.publishedSource.tag}`,
	);
	const published = await verifyPublishedRelease(client, release);
	requireValue(
		published.manifest.schemaVersion === 2 &&
			published.manifest.channel === "nightly" &&
			published.manifestSha256 === baseline.publishedSource.manifestSha256,
		"Pinned baseline release manifest changed",
	);
	const { manifest } = published;
	const assetUrl = (file) =>
		`https://github.com/${REPOSITORY}/releases/download/${manifest.tag}/${file}`;
	const source = join(temporary, "published-source");
	mkdirSync(source);
	for (const record of sourceTransportRecords(
		manifest.source,
		manifest.sourceTransport,
	)) {
		await downloadPinned(
			record,
			assetUrl(record.file),
			join(source, record.file),
			client.transport,
		);
	}
	let sourceArchive = join(source, manifest.source.file);
	if (manifest.sourceTransport) {
		const assembled = join(temporary, "assembled");
		mkdirSync(assembled);
		sourceArchive = reconstructSourceArchive(
			source,
			manifest.source,
			manifest.sourceTransport,
			assembled,
		);
	}
	validateSourceArchive(sourceArchive, {
		commit: manifest.commit,
		version: manifest.version,
		workflowSha: manifest.workflowSha,
		candidateDigest: manifest.candidateDigest,
	});
	const materialDirectory = join(temporary, "materials");
	mkdirSync(materialDirectory);
	inspectArchive(sourceArchive, {
		prefix: "source-rebuild/",
		regularOnly: true,
		flat: true,
		limits: { maxMembers: 256 },
		output: materialDirectory,
	});
	const priorMaterials = recoverAcceptedMaterials(materialDirectory, baseline);
	rmSync(source, { recursive: true });
	if (manifest.sourceTransport)
		rmSync(join(temporary, "assembled"), { recursive: true });
	const closure = manifest.assets.find(
		(r) => r.file === "validation-receipts.tar.gz",
	);
	requireValue(closure, "Published baseline receipt closure missing");
	const closurePath = join(temporary, "published-validation-receipts.tar.gz");
	await downloadPinned(
		closure,
		assetUrl(closure.file),
		closurePath,
		client.transport,
	);
	const retained = join(temporary, "retained-receipts");
	mkdirSync(retained);
	inspectArchive(closurePath, {
		prefix: "",
		regularOnly: true,
		flat: true,
		output: retained,
	});
	const check = (record, path) =>
		requireValue(
			canonical(fileRecord(path, record.file)) ===
				canonical({
					file: record.file,
					size: record.size,
					sha256: record.sha256,
				}),
			"Original accepted receipt changed",
		);
	const acceptedReceipts = join(
		retained,
		"accepted-validation-receipts.tar.gz",
	);
	check(baseline.receiptArchive, acceptedReceipts);
	const receipts = {};
	for (const gate of [
		"reviewedCandidate",
		"fullPayloadF1",
		"migrationPreservation",
		"licensingAndSource",
	]) {
		const record = baseline.receipts?.[gate];
		requireValue(
			record && /^[A-Za-z0-9_.-]+$/.test(record.file),
			`Missing accepted baseline receipt: ${gate}`,
		);
		const path = join(retained, `baseline-${gate}.receipt`);
		check(record, path);
		const receipt = JSON.parse(readFileSync(path));
		requireValue(
			receipt.candidateDigest === baseline.candidate.digest &&
				receipt.commit === baseline.candidate.candidate.commit,
			"Original baseline receipt candidate mismatch",
		);
		receipts[gate] = { record, path };
	}
	return { materialDirectory, priorMaterials, acceptedReceipts, receipts };
}
