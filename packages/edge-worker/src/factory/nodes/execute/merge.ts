import type { z } from "zod";
import {
	acquireDelivery,
	releaseDelivery,
} from "../../DeliveryCoordination.js";
import { resolveGitProvider } from "../../GitProvider.js";
import { repositoryReference } from "../../GitProviderReference.js";
import { delay } from "../../MergeReadiness.js";
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
	for (const request of requests)
		if (!repositories.some((repo) => repo.id === request.repositoryId))
			throw new Error(`Repository ${request.repositoryId} is outside this run`);
	const results = [];
	for (const request of requests) {
		const repository = repositories.find(
			(repo) => repo.id === request.repositoryId,
		)!;
		// Everything remote is inside the durable boundary: confirmed repositories can
		// be reused even when their provider becomes unavailable during a later retry.
		const operate = async (key: string, reconcile: boolean) => {
			ctx.signal.throwIfAborted();
			const context = { ...ctx, run: repositoryRun(ctx.run, repository) };
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
			const checkHead = (head: string) => {
				if (head !== request.headSha)
					throw new Error(
						"PR head changed; bind the current revision before merging",
					);
			};
			const receipt = (sha?: string) => {
				if (!sha)
					throw new Error("Provider confirmed merge without its commit SHA");
				return { merged: true, sha, url: request.url };
			};
			const current = await provider.view(request.url);
			checkHead(current.headRefOid);
			if (current.state === "MERGED") return receipt(current.mergeCommitSha);
			if (current.state !== "OPEN") throw new Error("PR closed without merge");
			const url =
				repository.providerSnapshot?.repositoryUrl ??
				repository.githubUrl ??
				repository.gitlabUrl;
			if (!url) throw new Error("Merge needs a configured repository URL");
			const reservation = `node:${key}`;
			const scopes = [
				JSON.stringify([
					repositoryReference(url).url,
					current.baseRefName ?? repository.baseBranch,
				]),
			];
			await ctx.phase("waiting-ci", () =>
				acquireDelivery(
					ctx.run,
					() => ctx.engine.runs.values(),
					ctx.signal,
					ctx.checkpoint,
					ctx.log,
					{
						key: reservation,
						scopes,
						reason: "Repository mutation",
						assertSchedulingOpen: ctx.assertSchedulingOpen,
					},
				),
			);
			try {
				if (!reconcile) {
					const method =
						ctx.step.method ??
						(await provider.readiness(request.url)).mergeMethod;
					await provider.merge(request.url, request.headSha, method);
				}
				// OPEN after a lost response is unknown, never proven absence. Poll only;
				// this includes requests still processing or admitted to a provider queue.
				return await ctx.phase("waiting-ci", async () => {
					const deadline = Date.now() + ctx.step.timeout;
					while (true) {
						ctx.signal.throwIfAborted();
						ctx.assertSchedulingOpen?.();
						const state = await provider.view(request.url);
						checkHead(state.headRefOid);
						if (state.state === "MERGED") return receipt(state.mergeCommitSha);
						if (state.state !== "OPEN")
							throw new Error("PR closed without merge");
						if (Date.now() >= deadline)
							throw new Error("Timed out waiting for provider-confirmed merge");
						await delay(ctx.signal, ctx.step.pollInterval);
					}
				});
			} finally {
				releaseDelivery(ctx.run, "Repository operation settled", reservation);
				await ctx.checkpoint();
			}
		};
		const result = await ctx.effect(
			`merge:${repository.id}`,
			{ ...request, method: ctx.step.method ?? "provider-default" },
			(key) => operate(key, false),
			(key) => operate(key, true),
		);
		results.push({ repositoryId: repository.id, ...result });
	}
	return { repositories: results };
}
