import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
	appendFileSync,
	createReadStream,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { arch, platform, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

// Run only after the integration owner supplies the compiled native binary.
// node taskbot140-views-native.mjs --binary /absolute/bobs-factory --output /absolute/evidence
const options = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
	assert(
		process.argv[index]?.startsWith("--") && process.argv[index + 1],
		"Expected named --binary and --output arguments",
	);
	assert(!options.has(process.argv[index]), "Repeated driver argument");
	options.set(process.argv[index], process.argv[index + 1]);
}
assert(
	options.has("--binary") && options.has("--output"),
	"Supply --binary and --output",
);
for (const name of options.keys())
	assert(["--binary", "--output"].includes(name), `Unknown option ${name}`);
const binary = realpathSync(resolve(options.get("--binary")));
const outputRoot = resolve(options.get("--output"));
mkdirSync(outputRoot, { recursive: true, mode: 0o700 });
const output = join(
	outputRoot,
	`attempt-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`,
);
mkdirSync(output, { mode: 0o700 });
const directory = mkdtempSync(join(tmpdir(), "taskbot140-native-views-"));
const home = join(directory, "factory-home");
const userHome = join(directory, "user-home");
const temporary = join(directory, "tmp");
const capacity = join(directory, "empty-capacity");
for (const path of [home, userHome, temporary, capacity])
	mkdirSync(path, { mode: 0o700 });
const report = {
	result: "FAIL",
	startedAt: new Date().toISOString(),
	driver: {
		path: basename(process.argv[1]),
		sha256: createHash("sha256")
			.update(readFileSync(process.argv[1]))
			.digest("hex"),
		command: process.argv,
		cwd: process.cwd(),
		node: process.version,
		platform: platform(),
		arch: arch(),
	},
	binary: { path: binary },
	directory,
	output,
	checks: [],
	requests: [],
	limits: [
		"Native macOS ARM64 catalogue/schema/preview/persistence smoke, without a configured project or prepared coding agent.",
		"Full Decide/Approve/Show execution and UI rendering are separate production-runtime mocked F1/browser evidence.",
		"No native provider authentication, live model quality, remote forge operation, release publication or deployment is exercised.",
	],
};
async function hashFile(path) {
	const before = statSync(path),
		hash = createHash("sha256");
	assert(before.isFile(), "Expected a regular binary file");
	for await (const chunk of createReadStream(path)) hash.update(chunk);
	const after = statSync(path);
	assert.equal(after.size, before.size);
	assert.equal(after.mtimeMs, before.mtimeMs, "Binary changed while hashing");
	return { size: before.size, sha256: hash.digest("hex") };
}
const reserve = createServer();
await new Promise((resolve, reject) => {
	reserve.once("error", reject);
	reserve.listen(0, "127.0.0.1", resolve);
});
const port = reserve.address().port;
await new Promise((resolve, reject) =>
	reserve.close((error) => (error ? reject(error) : resolve())),
);
assert(port < 65535, "Factory also needs the next port for its worker");
const origin = `http://127.0.0.1:${port}`;
const environment = {
	PATH: "/usr/bin:/bin",
	HOME: userHome,
	TMPDIR: temporary,
	BOBS_FACTORY_MIGRATION_SOURCE_CAPACITY_DIRECTORY: capacity,
	BOBS_FACTORY_SENTRY_DISABLED: "1",
};
report.environment = {
	...environment,
	inheritedEnvironment: false,
	providerCredentialsProvided: false,
};
let child,
	closed,
	startup = 0;
const delay = (milliseconds) =>
	new Promise((resolve) => setTimeout(resolve, milliseconds));
