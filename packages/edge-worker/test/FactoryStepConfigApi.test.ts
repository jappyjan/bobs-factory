import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";
import { FactoryServer } from "./fixtures/authenticated-factory.js";

it("validates custom output schemas without allowing external references or unknown schema keywords", async () => {
	const home = mkdtempSync(join(tmpdir(), "factory-schema-editor-"));
	const runtime = new WorkflowRuntime(home, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
	});
	const server = new FactoryServer(runtime, {
		repositories: () => [],
		sessions: () => [],
		entries: () => [],
		start: async () => {
			throw new Error("Unused");
		},
		stop: (id) => runtime.stop(id),
	});
	const validate = async (schema: object) =>
		(
			await server.app.inject({
				method: "POST",
				url: "/api/workflows/step-config/validate",
				headers: { "x-factory-request": "1" },
				payload: { schema },
			})
		).json();
	try {
		expect(
			await validate({
				type: "object",
				properties: { summary: { type: "string", minLength: 1 } },
				required: ["summary"],
				additionalProperties: false,
			}),
		).toEqual({ valid: true, issues: [] });
		const remote = await validate({
			$ref: "https://example.invalid/schema.json",
		});
		expect(remote.valid).toBe(false);
		expect(remote.issues).toEqual([
			"/$ref: only local references (#/...) are allowed",
		]);
		const typo = await validate({
			type: "object",
			propertiez: { summary: { type: "string" } },
		});
		expect(typo.valid).toBe(false);
		expect(typo.issues).toEqual(['strict mode: unknown keyword: "propertiez"']);
		for (const [schema, message] of [
			[{ type: "string", pattern: "^(a+)+$" }, "unsafe pattern"],
			[
				{
					type: "object",
					patternProperties: { "^(a+)+$": { type: "string" } },
				},
				"unsafe pattern",
			],
			[{ $ref: "#" }, "reference cycles"],
		] as const) {
			const rejected = await validate(schema);
			expect(rejected.valid).toBe(false);
			expect(rejected.issues.join(";")).toContain(message);
		}
		// A real expensive compile must not delay unrelated HTTP work.
		const compileStarted = Date.now();
		let compileFinished = false;
		const compiling = validate({
			enum: Array.from({ length: 4400 }, (_, id) => ({ id })),
		}).finally(() => {
			compileFinished = true;
		});
		await new Promise((resolve) => setTimeout(resolve, 20));
		const responsiveAt = Date.now();
		const stillResponsive = await server.app.inject({
			url: "/api/workflows/step-config/catalog",
		});
		expect(stillResponsive.statusCode).toBe(200);
		expect(Date.now() - responsiveAt).toBeLessThan(1000);
		expect(compileFinished).toBe(false);
		const exhausted = await compiling;
		expect(Date.now() - compileStarted).toBeLessThan(3000);
		// This schema is valid: Node 22 can compile it within the CPU budget.
		// Both successful completion and an enforced resource limit are correct.
		if (exhausted.valid) expect(exhausted.issues).toEqual([]);
		else
			expect(exhausted.issues.join(";")).toMatch(
				/execution limit|wall limit|resource limits/,
			);
		const config = (
			await server.app.inject({ url: "/api/config?view=recipes" })
		).json();
		for (const [patch, message] of [
			[
				{ output: { format: "missing-v1" } },
				"Unknown output format: missing-v1",
			],
			[{ checks: ["missing-check"] }, "Unknown evidence check: missing-check"],
			[
				{ instructions: ["missing-instruction"] },
				"Unknown shared instruction: missing-instruction",
			],
		] as const) {
			const response = await server.app.inject({
				method: "PATCH",
				url: "/api/workflows",
				headers: {
					"x-factory-request": "1",
					"x-factory-config": config.configRevision,
				},
				payload: {
					workflows: [
						{
							id: "invalid-library-id",
							name: "Invalid library ID",
							stepConfigVersion: "step-config-v1",
							steps: [
								{
									id: "work",
									name: "Work",
									type: "agent",
									prompt: "Task",
									...patch,
								},
							],
						},
					],
				},
			});
			expect(response.statusCode).toBe(400);
			expect(response.json()).toEqual({ error: message });
		}

		for (const schema of [
			{ type: "string", pattern: "^(a+)+$" },
			{ $ref: "#" },
		]) {
			const response = await server.app.inject({
				method: "PATCH",
				url: "/api/workflows",
				headers: {
					"x-factory-request": "1",
					"x-factory-config": config.configRevision,
				},
				payload: {
					workflows: [
						{
							id: "unsafe-inline",
							name: "Unsafe inline",
							stepConfigVersion: "step-config-v1",
							steps: [
								{
									id: "work",
									type: "agent",
									name: "Work",
									prompt: "Task",
									output: { schema },
								},
							],
						},
					],
				},
			});
			expect({
				status: response.statusCode,
				body: response.json(),
			}).toMatchObject({ status: 400 });
			expect(response.json().error).toMatch(/unsafe pattern|reference cycles/);
		}
		const catalog = await server.app.inject({
			url: "/api/workflows/step-config/catalog",
		});
		expect(catalog.statusCode).toBe(200);
		expect(catalog.json().formats).toContainEqual({
			id: "qa-capture-v1",
			version: 1,
		});
		// Saving crosses asynchronous compilation into synchronous catalogue
		// validation. A new schema must be cached before that validation runs.
		const savedSchema = {
			type: "object",
			properties: { result: { type: "integer", minimum: 1 } },
			required: ["result"],
			additionalProperties: false,
		};
		const saved = await server.app.inject({
			method: "PATCH",
			url: "/api/workflows",
			headers: {
				"x-factory-request": "1",
				"x-factory-config": config.configRevision,
			},
			payload: {
				workflows: [
					{
						id: "saved-inline",
						name: "Saved inline schema",
						stepConfigVersion: "step-config-v1",
						steps: [
							{
								id: "work",
								type: "agent",
								name: "Work",
								prompt: "Task",
								output: { schema: savedSchema },
							},
						],
					},
				],
			},
		});
		expect({ status: saved.statusCode, body: saved.json() }).toMatchObject({
			status: 200,
		});
		expect(
			runtime.listWorkflows().find((workflow) => workflow.id === "saved-inline")
				?.steps[0],
		).toMatchObject({ output: { schema: savedSchema } });
	} finally {
		await server.app.close();
		await runtime.shutdown();
		rmSync(home, { recursive: true, force: true });
	}
});
