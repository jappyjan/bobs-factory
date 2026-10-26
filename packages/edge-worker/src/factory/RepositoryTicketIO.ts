import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmdirSync as rmLock,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { GithubApi } from "./GithubApi.js";
import { runRepositories } from "./RepositoryScope.js";
import type { TicketIdentity, TicketIOAdapter } from "./TicketIO.js";
import type {
	RepositoryTicketReference,
	StatusType,
} from "./TicketIOContracts.js";
import type { TicketSnapshot } from "./TicketTracking.js";
import type { ExecutionContext } from "./WorkflowRuntime.js";
export async function repositoryTicketIO(
	ctx: ExecutionContext,
	ref: RepositoryTicketReference,
): Promise<TicketIOAdapter> {
	const repo = runRepositories(ctx.run).find(
		(repository) => repository.id === ref.repositoryId,
	);
	if (!repo) throw new Error("Ticket repository is outside this run");
	if (ref.provider === "file") {
		if (!ctx.factoryHome)
			throw new Error("File tickets require a runtime-owned factoryHome");
		const directory = join(
			ctx.factoryHome,
			"factory",
			"tickets",
			createHash("sha256").update(repo.id).digest("hex"),
		);
		return fileTicketIO(directory, ref.id);
	}
	if (!repo.githubUrl)
		throw new Error("GitHub issues require a configured GitHub repository");
	const { executeCommand } = await import("./nodes/execute/command.js");
	const api = new GithubApi(
		(exe, args, timeout) => executeCommand(ctx, exe, args, timeout),
		repo.githubUrl,
	);
	return githubTicketIO(api, ref.number);
}
const fileSchema = z.object({
	id: z.string(),
	url: z.string(),
	title: z.string(),
	description: z.string().optional(),
	priority: z.number().optional(),
	state: z.object({ type: z.string() }),
	comments: z.array(z.object({ body: z.string() })),
	attachments: z.array(z.object({ url: z.string() })),
});
export function fileTicketIO(directory: string, id: string): TicketIOAdapter {
	if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Invalid file ticket ID");
	const path = (value: string) => join(directory, `${value}.json`);
	const read = () =>
		fileSchema.parse(JSON.parse(readFileSync(path(id), "utf8")));
	const mutate = (fn: (ticket: z.output<typeof fileSchema>) => void) => {
		mkdirSync(`${path(id)}.lock`);
		try {
			const ticket = read();
			fn(ticket);
			const temporary = `${path(id)}.tmp`;
			writeFileSync(temporary, JSON.stringify(ticket), { mode: 0o600 });
			renameSync(temporary, path(id));
		} finally {
			// All IO in this section is synchronous; another writer cannot observe an unlocked partial update.
			rmLock(`${path(id)}.lock`);
		}
	};
	return {
		read: async () => read(),
		comment: async (body) =>
			mutate((ticket) => {
				if (!ticket.comments.some((comment) => comment.body === body))
					ticket.comments.push({ body });
			}),
		update: async (fields) => mutate((ticket) => Object.assign(ticket, fields)),
		setStatus: async (type) =>
			mutate((ticket) => {
				ticket.state.type = type;
			}),
		link: async (url) =>
			mutate((ticket) => {
				if (!ticket.attachments.some((item) => item.url === url))
					ticket.attachments.push({ url });
			}),
		async create(fields, key, reconcile) {
			const createdId = createHash("sha256").update(key).digest("hex");
			const url = `factory-ticket:${createdId}`;
			if (existsSync(path(createdId))) {
				const ticket = fileSchema.parse(
					JSON.parse(readFileSync(path(createdId), "utf8")),
				);
				if (!ticket.description?.includes(`<!-- factory-ticket:${key} -->`))
					throw new Error("File ticket identity collision");
				return { id: createdId, url: ticket.url };
			}
			if (reconcile) return undefined;
			mkdirSync(directory, { recursive: true, mode: 0o700 });
			writeFileSync(
				path(createdId),
				JSON.stringify({
					...fields,
					id: createdId,
					url,
					description: `${fields.description ?? ""}\n\n<!-- factory-ticket:${key} -->`,
					state: { type: "backlog" },
					comments: [],
					attachments: [],
				}),
				{ flag: "wx", mode: 0o600 },
			);
			return { id: createdId, url };
		},
	};
}

