import { serveFactoryContext } from "./factory-context-stdio.js";

await serveFactoryContext(
	process.argv[2] === "--snapshot" ? process.argv[3] : process.argv[2],
	{ snapshot: process.argv[2] === "--snapshot" },
);
