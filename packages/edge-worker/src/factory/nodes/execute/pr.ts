import type { z } from "zod";
import type { NodeContext } from "../NodeDefinition.js";
import type { schema } from "../pr.js";
import {
	assertRequest,
	checksSummary,
	marker,
	repositories,
	requestDetails,
	requestUrl,
	textRead,
} from "./repository-io.js";

export async function execute(ctx: NodeContext<z.output<typeof schema>>) {
	return repositories(ctx, async (io) => {
		const { repository, branch } = io;
		const provider = await io.provider();
		if (ctx.step.op === "ensure") {
			if (!branch || branch === repository.baseBranch)
				throw new Error("PR ensure requires a non-base branch");
			const title = textRead(ctx, "title"),
				body = textRead(ctx, "body", true);
			const intent = { branch, baseBranch: repository.baseBranch, title, body };
			const find = async () => {
				const candidates = await provider.list(branch);
				if (candidates.length > 1)
					throw new Error("Multiple PRs for the scoped branch");
				if (!candidates[0]) return null;
				const pr = await requestDetails(provider, candidates[0].url);
				assertRequest(io, pr);
				return pr;
			};
			return ctx.effect(
				`pr:ensure:${repository.id}`,
				intent,
				async (key) => {
					const markedBody = `${body}\n\n${marker(key)}`;
					const existing = await find();
					if (existing && !existing.isDraft)
						return {
							url: existing.url,
							head: existing.headRefOid,
							isDraft: false,
						};
					let url = existing?.url;
					if (url) {
						if (!provider.update)
							throw new Error("Provider does not support PR updates");
						await provider.update(url, { title, body: markedBody });
					} else url = await provider.create({ ...intent, body: markedBody });
					const pr = await requestDetails(provider, url);
					assertRequest(io, pr);
					if (
						!pr.isDraft ||
						pr.body !== markedBody ||
						pr.title.replace(/^(?:Draft:|WIP:)\s*/i, "") !==
							title.replace(/^(?:Draft:|WIP:)\s*/i, "")
					)
						throw new Error(
							"Provider did not confirm the requested draft metadata",
						);
					return { url, head: pr.headRefOid, isDraft: true };
				},
				async (key) => {
					const pr = await find();
					if (!pr) return null;
					return pr.body === `${body}\n\n${marker(key)}` &&
						pr.title.replace(/^(?:Draft:|WIP:)\s*/i, "") ===
							title.replace(/^(?:Draft:|WIP:)\s*/i, "")
						? { url: pr.url, head: pr.headRefOid, isDraft: pr.isDraft }
						: undefined;
				},
			);
		}
		const url = await requestUrl(ctx, io, provider);
		if (ctx.step.op === "read") {
			if (!provider.read) throw new Error("Provider does not support PR reads");
			const pr = await provider.read(url);
			return {
				...pr,
				head: pr.headRefOid,
				base: pr.baseSha,
				checksSummary: checksSummary(pr.checks as { bucket: string }[]),
			};
		}
		const pr = await requestDetails(provider, url);
		assertRequest(io, pr);
		if (ctx.step.op === "ready") {
			return ctx.effect(
				`pr:ready:${repository.id}`,
				{ url, head: pr.headRefOid },
				async () => {
					if (pr.isDraft) await provider.draft(url, false);
					const current = await requestDetails(provider, url);
					assertRequest(io, current);
					if (current.isDraft || current.headRefOid !== pr.headRefOid)
						throw new Error(
							"Provider did not confirm ready state at the requested head",
						);
					return { url, head: pr.headRefOid, isDraft: false };
				},
				async () => {
					const current = await requestDetails(provider, url);
					assertRequest(io, current);
					return current.headRefOid === pr.headRefOid && !current.isDraft
						? { url, head: current.headRefOid, isDraft: false }
						: undefined;
				},
			);
		}
		const body = textRead(ctx, "body");
		if (!provider.comment || !provider.comments)
			throw new Error("Provider does not support idempotent comments");
		return ctx.effect(
			`pr:comment:${repository.id}`,
			{ url, body },
			async (key) => {
				const comment = await provider.comment!(
					url,
					`${body}\n\n${marker(key)}`,
				);
				return { url, head: pr.headRefOid, comment };
			},
			async (key) => {
				const comments = await provider.comments!(url);
				const comment = comments.find(
					(c) => c.body === `${body}\n\n${marker(key)}`,
				);
				return comment ? { url, head: pr.headRefOid, comment } : null;
			},
		);
	});
}
