import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { expect, it } from "vitest";
import { registerResearchTools } from "./factoryResearch.js";

it("limits research to pinned regular blobs, excluding secrets, symlinks, arbitrary paths and writes", async () => {
	const root = mkdtempSync(join(tmpdir(), "factory-research-"));
	const git = (...args: string[]) =>
		execFileSync("git", ["-C", root, ...args], {
			encoding: "utf8",
			stdio: "pipe",
		}).trim();
	const server = new McpServer({ name: "research-test", version: "1" });
	const client = new Client({ name: "research-test", version: "1" });
	try {
		git("init", "-b", "main");
		writeFileSync(join(root, "README.md"), "Pinned architecture");
		writeFileSync(join(root, ".env"), "DO_NOT_READ=secret");
		symlinkSync("/etc/passwd", join(root, "escape"));
		git("add", "--force", ".");
		git(
			"-c",
			"user.name=Fixture",
			"-c",
			"user.email=f@example.test",
			"-c",
			"commit.gpgsign=false",
			"-c",
			"core.hooksPath=/dev/null",
			"commit",
			"-m",
			"Fixture",
		);
		registerResearchTools(server, {
			repositories: [{ id: "repo", root, revision: git("rev-parse", "HEAD") }],
			maxCalls: 10,
		});
		writeFileSync(
			join(root, "README.md"),
			"Uncommitted changes are not the baseline",
		);
		const [a, b] = InMemoryTransport.createLinkedPair();
		await server.connect(a);
		await client.connect(b);
		const call = (path: string, repositoryId = "repo") =>
			client.callTool({
				name: "read_repository",
				arguments: { repositoryId, path },
			});
		const listed = await client.callTool({
			name: "list_repository",
			arguments: { repositoryId: "repo" },
		});
		expect(
			JSON.parse((listed.content as { text: string }[])[0]!.text).paths,
		).toEqual(["README.md"]);
		const read = await call("README.md");
		expect(JSON.parse((read.content as { text: string }[])[0]!.text).text).toBe(
			"Pinned architecture",
		);
		for (const path of [
			".env",
			"escape",
			"../README.md",
			"/etc/passwd",
			":(glob)*",
			".git/config",
		])
			expect((await call(path)).isError).toBe(true);
		expect((await call("README.md", "other")).isError).toBe(true);
		const tools = await client.listTools();
		expect(tools.tools.map((t) => t.name).sort()).toEqual([
			"list_repository",
			"read_repository",
		]);
		for (let i = 0; i < 10; i++) await call("README.md");
		const exhausted = await call("README.md");
		expect(exhausted.isError).toBe(true);
		expect(JSON.stringify(exhausted)).toContain("budget exhausted");
	} finally {
		await client.close();
		await server.close();
		rmSync(root, { recursive: true, force: true });
	}
});
