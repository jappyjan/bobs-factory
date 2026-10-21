#!/usr/bin/env node
if (process.argv[2] === "internal-schema-validator") {
	const { runInlineSchemaChild } = await import(
		"bobs-factory-edge-worker/dist/factory/InlineSchemaChild.js"
	);
	await runInlineSchemaChild();
} else {
	// The isolated validator must not initialize the application/provider graph.
	// Keep decorator setup and executable ownership on every normal CLI path.
	await import("reflect-metadata");
	const { isPackagedExecutable } = await import("bobs-factory-core");
	if (isPackagedExecutable)
		process.env.BOBS_FACTORY_INTERNAL_EXECUTABLE = process.execPath;
	else delete process.env.BOBS_FACTORY_INTERNAL_EXECUTABLE;
	if (process.argv[2] === "operator-mcp") {
		const { serveOperatorClient } = await import("bobs-factory-edge-worker");
		const { resolvePath } = await import("bobs-factory-core");
		const { homedir } = await import("node:os");
		const { join } = await import("node:path");
		const args = process.argv.slice(3);
		const flag = (name: string) => args[args.indexOf(name) + 1];
		if (!args.includes("--credential-file"))
			throw new Error(
				"operator-mcp requires --credential-file <private grant file>",
			);
		await serveOperatorClient(
			resolvePath(
				args.includes("--home")
					? flag("--home")!
					: (process.env.BOBS_FACTORY_HOME ?? join(homedir(), ".bobs-factory")),
			),
			resolvePath(flag("--credential-file")!),
		);
	} else if (process.argv[2] === "git-credential") {
		const { gitCredential } = await import("./github.js");
		await gitCredential(process.argv[3]);
	} else if (process.argv[2] === "internal") {
		const { runInternal } = await import("./internal.js");
		await runInternal(process.argv.slice(3));
	} else {
		await import("./cli.js");
	}
}
