import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { resolvePath } from "bobs-factory-core";
import { requestFactoryTerminalSession } from "bobs-factory-edge-worker";
import type { Command } from "commander";
import { FactoryClient } from "../tui/client.js";

export function addStorageCommands(program: Command) {
	const storage = program
		.command("storage")
		.description(
			"Inspect and safely clean storage on the selected running instance",
		);
	const client = () =>
		new FactoryClient({
			home: resolve(resolvePath(program.opts().home)),
			port: Number(program.opts().port),
			requestSession: requestFactoryTerminalSession,
		});
	const output = (value: unknown) =>
		console.log(JSON.stringify(value, null, 2));
	storage
		.command("status")
		.action(async () => output(await client().get("/api/storage")));
	storage
		.command("preview")
		.description("Evaluate the next bounded inventory slice")
		.action(async () => output(await client().post("/api/storage/preview")));
	storage
		.command("policy")
		.requiredOption("--file <path>", "JSON policy file")
		.requiredOption("--revision <number>", "Displayed policy revision")
		.action(async (options: { file: string; revision: string }) => {
			const policy: unknown = JSON.parse(await readFile(options.file, "utf8"));
			output(
				await client().put("/api/storage/policy", {
					revision: Number(options.revision),
					policy,
				}),
			);
		});
	storage
		.command("clean")
		.requiredOption("--preview <id>", "Exact preview ID")
		.requiredOption("--ids <ids>", "Comma-separated selected candidate IDs")
		.option(
			"--idempotent-teardown",
			"Retry an interrupted teardown only after verifying its scripts can safely run again",
		)
		.action(
			async (options: {
				preview: string;
				ids: string;
				idempotentTeardown?: boolean;
			}) =>
				output(
					await client().post("/api/storage/execute", {
						previewId: options.preview,
						selected: options.ids.split(","),
						idempotentTeardown: options.idempotentTeardown,
					}),
				),
		);
}
