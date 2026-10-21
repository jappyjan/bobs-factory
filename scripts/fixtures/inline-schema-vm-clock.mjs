// A trusted diagnostic fixture: simulate descheduling *inside* the engine VM,
// without admitting executable code through the product's schema protocol.
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { executeInlineSchemaJob } from "../../packages/edge-worker/src/factory/InlineSchemaEngine.ts";
import { INLINE_SCHEMA_LIMITS } from "../../packages/edge-worker/src/factory/InlineSchemaProtocol.ts";

assert(process.versions.bun, "Exercise the actual Bun VM implementation");
const pauseMs = Number(process.argv[2]);
assert([500, 1500].includes(pauseMs));
const started = performance.now();
const cpu = process.cpuUsage();
const result = executeInlineSchemaJob(
	{ schema: { type: "null", title: "After faults" }, validate: false },
	undefined,
	(script, context, options) =>
		runInNewContext(
			script,
			{
				run: () => {
					Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, pauseMs);
					return context.run();
				},
			},
			options,
		),
);
console.log(
	JSON.stringify({
		result,
		pauseMs,
		elapsedMs: performance.now() - started,
		cpu: process.cpuUsage(cpu),
		executionMs: INLINE_SCHEMA_LIMITS.executionMs,
		bun: process.versions.bun,
	}),
);
