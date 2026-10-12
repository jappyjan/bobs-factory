import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileRecord, jsonBytes } from "../lib/binary-release.mjs";
import { freezeCandidate } from "../lib/release-candidate.mjs";

test("actual ZIP artifact restore excludes transport bytes, remains restorable and cleans transport on refusal", () => {
	const work = mkdtempSync(join(tmpdir(), "factory-artifact-handoff-test-"));
	try {
		const candidate = freezeCandidate({
			channel: "nightly",
			commit: "a".repeat(40),
			workflowSha: "a".repeat(40),
			committedVersion: "1.0.0",
			sequence: 12,
			date: "2026-10-12T00:00:00Z",
		});
		const stage = join(work, "stage");
		mkdirSync(join(stage, "assets"), { recursive: true });
		writeFileSync(join(stage, "assets/candidate.json"), jsonBytes(candidate));
		const zip = join(work, "provider.zip");
		execFileSync("zip", ["-qr", zip, "assets"], { cwd: stage });
		const temp = join(work, "temp");
		mkdirSync(temp);
		const preload = join(work, "transport.mjs");
		writeFileSync(
			preload,
			`import {readFileSync} from 'node:fs';
const state=JSON.parse(readFileSync(process.env.ARTIFACT_FIXTURE));
globalThis.fetch=async(url)=>{
 if(String(url).endsWith('/actions/artifacts/17')) return Response.json(state.artifact);
 if(String(url).endsWith('/actions/runs/23')) return Response.json(state.run);
 if(String(url).endsWith('/actions/artifacts/17/zip'))return new Response(null,{status:302,headers:{location:'https://fixture.invalid/zip'}});
 if(String(url)==='https://fixture.invalid/zip')return new Response(readFileSync(state.zip));
 throw Error('Unexpected fixture request '+url);
};`,
		);
		const state = {
			zip,
			artifact: {
				id: 17,
				name: `bobs-factory-prepared-release-${candidate.digest}`,
				digest: `sha256:${fileRecord(zip, "zip").sha256}`,
				expired: false,
				workflow_run: { id: 23, head_sha: candidate.candidate.workflowSha },
			},
			run: {
				repository: { full_name: "jappyjan/bobs-factory" },
				head_repository: { full_name: "jappyjan/bobs-factory" },
				path: ".github/workflows/binary-release.yml",
				event: "workflow_dispatch",
				status: "completed",
				conclusion: "success",
				head_sha: candidate.candidate.workflowSha,
			},
		};
		const stateFile = join(work, "provider.json");
		const run = (output) => {
			writeFileSync(stateFile, jsonBytes(state));
			return spawnSync(
				process.execPath,
				[
					"--import",
					preload,
					resolve("scripts/download-release-artifact.mjs"),
					"--kind",
					"prepared",
					"--artifact-id",
					"17",
					"--output",
					output,
				],
				{
					encoding: "utf8",
					env: {
						...process.env,
						GH_TOKEN: "synthetic",
						TMPDIR: temp,
						ARTIFACT_FIXTURE: stateFile,
					},
				},
			);
		};
		const first = join(work, "first");
		let r = run(first);
		assert.equal(r.status, 0, r.stderr);
		assert.equal(existsSync(join(first, "incoming.zip")), false);
		assert.deepEqual(readdirSync(temp), []);
		const secondZip = join(work, "retained.zip");
		execFileSync("zip", ["-qr", secondZip, "."], { cwd: first });
		state.zip = secondZip;
		state.artifact.digest = `sha256:${fileRecord(secondZip, "zip").sha256}`;
		r = run(join(work, "second"));
		assert.equal(r.status, 0, r.stderr);
		assert.deepEqual(readdirSync(temp), []);
		state.artifact.digest = `sha256:${"f".repeat(64)}`;
		r = run(join(work, "bad-hash"));
		assert.notEqual(r.status, 0);
		assert.match(r.stderr, /digest mismatch/);
		assert.deepEqual(readdirSync(temp), []);
		writeFileSync(join(first, "incoming.zip"), "legacy malformed transport");
		const legacy = join(work, "legacy.zip");
		execFileSync("zip", ["-qr", legacy, "."], { cwd: first });
		state.zip = legacy;
		state.artifact.digest = `sha256:${fileRecord(legacy, "zip").sha256}`;
		r = run(join(work, "legacy"));
		assert.notEqual(r.status, 0);
		assert.match(r.stderr, /Unsafe artifact inventory/);
		assert.deepEqual(readdirSync(temp), []);
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
});
