export { feedbackPolicyInstructions } from "./InstructionText.js";

import { createHash } from "node:crypto";
import { z } from "zod";
import { boundOutput, historyForCheck } from "./ToolBindings.js";
import type { ExecutionContext } from "./WorkflowRuntime.js";

export const FeedbackPolicySchema = z.object({
	author: z.string().trim().min(1).max(200),
	action: z.enum(["ignore", "assess"]),
	reason: z.string().trim().min(1),
	source: z.object({
		path: z
			.string()
			.regex(
				/^(input|answers\/\d+\/answer|chatMessages\/\d+\/text|humanDecisions\/\d+\/feedback)$/,
			),
		quote: z.string().trim().min(1).max(2000),
	}),
});
type FeedbackPolicy = z.infer<typeof FeedbackPolicySchema>;
type AuthorizedPolicy = FeedbackPolicy & {
	sourceSha256: string;
	sourceAt: string;
	sourceOffset: number;
};

function instruction(context: ExecutionContext, path: string) {
	const { run } = context;
	if (path === "input") return { text: run.input, at: run.createdAt };
	const [collection, index] = path.split("/");
	const position = Number(index);
	if (collection === "answers") {
		const value = run.answers?.[position];
		return value && { text: value.answer, at: value.at };
	}
	if (collection === "humanDecisions") {
		const value = run.humanDecisions?.[position];
		return value && { text: value.feedback, at: value.at };
	}
	const messages =
		context.chatMessages ??
		(
			context.input as
				| { chatMessages?: { text: string; at: string }[] }
				| undefined
		)?.chatMessages;
	const value = messages?.[position];
	return value && { text: value.text, at: value.at };
}

function authorize(
	context: ExecutionContext,
	value: FeedbackPolicy,
): AuthorizedPolicy {
	const source = instruction(context, value.source.path);
	if (
		!source?.text ||
		!source.at ||
		!Number.isFinite(Date.parse(source.at)) ||
		!source.text.includes(value.source.quote)
	)
		throw new Error(
			`Feedback policy for ${value.author} requires an exact supporting user instruction at ${value.source.path}`,
		);
	return {
		...value,
		sourceSha256: createHash("sha256").update(source.text).digest("hex"),
		sourceAt: source.at,
		sourceOffset: source.text.indexOf(value.source.quote),
	};
}

export function authorizeFeedbackPolicies(
	context: ExecutionContext,
	values: unknown,
): AuthorizedPolicy[] {
	return z
		.array(FeedbackPolicySchema)
		.parse(values ?? [])
		.map((value) => authorize(context, value));
}

export function feedbackInstructionFingerprint(
	context: ExecutionContext,
): string {
	return createHash("sha256")
		.update(
			JSON.stringify({
				input: context.run.input,
				answers: context.run.answers ?? [],
				humanDecisions: context.run.humanDecisions ?? [],
				chatMessages:
					context.chatMessages ??
					(context.input as { chatMessages?: unknown } | undefined)
						?.chatMessages ??
					[],
			}),
		)
		.digest("hex");
}

/** Feedback gates expose their inputs independently of customized role inputs. */
export function factoryFeedbackContext(context: ExecutionContext) {
	return {
		readiness: context.run.mergeReadiness ?? boundOutput(context, "ci"),
		handoff: boundOutput(context, "handoff"),
		guide: boundOutput(context, "guide"),
		userInstructions: {
			input: context.run.input,
			answers: context.run.answers ?? [],
			humanDecisions: context.run.humanDecisions ?? [],
			chatMessages:
				context.chatMessages ??
				(context.input as { chatMessages?: unknown } | undefined)
					?.chatMessages ??
				[],
		},
	};
}

/** Recheck the human source, so persisted or edited agent output cannot invent authority. */
export function feedbackPolicies(
	context: ExecutionContext,
	candidate: AuthorizedPolicy[] = [],
): Map<string, AuthorizedPolicy> {
	const active = new Map<string, AuthorizedPolicy>();
	const outputs = historyForCheck(context.run, "feedback-assessment").map(
		(item) =>
			(item.output as { feedbackPolicies?: unknown[] } | undefined)
				?.feedbackPolicies ?? [],
	);
	for (const value of [...outputs.flat(), ...candidate]) {
		const parsed = FeedbackPolicySchema.safeParse(value);
		if (!parsed.success) continue;
		let policy: AuthorizedPolicy;
		try {
			policy = authorize(context, parsed.data);
		} catch {
			continue;
		}
		if ((value as AuthorizedPolicy).sourceSha256 !== policy.sourceSha256)
			continue;
		const key = policy.author.toLowerCase();
		const previous = active.get(key);
		if (
			!previous ||
			Date.parse(policy.sourceAt) > Date.parse(previous.sourceAt) ||
			(policy.sourceAt === previous.sourceAt &&
				policy.sourceOffset >= previous.sourceOffset)
		)
			active.set(key, policy);
	}
	return active;
}
