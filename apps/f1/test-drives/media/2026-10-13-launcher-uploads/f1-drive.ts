// Isolated, headless-ready HTTP drive. All agents are deterministic F1 mocks.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { EdgeWorker } from "../../../../../packages/edge-worker/src/EdgeWorker.ts";
import { defaultWorkflows } from "../../../../../packages/edge-worker/src/factory/defaultWorkflows.ts";
import { WorkflowRuntime } from "../../../../../packages/edge-worker/src/factory/WorkflowRuntime.ts";
import { MockAgentRunner } from "../../../src/MockAgentRunner.ts";

assert.equal(
	process.env.F1_AGENT_MODE,
	"mock",
	"This drive requires F1_AGENT_MODE=mock",
);
const home = mkdtempSync(join(tmpdir(), "bobs85-f1-"));
process.env.BOBS_FACTORY_MIGRATION_SOURCE_CAPACITY_DIRECTORY = join(
	home,
	"legacy-capacity",
);
mkdirSync(process.env.BOBS_FACTORY_MIGRATION_SOURCE_CAPACITY_DIRECTORY);
delete process.env.BOBS_FACTORY_INTERNAL_EXECUTABLE;
const listener = createServer();
await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
const port = (listener.address() as { port: number }).port;
await new Promise<void>((resolve) => listener.close(() => resolve()));
process.env.BOBS_FACTORY_FACTORY_PORT = String(port);
const origin = `http://127.0.0.1:${port}`;
const repositories = ["app", "api"].map((id) => {
	const path = join(home, id);
	mkdirSync(path);
	const git = (...args: string[]) =>
		execFileSync("git", args, { cwd: path, stdio: "pipe" });
	git("init", "-b", "main");
	git("config", "user.email", "f1@example.test");
	git("config", "user.name", "F1");
	writeFileSync(join(path, "README.md"), "F1 isolated fixture");
	git("add", ".");
	git("commit", "-m", "fixture");
	git("remote", "add", "origin", path);
	return {
		id,
		name:
			id === "app"
				? "A project with a deliberately long name for layout checks"
				: "API",
		repositoryPath: path,
		workspaceBaseDir: join(home, "worktrees"),
		baseBranch: "main",
		githubUrl: `https://github.com/f1-test/${id}`,
		linearWorkspaceId: "cli-workspace",
		isActive: true,
		routingLabels: ["grouped"],
	};
});
let currentContext: any;
const runnerConfigs: any[] = [];
const simplePrompts: string[] = [];
const worker: any = new EdgeWorker({
	platform: "cli",
	factoryHome: home,
	serverPort: 0,
	serverHost: "localhost",
	repositories,
	linearWorkspaces: {
		"cli-workspace": { linearToken: "cli-mode-no-token-needed" },
	},
	handlers: {
		createAgentRunner: (_type: any, config: any) => {
			runnerConfigs.push(config);
			const runner = new MockAgentRunner(
				config,
				JSON.stringify({
					summary: "Simulated agent read submitted bytes",
					checks: ["bytes match"],
					questions: [],
					title: "F1 uploaded task",
				}),
			);
			const original = runner.start.bind(runner);
			runner.start = async (prompt: string) => {
				if (prompt.includes("Submitted workflow attachments")) {
					simplePrompts.push(prompt);
					assert.ok(prompt.includes("canonical paths"));
					const path = prompt.match(/"path": "([^"]+)"/)?.[1];
					assert.ok(path, "Simple instructions include a readable file path");
					assert.deepEqual(readFileSync(path), samples[2]!.bytes);
				}
				if (currentContext) {
					for (const asset of Object.values(
						currentContext.run.launchAttachments ?? {},
					).flat() as any[]) {
						assert.ok(
							config.allowedDirectories.includes(dirname(asset.path)),
							"runner can read only the claimed directory",
						);
						assert.deepEqual(
							readFileSync(asset.path),
							samples.find((item) => item.name === asset.name)!.bytes,
						);
					}
				}
				return original(prompt);
			};
			return runner;
		},
	},
});
const samples = [
	{
		name: "reference.png",
		bytes: Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNNsAAAAASUVORK5CYII=",
			"base64",
		),
		mime: "image/png",
	},
	{
		name: "spec.pdf",
		bytes: Buffer.from("%PDF-1.1\n%%EOF"),
		mime: "application/pdf",
	},
	{
		name: "notes.txt",
		bytes: Buffer.from("exact submitted text\n"),
		mime: "text/plain",
	},
	{
		name: "unknown.privatebinary",
		bytes: Buffer.from([0, 255, 4, 99]),
		mime: "",
	},
];
for (const sample of samples)
	writeFileSync(join(home, sample.name), sample.bytes);
await worker.start();
const runtime: any = worker.getFactoryRuntime();

