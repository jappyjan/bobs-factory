import { existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import {
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
	sep,
	win32,
} from "node:path";
import type { Architecture } from "./Architecture.js";

export interface ArchitectureRepository {
	id: string;
	name: string;
	workspace: string;
	repositoryPath: string;
}
type Change = "new" | "edit" | "delete" | "unspecified";
type Kind = "code" | "test" | "docs" | "config" | "asset";
export interface ArchitectureFootprint {
	files: {
		path: string;
		repository?: string;
		area?: string;
		change: Change;
		kind: Kind;
		valid: boolean;
	}[];
	changes: Record<Change, number>;
	kinds: Record<Kind, number>;
	areas: { name: string; files: number }[];
	primaryArea?: string;
	warnings: { code: string; message: string; paths: string[] }[];
}
const contains = (root: string, path: string) => {
	const child = relative(root, path);
	return child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
};
function kind(path: string): Kind {
	if (
		/(^|\/)(__tests__|tests?|e2e|fixtures)(\/|$)|[.-](test|spec)\.[^/]+$/i.test(
			path,
		)
	)
		return "test";
	if (/(^|\/)(docs?|documentation)(\/|$)|\.(mdx?|rst|txt)$/i.test(path))
		return "docs";
	if (
		/\.(json[5c]?|ya?ml|toml|ini|config|lock)$|(^|\/)(Dockerfile|Makefile|[.][^/]+)$|(^|\/)[^/]*config\.[^/]+$/i.test(
			path,
		)
	)
		return "config";
	if (/\.(png|jpe?g|svg|webp|gif|ico|woff2?|mp4|pdf)$/i.test(path))
		return "asset";
	return "code";
}
/** Find the actual owning package/project, including Nx projects nested below apps/. */
function area(root: string, path: string): string {
	let folder = dirname(path);
	while (folder !== root && contains(root, folder)) {
		if (
			["package.json", "project.json"].some((file) =>
				existsSync(join(folder, file)),
			)
		)
			return relative(root, folder).split(sep).join("/");
		folder = dirname(folder);
	}
	const parts = relative(root, path).split(sep);
	return parts.length > 1 ? parts[0]! : "repository root";
}

/** Counts declared paths, not a future Git diff. Never reads paths outside the run's repositories. */
export function architectureFootprint(
	content: Architecture,
	repositories: readonly ArchitectureRepository[],
): ArchitectureFootprint {
	const result: ArchitectureFootprint = {
		files: [],
		changes: { new: 0, edit: 0, delete: 0, unspecified: 0 },
		kinds: { code: 0, test: 0, docs: 0, config: 0, asset: 0 },
		areas: [],
		warnings: [],
	};
	const warn = (code: string, message: string, paths: string[]) => {
		if (
			!result.warnings.some(
				(w) => w.code === code && w.paths.join() === paths.join(),
			)
		)
			result.warnings.push({ code, message, paths });
	};
	const locate = (path: string, repository?: string) => {
		if (
			/^[~]|[\n\r*?]|^[a-z]+:\/\//i.test(path) ||
			(win32.isAbsolute(path) && !isAbsolute(path))
		)
			return undefined;
		const candidates = repositories.flatMap((repo) => {
			if (repository && repository !== repo.id && repository !== repo.name)
				return [];
			const roots = [
				...new Set(
					[repo.workspace, repo.repositoryPath].flatMap((r) => {
						const root = resolve(r);
						try {
							return [root, realpathSync(root)];
						} catch {
							return [root];
						}
					}),
				),
			];
			const source = isAbsolute(path)
				? roots.find((r) => contains(r, path))
				: roots[0];
			if (!source) return [];
			const local = relative(source, resolve(source, path));
			const root = resolve(repo.workspace);
			const target = resolve(root, local);
			if (!contains(root, target) || target === root) return [];
			return [{ repo, root, target, local: local.split(sep).join("/") }];
		});
		// Repeated filenames in grouped repositories need explicit repository identity.
		return candidates.length === 1 ? candidates[0] : undefined;
	};
	const seen = new Map<string, ArchitectureFootprint["files"][number]>();
	for (const step of content.candidate.steps)
		for (const planned of step.files) {
			const declared =
				typeof planned === "string"
					? { path: planned, change: "unspecified" as const }
					: planned;
			const located = locate(
				declared.path,
				"repository" in declared ? declared.repository : undefined,
			);
			let valid = !!located;
			let fileArea: string | undefined;
			if (located) {
				try {
					let ancestor = located.target;
					while (
						!lstatSync(ancestor, { throwIfNoEntry: false }) &&
						ancestor !== located.root
					)
						ancestor = dirname(ancestor);
					if (!contains(realpathSync(located.root), realpathSync(ancestor))) {
						valid = false;
						warn(
							"outside-repository",
							"A planned path follows a link outside its repository.",
							[declared.path],
						);
					} else if (
						existsSync(located.target) &&
						!statSync(located.target).isFile()
					) {
						valid = false;
						warn(
							"not-a-file",
							"A planned file is a directory or another non-file path.",
							[declared.path],
						);
					} else {
						fileArea = `${located.repo.name}: ${area(located.root, located.target)}`;
						const exists = existsSync(located.target);
						if (
							(declared.change === "new" && exists) ||
							(["edit", "delete"].includes(declared.change) && !exists)
						)
							warn(
								"operation-mismatch",
								`The planned ${declared.change} operation does not match the current worktree.`,
								[declared.path],
							);
					}
				} catch {
					valid = false;
					warn(
						"unverifiable-path",
						"The planned path could not be checked in the current worktree.",
						[declared.path],
					);
				}
			} else
				warn(
					"unresolved-path",
					"A planned path is outside the repositories, names a workspace, or needs an explicit repository identity.",
					[declared.path],
				);
			const path = located?.local ?? declared.path;
			const key = `${located?.repo.id ?? "?"}:${path}`;
			const existing = seen.get(key);
			if (existing) {
				if (existing.change !== declared.change) {
					existing.change = "unspecified";
					warn(
						"conflicting-operations",
						"Deliverables disagree about the operation on the same file.",
						[path],
					);
				}
				continue;
			}
			const entry = {
				path,
				repository: located?.repo.id,
				area: fileArea,
				change: declared.change,
				kind: kind(path),
				valid,
			};
			seen.set(key, entry);
			result.files.push(entry);
		}
	const areaCounts = new Map<string, number>();
	const codeCounts = new Map<string, number>();
	for (const file of result.files) {
		result.changes[file.change]++;
		result.kinds[file.kind]++;
		if (file.area) {
			areaCounts.set(file.area, (areaCounts.get(file.area) ?? 0) + 1);
			if (file.kind === "code")
				codeCounts.set(file.area, (codeCounts.get(file.area) ?? 0) + 1);
		}
	}
	const ranked = (counts: Map<string, number>) =>
		[...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
	result.areas = ranked(areaCounts).map(([name, files]) => ({ name, files }));
	result.primaryArea = ranked(codeCounts)[0]?.[0];
	const other = result.files.filter(
		(f) =>
			f.valid &&
			f.kind === "code" &&
			result.primaryArea &&
			f.area !== result.primaryArea,
	);
	if (other.length)
		warn(
			"other-code-areas",
			`Code is also planned outside the largest code area (${result.primaryArea}). Review the need for these changes.`,
			other.map((f) => `${f.repository}: ${f.path}`),
		);
	const config = result.files.filter((f) => f.kind === "config");
	if (config.length)
		warn(
			"configuration",
			"The proposal includes build or configuration files.",
			config.map((f) => f.path),
		);
	for (const part of content.map?.parts ?? []) {
		if (part.status !== "unchanged" || !part.file) continue;
		const located = locate(part.file);
		const touched = result.files.filter((f) =>
			located
				? f.repository === located.repo.id && f.path === located.local
				: f.path === part.file,
		);
		if (touched.length)
			warn(
				"map-conflict",
				`The map marks “${part.label}” unchanged, but its file is listed for work.`,
				touched.map((f) => f.path),
			);
	}
	return result;
}
