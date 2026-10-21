import { expect, it } from "vitest";
import {
	compileInlineSchema,
	inlineSchemaPreflight,
} from "../src/factory/InlineSchema.js";
import { parseStepOutputAsync } from "../src/factory/OutputFormats.js";
import { OutputValidationError } from "../src/factory/OutputValidation.js";

const step = (schema: Record<string, unknown>) => ({
	id: "custom-result",
	output: { schema },
});
it("rejects recursive local references and unsafe property/value patterns before save", async () => {
	for (const schema of [
		{ $ref: "#" },
		{
			definitions: {
				a: { $ref: "#/definitions/b" },
				b: { $ref: "#/definitions/a" },
			},
			$ref: "#/definitions/a",
		},
	])
		expect(await compileInlineSchema(schema)).toContain(
			"Inline JSON Schema reference cycles are not supported",
		);
	for (const schema of [
		{ type: "string", pattern: "^(a+)+$" },
		{ type: "object", patternProperties: { "^(a+)+$": { type: "string" } } },
		{ type: "string", pattern: "^(a(b+))+$" },
	])
		expect((await compileInlineSchema(schema)).join(";")).toContain(
			"unsafe pattern",
		);
});
it("retains ordinary schemas, acyclic shared definitions and normal correction errors", async () => {
	const schema = {
		type: "object",
		definitions: {
			anything: true,
			name: { type: "string", pattern: "^[A-Z][A-Za-z0-9_-]{0,63}$" },
		},
		properties: { name: { $ref: "#/definitions/name" } },
		required: ["name"],
		additionalProperties: false,
	};
	expect(await compileInlineSchema(schema)).toEqual([]);
	await expect(
		parseStepOutputAsync(step(schema), { name: "Valid_name" }),
	).resolves.toEqual({ name: "Valid_name" });
	await expect(
		parseStepOutputAsync(step(schema), { name: "invalid" }),
	).rejects.toBeInstanceOf(OutputValidationError);
});
it("terminates expensive residual regex validation while the main event loop remains responsive", async () => {
	// Adjacent repetitions pass the conservative preflight but are quadratic on this input.
	const schema = { type: "string", pattern: "^a+a+$" };
	expect(inlineSchemaPreflight(schema)).toEqual([]);
	let ticks = 0;
	const heartbeat = setInterval(() => ticks++, 10);
	const started = Date.now();
	try {
		await expect(
			parseStepOutputAsync(step(schema), `${"a".repeat(100_000)}!`),
		).rejects.toThrow(/execution limit|wall limit|resource limits/);
		expect(ticks).toBeGreaterThan(2);
		expect(Date.now() - started).toBeLessThan(3000);
		await expect(
			parseStepOutputAsync(step({ type: "string" }), "after deadline"),
		).resolves.toBe("after deadline");
	} finally {
		clearInterval(heartbeat);
	}
}, 10_000);
it("bounds schema compilation itself without stopping the server event loop", async () => {
	// Draft-07 meta-validation compares object enum values for uniqueness.
	const schema = { enum: Array.from({ length: 4400 }, (_, id) => ({ id })) };
	expect(inlineSchemaPreflight(schema)).toEqual([]);
	let ticks = 0;
	const heartbeat = setInterval(() => ticks++, 10);
	try {
		const issues = await compileInlineSchema(schema);
		expect(issues.join(";")).toMatch(
			/compilation.*execution limit|wall limit|resource limits/,
		);
		expect(ticks).toBeGreaterThan(2);
	} finally {
		clearInterval(heartbeat);
	}
}, 10_000);
it("cancels an active isolated validation without spending the correction budget or occupying a worker slot", async () => {
	const controller = new AbortController();
	const pending = parseStepOutputAsync(
		step({ type: "string", pattern: "^a+a+$" }),
		`${"a".repeat(100_000)}!`,
		undefined,
		controller.signal,
	);
	setTimeout(
		() => controller.abort(new DOMException("Run stopped", "AbortError")),
		30,
	);
	await expect(pending).rejects.toMatchObject({
		name: "AbortError",
		message: "Run stopped",
	});
	await expect(compileInlineSchema({ type: "boolean" })).resolves.toEqual([]);
});

it("bounds queued work and releases cancelled waiters before accepting another job", async () => {
	const controller = new AbortController();
	const schema = { type: "string", pattern: "^a+a+$" };
	const value = `${"a".repeat(100_000)}!`;
	const pending = Array.from({ length: 20 }, () =>
		parseStepOutputAsync(step(schema), value, undefined, controller.signal),
	);
	setTimeout(
		() => controller.abort(new DOMException("Batch stopped", "AbortError")),
		30,
	);
	const settled = await Promise.allSettled(pending);
	expect(
		settled.filter(
			(result) =>
				result.status === "rejected" &&
				result.reason instanceof Error &&
				result.reason.name === "AbortError",
		),
	).toHaveLength(18);
	expect(
		settled.filter(
			(result) =>
				result.status === "rejected" &&
				result.reason instanceof Error &&
				result.reason.message.includes("queue is full"),
		),
	).toHaveLength(2);
	await expect(compileInlineSchema({ type: "null" })).resolves.toEqual([]);
});
