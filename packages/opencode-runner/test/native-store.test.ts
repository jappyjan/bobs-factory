import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import { OpenCodeRunner } from "../src/OpenCodeRunner.js";
import { initializeStore } from "./fixtures/context-store.js";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
function fixture(native = process.env.BOBS_FACTORY_TEST_OPENCODE_PATH) {
	const root = mkdtempSync(join(tmpdir(), "opencode-store-preflight-"));
	roots.push(root);
	const dataHome = join(root, "data"),
		data = join(dataHome, "opencode"),
		invocations = join(root, "invocations.jsonl"),
		executable = join(root, "native-boundary.mjs");
	mkdirSync(join(root, "cwd"));
	mkdirSync(data, { recursive: true });
	writeFileSync(
		executable,
		`#!/usr/bin/env node
import {appendFileSync} from 'node:fs'; import {spawnSync} from 'node:child_process';
const args=process.argv.slice(2);appendFileSync(${JSON.stringify(invocations)},JSON.stringify({args,data:process.env.XDG_DATA_HOME,fetch:process.env.OPENCODE_DISABLE_MODELS_FETCH})+'\\n');
if(args[0]==='run'){process.stdout.write(JSON.stringify({type:'step_start',sessionID:'ses_native_restricted'})+'\\n'+JSON.stringify({type:'text',part:{text:'No paid model was invoked.'}})+'\\n'+JSON.stringify({type:'step_finish',reason:'stop'})+'\\n');process.exit(0)}
if(${JSON.stringify(native ?? null)}){const r=spawnSync(${JSON.stringify(native ?? null)},args,{env:process.env,encoding:'utf8',timeout:5000});process.stdout.write(r.stdout??'');process.stderr.write(r.stderr??'');process.exit(r.status??1)}
if(args[0]==='--version')process.stdout.write('1.2.27\\n');else throw Error('Unexpected native invocation');
`,
		{ mode: 0o755 },
	);
	const config = {
		factoryHome: join(root, "factory"),
		workingDirectory: join(root, "cwd"),
		openCodePath: executable,
		toolProfile: "context-only" as const,
		model: "openai/unused-no-model",
		childEnvironment: {
			HOME: join(root, "home"),
			PATH: process.env.PATH!,
			XDG_DATA_HOME: dataHome,
		},
		mcpConfig: {
			"factory-context": {
				type: "http" as const,
				url: "http://127.0.0.1:1/context",
			},
		},
		onError: () => {},
	};
	return { root, data, dataHome, config, invocations };
}
function legacy(data: string) {
	const files = {
		"auth.json": JSON.stringify({
			"https://unsafe.invalid": {
				type: "wellknown",
				key: "SYNTHETIC_AUTH",
				token: "synthetic-not-a-credential",
			},
		}),
		"storage/project/proj_fixture.json": JSON.stringify({
			worktree: "/synthetic",
			vcs: "git",
			time: { created: 1, updated: 1 },
			sandboxes: [],
		}),
		"storage/session/proj_fixture/ses_fixture.json": JSON.stringify({
			slug: "fixture",
			directory: "/synthetic",
			title: "SYNTHETIC HISTORY",
			version: "1",
			time: { created: 1, updated: 1 },
		}),
		"storage/message/ses_fixture/msg_fixture.json": JSON.stringify({
			role: "user",
			time: { created: 1 },
		}),
		"storage/part/msg_fixture/prt_fixture.json": JSON.stringify({
			type: "text",
			text: "SYNTHETIC FULL NATIVE HISTORY MUST NOT BE READ/IMPORTED DURING REFUSAL",
			time: { created: 1 },
		}),
	};
	for (const [path, body] of Object.entries(files)) {
		const target = join(data, path);
		mkdirSync(join(target, ".."), { recursive: true });
		writeFileSync(target, body);
	}
	return files;
}
function bytes(data: string): Record<string, string> {
	const all: Record<string, string> = {};
	function visit(path: string) {
		for (const entry of readdirSync(path, { withFileTypes: true })) {
			const file = join(path, entry.name);
			if (entry.isDirectory()) visit(file);
			else
				all[file.slice(data.length + 1)] = createHash("sha256")
					.update(readFileSync(file))
					.digest("hex");
		}
	}
	visit(data);
	return all;
}
it.each([
	"legacy",
	"auth-only",
	"channel-only",
	"unknown",
	"invalid-marker",
	"symlink-marker",
	"old-schema",
	"future-schema",
	"uncheckpointed",
])("refuses %s before ANY CLI startup without touching original synthetic bytes", async (mode) => {
	const f = fixture();
	if (mode === "legacy") legacy(f.data);
	else if (mode === "auth-only")
		writeFileSync(
			join(f.data, "auth.json"),
			"synthetic private auth untouched",
		);
	else if (mode === "channel-only")
		writeFileSync(
			join(f.data, "opencode-channel.db"),
			"synthetic original channel history",
		);
	else if (mode === "unknown")
		writeFileSync(join(f.data, "unknown-state"), "untouched");
	else if (mode === "invalid-marker")
		writeFileSync(join(f.data, "opencode.db"), "not SQLite");
	else if (mode === "symlink-marker") {
		writeFileSync(join(f.root, "outside.db"), "original external bytes");
		symlinkSync(join(f.root, "outside.db"), join(f.data, "opencode.db"));
	} else {
		initializeStore(f.dataHome, "ses_native_restricted");
		const db = new DatabaseSync(join(f.data, "opencode.db"));
		if (mode === "old-schema")
			db.exec("ALTER TABLE __drizzle_migrations DROP COLUMN applied_at");
		if (mode === "future-schema")
			db.exec(
				"INSERT INTO __drizzle_migrations(hash,created_at,name) VALUES ('',9999999999999,'future-migration')",
			);
		db.close();
		if (mode === "uncheckpointed")
			writeFileSync(
				join(f.data, "opencode.db-wal"),
				"synthetic uncheckpointed writes",
			);
	}
	const before = bytes(f.data);
	const runner = new OpenCodeRunner(f.config);
	await runner.start("Must refuse before metadata startup");
	expect(runner.getMessages().at(-1)).toMatchObject({ is_error: true });
	expect(existsSync(f.invocations)).toBe(false);
	expect(bytes(f.data)).toEqual(before);
});

