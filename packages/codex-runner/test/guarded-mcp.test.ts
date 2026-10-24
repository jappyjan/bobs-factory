import {
	chmodSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UnsentDispatchError } from "bobs-factory-core";
import { expect, it, vi } from "vitest";
import { callCodexMcpTool } from "../src/callMcpTool.js";

it.each([
	"initialize",
	"thread/start",
	"mcpServerStatus/list",
])("checks after native %s preparation before the real stdin tool-call frame", async (held) => {
	const home = mkdtempSync(join(tmpdir(), "native-mcp-guard-"));
	const binary = join(home, "synthetic-codex.mjs"),
		log = join(home, "frames.jsonl");
	writeFileSync(
		binary,
		`#!${process.execPath}
import { createInterface } from 'node:readline';
import { appendFileSync, writeFileSync, existsSync } from 'node:fs';
const home = ${JSON.stringify(home)}, held = ${JSON.stringify(held)};
for await (const line of createInterface({input:process.stdin})) {
 const message = JSON.parse(line); appendFileSync(${JSON.stringify(log)}, line+'\\n');
 if (message.method === held) {
  writeFileSync(home+'/entered', 'ready');
  while (!existsSync(home+'/release')) await new Promise(resolve => setTimeout(resolve, 5));
 }
 const result = message.method === 'thread/start' ? {thread:{id:'synthetic-native-identity'}} : message.method === 'mcpServerStatus/list' ? {data:[{name:'taskbot',runtimeStatus:'connected'}]} : message.method === 'mcpServer/tool/call' ? {content:[],structuredContent:{ok:true}} : {};
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result})+'\\n');
}
`,
	);
	chmodSync(binary, 0o700);
	let current = true;
	const invoke = () =>
		callCodexMcpTool(
			{
				workingDirectory: home,
				codexPath: binary,
				codexHome: join(home, "synthetic-data"),
			},
			"taskbot",
			{ type: "http", url: "https://synthetic.invalid/mcp" },
			"comment",
			{ body: "Exact immutable displayed content" },
			AbortSignal.timeout(20000),
			{
				run: async (write) => {
					if (!current) throw new UnsentDispatchError("superseded");
					return { value: write() };
				},
			},
		);
	try {
		const pending = invoke();
		const rejected =
			expect(pending).rejects.toBeInstanceOf(UnsentDispatchError);
		// Spawning the synthetic binary can exceed the default 1s under load.
		await vi.waitFor(
			() => expect(existsSync(join(home, "entered"))).toBe(true),
			{ timeout: 15000 },
		);
		current = false;
		writeFileSync(join(home, "release"), "release");
		await rejected;
		const before = readFileSync(log, "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(before.map((frame) => frame.method)).toEqual([
			"initialize",
			"thread/start",
			"mcpServerStatus/list",
		]);
		expect(before[1].params.config.mcp_servers.taskbot.required).toBe(true);
		current = true;
		await expect(invoke()).resolves.toEqual({ ok: true });
		const after = readFileSync(log, "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(after.at(-1)).toMatchObject({
			method: "mcpServer/tool/call",
			params: {
				threadId: "synthetic-native-identity",
				server: "taskbot",
				tool: "comment",
				arguments: { body: "Exact immutable displayed content" },
			},
		});
		expect(after.filter((frame) => /turn|resume/.test(frame.method))).toEqual(
			[],
		);
		expect(Object.keys(after.at(-1).params)).toEqual([
			"threadId",
			"server",
			"tool",
			"arguments",
		]);
	} finally {
		writeFileSync(join(home, "release"), "release");
		rmSync(home, { recursive: true, force: true });
	}
}, 30000);
