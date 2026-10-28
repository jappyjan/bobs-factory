import { Command } from "commander";
import { afterEach, expect, it, vi } from "vitest";
import { FactoryClient } from "../tui/client.js";
import { addStorageCommands } from "./storage.js";

afterEach(() => vi.restoreAllMocks());
function program() {
	const command = new Command()
		.option("--home <path>", "Fixture home", "/tmp/storage-command-fixture")
		.option("--port <number>", "Fixture port", "3457");
	command.exitOverride();
	command.configureOutput({ writeErr: () => {} });
	addStorageCommands(command);
	return command;
}
it("submits exact preview identities through the protected instance service", async () => {
	vi.spyOn(console, "log").mockImplementation(() => {});
	const post = vi
		.spyOn(FactoryClient.prototype, "post")
		.mockResolvedValue({ operationId: "fixture" });
	await program().parseAsync([
		"node",
		"fixture",
		"storage",
		"clean",
		"--preview",
		"preview-id",
		"--ids",
		"first-id,second-id",
		"--idempotent-teardown",
	]);
	expect(post).toHaveBeenCalledWith("/api/storage/execute", {
		previewId: "preview-id",
		selected: ["first-id", "second-id"],
		idempotentTeardown: true,
	});
});