it("preserves an attested original ID and refuses a migration-requiring store before metadata/version/resume startup", async () => {
	const f = fixture();
	initializeStore(f.dataHome, "ses_native_restricted");
	const first = new OpenCodeRunner(f.config);
	await first.start("Restricted original native identity");
	expect(first.getMessages().at(-1)).toMatchObject({ is_error: false });
	const calls = readFileSync(f.invocations, "utf8");
	rmSync(join(f.data, "opencode.db"));
	legacy(f.data);
	const before = bytes(f.data);
	const resumed = new OpenCodeRunner({
		...f.config,
		resumeSessionId: "ses_native_restricted",
	});
	const session = await resumed.start("No replacement/migration");
	expect(session.sessionId).toBe("ses_native_restricted");
	expect(resumed.getMessages().at(-1)).toMatchObject({ is_error: true });
	expect(readFileSync(f.invocations, "utf8")).toBe(calls);
	expect(bytes(f.data)).toEqual(before);
	expect(existsSync(join(f.data, "opencode.db"))).toBe(false);
});

it.skipIf(!process.env.BOBS_FACTORY_TEST_OPENCODE_PATH)(
	"uses actual pinned native metadata only after initialized-store verification; legacy refuses with zero actual native invocations",
	async () => {
		const old = fixture();
		legacy(old.data);
		const before = bytes(old.data);
		const rejected = new OpenCodeRunner(old.config);
		await rejected.start("No native startup or model");
		expect(rejected.getMessages().at(-1)).toMatchObject({ is_error: true });
		expect(existsSync(old.invocations)).toBe(false);
		expect(bytes(old.data)).toEqual(before);
		expect(existsSync(join(old.data, "opencode.db"))).toBe(false);
		const supported = fixture();
		initializeStore(supported.dataHome, "ses_native_restricted");
		writeFileSync(
			join(supported.data, "auth.json"),
			JSON.stringify({
				synthetic: { type: "api", key: "synthetic-not-a-real-key" },
			}),
		);
		const original = bytes(supported.data);
		const runner = new OpenCodeRunner(supported.config);
		await runner.start("Controlled transport; metadata native only");
		expect(runner.getMessages().at(-1)).toMatchObject({ is_error: false });
		expect(bytes(supported.data)).toEqual(original);
		const calls = readFileSync(supported.invocations, "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(calls.map((c) => c.args[0])).toEqual([
			"--version",
			"providers",
			"run",
		]);
		expect(calls[0].data).not.toBe(supported.dataHome);
		expect(calls[1]).toMatchObject({ data: supported.dataHome, fetch: "1" });
		expect(calls[1].args).toEqual(["providers", "list", "--print-logs"]);
		expect(statSync(join(supported.data, "opencode.db")).size).toBeGreaterThan(
			0,
		);
	},
);
