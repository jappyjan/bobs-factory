import { runInNewContext } from "node:vm";
import { Ajv } from "ajv";
import type {
	InlineSchemaJob,
	InlineSchemaResult,
} from "./InlineSchemaProtocol.js";

/** Trusted engine entry: callers isolate this complete operation, including compilation. */
export function executeInlineSchemaJob(
	request: InlineSchemaJob,
	AjvClass = Ajv,
	evaluate = runInNewContext,
	executionMs = 250,
): InlineSchemaResult {
	let compiling = true;
	let result: InlineSchemaResult;
	try {
		result = evaluate(
			"run()",
			{
				run: (): InlineSchemaResult => {
					const ajv = new AjvClass({
						strict: true,
						allErrors: true,
						validateSchema: true,
						addUsedSchema: false,
						inlineRefs: false,
						ownProperties: true,
						loopRequired: 50,
						loopEnum: 50,
						code: { optimize: false },
					});
					const validate = ajv.compile(request.schema);
					compiling = false;
					if (!request.validate || validate(request.value))
						return { schemaIssues: [], issues: [] };
					return {
						schemaIssues: [],
						issues: (validate.errors ?? []).slice(0, 30).map((issue) => ({
							path: (issue.instancePath || "/").slice(0, 300),
							message: (issue.message ?? "Invalid output").slice(0, 300),
						})),
					};
				},
			},
			{ timeout: executionMs },
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const exceeded = /Script execution timed out/.test(message);
		const issue = exceeded
			? `Inline JSON Schema ${compiling ? "compilation" : "validation"} exceeded the ${executionMs} ms execution limit`
			: message.slice(0, 1000);
		result = {
			schemaIssues: compiling ? [issue] : [],
			issues: compiling ? [] : [{ path: "/", message: issue }],
			...(exceeded ? { resourceFailure: true } : {}),
		};
	}
	return result;
}
