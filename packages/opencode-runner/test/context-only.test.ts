import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenCodeRunner } from "../src/OpenCodeRunner.js";
import type { OpenCodeRunnerConfig } from "../src/types.js";

const directories: string[] = [];
afterEach(() => {
	vi.unstubAllEnvs();
	for (const directory of directories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});

function fixture(sessionId = "ses_context_only") {
	const directory = mkdtempSync(join(tmpdir(), "opencode-context-profile-"));
	directories.push(directory);
	const capture = join(directory, "native-options.json");
	const metadata = join(directory, "native-permission-metadata.json");
	const preflight = join(directory, "native-preflight.json");
	const providerMetadata = join(directory, "native-provider-metadata.json");
	const providerProbe = join(directory, "native-provider-probe.json");
	const executable = join(directory, "provider-transport.mjs");
	writeFileSync(
		executable,
		`#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
if(process.argv[2]==="providers") {
 writeFileSync(${JSON.stringify(providerProbe)},JSON.stringify({argv:process.argv.slice(2),modelsFetch:process.env.OPENCODE_DISABLE_MODELS_FETCH}));
 const output=JSON.parse(readFileSync(${JSON.stringify(providerMetadata)},"utf8"));
 if(output.unsupported) process.exit(1);
 if(output.timeout) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,6000);
 process.stdout.write(typeof output==="string"?output:JSON.stringify(output));
 process.exit(0);
}
if(process.argv[2]==="db") {
 writeFileSync(${JSON.stringify(preflight)},JSON.stringify(process.argv.slice(2)));
 const metadata = existsSync(${JSON.stringify(metadata)}) ? JSON.parse(readFileSync(${JSON.stringify(metadata)},"utf8")) : [{remoteOrg:0,savedPermissions:0,sessionPermission:JSON.stringify([{permission:"question",action:"deny",pattern:"*"}])}];
 if(metadata.unsupported) process.exit(1);
 process.stdout.write(JSON.stringify(metadata));
 process.exit(0);
}
readFileSync(0, "utf8");
writeFileSync(${JSON.stringify(capture)}, JSON.stringify({
 argv:process.argv.slice(2),
 config:JSON.parse(process.env.OPENCODE_CONFIG_CONTENT),
 permission:JSON.parse(process.env.OPENCODE_PERMISSION),
 env:Object.fromEntries(["HOME","XDG_DATA_HOME","XDG_CONFIG_HOME","OPENCODE_CONFIG_DIR","OPENCODE_CONFIG","OPENCODE_DISABLE_PROJECT_CONFIG","OPENCODE_DISABLE_CLAUDE_CODE","OPENCODE_DISABLE_EXTERNAL_SKILLS","OPENCODE_DISABLE_DEFAULT_PLUGINS"].map(key=>[key,process.env[key]]))
}));
mkdirSync(process.env.XDG_DATA_HOME+"/opencode",{recursive:true});
writeFileSync(process.env.XDG_DATA_HOME+"/opencode/opencode.db","native-transport-fixture");
process.stdout.write(JSON.stringify({type:"step_start",sessionID:${JSON.stringify(sessionId)}})+"\\n");
process.stdout.write(JSON.stringify({type:"text",part:{text:"Accepted context read."}})+"\\n");
process.stdout.write(JSON.stringify({type:"step_finish",reason:"stop"})+"\\n");
`,
		{ mode: 0o755 },
	);
	const config: OpenCodeRunnerConfig = {
		factoryHome: directory,
		workingDirectory: directory,
		openCodePath: executable,
		toolProfile: "context-only",
		model: "openai/selected-model",
		agent: "inherited-broad-agent",
		allowedTools: ["Read", "Bash", "Task", "mcp__factory-context__*"],
		allowedDirectories: ["/private"],
		childEnvironment: {
			PATH: process.env.PATH!,
			HOME: join(directory, "native-home"),
			XDG_DATA_HOME: join(directory, "native-data"),
		},
		env: {
			OPENCODE_PERMISSION: '{"*":"allow"}',
			OPENCODE_CONFIG: "/untrusted/config.json",
		},
		mcpConfig: {
			"factory-context": { type: "http", url: "http://127.0.0.1:1/context" },
			other: { command: "malicious" },
		},
		opencodeGlobalConfig: {
			plugin: ["untrusted-global"],
			permission: { "*": "allow" },
		},
		opencodeRepositoryConfig: {
			instructions: ["/private/secret"],
			plugin: ["untrusted-project"],
			agent: { "factory-context-only": { permission: { "*": "allow" } } },
			mcp: {
				inherited: { type: "local", command: ["malicious"], enabled: true },
			},
		},
		onError: vi.fn(),
	};
	return {
		directory,
		capture,
		config,
		metadata,
		preflight,
		providerMetadata,
		providerProbe,
	};
}

describe("OpenCode context-only native process boundary", () => {
	it.each([
		{
			label: "well-known remote config",
			output:
				"┌ Credentials /native/auth.json\n● Workspace wellknown\n└ 1 credentials\n",
		},
		{
			label: "unknown auth mode",
			output:
				"┌ Credentials /native/auth.json\n● Workspace managed\n└ 1 credentials\n",
		},
		{ label: "unparseable metadata", output: "unrecognized output" },
		{ label: "old CLI", output: { unsupported: true } },
		{ label: "bounded oversized metadata", output: "x".repeat(20_000) },
	])("refuses $label before a new model turn even without an existing database", async ({
		output,
	}) => {
		const { directory, capture, config, providerMetadata, providerProbe } =
			fixture();
		const native = join(directory, "native-data/opencode");
		mkdirSync(native, { recursive: true });
		const auth = join(native, "auth.json");
		const originalAuth =
			"private fixture bytes: the runner must not read or copy this file";
		writeFileSync(auth, originalAuth);
		writeFileSync(providerMetadata, JSON.stringify(output));
		const runner = new OpenCodeRunner(config);
		await runner.start("No remote configuration or plugin may execute");
		expect(existsSync(capture)).toBe(false);
		expect(existsSync(join(native, "opencode.db"))).toBe(false);
		expect(readFileSync(auth, "utf8")).toBe(originalAuth);
		expect(JSON.parse(readFileSync(providerProbe, "utf8"))).toEqual({
			argv: ["providers", "list"],
			modelsFetch: "1",
		});
		expect(runner.getMessages().at(-1)).toMatchObject({ is_error: true });
	});

	// The production probe's 5s deadline needs its own test budget plus process
	// startup/cleanup. This does not lengthen the production timeout.
	it("terminates a silent metadata probe within its native deadline before a model turn", async () => {
		const { directory, config, capture, providerMetadata } = fixture();
		const native = join(directory, "native-data/opencode");
		mkdirSync(native, { recursive: true });
		writeFileSync(join(native, "auth.json"), "private fixture bytes untouched");
		writeFileSync(providerMetadata, JSON.stringify({ timeout: true }));
		const started = performance.now();
		const runner = new OpenCodeRunner(config);
		await runner.start("A hung metadata command cannot start a model turn");
		expect(performance.now() - started).toBeLessThan(7_000);
		expect(existsSync(capture)).toBe(false);
		expect(runner.getMessages().at(-1)).toMatchObject({ is_error: true });
	}, 8_000);

	it.each([
		"api",
		"oauth",
	])("retains native %s authentication and permits a new turn after metadata-only verification", async (mode) => {
		const { directory, config, capture, providerMetadata } = fixture();
		const native = join(directory, "native-data/opencode");
		mkdirSync(native, { recursive: true });
		writeFileSync(join(native, "auth.json"), "private fixture bytes untouched");
		writeFileSync(
			providerMetadata,
			JSON.stringify(
				`┌ Credentials /native/auth.json\n│\n● Fixture ${mode}\n└ 1 credentials\n`,
			),
		);
		const runner = new OpenCodeRunner(config);
		await runner.start("Accepted context only");
		expect(runner.getMessages().at(-1)).toMatchObject({ is_error: false });
		expect(JSON.parse(readFileSync(capture, "utf8")).env.XDG_DATA_HOME).toBe(
			join(directory, "native-data"),
		);
	});

	it.each([
		1,
		undefined,
	])("refuses active or unverifiable remote organization metadata (%s) without replacing native history", async (remoteOrg) => {
		const { capture, config, metadata } = fixture();
		await new OpenCodeRunner(config).start(
			"Create restricted original conversation",
		);
		const original = readFileSync(capture, "utf8");
		writeFileSync(
			metadata,
			JSON.stringify([
				{ remoteOrg, savedPermissions: 0, sessionPermission: "[]" },
			]),
		);
		const runner = new OpenCodeRunner({
			...config,
			resumeSessionId: "ses_context_only",
		});
		const session = await runner.start("No remote org config turn");
		expect(session.sessionId).toBe("ses_context_only");
		expect(readFileSync(capture, "utf8")).toBe(original);
		expect(runner.getMessages().at(-1)).toMatchObject({ is_error: true });
	});

	it("preserves an attested native identity when authentication later enables remote configuration", async () => {
		const { directory, capture, config, providerMetadata } = fixture();
		await new OpenCodeRunner(config).start("Original restricted native thread");
		const original = readFileSync(capture, "utf8");
		writeFileSync(
			join(directory, "native-data/opencode/auth.json"),
			"private auth fixture untouched",
		);
		writeFileSync(
			providerMetadata,
			JSON.stringify("● Workspace wellknown\n└ 1 credentials\n"),
		);
		const runner = new OpenCodeRunner({
			...config,
			resumeSessionId: "ses_context_only",
		});
		const session = await runner.start("Refuse changed remote authority");
		expect(session.sessionId).toBe("ses_context_only");
		expect(readFileSync(capture, "utf8")).toBe(original);
		expect(runner.getMessages().at(-1)).toMatchObject({ is_error: true });
	});
	it("passes exact final permissions and isolated configuration discovery on a new and attested resumed conversation", async () => {
		const { directory, capture, config, preflight } = fixture();
		const expectedPermission = {
			"*": "deny",
			"factory-context_list_context": "allow",
			"factory-context_read_context": "allow",
		};
		for (const resumeSessionId of [undefined, "ses_context_only"]) {
			const runner = new OpenCodeRunner({ ...config, resumeSessionId });
			const session = await runner.start("Read accepted context only.");
			expect(session.sessionId).toBe("ses_context_only");
			expect(runner.getMessages().at(-1)).toMatchObject({ is_error: false });
			const native = JSON.parse(readFileSync(capture, "utf8"));
			expect(native.config).toEqual({
				$schema: "https://opencode.ai/config.json",
				mcp: {
					"factory-context": {
						type: "remote",
						url: "http://127.0.0.1:1/context",
						oauth: false,
						enabled: true,
					},
				},
				permission: expectedPermission,
				default_agent: "factory-context-only",
				agent: {
					"factory-context-only": {
						mode: "primary",
						permission: expectedPermission,
					},
				},
				plugin: [],
				instructions: [],
			});
			expect(native.permission).toEqual(expectedPermission);
			expect(
				native.argv.slice(
					native.argv.indexOf("--agent"),
					native.argv.indexOf("--agent") + 2,
				),
			).toEqual(["--agent", "factory-context-only"]);
			expect(
				native.argv.slice(
					native.argv.indexOf("--model"),
					native.argv.indexOf("--model") + 2,
				),
			).toEqual(["--model", "openai/selected-model"]);
			if (resumeSessionId)
				expect(native.argv.slice(-2)).toEqual(["--session", resumeSessionId]);
			if (resumeSessionId) {
				const args = JSON.parse(readFileSync(preflight, "utf8"));
				expect(args[0]).toBe("db");
				expect(args.slice(-2)).toEqual(["--format", "json"]);
				expect(args[1]).toContain("id = 'ses_context_only'");
				expect(args[1]).not.toMatch(/auth|message|part|token|SELECT \*/i);
			}
			expect(native.env).toMatchObject({
				HOME: join(directory, "opencode-state/context-only/home"),
				XDG_DATA_HOME: join(directory, "native-data"),
				XDG_CONFIG_HOME: join(directory, "opencode-state/context-only/config"),
				OPENCODE_CONFIG_DIR: join(
					directory,
					"opencode-state/context-only/config/opencode",
				),
				OPENCODE_CONFIG: "",
				OPENCODE_DISABLE_PROJECT_CONFIG: "1",
				OPENCODE_DISABLE_CLAUDE_CODE: "1",
				OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
				OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
			});
		}
	});

	it.each([
		{
			label: "saved project approvals",
			value: [{ remoteOrg: 0, savedPermissions: 1, sessionPermission: "[]" }],
		},
		{
			label: "broader session approval",
			value: [
				{
					remoteOrg: 0,
					savedPermissions: 0,
					sessionPermission: JSON.stringify([
						{ permission: "bash", action: "allow", pattern: "*" },
					]),
				},
			],
		},
		{
			label: "missing session",
			value: [{ remoteOrg: 0, savedPermissions: 0, sessionPermission: null }],
		},
		{ label: "unsupported CLI", value: { unsupported: true } },
		{
			label: "oversized metadata",
			value: [
				{
					remoteOrg: 0,
					savedPermissions: 0,
					sessionPermission: "x".repeat(20_000),
				},
			],
		},
	])("refuses $label before a model turn", async ({
		value: permissionMetadata,
	}) => {
		const { capture, config, metadata } = fixture();
		await new OpenCodeRunner(config).start("Create restricted conversation");
		const original = readFileSync(capture, "utf8");
		writeFileSync(metadata, JSON.stringify(permissionMetadata));
		const runner = new OpenCodeRunner({
			...config,
			resumeSessionId: "ses_context_only",
		});
		const session = await runner.start("Must not reach a model turn");
		expect(session.sessionId).toBe("ses_context_only");
		expect(readFileSync(capture, "utf8")).toBe(original);
		expect(runner.getMessages().at(-1)).toMatchObject({
			is_error: true,
			errors: [
				"Context-only OpenCode could not verify that native saved permissions are restricted. Native history is preserved; refusing a model turn.",
			],
		});
	});

	it("escapes the owned native session identity in the read-only metadata query", async () => {
		const sessionId = "ses_quote'id";
		const { config, preflight } = fixture(sessionId);
		await new OpenCodeRunner(config).start("Create restricted conversation");
		await new OpenCodeRunner({ ...config, resumeSessionId: sessionId }).start(
			"Resume exact conversation",
		);
		const args = JSON.parse(readFileSync(preflight, "utf8"));
		expect(args[1]).toContain("id = 'ses_quote''id'");
	});

	it("conservatively refuses a new turn in an existing data store with saved project approvals", async () => {
		const { capture, config, metadata, preflight } = fixture();
		await new OpenCodeRunner(config).start("Initialize fixture native store");
		const original = readFileSync(capture, "utf8");
		writeFileSync(
			metadata,
			JSON.stringify([
				{ remoteOrg: 0, savedPermissions: 1, sessionPermission: "[]" },
			]),
		);
		const runner = new OpenCodeRunner(config);
		await runner.start("New model turn must not start");
		expect(readFileSync(capture, "utf8")).toBe(original);
		expect(JSON.parse(readFileSync(preflight, "utf8"))[1]).not.toContain(
			"FROM session",
		);
		expect(runner.getMessages().at(-1)).toMatchObject({ is_error: true });
	});

	it("retains the native identity when the native metadata CLI is unavailable", async () => {
		const { directory, config } = fixture();
		await new OpenCodeRunner(config).start("Create restricted conversation");
		const runner = new OpenCodeRunner({
			...config,
			openCodePath: join(directory, "missing-opencode"),
			resumeSessionId: "ses_context_only",
		});
		const session = await runner.start("No replacement conversation");
		expect(session.sessionId).toBe("ses_context_only");
		expect(runner.getMessages().at(-1)).toMatchObject({ is_error: true });
	});

	it("refuses an unattested broader native resume before spawning while preserving native history", async () => {
		const { directory, capture, config } = fixture();
		const historyPath = join(directory, "original-native-history.jsonl");
		const history = '{"accepted":"original immutable conversation"}\n';
		writeFileSync(historyPath, history);
		const runner = new OpenCodeRunner({
			...config,
			resumeSessionId: "ses_before_profile",
		});
		const session = await runner.start("Attempt broader resume");
		expect(session.sessionId).toBe("ses_before_profile");
		expect(existsSync(capture)).toBe(false);
		expect(readFileSync(historyPath, "utf8")).toBe(history);
		expect(runner.getMessages().at(-1)).toMatchObject({
			is_error: true,
			errors: [
				"This OpenCode conversation has no matching context-only permission receipt. Its native history is preserved; refusing to resume broader saved permissions.",
			],
		});
	});

	it("does not reuse a context receipt for another working directory or native data store", async () => {
		const { directory, capture, config } = fixture();
		await new OpenCodeRunner(config).start("Create restricted conversation");
		const captured = readFileSync(capture, "utf8");
		for (const change of [
			{ workingDirectory: join(directory, "different-repository") },
			{
				childEnvironment: {
					...config.childEnvironment,
					XDG_DATA_HOME: join(directory, "different-data"),
				},
			},
		]) {
			const runner = new OpenCodeRunner({
				...config,
				...change,
				resumeSessionId: "ses_context_only",
			});
			await runner.start("Resume with different native owner");
			expect(runner.getMessages().at(-1)).toMatchObject({ is_error: true });
			expect(readFileSync(capture, "utf8")).toBe(captured);
		}
	});
});