/** GitHub has no attachment primitive: links are explicit comments, read back as attachments. */
export function githubTicketIO(
	api: GithubApi,
	number: number,
): TicketIOAdapter {
	const issues = `repos/${api.repository.project}/issues`;
	const path = `${issues}/${number}`;
	const read = async (): Promise<TicketSnapshot> => {
		const issue = await api.request("GET", path);
		const comments = await api.pages<{ body: string }>(`${path}/comments`);
		const labels = (issue.labels as { name: string }[]).map(
			(label) => label.name,
		);
		const declared = labels
			.find((label) => label.startsWith("factory-status:"))
			?.slice(15);
		const type =
			issue.state === "closed"
				? declared === "canceled"
					? "canceled"
					: "completed"
				: declared && !["completed", "canceled"].includes(declared)
					? declared
					: "unstarted";
		return {
			...issue,
			id: String(issue.number),
			description: issue.body ?? "",
			state: { type },
			comments,
			attachments: comments.flatMap((comment) =>
				/^Factory link: (https?:\/\/\S+)$/.test(comment.body)
					? [{ url: comment.body.slice(14) }]
					: [],
			),
		};
	};
	return {
		read,
		async comment(body) {
			await api.request("POST", `${path}/comments`, { body });
		},
		async update(fields) {
			if (fields.priority !== undefined)
				throw new Error("GitHub issues do not support numeric priority");
			await api.request("PATCH", path, {
				...(fields.title !== undefined ? { title: fields.title } : {}),
				...(fields.description !== undefined
					? { body: fields.description }
					: {}),
			});
		},
		async setStatus(type: StatusType) {
			const issue = await api.request("GET", path);
			const labels = (issue.labels as { name: string }[])
				.map((label) => label.name)
				.filter((label) => !label.startsWith("factory-status:"));
			await api.request("PATCH", path, {
				state: ["completed", "canceled"].includes(type) ? "closed" : "open",
				...(["completed", "canceled"].includes(type)
					? { state_reason: type === "canceled" ? "not_planned" : "completed" }
					: {}),
				labels: [...labels, `factory-status:${type}`],
			});
		},
		async link(url) {
			if (!(await read()).attachments.some((item) => item.url === url))
				await api.request("POST", `${path}/comments`, {
					body: `Factory link: ${url}`,
				});
		},
		async create(fields, key, reconcile): Promise<TicketIdentity | undefined> {
			if (fields.priority !== undefined)
				throw new Error("GitHub issues do not support numeric priority");
			const marker = `<!-- factory-ticket:${key} -->`;
			// Search only candidate issues; large repositories must not scan every issue/PR.
			const {
				data: { search },
			} = await api.graphql<{
				data: {
					search: {
						nodes: { number: number; url: string; body: string }[];
						pageInfo: { hasNextPage: boolean };
					};
				};
			}>(
				`query TicketMarker($query: String!) {
				search(query: $query, type: ISSUE, first: 100) {
					nodes { ... on Issue { number url body } }
					pageInfo { hasNextPage }
				}
			}`,
				{
					query: `repo:${api.repository.project} is:issue in:body "factory-ticket:${key}"`,
				},
			);
			if (search.pageInfo.hasNextPage)
				throw new Error("GitHub ticket marker search is incomplete");
			const matches = search.nodes.filter((issue) =>
				issue.body?.includes(marker),
			);
			if (matches.length > 1)
				throw new Error("Several GitHub issues match the creation marker");
			if (matches[0])
				return { id: String(matches[0].number), url: matches[0].url };
			if (reconcile) return undefined;
			const created = await api.request("POST", issues, {
				title: fields.title,
				body: `${fields.description ?? ""}\n\n${marker}`,
			});
			return { id: String(created.number), url: created.html_url };
		},
	};
}
