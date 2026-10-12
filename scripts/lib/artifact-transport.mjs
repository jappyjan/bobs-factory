// Authenticated artifact transport only. Callers validate canonical run/name/head.
import { execFileSync } from "node:child_process";
import {
	closeSync,
	createWriteStream,
	existsSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readdirSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { requireValue, sha256File } from "./binary-release.mjs";

export async function restoreArtifact(client, artifact, output) {
	requireValue(
		!artifact.expired && /^sha256:[a-f0-9]{64}$/.test(artifact.digest),
		"Expired or unverifiable artifact",
	);
	requireValue(
		!existsSync(output) || readdirSync(output).length === 0,
		"Artifact output must be empty",
	);
	mkdirSync(output, { recursive: true });
	const temporary = mkdtempSync(join(tmpdir(), "factory-artifact-transport-"));
	try {
		const base = `https://api.github.com/repos/jappyjan/bobs-factory/actions/artifacts/${artifact.id}/zip`;
		const redirect = await client.transport(base, {
			headers: client.headers,
			redirect: "manual",
		});
		requireValue(
			redirect.status === 302,
			"Artifact transport did not redirect",
		);
		const location = new URL(redirect.headers.get("location"));
		requireValue(
			location.protocol === "https:",
			"Artifact transport must use HTTPS",
		);
		const response = await client.transport(location);
		requireValue(response.ok && response.body, "Artifact download failed");
		const archive = join(temporary, "incoming.zip");
		await pipeline(
			Readable.fromWeb(response.body),
			createWriteStream(archive, { flags: "wx" }),
		);
		requireValue(
			sha256File(archive) === artifact.digest.slice(7),
			"Artifact digest mismatch",
		);
		const entries = execFileSync("unzip", ["-Z1", archive], {
			encoding: "utf8",
		})
			.trim()
			.split("\n");
		requireValue(
			new Set(entries).size === entries.length &&
				entries.every(
					(e) =>
						/^[A-Za-z0-9_./-]+$/.test(e) &&
						!e.startsWith("/") &&
						!e.split("/").some((p) => p === "." || p === "..") &&
						e !== "incoming.zip",
				),
			"Unsafe artifact inventory",
		);
		for (const entry of entries) {
			const path = join(output, entry);
			if (entry.endsWith("/")) {
				mkdirSync(path, { recursive: true });
				continue;
			}
			mkdirSync(dirname(path), { recursive: true });
			const fd = openSync(path, "wx");
			try {
				execFileSync("unzip", ["-p", archive, entry], {
					stdio: ["ignore", fd, "pipe"],
				});
			} finally {
				closeSync(fd);
			}
		}
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
}
