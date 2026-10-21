import { executeInlineSchemaJob } from "./InlineSchemaEngine.js";
import {
	INLINE_SCHEMA_LIMITS,
	type InlineSchemaJob,
} from "./InlineSchemaProtocol.js";
/** Private one-job subprocess protocol; accepts JSON data, never source text. */
export async function runInlineSchemaChild(): Promise<void> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of process.stdin) {
		const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += bytes.length;
		if (
			size >
			INLINE_SCHEMA_LIMITS.schemaBytes + INLINE_SCHEMA_LIMITS.dataBytes + 8192
		)
			throw new Error("Inline schema child request exceeds its size limit");
		chunks.push(bytes);
	}
	const request = JSON.parse(
		Buffer.concat(chunks).toString(),
	) as InlineSchemaJob;
	if (
		!request ||
		typeof request !== "object" ||
		!request.schema ||
		typeof request.schema !== "object" ||
		Array.isArray(request.schema) ||
		typeof request.validate !== "boolean"
	)
		throw new Error("Invalid inline schema child request");
	process.stdout.write(JSON.stringify(executeInlineSchemaJob(request)));
}
if (process.argv[2] === "--inline-schema-child") await runInlineSchemaChild();
