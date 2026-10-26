import type { z } from "zod";
import {
	acquireDelivery,
	releaseDelivery,
} from "../../DeliveryCoordination.js";
import { resolveGitProvider } from "../../GitProvider.js";
import { repositoryReference } from "../../GitProviderReference.js";
import { delay } from "../../MergeReadiness.js";
import { latestNodeReceipt, nodeReference } from "../../NodeGuarantees.js";
import { repositoryRun, runRepositories } from "../../RepositoryScope.js";
import { requestSchema, type schema } from "../merge.js";
import type { NodeContext } from "../NodeDefinition.js";

export async function execute(ctx: NodeContext<z.output<typeof schema>>) {
	const raw = ctx.step.requests ?? ctx.reads.requests;
	const grouped = raw as
		| {
				deliveries?: { repositoryId: string; output: object }[];
				repositories?: object[];
		  }
		| undefined;
	const values = grouped?.deliveries
		? grouped.deliveries.map((item) => ({
				repositoryId: item.repositoryId,
				...item.output,
			}))
		: (grouped?.repositories ??
			(Array.isArray(raw)
				? raw
				: [{ repositoryId: ctx.run.repositoryId, ...(raw as object) }]));
	const requests = requestSchema
		.array()
		.min(1)
		.parse(
			values.map((value) => {
				const item = value as {
					id?: string;
					repositoryId?: string;
					headSha?: string;
					head?: string;
					headRefOid?: string;
				};
				return {
					...item,
					repositoryId: item.repositoryId ?? item.id,
					headSha: item.headSha ?? item.head ?? item.headRefOid,
				};
			}),
		);
	if (
		new Set(requests.map((item) => item.repositoryId)).size !== requests.length
	)
		throw new Error("Duplicate merge repository");
	const repositories = runRepositories(ctx.run);
	if (ctx.step.expectedRevision) {
		const receipt = latestNodeReceipt(
			ctx,
			nodeReference(ctx, ctx.step.expectedRevision),
		);
		for (const request of requests) {
			const revision = receipt?.guarantee?.revisions[request.repositoryId];
			if (!revision || revision.unobservable || !receipt?.inputDigest)
				throw new Error("Merge expectedRevision requires a stamped revision");
			request.headSha = revision.headSha;
		}
	}
	for (const request of requests)
		if (!repositories.some((repo) => repo.id === request.repositoryId))
			throw new Error(`Repository ${request.repositoryId} is outside this run`);
	const results = [];
	for (const request of requests) {
		const repository = repositories.find(
			(repo) => repo.id === request.repositoryId,
		)!;
		const name = `merge:${repository.id}`;
		const key = await ctx.effectKey(name);
		const reservation = `node:${key}`;
		const context = { ...ctx, run: repositoryRun(ctx.run, repository) };
		const getProvider = async () => {
			const { executeCommand } = await import("../../FactoryTools.js");
			const provider = ctx.engine.hooks.ioGitProvider
				? await ctx.engine.hooks.ioGitProvider(context)
				: await resolveGitProvider(
						context,
						(exe, args, timeout) => executeCommand(context, exe, args, timeout),
						request.url,
					);
			repository.providerSnapshot = context.run.gitProvider;
			await ctx.checkpoint();
			return provider;
		};
		// Resolve lazily so a confirmed repository needs no provider on a grouped retry.
		let provider: Awaited<ReturnType<typeof getProvider>> | undefined;
		const checkHead = (head: string) => {
			if (head !== request.headSha)
				throw new Error(
					"PR head changed; bind the current revision before merging",
				);
		};
		const confirm = () =>
			ctx.phase("waiting-ci", async () => {
				provider ??= await getProvider();
				const deadline = Date.now() + ctx.step.timeout;
				while (true) {
					ctx.signal.throwIfAborted();
					ctx.assertSchedulingOpen?.();
					const state = await provider.view(request.url);
					checkHead(state.headRefOid);
					if (state.state === "MERGED") {
						if (!state.mergeCommitSha)
							throw new Error(
								"Provider confirmed merge without its commit SHA",
							);
						return {
							merged: true,
							sha: state.mergeCommitSha,
							url: request.url,
						};
					}
					if (state.state !== "OPEN")
						throw new Error("PR closed without merge");
					if (Date.now() >= deadline)
						throw new Error("Timed out waiting for provider-confirmed merge");
					await delay(ctx.signal, ctx.step.pollInterval);
				}
			});
		const release = async () => {
			releaseDelivery(ctx.run, "Repository operation settled", reservation);
			await ctx.checkpoint();
		};
		let method = ctx.step.method;
		let alreadyMerged = false;
		try {
			const record = ctx.run.nodeEffects?.[key];
			if (!record || record.phase === "not-sent") {
				// Failures and cancellation during preflight/admission must remain retryable.
				if (
					ctx.step.expectedRevision &&
					!(await ctx.fresh(ctx.step.expectedRevision))
				)
					throw new Error("Merge expectedRevision is stale");
				ctx.signal.throwIfAborted();
				provider = await getProvider();
				const current = await provider.view(request.url);
				checkHead(current.headRefOid);
				alreadyMerged = current.state === "MERGED";
				if (!alreadyMerged) {
					if (current.state !== "OPEN")
						throw new Error("PR closed without merge");
					method ??= (await provider.readiness(request.url)).mergeMethod;
					const url =
						repository.providerSnapshot?.repositoryUrl ??
						repository.githubUrl ??
						repository.gitlabUrl;
					if (!url) throw new Error("Merge needs a configured repository URL");
					await ctx.phase("waiting-ci", () =>
						acquireDelivery(
							ctx.run,
							() => ctx.engine.runs.values(),
							ctx.signal,
							ctx.checkpoint,
							ctx.log,
							{
								key: reservation,
								scopes: [
									JSON.stringify([
										repositoryReference(url).url,
										current.baseRefName ?? repository.baseBranch,
									]),
								],
								reason: "Repository mutation",
								assertSchedulingOpen: ctx.assertSchedulingOpen,
							},
						),
					);
				}
			}
			const result = await ctx.effect(
				name,
				{ ...request, method: ctx.step.method ?? "provider-default" },
				async () => {
					try {
						if (!alreadyMerged)
							await provider!.merge(request.url, request.headSha, method!);
					} finally {
						// Provider queues can take an hour: other runs may publish while we poll.
						await release();
					}
					return confirm();
				},
				// An OPEN PR after dispatch is unknown, including provider merge queues.
				() => confirm(),
			);
			results.push({ repositoryId: repository.id, ...result });
		} finally {
			await release();
		}
	}
	return { repositories: results };
}