const definitions = structuredClone(defaultWorkflows);
const factory = definitions.find((item) => item.id === "factory")!;
factory.steps = [
	{
		...factory.steps[0],
		id: "read",
		name: "Read uploaded files",
		type: "agent",
		prompt:
			"Read the submitted files from launchAttachments and return summary, checks and questions.",
		inputs: ["attachments"],
		json: true,
		maxVisits: 1,
		branches: [],
	},
];
// Parse/update through production workflow validation, preserving stock file inputs.
definitions.push({
	...factory,
	id: "without-files",
	name: "No attachment support",
	launchFields: factory.launchFields!.filter((field) => field.type !== "files"),
});
definitions.push({
	...factory,
	id: "required-files",
	name: "Required attachments",
	launchFields: factory.launchFields!.map((field) =>
		field.type === "files" ? { ...field, required: true } : field,
	),
});
runtime.updateWorkflows(definitions);
const originalAgent = runtime.hooks.agent;
runtime.hooks.agent = async (context: any) => {
	currentContext = context;
	assert.deepEqual(
		context.input.attachments,
		context.run.launchAttachments?.attachments ?? undefined,
	);
	assert.deepEqual(
		context.input.launchAttachments,
		context.run.launchAttachments,
	);
	try {
		return await originalAgent(context);
	} finally {
		currentContext = undefined;
	}
};
// Native HTTP consumes error responses completely and avoids Bun fetch socket
// reuse after intentionally oversized requests. Browser QA uses native Chrome fetch.
const httpFetch = async (
	url: string,
	options: RequestInit = {},
): Promise<Response> =>
	new Promise((resolve, reject) => {
		console.log(
			"REQUEST_START",
			options.method ?? "GET",
			new URL(url).pathname,
		);
		const req = httpRequest(
			url,
			{
				method: options.method,
				agent: false,
				headers: { ...options.headers, Connection: "close" },
			},
			(response) => {
				const chunks: Buffer[] = [];
				response.on("data", (chunk) => chunks.push(chunk));
				response.on("end", () => {
					resolve(
						new Response(Buffer.concat(chunks), {
							status: response.statusCode,
						}),
					);
				});
			},
		);
		req.setTimeout(10000, () =>
			req.destroy(new Error("HTTP fixture request timed out")),
		);
		req.on("error", reject);
		req.end(options.body);
	});
const getConfig = async () => (await httpFetch(`${origin}/api/config`)).json();
const config = await getConfig();
const headers = () => ({
	Origin: origin,
	"X-Factory-Request": "1",
	"X-Factory-Build": config.build ?? config.uiBuild ?? build,
	"X-Factory-Config": config.configRevision,
});
const build = (await (await httpFetch(`${origin}/api/version`)).json()).build;
const upload = async (
	draft: string,
	sample = samples[0]!,
	workflow = "factory",
): Promise<Response> => {
	const url = `${origin}/api/launch-assets?metadata=${encodeURIComponent(JSON.stringify({ draft, workflow, repositoryId: "app", repositoryIds: ["app", "api"], field: "attachments", name: sample.name, mime: sample.mime }))}`;

	return new Promise((resolve, reject) => {
		const req = httpRequest(
			url,
			{
				method: "POST",
				agent: false,
				headers: {
					Connection: "close",
					...headers(),
					"Content-Type": "application/octet-stream",
					"Content-Length": sample.bytes.length,
				},
			},
			(response) => {
				const chunks: Buffer[] = [];
				response.on("data", (chunk) => chunks.push(chunk));
				response.on("end", () => {
					resolve(
						new Response(Buffer.concat(chunks), {
							status: response.statusCode,
						}),
					);
					req.destroy();
				});
			},
		);
		req.setTimeout(10000, () => req.destroy(new Error("Upload timed out")));
		req.on("error", reject);
		req.end(sample.bytes);
	});
};
const launch = async (body: any) =>
	httpFetch(`${origin}/api/runs`, {
		method: "POST",
		headers: { ...headers(), "Content-Type": "application/json" },
		body: JSON.stringify({
			repositoryId: "app",
			repositoryIds: ["app", "api"],
			workflow: "factory",
			inputs: { prompt: "Read these files" },
			...body,
		}),
	});
