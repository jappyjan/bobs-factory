import { existsSync, readFileSync, unwatchFile, watchFile } from "node:fs";
import { dirname, join } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	createFactoryContextServer,
	createFactoryContextServerFromSnapshot,
} from "./factoryContext.js";

export async function serveFactoryContext(
	path: string | undefined,
	options: { snapshot?: boolean } = {},
): Promise<void> {
	if (!path) throw new Error("A factory step input snapshot is required");
	const artifactConfig = join(dirname(path), "artifacts.json");
	const researchConfig = join(dirname(path), "research.json");
	const research = existsSync(researchConfig)
		? JSON.parse(readFileSync(researchConfig, "utf8"))
		: undefined;
	const artifacts = existsSync(artifactConfig)
		? JSON.parse(readFileSync(artifactConfig, "utf8"))
		: undefined;
	// The flag is an explicit transport choice, never inferred from role JSON.
	const server = options.snapshot
		? createFactoryContextServerFromSnapshot(path, artifacts, research)
		: createFactoryContextServer(
				JSON.parse(readFileSync(path, "utf8")),
				artifacts,
			);
	// Some runners pool their MCP connections after a turn. The snapshot's lifetime
	// is the role's lifetime, so release its server even if the connection stays open.
	const close = server.server.onclose;
	server.server.onclose = () => {
		close?.();
		unwatchFile(path);
	};
	watchFile(path, { interval: 500 }, (stat) => {
		if (stat.nlink === 0) {
			unwatchFile(path);
			void server.close().finally(() => process.exit(0));
		}
	});
	await server.connect(new StdioServerTransport());
}
