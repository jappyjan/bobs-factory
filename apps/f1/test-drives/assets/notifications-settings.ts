// Isolated dashboard F1 fixture. All runners are simulated and push sends are recorded.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createECDH } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EdgeWorker } from "../../../../packages/edge-worker/dist/EdgeWorker.js";
import { FactoryPush } from "../../../../packages/edge-worker/dist/factory/FactoryPush.js";
import { f1AgentHandlers } from "../../dist/src/MockAgentRunner.js";

assert.equal(process.env.F1_AGENT_MODE, "mock");
const home = mkdtempSync(join(tmpdir(), "f1-notification-settings-"));
const repository = join(home, "repository");
mkdirSync(repository);
const git = (...args: string[]) =>
	execFileSync("git", args, { cwd: repository });
git("init", "-q", "-b", "main");
writeFileSync(
	join(repository, "README.md"),
	"# Notification Settings fixture\n",
);
git("add", ".");
git(
	"-c",
	"user.name=F1",
	"-c",
	"user.email=f1@example.invalid",
	"-c",
	"commit.gpgsign=false",
	"commit",
	"-qm",
	"Fixture",
);
git("remote", "add", "origin", repository);
process.env.BOBS_FACTORY_MIGRATION_SOURCE_CAPACITY_DIRECTORY = join(
	home,
	"old-capacity",
);
process.env.BOBS_FACTORY_FACTORY_PORT = "3647";
process.env.BOBS_FACTORY_FACTORY_ORIGIN =
	"https://notifications.fixture.invalid";
delete process.env.BOBS_FACTORY_FACTORY_PUBLIC_ORIGIN;
const repositories = [
	{
		id: "fixture",
		name: "Fixture",
		repositoryPath: repository,
		workspaceBaseDir: join(home, "worktrees"),
		baseBranch: "main",
		linearWorkspaceId: "cli-workspace",
		isActive: true,
	},
];
writeFileSync(join(home, "config.json"), JSON.stringify({ repositories }));
const sends: unknown[] = [];
const push = new FactoryPush(
	home,
	async (...args) => {
		sends.push(args);
	},
	Date.now,
	"",
);
const worker = new EdgeWorker({
	platform: "cli",
	factoryHome: home,
	repositories,
	serverPort: 3648,
	serverHost: "127.0.0.1",
	handlers: f1AgentHandlers("mock"),
});
// Inject the recording transport before the production dashboard initializes.
(worker as unknown as { factoryPush: FactoryPush }).factoryPush = push;
const ec = createECDH("prime256v1");
ec.generateKeys();
const evidence = process.env.F1_EVIDENCE_DIR!;
const keys = {
	p256dh: ec.getPublicKey().toString("base64url"),
	auth: Buffer.alloc(16, 1).toString("base64url"),
};
writeFileSync(
	join(evidence, "notification-fixture.json"),
	JSON.stringify({ home, keys, origin: "http://localhost:3647" }),
);
let stopping = false;
async function stop() {
	if (stopping) return;
	stopping = true;
	writeFileSync(
		join(evidence, "notification-sends.json"),
		JSON.stringify(sends),
	);
	await worker.stop();
	process.exit(0);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
await worker.start();
const server = (
	worker as unknown as {
		factoryServer: {
			app: { inject(input: unknown): Promise<{ statusCode: number }> };
		};
	}
).factoryServer;
for (const url of ["/api/config", "/api/push"]) {
	const response = await server.app.inject({
		method: "GET",
		url,
		headers: {
			host: "notifications.fixture.invalid",
			origin: "https://notifications.fixture.invalid",
		},
	});
	assert.equal(
		response.statusCode,
		401,
		`Signed-out remote access must protect ${url}`,
	);
}
writeFileSync(
	join(evidence, "notifications-protected-access.json"),
	JSON.stringify({ config: 401, push: 401 }),
);
console.log("PASS Signed-out remote config and push access remain protected");
console.log(`READY http://localhost:3647 ${home}`);
await new Promise(() => {});
