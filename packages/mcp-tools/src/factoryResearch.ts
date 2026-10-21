import { execFileSync } from "node:child_process";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/** Supplied out of band by the runtime, never taken from an agent's context. */
export const ResearchAccessSchema = z.object({
	repositories: z
		.array(
			z.object({
				id: z.string(),
				root: z.string(),
				revision: z.string().regex(/^[a-f0-9]{40,64}$/),
			}),
		)
		.min(1),
	maxCalls: z.number().int().min(1).max(200).default(60),
});
export type ResearchAccess = z.infer<typeof ResearchAccessSchema>;
const privatePath =
	/(?:^|\/)(?:\.env(?:\..*)?|[^/]*\.(?:pem|key|p12|pfx)|credentials[^/]*|secrets?[^/]*)(?:\/|$)/i;
const safePath = (path: string) =>
	!!path &&
	!path.startsWith("/") &&
	!path.startsWith(":") &&
	!path.split("/").some((p) => p === ".." || p === ".git") &&
	!privatePath.test(path);

export function registerResearchTools(
	server: McpServer,
	input: ResearchAccess,
) {
	const access = ResearchAccessSchema.parse(input);
	let calls = 0;
	const invoke = (repositoryId: string) => {
		if (++calls > access.maxCalls)
			throw new Error(
				"Research tool budget exhausted; return collected evidence and limitations",
			);
		const repo = access.repositories.find((r) => r.id === repositoryId);
		if (!repo)
			throw new Error("Repository is outside this research assignment");
		const git = (args: string[]) =>
			execFileSync("git", ["--no-pager", "-C", repo.root, ...args], {
				encoding: "utf8",
				timeout: 15000,
				maxBuffer: 4 * 1024 * 1024,
				env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
				stdio: ["ignore", "pipe", "pipe"],
			});
		return { repo, git };
	};
	const result = (data: unknown) => ({
		content: [{ type: "text" as const, text: JSON.stringify(data) }],
	});
	const annotations = {
		readOnlyHint: true,
		destructiveHint: false,
		openWorldHint: false,
	};
	server.registerTool(
		"list_repository",
		{
			description:
				"List tracked files at this research run's pinned revision. Secret-looking paths and symlinks are excluded. Follow nextOffset.",
			inputSchema: {
				repositoryId: z.string(),
				prefix: z.string().max(1000).default(""),
				offset: z.number().int().nonnegative().default(0),
			},
			annotations,
		},
		async ({ repositoryId, prefix, offset }) => {
			const { repo, git } = invoke(repositoryId);
			const paths = git(["ls-tree", "-rz", "--full-tree", repo.revision])
				.split("\0")
				.flatMap((line) => {
					const match = /^(100644|100755) blob [a-f0-9]+\t([\s\S]+)$/.exec(
						line,
					);
					return match && safePath(match[2]!) && match[2]!.startsWith(prefix)
						? [match[2]!]
						: [];
				});
			return result({
				revision: repo.revision,
				paths: paths.slice(offset, offset + 100),
				total: paths.length,
				nextOffset: offset + 100 < paths.length ? offset + 100 : null,
			});
		},
	);
	server.registerTool(
		"read_repository",
		{
			description:
				"Read a tracked text blob from the pinned revision. No working-tree files, symlinks or credentials are read. Output is paginated in characters.",
			inputSchema: {
				repositoryId: z.string(),
				path: z.string().min(1).max(1000),
				offset: z.number().int().nonnegative().default(0),
			},
			annotations,
		},
		async ({ repositoryId, path, offset }) => {
			if (!safePath(path)) throw new Error("Invalid or private research path");
			const { repo, git } = invoke(repositoryId);
			const tree = git(["ls-tree", "-z", repo.revision, "--", path]);
			if (
				!/^100(?:644|755) blob [a-f0-9]+\t/.test(tree) ||
				tree.split("\t").slice(1).join("\t") !== `${path}\0` ||
				tree.split("\0").filter(Boolean).length !== 1
			)
				throw new Error("Research reads require one regular tracked file");
			const text = git(["show", `${repo.revision}:${path}`]);
			if (text.includes("\0"))
				throw new Error("Binary research blobs are unsupported");
			return result({
				revision: repo.revision,
				path,
				offset,
				text: text.slice(offset, offset + 16000),
				total: text.length,
				nextOffset: offset + 16000 < text.length ? offset + 16000 : null,
			});
		},
	);
}
