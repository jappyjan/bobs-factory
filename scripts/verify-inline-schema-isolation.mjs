// Run with Bun. No arguments exercises source subprocess isolation; an absolute
// packaged binary path exercises the real HTTP service and private dispatcher.
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

assert(process.versions.bun, "Run this stress driver with Bun");
const binary = process.argv[2] && resolve(process.argv[2]);
const expectedCommit = process.argv[3];
const home = mkdtempSync(join(tmpdir(), "factory-schema-stress-"));
const report = {
	mode: binary ? "packaged-binary" : "Bun-source",
	bun: process.versions.bun,
	home,
	compileRequests: 0,
	evaluations: 0,
	cancellations: 0,
	postCancelCompiles: 0,
	postCancelEvaluations: 0,
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const children = (parent) =>
	execFileSync("/bin/ps", ["-axo", "pid=,ppid=,command="], {
		encoding: "utf8",
	})
		.split("\n")
		.flatMap((line) => {
			const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
			return match &&
				Number(match[2]) === parent &&
				/internal-schema-validator|InlineSchemaChild\.(ts|js)/.test(match[3])
				? [{ pid: Number(match[1]), command: match[3] }]
				: [];
		});
async function stopHelper(parent) {
	for (let attempt = 0; attempt < 100; attempt++) {
		const found = children(parent);
		if (found.length) {
			assert.equal(found.length, 1, "Only this request may own a validator");
			process.kill(found[0].pid, "SIGSTOP");
			return found[0];
		}
		await sleep(5);
	}
	assert.fail("Did not observe the actual validator subprocess");
}
const expensive = (title) => ({
	title,
	enum: Array.from({ length: 4990 }, (_, i) => ({ i })),
});
let service;
let logs = "";
let parent = process.pid;
let compile;
let evaluate;
try {
	if (binary) {
		const build = JSON.parse(
			readFileSync(join(dirname(binary), "build.json"), "utf8"),
		);
		if (expectedCommit) assert.equal(build.commit, expectedCommit);
		assert.equal(build.dirty, false);
		report.binary = binary;
		report.binarySha256 = createHash("sha256")
			.update(readFileSync(binary))
			.digest("hex");
		report.build = build;
		const reserve = createServer();
		await new Promise((resolve) => reserve.listen(0, "127.0.0.1", resolve));
		const port = reserve.address().port;
		await new Promise((resolve) => reserve.close(resolve));
		const base = `http://127.0.0.1:${port}`;
		mkdirSync(join(home, "empty-capacity"));
		service = spawn(
			binary,
			["--home", join(home, "state"), "--port", String(port), "--no-open"],
			{
				env: {
					...process.env,
					BOBS_FACTORY_SENTRY_DISABLED: "1",
					BOBS_FACTORY_MIGRATION_SOURCE_CAPACITY_DIRECTORY: join(
						home,
						"empty-capacity",
					),
				},
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		parent = service.pid;
		service.stdout.on("data", (chunk) => (logs += chunk));
		service.stderr.on("data", (chunk) => (logs += chunk));
		for (let attempt = 0; attempt < 120; attempt++) {
			try {
				const response = await fetch(`${base}/api/version`);
				if (response.ok) {
					report.identity = await response.json();
					break;
				}
			} catch {}
			assert.equal(service.exitCode, null, logs);
			await sleep(250);
		}
		assert(report.identity, logs);
		assert.equal(report.identity.runtime.packaged, true);
		for (const key of [
			"version",
			"commit",
			"dirty",
			"target",
			"resourceDigest",
		])
			assert.equal(report.identity.runtime[key], build[key]);
		compile = async (schema, signal) => {
			const response = await fetch(
				`${base}/api/workflows/step-config/validate`,
				{
					method: "POST",
					headers: {
						"content-type": "application/json",
						"x-factory-request": "1",
						origin: base,
					},
					body: JSON.stringify({ schema }),
					signal,
				},
			);
			assert.equal(response.status, 200);
			const result = await response.json();
			assert.equal(result.valid, result.issues.length === 0);
			return result.issues;
		};
		// This is the same binary's private evaluator, not an external Node host.
		// Source mode below also stresses evaluation through the parent watchdog.
		evaluate = async (schema, value) => {
			const result = spawnSync(binary, ["internal-schema-validator"], {
				input: JSON.stringify({ schema, value, validate: true }),
				encoding: "utf8",
				timeout: 5000,
				maxBuffer: 24 * 1024,
			});
			assert.equal(result.status, 0, result.stderr);
			return JSON.parse(result.stdout);
		};
	} else {
		const source = await import(
			"../packages/edge-worker/src/factory/InlineSchema.ts"
		);
		compile = (schema, signal) =>
			source.compileInlineSchema(schema, { signal });
		evaluate = source.validateInlineSchema;
		const clock = fileURLToPath(
			new URL("./fixtures/inline-schema-vm-clock.mjs", import.meta.url),
		);
		report.vmAllowance = [];
		for (const pause of [500, 1500]) {
			const child = spawnSync(process.execPath, [clock, String(pause)], {
				encoding: "utf8",
				timeout: 3000,
			});
			assert.equal(child.status, 0, child.stderr);
			const sample = JSON.parse(child.stdout);
			assert.equal(sample.executionMs, 1000);
			if (pause === 500)
				assert.deepEqual(sample.result, { schemaIssues: [], issues: [] });
			else {
				assert.equal(sample.result.resourceFailure, true);
				assert(
					sample.result.schemaIssues.some((issue) =>
						issue.includes("1000 ms execution limit"),
					),
				);
			}
			report.vmAllowance.push(sample);
		}
	}
	for (let i = 0; i < 100; i++) {
		assert.deepEqual(
			await compile({ type: "boolean", title: `Ordinary compile ${i}` }),
			[],
			`Ordinary compilation ${i}`,
		);
		report.compileRequests++;
		assert.deepEqual(
			await evaluate(
				{ type: "integer", minimum: 1, title: `Evaluate ${i}` },
				3,
			),
			{ schemaIssues: [], issues: [] },
			`Ordinary evaluation ${i}`,
		);
		report.evaluations++;
	}
	const invalid = await evaluate({ type: "integer", minimum: 1 }, 0);
	assert.equal(invalid.schemaIssues.length, 0);
	assert.equal(invalid.issues.length, 1);
	assert.equal(invalid.resourceFailure, undefined);
	report.invalidOutputRemainsCorrection = true;
	for (let i = 0; i < 10; i++) {
		const controller = new AbortController();
		const pending = compile(expensive(`Cancellation ${i}`), controller.signal);
		const settled = pending.then(
			(value) => ({ value }),
			(error) => ({ error }),
		);
		const child = await stopHelper(parent);
		controller.abort();
		assert.equal((await settled).error?.name, "AbortError");
		for (let attempt = 0; attempt < 40 && children(parent).length; attempt++)
			await sleep(25);
		assert.deepEqual(
			children(parent),
			[],
			"Cancelled helper was not reclaimed",
		);
		assert(
			child.command.startsWith(`${realpathSync(binary ?? process.execPath)} `),
			"The helper must use this executable, never an external Node host",
		);
		report.cancellations++;
		assert.deepEqual(
			await compile({ type: "boolean", title: `After cancellation ${i}` }),
			[],
		);
		report.postCancelCompiles++;
		assert.deepEqual(await evaluate({ type: "boolean" }, false), {
			schemaIssues: [],
			issues: [],
		});
		report.postCancelEvaluations++;
	}
	let ticks = 0;
	const heartbeat = setInterval(() => ticks++, 10);
	const started = Date.now();
	try {
		const pending = compile(expensive("Hard wall deadline"));
		const child = await stopHelper(parent);
		const issues = await pending;
		assert(issues.some((issue) => issue.includes("2000 ms wall limit")));
		assert(ticks > 2);
		assert(Date.now() - started < 3500);
		assert.deepEqual(children(parent), [], "Deadline helper remains alive");
		report.wall = { elapsedMs: Date.now() - started, ticks, child };
	} finally {
		clearInterval(heartbeat);
	}
	if (!binary) {
		const originalPath = process.env.PATH;
		const watchdog = join(home, "watchdog");
		mkdirSync(watchdog);
		const ps = join(watchdog, "ps");
		const control = async (source, title, message, freeze = false) => {
			writeFileSync(ps, `#!/bin/sh\n${source}\n`);
			chmodSync(ps, 0o755);
			process.env.PATH = watchdog;
			try {
				const pending = compile(expensive(title));
				if (freeze) await stopHelper(parent);
				const issues = await pending;
				assert(
					issues.some((issue) => issue.includes(message)),
					issues,
				);
				assert.deepEqual(children(parent), []);
				return issues;
			} finally {
				process.env.PATH = originalPath;
			}
		};
		report.unavailableWatchdog = await control(
			"exit 1",
			"Unavailable live startup watchdog",
			"watchdog unavailable",
		);
		report.rssLimit = await control(
			"echo 262145",
			"RSS over cap",
			"256 MiB RSS limit",
		);
		const observed = join(watchdog, "observed");
		report.lostLiveWatchdog = await control(
			`if [ -f '${observed}' ]; then exit 1; fi\n: > '${observed}'\necho 32768`,
			"Lost live watchdog",
			"watchdog unavailable",
			true,
		);
		assert(existsSync(observed));
		assert.deepEqual(
			await compile({ type: "null", title: "After faults" }),
			[],
		);
	}
	assert.deepEqual(children(parent), []);
	report.childrenAfter = [];
	report.result = "PASS";
	console.log(JSON.stringify(report, null, 2));
} finally {
	for (const child of children(parent)) process.kill(child.pid, "SIGKILL");
	if (service) {
		writeFileSync(join(home, "worker.log"), logs);
		service.kill("SIGTERM");
		await new Promise((resolve) => {
			if (service.exitCode !== null) return resolve();
			service.once("exit", resolve);
			setTimeout(() => service.kill("SIGKILL"), 5000).unref();
		});
	}
}
