// Run from the repository root after building bobs-factory-edge-worker and bobs-factory-f1.
// F1_AGENT_MODE=mock is mandatory; embedded workers explicitly inject simulated
// runners, including background titles. No live provider is reachable.
// Uses headless Playwright because agent-browser 0.27 screenshot capture stalled.
// Supply F1_PLAYWRIGHT_MODULE when Playwright is installed outside this workspace.
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

assert.equal(process.env.F1_AGENT_MODE, "mock");
const root = process.cwd();
const home = mkdtempSync(join(tmpdir(), "choices-ec390161-mock-"));
const repo = join(home, "repo");
const evidence = process.env.F1_EVIDENCE_DIR ?? join(home, "evidence");
mkdirSync(repo);
mkdirSync(evidence, { recursive: true });
const git = (...args) => execFileSync("git", args, { cwd: repo });
git("init", "-b", "main");
git("config", "user.name", "F1 Fixture");
git("config", "user.email", "f1@example.test");
writeFileSync(join(repo, "README.md"), "Isolated mocked refinement fixture\n");
git("-c", "commit.gpgsign=false", "add", ".");
git("-c", "commit.gpgsign=false", "commit", "-m", "Initial fixture");
git("remote", "add", "origin", repo);

// Keep the real bounded admission mechanism in a temporary fixture pool.
// Never edit or increase the production pool, and never start a live agent.
// This fresh fixture has no legacy coordinator; isolate migration checks too.
process.env.BOBS_FACTORY_MIGRATION_SOURCE_CAPACITY_DIRECTORY = join(
	home,
	"legacy-capacity",
);
process.env.BOBS_FACTORY_FACTORY_PORT = "3543";
const { EdgeWorker } = await import(
	join(root, "packages/edge-worker/dist/index.js")
);
const { CLIIssueTrackerService } = await import(
	join(root, "packages/core/dist/index.js")
);
const { LinearActivitySink } = await import(
	join(root, "packages/edge-worker/dist/sinks/LinearActivitySink.js")
);
const tracker = new CLIIssueTrackerService();
tracker.seedDefaultData();
const workerConfig = {
	platform: "cli",
	factoryHome: home,
	serverPort: 3623,
	serverHost: "127.0.0.1",
	defaultRunner: "codex",
	repositories: [
		{
			id: "fixture",
			name: "Refinement fixture",
			repositoryPath: repo,
			workspaceBaseDir: join(home, "worktrees"),
			baseBranch: "main",
			linearWorkspaceId: "cli-workspace",
			isActive: true,
		},
	],
};
let worker = new EdgeWorker(workerConfig);
worker.issueTrackers.set("cli-workspace", tracker);
worker.activitySinks.set(
	"cli-workspace",
	new LinearActivitySink(tracker, "cli-workspace"),
);
const calls = [];
const questions = [
	"Which strategy?",
	"Which platforms?",
	"When should notifications arrive?",
	"Anything else?",
];
const choices = [
	{
		questionIndex: 0,
		selection: "single",
		options: [
			{ id: "examples", answer: "Explain using examples" },
			{ id: "text", answer: "Use text" },
		],
		preselectedOptionIds: ["examples"],
	},
	{
		questionIndex: 1,
		selection: "multiple",
		options: [
			{ id: "web", answer: "Web dashboard", reason: "Browser access" },
			{
				id: "terminal",
				answer: "Terminal UI",
				reason: "Local developer access",
			},
		],
		preselectedOptionIds: ["web", "terminal"],
	},
];
let choiceContract = choices;
const recommendations = [
	{ questionIndex: 2, answer: "Daily digest", reason: "Fewer interruptions" },
];
const mockedRunner = (type, config) => {
	assert.equal(type, "codex");
	let messages = [];
	return {
		supportsStreamingInput: false,
		isRunning: () => false,
		stop() {},
		getMessages: () => messages,
		async start(prompt) {
			const contextConfig = config.mcpConfig?.["factory-context"];
			if (!contextConfig) {
				// The unrelated automatic title job also uses the injected runner.
				assert.match(config.appendSystemPrompt ?? "", /title/i);
				messages = [
					{
						type: "result",
						subtype: "success",
						result: '{"title":"Mocked refinement fixture"}',
					},
				];
				config.onMessage?.(messages[0]);
				return { sessionId: "mock-title" };
			}
			const snapshotPath = contextConfig.args.find((arg) =>
				arg.endsWith(".json"),
			);
			assert.ok(snapshotPath, JSON.stringify(contextConfig.args));
			const input = JSON.parse(readFileSync(snapshotPath, "utf8"));
			assert.match(config.appendSystemPrompt, /questionRecommendations/);
			assert.match(
				config.appendSystemPrompt,
				/explicit human submission is required/,
			);
			const answered = input.answers.length > 0;
			// Canned output establishes transport/retention, never model reasoning.
			const output = answered
				? { questions: [], decisions: [], requirements: [] }
				: {
						questions,
						questionRecommendations: recommendations,
						questionChoices: choiceContract,
						decisions: [],
						requirements: [],
					};
			calls.push({
				input,
				output,
				prompt,
				instruction: config.appendSystemPrompt,
			});
			const sessionId = `mock-question-${calls.length}`;
			config.onMessage?.({
				type: "system",
				subtype: "init",
				session_id: sessionId,
			});
			messages = [
				{ type: "result", subtype: "success", result: JSON.stringify(output) },
			];
			config.onMessage?.(messages[0]);
			return { sessionId };
		},
	};
};
worker.buildRunnerForType = mockedRunner;
let runtime = worker.getFactoryRuntime();
const runCommand = promisify(execFile);
const commands = [];
async function command(file, args, env = {}) {
	const result = await runCommand(file, args, {
		cwd: root,
		env: { ...process.env, ...env },
		timeout: 30000,
		maxBuffer: 1024 * 1024,
	});
	commands.push({ file, args, stdout: result.stdout, stderr: result.stderr });
	writeFileSync(
		join(evidence, "choices-mock-commands.json"),
		JSON.stringify(commands, null, 2),
	);
	// biome-ignore lint/suspicious/noControlCharactersInRegex: F1 CLI emits ANSI colors.
	return result.stdout.replace(/\u001b\[[0-9;]*m/g, "");
}
const f1 = (...args) =>
	command(join(root, "apps/f1/f1"), args, { BOBS_FACTORY_PORT: "3623" });
const { chromium } = await import(
	process.env.F1_PLAYWRIGHT_MODULE ?? "playwright"
);
const browserInstance = await chromium.launch({ headless: true });
let page;
async function until(check) {
	const deadline = Date.now() + 30000;
	while (Date.now() < deadline) {
		const value = check();
		if (value) return value;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error("Timed out waiting for fixture state");
}
const records = [];
try {
	await worker.start();
	runtime.updateWorkflows([
		...runtime.listWorkflows(),
		{
			id: "choices-mock",
			name: "Mocked refinement transport",
			labels: ["workflow:choices-mock"],
			allowedTriggers: ["manual", "ticket-assignment"],
			steps: [
				{
					id: "clarify",
					name: "Clarify preferences",
					type: "agent",
					runner: "codex",
					askQuestions: true,
					prompt:
						'Read all ticket context and explicit answers. Ask for notification channel and schedule. Return {"questions":[],"decisions":[],"requirements":[]}.',
				},
				{
					id: "receipt",
					name: "Record explicit answers",
					type: "script",
					computeIntensive: false,
					script:
						'node -e \'const fs=require("node:fs");const input=JSON.parse(fs.readFileSync(process.env.FACTORY_INPUT_FILE,"utf8"));console.log(JSON.stringify({answers:input.answers}));\'',
				},
			],
		},
	]);
	await f1("ping");
	for (const method of ["dashboard", "dashboard-custom", "ticket"]) {
		choiceContract =
			method === "dashboard-custom"
				? choices.map((choice, index) => {
						if (index !== 0) return choice;
						const { preselectedOptionIds, ...withoutDefaults } = choice;
						return withoutDefaults;
					})
				: choices;
		const created = await f1(
			"create-issue",
			"--title",
			`Preferences ${method}`,
			"--description",
			"Detailed nonurgent updates; no SMS budget; prefer fewer interruptions. Ask separately for notification channel and schedule. Do not implement or publish.",
			"--labels",
			"workflow:choices-mock,codex",
		);
		const issueId = created.match(/ID: (issue-\d+)/)?.[1];
		assert.ok(issueId, created);
		const started = await f1("start-session", "--issue-id", issueId);
		const id = started.match(/Session ID: (session-\d+)/)?.[1];
		assert.ok(id, started);
		let run = await until(
			() => runtime.runs.get(id)?.status === "waiting" && runtime.get(id),
		);
		assert.deepEqual(run.questionRecommendations, recommendations);
		assert.deepEqual(run.questionChoices, choiceContract);
		assert.deepEqual(run.answers, []);
		assert.equal(run.outputs.receipt, undefined);
		const batchBeforeRestart = run.questionBatchId;
		const oldContext = {
			questions: [...run.questions],
			step: run.step,
			questionBatchId: batchBeforeRestart,
		};
		const receiptsBeforeRestart = structuredClone(
			(run.ticketSync?.receipts ?? []).filter((receipt) =>
				receipt.key.startsWith("questions:"),
			),
		);
		if (method.startsWith("dashboard")) {
			if (method === "dashboard-custom")
				run.outputs.clarify.questionChoices[0].options[0].reason =
					"Updated option guidance";
			await runtime.save(run);
			await worker.stop();
			worker = new EdgeWorker(workerConfig);
			worker.issueTrackers.set("cli-workspace", tracker);
			worker.activitySinks.set(
				"cli-workspace",
				new LinearActivitySink(tracker, "cli-workspace"),
			);
			worker.buildRunnerForType = mockedRunner;
			runtime = worker.getFactoryRuntime();
			await worker.start();
			run = await until(
				() => runtime.pendingAnswers.has(id) && runtime.get(id),
			);
			assert.deepEqual(run.answers, []);
			if (method === "dashboard") {
				assert.equal(run.questionBatchId, batchBeforeRestart);
				assert.deepEqual(run.questionChoices, choiceContract);
				assert.deepEqual(
					(run.ticketSync?.receipts ?? []).filter((receipt) =>
						receipt.key.startsWith("questions:"),
					),
					receiptsBeforeRestart,
				);
			} else {
				assert.notEqual(run.questionBatchId, batchBeforeRestart);
				assert.equal(
					(run.ticketSync?.receipts ?? []).filter((receipt) =>
						receipt.key.startsWith("questions:"),
					).length,
					2,
				);
				const { OperatorService } = await import(
					join(root, "packages/edge-worker/dist/factory/OperatorService.js")
				);
				const operator = new OperatorService(
					runtime,
					{ stop() {} },
					"F1 choices",
				);
				await assert.rejects(
					operator.answer(id, "Use text", "answer", oldContext),
					(error) => error.code === "stale_state",
				);
			}
		}

		const waiting = structuredClone(run);

		if (method.startsWith("dashboard")) {
			if (page) await page.close();
			page = await browserInstance.newPage();
			page.setDefaultTimeout(10000);
			await page.goto(`http://127.0.0.1:3543/#/runs/${id}`);
			try {
				await page.locator('input[type="radio"]').first().waitFor();
			} catch (error) {
				console.error("Browser state:", await page.locator("body").innerText());
				console.error("Run:", run.status, run.error);
				throw error;
			}
			await page.setViewportSize({ width: 1280, height: 1100 });
			assert.equal(
				await page
					.getByRole("radio", { name: /^Explain using examples/ })
					.isChecked(),
				method !== "dashboard-custom",
			);
			assert.equal(
				await page
					.getByRole("checkbox", {
						name: "Web dashboard Browser access",
						exact: true,
					})
					.isChecked(),
				true,
			);
			assert.equal(
				await page
					.getByRole("checkbox", {
						name: "Terminal UI Local developer access",
						exact: true,
					})
					.isChecked(),
				true,
			);
			assert.equal(
				await page.getByRole("button", { name: "Send answers" }).isDisabled(),
				true,
			);
			assert.deepEqual(run.answers, []);
			await page.screenshot({
				path: join(evidence, `choices-${method}-defaults.png`),
				fullPage: true,
				animations: "disabled",
				timeout: 10000,
			});
			await page.locator(`#answer-${id}-3`).fill("No other requirements");
			if (method === "dashboard-custom") {
				assert.equal(
					await page.getByRole("button", { name: "Send answers" }).isDisabled(),
					true,
				);
				const strategy = page.getByRole("radio", {
					name: /^Explain using examples/,
				});
				await strategy.focus();
				await page.keyboard.press("Space");
				assert.equal(await strategy.isChecked(), true);
			}

			const terminal = page.getByRole("checkbox", {
				name: "Terminal UI Local developer access",
				exact: true,
			});
			await terminal.focus();
			await page.keyboard.press("Space");
			assert.equal(await terminal.isChecked(), false);
			await page.keyboard.press("Space");
			assert.equal(await terminal.isChecked(), true);
			const custom = page
				.getByRole("radio", { name: "Custom answer", exact: true })
				.first();
			await custom.check();
			assert.equal(
				await page.getByRole("button", { name: "Send answers" }).isDisabled(),
				true,
			);
			assert.equal(
				await page
					.locator(`#answer-${id}-0`)
					.evaluate((el) => el === document.activeElement),
				true,
			);
			await page.locator(`#answer-${id}-0`).fill("A custom strategy");
			await page
				.getByRole("radio", { name: "Predefined answers", exact: true })
				.first()
				.check();
			await custom.check();
			assert.equal(
				await page.locator(`#answer-${id}-0`).inputValue(),
				"A custom strategy",
			);
			await runtime.save(run);
			await page.waitForTimeout(150);
			assert.equal(
				await page.locator(`#answer-${id}-3`).inputValue(),
				"No other requirements",
			);

			await page.setViewportSize({ width: 390, height: 844 });
			await page.screenshot({
				path: join(evidence, "choices-custom-mobile.png"),
				fullPage: true,
				animations: "disabled",
				timeout: 10000,
			});
			assert.equal(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth,
				),
				true,
			);
			if (method === "dashboard")
				await page
					.getByRole("radio", { name: "Predefined answers", exact: true })
					.first()
					.check();
			await page.setViewportSize({ width: 1280, height: 1100 });
			await page.screenshot({
				path: join(evidence, `choices-${method}-selected.png`),
				fullPage: true,
				animations: "disabled",
				timeout: 10000,
			});
			await page.route(
				`**/api/runs/${id}/answer`,
				(route) =>
					route.fulfill({
						status: 400,
						headers: {
							"X-Factory-Build": route.request().headers()["x-factory-build"],
						},
						contentType: "application/json",
						body: JSON.stringify({
							error: "Fixture recoverable request failure",
						}),
					}),
				{
					times: 1,
				},
			);
			await page.getByRole("button", { name: "Send answers" }).click();
			await page.getByRole("alert").first().waitFor();
			assert.deepEqual(run.answers, []);
			assert.equal(
				await page.locator(`#answer-${id}-3`).inputValue(),
				"No other requirements",
			);
			await page.getByRole("button", { name: "Send answers" }).click();
		} else {
			await f1(
				"prompt-session",
				"--session-id",
				id,
				"--message",
				"Use Email and Daily digest.",
			);
		}
		await until(() => run.status === "completed");
		assert.equal(run.answers.length, 1);
		assert.equal(
			run.answers[0].answer,
			method.startsWith("dashboard")
				? questions
						.map(
							(q, i) =>
								`${i + 1}. ${q}\n${[method === "dashboard-custom" ? "A custom strategy" : "Explain using examples", "- Web dashboard\n- Terminal UI", "Daily digest", "No other requirements"][i]}`,
						)
						.join("\n\n")
				: "Use Email and Daily digest.",
		);
		assert.deepEqual(run.outputs.receipt.answers, run.answers);
		assert.equal(
			run.history.filter((entry) => entry.step === "receipt").length,
			1,
		);
		assert.equal(
			calls.filter(
				(call) =>
					call.input.answers.length &&
					call.input.answers[0].answer === run.answers[0].answer,
			).length,
			1,
		);
		await f1("view-session", "--session-id", id, "--limit", "10");
		records.push({ method, waiting, completed: structuredClone(run) });
	}
	assert.equal(calls.length, 6);
	writeFileSync(
		join(evidence, "choices-mock-path.json"),
		JSON.stringify(
			{
				headSha: execFileSync("git", ["rev-parse", "HEAD"], {
					cwd: root,
					encoding: "utf8",
				}).trim(),
				mode: "mock",
				home,
				browser: "Playwright Chromium headless",
				records,
				calls,
				commands,
				limitations: [
					"Canned agent output cannot establish live model generation or missing-fact reasoning.",
					"No live Taskbot delivery or status reconciliation was tested.",
				],
			},
			null,
			2,
		),
	);
	console.log(
		"PASS: dashboard choices and existing-session ticket reply each resumed one simulated agent turn and one receipt.",
	);
} finally {
	await browserInstance.close();
	for (const run of runtime.runs.values()) {
		if (!["completed", "stopped"].includes(run.status)) runtime.stop(run.id);
	}
	await worker.stop();
}