const waitFor = async (id: string, status = "completed") => {
	for (let i = 0; i < 300; i++) {
		const run = runtime.get(id);
		if (run.status === status) return run;
		if (run.status === "failed") throw new Error(run.error);
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error(`Run ${id} did not become ${status}`);
};
try {
	const draft = randomUUID();
	const ids: string[] = [];
	for (const sample of samples) {
		const response = await upload(draft, sample);
		assert.equal(
			response.status,
			201,
			response.status === 201 ? "uploaded" : await response.text(),
		);
		ids.push((await response.json()).id);
	}
	const removed = ids.pop()!;
	const remove = await httpFetch(
		`${origin}/api/launch-assets/${draft}/${removed}`,
		{ method: "DELETE", headers: headers() },
	);
	assert.equal(remove.status, 200);
	assert.notEqual(
		(
			await launch({
				attachmentDraft: draft,
				attachments: { attachments: [...ids, removed] },
			})
		).status,
		202,
	);
	const binary = await upload(draft, samples[3]);
	assert.equal(binary.status, 201);
	ids.push((await binary.json()).id);
	assert.notEqual(
		(
			await launch({
				workflow: "without-files",
				attachmentDraft: draft,
				attachments: { attachments: ids },
			})
		).status,
		202,
	);
	assert.notEqual((await launch({ workflow: "required-files" })).status, 202);
	assert.notEqual(
		(await upload(randomUUID(), samples[0], "without-files")).status,
		201,
	);

	const oversized = await upload(randomUUID(), {
		name: "big",
		bytes: Buffer.alloc(25 * 1024 * 1024 + 1),
		mime: "",
	});
	assert.notEqual(oversized.status, 201);

	const first = await launch({
		attachmentDraft: draft,
		attachments: { attachments: ids },
	});
	assert.equal(
		first.status,
		202,
		first.status === 202 ? "admitted" : await first.text(),
	);
	const run = await waitFor((await first.json()).id);
	assert.deepEqual(
		run.repositories.map((repo: any) => repo.id),
		["app", "api"],
	);
	assert.equal(run.launchAttachments.attachments.length, 4);
	assert.notEqual(
		(
			await launch({
				attachmentDraft: draft,
				attachments: { attachments: ids },
			})
		).status,
		202,
	);
	assert.notEqual((await upload(draft)).status, 201);

	const raceDraft = randomUUID();
	const raceFile = await upload(raceDraft, samples[2]);
	const raceSelection = {
		attachmentDraft: raceDraft,
		attachments: { attachments: [(await raceFile.json()).id] },
	};
	const raced = await Promise.all([
		launch(raceSelection),
		launch(raceSelection),
	]);
	assert.equal(raced.filter((response) => response.status === 202).length, 1);
	await waitFor(
		(await raced.find((response) => response.status === 202)!.json()).id,
	);
	await runtime.flush(run.id);
	const recovered = new WorkflowRuntime(home, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
	});
	assert.deepEqual(
		recovered.get(run.id).launchAttachments,
		run.launchAttachments,
	);
	recovered.launchAssets.verify(
		run.id,
		recovered.get(run.id).launchAttachments,
	);
	await recovered.shutdown();
	// Actual failed-run retry restores the saved file manifest and role checkpoint.
	let fail = true;
	runtime.hooks.agent = async (context: any) => {
		if (fail) throw new Error("Simulated temporary failure");
		return originalAgent(context);
	};
	const retryDraft = randomUUID();
	const retryFile = await upload(retryDraft, samples[2]);
	const retryResponse = await launch({
		attachmentDraft: retryDraft,
		attachments: { attachments: [(await retryFile.json()).id] },
	});
	const retryId = (await retryResponse.json()).id;
	for (let i = 0; i < 300 && runtime.get(retryId).status !== "failed"; i++)
		await new Promise((resolve) => setTimeout(resolve, 25));
	assert.equal(runtime.get(retryId).status, "failed");
	fail = false;
	await runtime.retry(retryId);
	await waitFor(retryId);
	runtime.launchAssets.verify(retryId, runtime.get(retryId).launchAttachments);
	const simpleDraft = randomUUID();
	const simpleFile = await upload(simpleDraft, samples[2], "simple");
	const simpleResponse = await launch({
		workflow: "simple",
		attachmentDraft: simpleDraft,
		attachments: { attachments: [(await simpleFile.json()).id] },
	});
	assert.equal(
		simpleResponse.status,
		202,
		simpleResponse.status === 202 ? "admitted" : await simpleResponse.text(),
	);
	const simple = await waitFor((await simpleResponse.json()).id);
	assert.ok(simplePrompts.length);
	assert.ok(
		simple.simpleExecution.userPrompt.includes(
			simple.launchAttachments.attachments[0].path,
		),
	);
	assert.ok(
		runnerConfigs.some((config) =>
			config.allowedDirectories.includes(
				dirname(simple.launchAttachments.attachments[0].path),
			),
		),
	);
	console.log(
		JSON.stringify({
			result: "passed",
			origin,
			home,
			runId: run.id,
			retryId,
			simpleId: simple.id,
			assertions: [
				"real guarded HTTP binary upload",
				"PNG/PDF/text/unknown bytes",
				"removal",
				"unsupported/required fields",
				"per-file limit",
				"single claim, concurrent launch and late upload",
				"grouped scope",
				"simulated role reads exact bytes and has allowed directory",
				"persisted restart",
				"failed-run retry",
				"Simple manifest and read access",
			],
		}),
	);
	if (process.argv.includes("--serve")) {
		console.log(`BROWSER_FIXTURE ${origin} FILES ${home}`);
		await new Promise<void>((resolve) => {
			process.once("SIGTERM", resolve);
			process.once("SIGINT", resolve);
		});
	}
} finally {
	await worker.stop();
}

// The isolated harness has flushed/stopped its worker. Dispose Bun module timers
// as well so a successful drive does not leave a background process.
process.exit(0);
