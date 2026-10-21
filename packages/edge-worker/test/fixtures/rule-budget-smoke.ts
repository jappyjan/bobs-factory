import { performance } from "node:perf_hooks";
import { defaultWorkflows } from "../../src/factory/defaultWorkflows.js";
import { parseStepOutputAsync } from "../../src/factory/OutputFormats.js";
import { OutputValidationError } from "../../src/factory/OutputValidation.js";
import { RULE_EVALUATION_LIMITS } from "../../src/factory/Rules.js";
import { validateWorkflows } from "../../src/factory/Workflow.js";

const workflow = {
	id: "bounded-rule-demo",
	name: "Bounded rule demo",
	stepConfigVersion: "step-config-v1",
	allowedTriggers: ["manual"],
	steps: [
		{
			id: "ordinary",
			name: "Ordinary",
			type: "agent",
			prompt: "Return data",
			output: { format: "json-v1" },
			rules: [
				{
					message: "Lookup every ID",
					require: {
						each: "/items",
						require: {
							lookup: { collection: "$/items", key: "/id", value: "/id" },
							require: { path: "/match/id", exists: true },
						},
					},
				},
			],
			checks: [],
			instructions: [],
			next: "end",
		},
	],
};
const step = validateWorkflows([...defaultWorkflows, workflow]).at(-1)!
	.steps[0]!;
const results = [];
for (const count of [5000, 20000]) {
	const value = { items: Array.from({ length: count }, (_, id) => ({ id })) };
	let ticks = 0,
		maxDelay = 0,
		last = performance.now();
	const start = last;
	const timer = setInterval(() => {
		const now = performance.now();
		maxDelay = Math.max(maxDelay, now - last);
		last = now;
		ticks++;
	}, 1);
	let limited = false;
	try {
		await parseStepOutputAsync(step, value);
	} catch (error) {
		limited =
			error instanceof OutputValidationError &&
			/evaluation operation limit/.test(error.message);
	} finally {
		clearInterval(timer);
	}
	const elapsed = performance.now() - start;
	if (!limited || ticks === 0 || maxDelay >= 1000 || elapsed >= 3000)
		throw new Error(JSON.stringify({ limited, ticks, maxDelay, elapsed }));
	results.push({
		items: count,
		inputBytes: Buffer.byteLength(JSON.stringify(value)),
		limited,
		ticks,
		maxDelayMs: maxDelay,
		elapsedMs: elapsed,
	});
}
const controller = new AbortController();
const cancelStarted = performance.now();
const pending = parseStepOutputAsync(
	step,
	{ items: Array.from({ length: 20000 }, (_, id) => ({ id })) },
	undefined,
	controller.signal,
);
setTimeout(
	() => controller.abort(new DOMException("Stop rule smoke", "AbortError")),
	5,
);
let cancelled = false;
try {
	await pending;
} catch (error) {
	cancelled = error instanceof Error && error.name === "AbortError";
}
if (!cancelled) throw new Error("Cancellation was not preserved");
await parseStepOutputAsync(step, { items: [{ id: 1 }, { id: 2 }] });
console.log(
	JSON.stringify({
		runtime: process.versions.bun
			? `Bun ${process.versions.bun}`
			: `Node ${process.versions.node}`,
		acceptedWorkflow: true,
		limits: RULE_EVALUATION_LIMITS,
		results,
		cancelled,
		cancelElapsedMs: performance.now() - cancelStarted,
		usefulRulePassed: true,
	}),
);