async function json(
	path,
	{
		method = "GET",
		body,
		expected = 200,
		config = false,
		headers: customHeaders = {},
		label = path,
	} = {},
) {
	const headers = { origin, "x-factory-request": "1", ...customHeaders };
	if (body !== undefined) headers["content-type"] = "application/json";
	if (config) {
		const current = await json("/api/config?view=recipes", {
			label: `${label}: current configuration revision`,
		});
		assert.equal(typeof current.configRevision, "string");
		headers["x-factory-config"] = current.configRevision;
	}
	const response = await fetch(`${origin}${path}`, {
		method,
		headers,
		...(body !== undefined ? { body: JSON.stringify(body) } : {}),
		signal: AbortSignal.timeout(10_000),
	});
	const text = await response.text();
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new Error(`${label}: expected JSON, status ${response.status}`);
	}
	report.requests.push({
		label,
		method,
		path,
		status: response.status,
		response: parsed,
	});
	if (expected === "reject")
		assert(
			response.status >= 400 && response.status < 500,
			`${label}: expected a clear rejection, got ${response.status}: ${text}`,
		);
	else assert.equal(response.status, expected, `${label}: ${text}`);
	return parsed;
}
function identity(actual, build) {
	assert.equal(actual.packaged, true);
	for (const field of [
		"version",
		"commit",
		"dirty",
		"target",
		"resourceDigest",
	])
		assert.equal(
			actual[field],
			build[field],
			`Runtime ${field} differs from adjacent build.json`,
		);
}
async function start() {
	startup++;
	const log = join(output, `worker-${startup}.log`);
	const args = ["--home", home, "--port", String(port), "--no-open"];
	child = spawn(binary, args, {
		cwd: directory,
		env: environment,
		stdio: ["ignore", "pipe", "pipe"],
	});
	closed = new Promise((resolve, reject) => {
		child.once("error", reject);
		child.once("exit", (code, signal) => resolve({ code, signal }));
	});
	void closed.catch(() => {});
	child.stdout.on("data", (bytes) =>
		appendFileSync(log, bytes, { mode: 0o600 }),
	);
	child.stderr.on("data", (bytes) =>
		appendFileSync(log, bytes, { mode: 0o600 }),
	);
	report.checks.push({
		name: `startup ${startup} command`,
		command: [binary, ...args],
		log,
	});
	const deadline = Date.now() + 20_000;
	while (Date.now() < deadline) {
		if (child.exitCode !== null || child.signalCode !== null)
			throw new Error(`Native startup exited: ${JSON.stringify(await closed)}`);
		try {
			const ready = await fetch(`${origin}/api/version`, {
				signal: AbortSignal.timeout(1000),
			});
			if (ready.ok) return;
		} catch {
			/* The bound socket is not ready yet. */
		}
		await delay(100);
	}
	throw new Error(
		"Native Factory startup did not become ready within 20 seconds",
	);
}
async function stop() {
	if (!child || child.exitCode !== null || child.signalCode !== null) return;
	const active = child;
	active.kill("SIGTERM");
	let timer;
	try {
		const result = await Promise.race([
			closed,
			new Promise((_, reject) => {
				timer = setTimeout(
					() => reject(new Error("Native shutdown exceeded 10 seconds")),
					10_000,
				);
			}),
		]);
		assert.equal(
			result.code,
			0,
			`Native shutdown failed: ${JSON.stringify(result)}`,
		);
		report.checks.push({
			name: `startup ${startup} graceful shutdown`,
			result,
		});
	} catch (error) {
		if (active.exitCode === null && active.signalCode === null)
			active.kill("SIGKILL");
		await closed.catch(() => {});
		throw error;
	} finally {
		clearTimeout(timer);
	}
}
const items = [
	{ id: "one", title: "Review one", body: "A bounded literal finding" },
	{ id: "two", title: "Review two", body: "Another bounded finding" },
];
const data = (type, value, id = type) => ({
	id,
	type,
	data: { literal: value },
});
const boundText = {
	id: "document",
	type: "markdown",
	data: { path: "/inputs/document" },
};
const actions = [
	{ id: "fix", label: "Fix", comment: true, followUp: true },
	{ id: "skip", label: "Skip" },
];
const recipe = {
	id: "native-human-views",
	name: "Native generic human views",
	stepConfigVersion: "step-config-v1",
	allowedTriggers: ["manual"],
	launchFields: [
		{ name: "text", label: "Artifact text", type: "textarea", required: true },
	],
	steps: [
		{
			id: "pick",
			name: "Decide per item",
			type: "decide",
			reads: { document: "@launchInputs" },
			view: {
				version: "view-v1",
				components: [
					boundText,
					data("itemCards", { items }),
					data("choices", {
						fields: [
							{ id: "name", label: "Reviewer", type: "text", required: true },
							{ id: "note", label: "Note", type: "textarea" },
							{
								id: "confirmed",
								label: "I read the findings",
								type: "checkbox",
								required: true,
							},
							{
								id: "priority",
								label: "Priority",
								type: "select",
								options: [
									{ id: "normal", label: "Normal" },
									{ id: "high", label: "High" },
								],
							},
						],
					}),
					data("decisionBar", {
						summary: "Choose an action for every item",
						actions: actions.map(({ id, label }) => ({ id, label })),
					}),
				],
			},
			decide: { items: { literal: items }, body: "/body", actions },
			branches: [
				{ when: { path: "hasFollowUps", equals: true }, next: "accept" },
			],
			next: "accept",
		},
		{
			id: "accept",
			name: "Approve exact artifact",
			type: "approve",
			reads: { document: "@launchInputs" },
			view: {
				version: "view-v1",
				components: [
					boundText,
					data("checklist", {
						items: [{ label: "Read the artifact", state: "open" }],
					}),
					data("beforeAfter", {
						before: "Before the chosen work",
						after: "After the chosen work",
					}),
					data("chart", {
						kind: "bar",
						series: [{ label: "Selected findings", value: 2 }],
					}),
					data("table", {
						columns: ["Evidence", "State"],
						rows: [["Review", "Pending"]],
					}),
					data("code", {
						file: "src/example.ts",
						startLine: 1,
						excerpt: "const display = true;",
						language: "ts",
					}),
					data("steps", {
						items: [
							{ label: "Read", status: "completed" },
							{ label: "Approve", status: "pending" },
						],
					}),
					data("points", {
						items: [
							{
								label: "Documentation",
								url: "https://example.invalid/documentation",
							},
						],
					}),
				],
			},
			next: "summary",
		},
		{
			id: "summary",
			name: "Nonblocking summary",
			type: "show",
			reads: { document: "@launchInputs", children: "@childRuns" },
			view: {
				version: "view-v1",
				components: [
					boundText,
					{
						id: "children",
						type: "runList",
						data: { path: "/inputs/children" },
					},
				],
			},
			next: "end",
		},
	],
};
function normalized(definition) {
	const { id, name, stepConfigVersion, steps, allowedTriggers, launchFields } =
		definition;
	return { id, name, stepConfigVersion, steps, allowedTriggers, launchFields };
}
try {
	assert.equal(
		platform(),
		"darwin",
		"This driver records native macOS evidence only",
	);
	assert.equal(
		arch(),
		"arm64",
		"This driver records native ARM64 evidence only",
	);
	const build = JSON.parse(
		readFileSync(join(dirname(binary), "build.json"), "utf8"),
	);
	const executable = await hashFile(binary);
	assert.equal(build.product, "bobs-factory");
	assert.equal(build.target, "darwin-arm64");
	assert.equal(build.tooling.bun, "1.4.2");
	assert.equal(build.executable.sha256, executable.sha256);
	assert.equal(build.executable.size, executable.size);
	report.binary = { path: binary, ...executable, build };
	report.source = {
		commit: build.commit,
		dirty: build.dirty,
		resourceDigest: build.resourceDigest,
		provenance:
			"Embedded adjacent build.json identity, checked against both running binary APIs; not inferred from the current checkout.",
	};
	await start();
	const firstVersion = await json("/api/version");
	identity(firstVersion.runtime, build);
	const workerVersion = await fetch(`http://127.0.0.1:${port + 1}/version`, {
		signal: AbortSignal.timeout(5000),
	});
	assert.equal(workerVersion.status, 200);
	const worker = await workerVersion.json();
	identity(worker.runtime, build);
	report.runtime = { dashboard: firstVersion.runtime, worker: worker.runtime };
	const initial = await json("/api/config?view=recipes");
	assert.equal(initial.repositories.length, 0);
	assert.deepEqual(await json("/api/runs"), []);
	const schema = await json("/api/recipes/view-schema");
	assert.equal(schema.type, "object");
	assert.equal(schema.additionalProperties, false);
	const catalog = await json("/api/workflows/step-config/catalog");
	assert(catalog.formats.some((format) => format.id === "view-v1"));
	const saved = await json("/api/workflows", {
		method: "PATCH",
		config: true,
		body: { workflows: [recipe] },
	});
	assert.equal(saved.updatedWorkflows.length, 1);
	const accepted = normalized(saved.updatedWorkflows[0]);
	assert.deepEqual(
		accepted.steps.map((step) => step.type),
		["decide", "approve", "show"],
	);
	assert.deepEqual(accepted.steps[0].decide.actions, actions);
	assert.equal(accepted.steps[0].branches[0].when.path, "hasFollowUps");
	const maliciousText =
		"<script>globalThis.nativeViewInjected=true</script> [Link](javascript:alert(1))";
	const preview = await json("/api/recipes/view-preview", {
		method: "POST",
		body: {
			workflowId: recipe.id,
			stepId: "pick",
			view: recipe.steps[0].view,
			decide: recipe.steps[0].decide,
			reads: recipe.steps[0].reads,
			sampleScope: { inputs: { document: { text: maliciousText } } },
		},
	});
	assert.equal(preview.view.components[0].data.text, maliciousText);
	assert.equal(preview.provenance.kind, "sample");
	assert.deepEqual(preview.paths, [
		"/inputs",
		"/inputs/document",
		"/inputs/document/text",
	]);
	assert.equal(preview.view.components[2].data.fields.length, 4);
	await json("/api/recipes/view-preview", {
		method: "POST",
		expected: 403,
		headers: { origin: "https://foreign.invalid" },
		body: { workflowId: recipe.id, stepId: "pick", view: recipe.steps[0].view },
		label: "foreign-origin preview is denied",
	});
	for (const [name, update] of [
		[
			"unknown component",
			(step) => {
				step.view.components[0].type = "html";
			},
		],
		[
			"unsafe view pointer",
			(step) => {
				step.view.components[0].data = { path: "/runtime/credentials" };
			},
		],
		[
			"native check on generic human",
			(step) => {
				step.checks = ["capture-evidence"];
			},
		],
		[
			"native approval contract on generic human",
			(step) => {
				step.architectureContract = "architecture-v1";
			},
		],
		[
			"agent-authored action URL",
			(step) => {
				step.view.components[1].data.literal.items[0].url =
					"javascript:alert(1)";
			},
		],
	]) {
		const invalid = structuredClone(recipe);
		update(invalid.steps[0]);
		await json("/api/workflows", {
			method: "PATCH",
			config: true,
			expected: "reject",
			body: { workflows: [invalid] },
			label: `save rejects ${name}`,
		});
	}
	await json("/api/recipes/view-preview", {
		method: "POST",
		expected: "reject",
		body: {
			workflowId: recipe.id,
			stepId: "pick",
			view: {
				version: "view-v1",
				components: [
					{
						id: "bad",
						type: "markdown",
						data: { path: "/runtime/credentials" },
					},
				],
			},
		},
		label: "preview repeats pointer validation",
	});
	await json("/api/recipes/view-preview", {
		method: "POST",
		expected: "reject",
		body: {
			workflowId: recipe.id,
			stepId: "pick",
			view: recipe.steps[0].view,
			lastRun: true,
		},
		label: "last-run preview cannot invent an accepted input snapshot",
	});
	report.checks.push({
		name: "compiled schema, generic saved bindings/actions/forms and clear invalid save/preview rejection",
		result: "PASS",
	});
	await stop();
	await start();
	const restartedVersion = await json("/api/version");
	identity(restartedVersion.runtime, build);
	const restarted = await json("/api/config?view=recipes");
	assert.deepEqual(
		normalized(
			restarted.workflows.find((workflow) => workflow.id === recipe.id),
		),
		accepted,
	);
	assert.deepEqual(await json("/api/runs"), []);
	assert.equal(restarted.repositories.length, 0);
	report.checks.push({
		name: "accepted generic saved definition survives real compiled binary restart without invalid replacement",
		result: "PASS",
	});
	report.execution = {
		runCount: 0,
		configuredRepositories: 0,
		providerCredentialsProvided: false,
		providerExecutions: 0,
		humanOnlyNativeProgression:
			"NOT EXERCISED: no configured project or prepared agent. Every ordinary new run also schedules a title agent. The driver does not bypass project/readiness or fabricate a prepared agent to claim native human execution.",
	};
	await stop();
	report.result = "PASS";
} catch (error) {
	report.error = {
		message: error instanceof Error ? error.message : String(error),
		stack: error instanceof Error ? error.stack : undefined,
	};
	process.exitCode = 1;
} finally {
	try {
		await stop();
	} catch (error) {
		report.shutdownError = String(error);
		report.result = "FAIL";
		process.exitCode = 1;
	}
	report.finishedAt = new Date().toISOString();
	writeFileSync(
		join(output, "native-views.json"),
		`${JSON.stringify(report, null, 2)}\n`,
		{ mode: 0o600, flag: "wx" },
	);
	console.log(
		JSON.stringify({
			result: report.result,
			output,
			directory,
			error: report.error?.message,
			runtime: report.runtime?.dashboard,
		}),
	);
}
