import type { z } from "zod";
import type { schema } from "../ci.js";
import type { NodeContext } from "../NodeDefinition.js";
import { checksSummary, repositories, requestUrl } from "./repository-io.js";

export async function execute(ctx: NodeContext<z.output<typeof schema>>) {
	return repositories(ctx, async (io) => {
		const provider = await io.provider();
		const url = await requestUrl(ctx, io, provider);
		const snapshot = await provider.readiness(url);
		const headMatches = snapshot.headSha === io.head;
		const checks = snapshot.checks.map((check) => ({
			name: check.name,
			required: check.required ?? null,
			conclusion: check.state,
			status: check.bucket,
			url: check.link ?? null,
			failureLogExcerpt:
				(check.failureLogExcerpt ?? check.failure?.evidence)?.slice(-8000) ??
				null,
			infraFailure: check.failure?.kind === "infrastructure",
			retry: check.retry ?? null,
		}));
		const reruns = [];
		if (ctx.step.op === "rerun") {
			const candidates = snapshot.checks.filter(
				(check) =>
					check.bucket === "fail" && check.failure?.kind === "infrastructure",
			);
			const seen = new Set<string>();
			for (const check of candidates) {
				const retry = check.retry;
				const reason = !headMatches
					? "head-mismatch"
					: !provider.retryCheck
						? "unsupported"
						: !retry
							? "missing-retry-identity"
							: retry.headSha !== io.head
								? "retry-head-mismatch"
								: retry.status && retry.status !== "completed"
									? "in-progress"
									: undefined;
				if (reason || !retry) {
					reruns.push({
						check: check.name,
						retry: retry ?? null,
						requested: false,
						skipped: reason,
					});
					continue;
				}
				const identity = `${retry.kind}:${retry.id}:${retry.attempt}`;
				if (seen.has(identity)) continue;
				seen.add(identity);
				const receipt = { check: check.name, retry, requested: true };
				reruns.push(
					await ctx.effect(
						`ci:rerun:${io.repository.id}:${identity}`,
						{ url, retry },
						async () => {
							const result = await provider.retryCheck!(url, retry);
							return result?.requested === false
								? {
										...receipt,
										requested: false,
										skipped: result.reason ?? "provider-skipped",
									}
								: receipt;
						},
						async () => {
							const current = await provider.readiness(url);
							if (current.headSha !== io.head) return undefined;
							const next = current.checks.find(
								(c) =>
									c.retry?.kind === retry.kind &&
									(c.retry.id === retry.id ||
										(retry.lineage && c.retry.lineage === retry.lineage)),
							);
							return next?.retry &&
								(next.retry.attempt > retry.attempt ||
									(next.retry.status && next.retry.status !== "completed"))
								? receipt
								: undefined;
						},
					),
				);
			}
		}
		return {
			url,
			base: snapshot.baseSha,
			prHead: snapshot.headSha,
			localHead: io.head,
			headMatches,
			summary: checksSummary(snapshot.checks, headMatches),
			checks,
			infraFailure: checks.some((c) => c.infraFailure),
			...(ctx.step.op === "rerun" ? { reruns } : {}),
		};
	});
}
