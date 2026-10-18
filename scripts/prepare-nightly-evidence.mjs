#!/usr/bin/env node
// CI-derived nightly/beta evidence. Stable remains on explicit reviewed evidence and
// exact prepared-asset approval. This entrypoint never publishes or executes inputs.
import { execFileSync } from "node:child_process";
import {
	copyFileSync,
	createWriteStream,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { restoreArtifact } from "./lib/artifact-transport.mjs";
import {
	fileRecord,
	jsonBytes,
	requireValue,
	sha256File,
	TARGETS,
	validateArchive,
	validateBuildProvenance,
	validateEvidence,
	validateNativeHelpers,
	validatePreparedAgentBoundaries,
	validatePublicInstaller,
} from "./lib/binary-release.mjs";
import { inspectArchive } from "./lib/bounded-archive.mjs";
import { githubClient } from "./lib/github-release.mjs";
import {
	archiveNativeNotices,
	stageNightlyDesktop,
} from "./lib/nightly-artifacts.mjs";
import { restoreNightlyBaseline } from "./lib/nightly-baseline.mjs";
import {
	nativeNoticeMaterialName,
	rebindSourceMaterials,
	verifyDependencyBaseline,
} from "./lib/nightly-source.mjs";
import {
	candidateIdentity,
	canonical,
	validateCandidate,
} from "./lib/release-candidate.mjs";
import { retainReviewedJavascriptSources } from "./lib/reviewed-javascript-sources.mjs";

const { values } = parseArgs({
	options: {
		"run-id": { type: "string" },
		baseline: { type: "string" },
		output: { type: "string" },
	},
});
requireValue(
	values.output && process.env.GH_TOKEN,
	"Provide --output and GitHub read credentials for automatic preparation",
);
const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
	output = resolve(values.output),
	client = githubClient();
requireValue(!existsSync(output), "Nightly evidence output must be new");
const runId = Number(values["run-id"]),
	run = await client.api(`actions/runs/${runId}`);
requireValue(
	run.path === ".github/workflows/release-channel.yml" &&
		["schedule", "workflow_dispatch"].includes(run.event) &&
		run.head_branch === "main" &&
		run.head_repository?.full_name === "jappyjan/bobs-factory",
	"Automatic evidence requires canonical main release-channel run",
);
const [jobs, artifacts] = await Promise.all([
	client.pages(`actions/runs/${runId}/jobs`, "jobs"),
	client.pages(`actions/runs/${runId}/artifacts`, "artifacts"),
]);
if (!artifacts.some((a) => a.name.startsWith("bobs-factory-nightly-checks-"))) {
	console.log(
		"No eligible nightly/beta payload in this completed preparation; stable evidence stays explicit.",
	);
	process.exit(0);
}
const temporary = mkdtempSync(join(tmpdir(), "factory-nightly-evidence-"));
let created = false,
	success = false;
try {
	const restore = async (name) => {
		const matches = artifacts.filter((a) => a.name === name);
		requireValue(
			matches.length === 1 &&
				matches[0].workflow_run?.id === runId &&
				matches[0].workflow_run.head_sha === run.head_sha,
			"Missing/ambiguous canonical nightly artifact",
		);
		const dir = join(temporary, name);
		await restoreArtifact(client, matches[0], dir);
		return dir;
	};
	const frozenDirectory = await restore(
		`bobs-factory-frozen-candidate-${runId}`,
	);
	const candidate = validateCandidate(
		JSON.parse(readFileSync(join(frozenDirectory, "candidate.json"))),
	);
	requireValue(
		["nightly", "beta"].includes(candidate.candidate.channel) &&
			(candidate.candidate.channel !== "beta" ||
				run.event === "workflow_dispatch") &&
			candidate.candidate.commit === run.head_sha &&
			candidate.candidate.workflowSha === run.head_sha &&
			execFileSync("git", ["rev-parse", "HEAD"], {
				cwd: root,
				encoding: "utf8",
			}).trim() === run.head_sha,
		"Nightly/beta requires exact frozen main source/tooling",
	);
	const identity = candidateIdentity(candidate, runId);
	const policy = `CI-derived-${identity.channel}`;
	const selected = validateBuildProvenance(run, jobs, artifacts, identity);
	const green = (
		await client.pages(
			`actions/workflows/ci.yml/runs?head_sha=${identity.commit}&event=push`,
			"workflow_runs",
		)
	).filter(
		(r) =>
			r.head_sha === identity.commit &&
			r.head_branch === "main" &&
			r.repository?.full_name === "jappyjan/bobs-factory" &&
			r.head_repository?.full_name === "jappyjan/bobs-factory" &&
			r.path === ".github/workflows/ci.yml" &&
			r.event === "push" &&
			r.status === "completed" &&
			r.conclusion === "success",
	);
	requireValue(
		green.length > 0,
		"Exact main CI is not green; no nightly evidence generated",
	);
	const checksDirectory = await restore(
		`bobs-factory-nightly-checks-${candidate.digest}-${run.run_attempt}`,
	);
	const checks = JSON.parse(
		readFileSync(join(checksDirectory, "nightly-checks.json")),
	);
	requireValue(
		checks.candidateDigest === candidate.digest &&
			checks.commit === identity.commit &&
			checks.workflowSha === identity.workflowSha &&
			checks.runId === runId &&
			checks.status === "passed" &&
			checks.mode === "mock/scripted",
		"Missing exact actual nightly checks",
	);
	requireValue(
		canonical(checks.logs.map((r) => r.file).sort()) ===
			canonical(
				[
					"tests.log",
					"release-tests.log",
					"update-lifecycle.log",
					"update-maintenance.log",
					"desktop-service-lifecycle.log",
					"desktop-shell-update.log",
					"localhost-noauth.log",
					"linear-delivery.log",
					"architecture.log",
					"impact-feedback-recovery.log",
				].sort(),
			),
		"Incomplete current full-payload CI/mock workflow coverage",
	);
	for (const record of checks.logs) {
		const actual = fileRecord(join(checksDirectory, record.file), record.file);
		requireValue(
			canonical(actual) === canonical(record),
			"Nightly check log changed",
		);
	}
	const baseline = JSON.parse(
		readFileSync(
			resolve(
				values.baseline ?? join(root, "distribution/nightly-baseline.json"),
			),
		),
	);
	const accepted = validateCandidate(baseline.candidate);
	const dependencies = verifyDependencyBaseline(
		root,
		accepted.candidate.commit,
		identity.commit,
		baseline.dependencyReviews,
	);
	requireValue(
		execFileSync(
			"git",
			["merge-base", accepted.candidate.commit, identity.commit],
			{ cwd: root, encoding: "utf8" },
		).trim() === accepted.candidate.commit,
		"Accepted baseline must be an ancestor of current main",
	);
	const { materialDirectory, priorMaterials, acceptedReceipts, receipts } =
		await restoreNightlyBaseline(client, baseline, temporary);
	mkdirSync(output);
	created = true;
	copyFileSync(
		acceptedReceipts,
		join(output, "accepted-validation-receipts.tar.gz"),
	);
	copyFileSync(
		join(frozenDirectory, "candidate.json"),
		join(output, "candidate.json"),
	);
	const provenance = {
		schemaVersion: 1,
		product: "bobs-factory",
		mode: policy,
		baseline,
		mainCI: green[0],
		run,
		jobs,
		artifacts,
		checks,
		dependencies,
	};
	writeFileSync(join(output, "nightly-provenance.json"), jsonBytes(provenance));
	for (const record of checks.logs)
		copyFileSync(join(checksDirectory, record.file), join(output, record.file));
	const bindings = [],
		currentNoticeRecords = await retainReviewedJavascriptSources(
			dependencies,
			materialDirectory,
			client.transport,
		),
		targets = {},
		desktop = [],
		additionalAssets = [];
	for (const target of TARGETS) {
		const nativeDirectory = await restore(selected[target].name),
			stem = `bobs-factory-${identity.version}-${target}`;
		validateArchive(
			join(nativeDirectory, `${stem}.tar.gz`),
			join(nativeDirectory, `${stem}.manifest.json`),
			identity,
			target,
		);
		const native = join(temporary, `native-${target}`);
		mkdirSync(native);
		inspectArchive(join(nativeDirectory, `${stem}.tar.gz`), {
			prefix: `${stem}/`,
			regularOnly: true,
			output: native,
		});
		const build = JSON.parse(readFileSync(join(native, "build.json")));
		targets[target] = {};
		for (const [file, key, validate] of [
			["native-helpers.json", "nativeHelpers", validateNativeHelpers],
			[
				"prepared-agent-boundaries.json",
				"preparedAgents",
				validatePreparedAgentBoundaries,
			],
			["public-installer.json", null, validatePublicInstaller],
		]) {
			validate(
				JSON.parse(readFileSync(join(nativeDirectory, file))),
				identity,
				target,
				build,
			);
			const name = `${target}-${file}`;
			copyFileSync(join(nativeDirectory, file), join(output, name));
			if (key)
				targets[target][key] = {
					status: "passed",
					receipt: { file: name, sha256: sha256File(join(output, name)) },
				};
		}
		// Get the official upstream base selected by this pinned Bun compiler. Only
		// equality with the independently accepted object's runtime hash permits reuse.
		const upstreamTarget = {
			"darwin-arm64": "darwin-aarch64",
			"darwin-x64": "darwin-x64",
			"linux-x64": "linux-x64",
			"linux-arm64": "linux-aarch64",
		}[target];
		const baseResponse = await fetch(
			`https://github.com/oven-sh/bun/releases/download/bun-v1.4.2/bun-${upstreamTarget}.zip`,
		);
		requireValue(
			baseResponse.ok,
			`Pinned Bun base unavailable for ${target} (${baseResponse.status})`,
		);
		const baseZip = join(temporary, `${target}-base.zip`);
		let baseCount = 0;
		await pipeline(
			Readable.fromWeb(baseResponse.body),
			new Transform({
				transform(chunk, _encoding, cb) {
					baseCount += chunk.length;
					cb(
						baseCount > 512 * 1024 ** 2
							? new Error("Bun download limit exceeded")
							: null,
						chunk,
					);
				},
			}),
			createWriteStream(baseZip, { flags: "wx" }),
		);
		const basePath = join(temporary, `${target}-base`);
		writeFileSync(
			basePath,
			execFileSync("unzip", ["-p", baseZip, `bun-${upstreamTarget}/bun`], {
				maxBuffer: 512 * 1024 ** 2,
			}),
		);
		requireValue(
			sha256File(basePath) ===
				priorMaterials.builds.find((b) => b.target === target).runtimeSha256,
			"Uncovered upstream runtime; update accepted baseline",
		);
		bindings.push(
			JSON.parse(
				execFileSync(
					"python3",
					[
						join(root, "scripts/lib/bun-base-binding.py"),
						target,
						basePath,
						join(native, "bobs-factory"),
					],
					{ encoding: "utf8", timeout: 120000, maxBuffer: 1024 ** 2 },
				),
			),
		);
		const name = nativeNoticeMaterialName(priorMaterials, identity, target);
		archiveNativeNotices(native, join(materialDirectory, name));
		currentNoticeRecords.push({
			kind: "candidate-notices",
			...fileRecord(join(materialDirectory, name), name),
			revision: identity.commit,
			source: `https://github.com/jappyjan/bobs-factory/actions/runs/${runId}`,
			target,
		});
		const desktopJobs = jobs.filter(
			(j) => j.name.includes(target) && /(?:^| \/ )desktop \(/.test(j.name),
		);
		requireValue(
			desktopJobs.length === 1 &&
				desktopJobs[0].status === "completed" &&
				desktopJobs[0].conclusion === "success",
			"Missing successful desktop job",
		);
		const desktopDirectory = await restore(
			`desktop-${target}-${candidate.digest}`,
		);
		const stagedDesktop = stageNightlyDesktop(
			desktopDirectory,
			nativeDirectory,
			output,
			identity,
			target,
		);
		desktop.push(...stagedDesktop.artifacts);
		additionalAssets.push(...stagedDesktop.additionalAssets);
		rmSync(nativeDirectory, { recursive: true, force: true });
		rmSync(native, { recursive: true, force: true });
		rmSync(desktopDirectory, { recursive: true, force: true });
	}
	rebindSourceMaterials(
		priorMaterials,
		materialDirectory,
		identity,
		bindings,
		provenance,
		currentNoticeRecords,
	);
	const sourceOutput = join(temporary, "assembled-source");
	execFileSync(
		process.execPath,
		[
			join(root, "scripts/build-release-source.mjs"),
			"--candidate",
			join(output, "candidate.json"),
			"--sha",
			identity.commit,
			"--materials",
			materialDirectory,
			"--output",
			sourceOutput,
		],
		{ stdio: "inherit", timeout: 15 * 60 * 1000 },
	);
	rmSync(join(sourceOutput, "source-rebuild"), {
		recursive: true,
		force: true,
	});
	copyFileSync(
		join(sourceOutput, "source-rebuild.tar.gz"),
		join(output, "source-rebuild.tar.gz"),
	);
	const gates = {};
	const ciReceipts = [
		fileRecord(
			join(output, "accepted-validation-receipts.tar.gz"),
			"accepted-validation-receipts.tar.gz",
		),
		fileRecord(
			join(output, "nightly-provenance.json"),
			"nightly-provenance.json",
		),
		...checks.logs,
		...TARGETS.flatMap((t) =>
			[
				"desktop-build.json",
				"native-service-receipt.json",
				"native-electron-receipt.json",
				...(t.startsWith("linux") ? ["native-shell-update-receipt.json"] : []),
			].map((f) => fileRecord(join(output, `${t}-${f}`), `${t}-${f}`)),
		),
	].map((receipt) => ({ receipt }));
	for (const [gate, { record, path }] of Object.entries(receipts)) {
		const old = `baseline-${gate}.receipt`;
		copyFileSync(path, join(output, old));
		const file = `nightly-${gate}.json`;
		writeFileSync(
			join(output, file),
			jsonBytes({
				schemaVersion: 1,
				product: "bobs-factory",
				...identity,
				status: "passed",
				policy,
				baselineReceipt: { ...record, file: old },
				acceptedBy: baseline.acceptedBy,
				provenance: fileRecord(
					join(output, "nightly-provenance.json"),
					"nightly-provenance.json",
				),
				scope:
					gate === "licensingAndSource"
						? "Accepted native source/objects and notices plus exact independently reviewed JavaScript dependency sources and upstream notices where recorded in provenance; every added npm archive is hash-checked and retained. Exact current full Git source/tooling, native full-byte Bun correspondence and fresh desktop notice checks. No new legal opinion or native relink claimed."
						: gate === "reviewedCandidate"
							? "Accepted main: exact canonical push CI success, current candidate validation and accepted baseline. No new human per-candidate review claimed."
							: "Accepted baseline plus actual current mocked workflow/update/state-preservation checks and native receipts; no live provider or physical OS trust claims.",
			}),
		);
		gates[gate] = {
			status: "passed",
			receipt: { file, sha256: sha256File(join(output, file)) },
			baseline: { receipt: { file: old, sha256: record.sha256 } },
		};
	}
	const evidence = {
		schemaVersion: 1,
		product: "bobs-factory",
		...identity,
		buildRunId: runId,
		...gates,
		ciReceipts,
		targets,
		source: fileRecord(
			join(output, "source-rebuild.tar.gz"),
			"source-rebuild.tar.gz",
		),
		desktop: { schemaVersion: 1, artifacts: desktop, additionalAssets },
	};
	validateEvidence(evidence, output, identity);
	writeFileSync(join(output, "release-evidence.json"), jsonBytes(evidence));
	success = true;
	console.log(
		`Prepared actual ${policy} evidence for ${candidate.digest}; publication remains separate.`,
	);
} finally {
	rmSync(temporary, { recursive: true, force: true });
	if (created && !success) rmSync(output, { recursive: true, force: true });
}
