import {
	compileInlineSchema,
	compileInlineSchemaSync,
	validateInlineSchema,
} from "../../src/factory/InlineSchema.js";

if (process.argv[2] === "internal-schema-validator") {
	const { runInlineSchemaChild } = await import(
		"../../src/factory/InlineSchemaChild.js"
	);
	await runInlineSchemaChild();
} else {
	const schema = {
		type: "object",
		properties: { summary: { type: "string" } },
		required: ["summary"],
		additionalProperties: false,
	};
	const syncIssues = compileInlineSchemaSync({ type: "integer", minimum: 1 });
	if (syncIssues.length) throw new Error(JSON.stringify(syncIssues));
	const issues = await compileInlineSchema(schema);
	if (issues.length) throw new Error(JSON.stringify(issues));
	const valid = await validateInlineSchema(schema, {
		summary: "Bundled worker",
	});
	if (valid.schemaIssues.length || valid.issues.length)
		throw new Error(JSON.stringify(valid));
	const cyclic = await compileInlineSchema({ $ref: "#" });
	if (!cyclic.some((issue) => issue.includes("reference cycles")))
		throw new Error("Recursive schema was accepted");
	let ticks = 0;
	const heartbeat = setInterval(() => ticks++, 10);
	const started = Date.now();
	const exhausted = await validateInlineSchema(
		{ type: "string", pattern: "^a+a+$" },
		`${"a".repeat(100_000)}!`,
	);
	clearInterval(heartbeat);
	if (!exhausted.issues.length && !exhausted.schemaIssues.length)
		throw new Error("Pathological input accepted");
	if (ticks < 2 || Date.now() - started > 3000)
		throw new Error("Worker deadline blocked the compiled application");
	const controller = new AbortController();
	const cancelled = validateInlineSchema(
		{ type: "string", pattern: "^a+a+$" },
		`${"a".repeat(100_000)}!`,
		controller.signal,
	);
	setTimeout(
		() => controller.abort(new DOMException("Smoke stopped", "AbortError")),
		30,
	);
	try {
		await cancelled;
		throw new Error("Cancellation was ignored");
	} catch (error) {
		if (!(error instanceof Error) || error.name !== "AbortError") throw error;
	}
	if ((await compileInlineSchema({ type: "boolean" })).length)
		throw new Error("Child slot was not released");
	console.log(
		JSON.stringify({
			valid: true,
			rejectedCycle: true,
			pathological: exhausted,
			ticks,
			elapsedMs: Date.now() - started,
		}),
	);
}
