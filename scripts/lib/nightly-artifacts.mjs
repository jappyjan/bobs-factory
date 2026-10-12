// Producer-shaped native and desktop intake. Artifact ZIP member paths are
// preserved; callers must have verified provider provenance before this boundary.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	fileRecord,
	jsonBytes,
	requireValue,
	sha256File,
} from "./binary-release.mjs";
import { canonical } from "./release-candidate.mjs";

export function archiveNativeNotices(native, outputArchive) {
	execFileSync(
		"tar",
		[
			"-czf",
			outputArchive,
			"-C",
			native,
			"LICENSE",
			"NOTICE",
			"THIRD_PARTY_NOTICES.txt",
		],
		{ env: { ...process.env, COPYFILE_DISABLE: "1" } },
	);
}

export function stageNightlyDesktop(
	artifactDirectory,
	nativeDirectory,
	output,
	identity,
	target,
) {
	const desktopDirectory = join(artifactDirectory, "desktop"),
		runtimeDirectory = join(artifactDirectory, "runtime"),
		candidate = { digest: identity.candidateDigest },
		stem = `bobs-factory-${identity.version}-${target}`,
		artifacts = [],
		additionalAssets = [];
	const info = JSON.parse(
			readFileSync(join(desktopDirectory, "desktop-build.json")),
		),
		electron = JSON.parse(
			readFileSync(join(desktopDirectory, "native-electron-receipt.json")),
		);
	requireValue(
		info.candidateDigest === candidate.digest &&
			info.commit === identity.commit &&
			info.version === identity.version &&
			info.target === target &&
			info.licenseValidation?.status === "passed" &&
			electron.passed === true &&
			`${electron.platform}-${electron.arch}` === target,
		"Invalid current native desktop/license receipts",
	);
	requireValue(
		sha256File(join(runtimeDirectory, `${stem}.tar.gz`)) ===
			sha256File(join(nativeDirectory, `${stem}.tar.gz`)),
		"Desktop must use exact canonical native runtime",
	);
	const service = JSON.parse(
		readFileSync(join(desktopDirectory, "native-service-receipt.json")),
	);
	requireValue(service.passed === true, "Native service check failed");
	const validation = `desktop-validation-${target}.json`;
	const rawFiles = [
		"desktop-build.json",
		"native-service-receipt.json",
		"native-electron-receipt.json",
		...(target.startsWith("linux") ? ["native-shell-update-receipt.json"] : []),
	];
	const raw = [];
	for (const file of rawFiles) {
		const dest = `${target}-${file}`;
		copyFileSync(join(desktopDirectory, file), join(output, dest));
		raw.push(fileRecord(join(output, dest), dest));
	}
	if (target.startsWith("linux"))
		requireValue(
			JSON.parse(
				readFileSync(
					join(desktopDirectory, "native-shell-update-receipt.json"),
				),
			).status === "passed",
			"Linux shell upgrade/rollback check failed",
		);
	writeFileSync(
		join(output, validation),
		jsonBytes({
			product: "bobs-factory",
			status: "passed",
			...identity,
			target,
			candidateDigest: candidate.digest,
			scope:
				"Fresh CI native service/Electron and installer notices; Linux packaged upgrade/rollback. Mac physical OS trust/DMG drag-drop are not automated claims. Accepted scoped historical observations retained in baseline.",
			rawReceipts: raw,
		}),
	);
	const put = (record) => {
		requireValue(
			record && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(record.file),
			"Unsafe desktop record",
		);
		const actual = fileRecord(join(desktopDirectory, record.file), record.file);
		requireValue(
			canonical(actual) === canonical(record),
			"Desktop artifact integrity mismatch",
		);
		if (!existsSync(join(output, record.file)))
			copyFileSync(
				join(desktopDirectory, record.file),
				join(output, record.file),
			);
		return actual;
	};
	const update = put(info.update.archive),
		metadata = put(info.update.metadata);
	for (const asset of info.assets) {
		if (asset.file.endsWith(".deb")) {
			// Generic inventoried installer; only AppImage is the Linux update target.
			additionalAssets.push(put(asset));
		} else
			artifacts.push({
				...identity,
				target,
				platformRequirements: target.startsWith("darwin")
					? "macOS 15 or newer"
					: "Ubuntu 24.04 / glibc 2.39 or newer",
				archive: put(asset),
				...(asset.file !== update.file ? { updateArchive: update } : {}),
				updateMetadata: metadata,
				validation: fileRecord(join(output, validation), validation),
			});
	}
	return { artifacts, additionalAssets };
}
