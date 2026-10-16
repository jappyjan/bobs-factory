import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
	ArchitectureSchema,
	proposalDigest,
	snapshotProposal,
	verifyProposal,
} from "../src/factory/Architecture.js";
import { architectureFootprint } from "../src/factory/ArchitectureFootprint.js";
import { proposal } from "./fixtures/architecture.js";

const homes: string[] = [];
afterEach(() => {
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});
function fixture() {
	const home = mkdtempSync(join(tmpdir(), "architecture-footprint-"));
	homes.push(home);
	const workspace = join(home, "repo");
	const file = (path: string) => {
		mkdirSync(join(workspace, path, ".."), { recursive: true });
		writeFileSync(join(workspace, path), "fixture");
	};
	for (const path of [
		"apps/plugins/wago/project.json",
		"apps/plugins/wago/parse.ts",
		"apps/plugins/wago/runtime.ts",
		"apps/plugins/rabbitmq/project.json",
		"apps/plugins/rabbitmq/provider.ts",
		"docs/recovery.md",
	])
		file(path);
	return {
		home,
		workspace,
		repos: [
			{ id: "repo", name: "Example", workspace, repositoryPath: workspace },
		],
	};
}

it("retains a 1,024-file architecture plan in bounded deliverables without dropping footprint paths", () => {
	const { repos } = fixture();
	const value = proposal();
	const step = value.candidate.steps[0]!;
	value.candidate.steps = Array.from({ length: 26 }, (_, group) => ({
		...step,
		id: `D${group + 1}`,
		files: Array.from({ length: group === 25 ? 24 : 40 }, (_, file) => ({
			path: `src/area-${group}/file-${file}.ts`,
			change: "new" as const,
		})),
	}));
	const parsed = ArchitectureSchema.parse(value);
	expect(architectureFootprint(parsed, repos).files).toHaveLength(1024);
	value.candidate.steps = Array.from({ length: 65 }, (_, i) => ({
		...step,
		id: `D${i + 1}`,
	}));
	expect(ArchitectureSchema.safeParse(value).success).toBe(false);
	value.candidate.steps = [
		{ ...step, files: Array.from({ length: 41 }, () => step.files[0]!) },
	];
	expect(ArchitectureSchema.safeParse(value).success).toBe(false);
});

it("surfaces cross-plugin scope, config, workspace paths and unchanged-map contradictions while counting unique files", () => {
	const { workspace, repos } = fixture();
	const value = proposal();
	value.candidate.steps[0]!.files = [
		{ path: "apps/plugins/wago/parse.ts", change: "edit" },
		{ path: "apps/plugins/wago/runtime.ts", change: "edit" },
		{ path: "apps/plugins/wago/limits.ts", change: "new" },
		{ path: "apps/plugins/rabbitmq/provider.ts", change: "edit" },
		{ path: "apps/plugins/wago/project.json", change: "edit" },
		{ path: "docs/recovery.md", change: "edit" },
		{ path: workspace, change: "edit" },
		{ path: "apps/plugins/wago", change: "edit" },
	];
	value.candidate.steps.push({
		...value.candidate.steps[0]!,
		id: "D2",
		files: [{ path: "apps/plugins/wago/parse.ts", change: "edit" }],
	});
	value.map!.parts[0]!.file = "apps/plugins/rabbitmq/provider.ts";
	value.map!.parts[0]!.status = "unchanged";
	const result = architectureFootprint(value, repos);
	expect(result.files).toHaveLength(8);
	expect(result.files.filter((f) => f.valid)).toHaveLength(6);
	expect(result.changes).toEqual({
		new: 1,
		edit: 7,
		delete: 0,
		unspecified: 0,
	});
	expect(result.primaryArea).toBe("Example: apps/plugins/wago");
	expect(result.warnings.map((w) => w.code).sort()).toEqual(
		[
			"configuration",
			"map-conflict",
			"not-a-file",
			"other-code-areas",
			"unresolved-path",
		].sort(),
	);
	expect(
		result.warnings.find((w) => w.code === "other-code-areas")!.paths,
	).toEqual(["repo: apps/plugins/rabbitmq/provider.ts"]);
});

it("keeps repository identity, rejects escaping links and distinguishes new files from missing edits", () => {
	const { home, workspace, repos } = fixture();
	const second = join(home, "other");
	mkdirSync(second);
	repos.push({
		id: "other",
		name: "Other",
		workspace: second,
		repositoryPath: second,
	});
	symlinkSync(second, join(workspace, "escape"));
	symlinkSync(join(second, "missing"), join(workspace, "dangling"));
	const value = proposal();
	value.candidate.steps[0]!.files = [
		{ path: "shared.ts", change: "new" },
		{ path: "shared.ts", change: "new", repository: "repo" },
		{ path: "shared.ts", change: "new", repository: "other" },
		{ path: "escape/new.ts", change: "new", repository: "repo" },
		{ path: "dangling/new.ts", change: "new", repository: "repo" },
		{ path: "../outside.ts", change: "edit", repository: "repo" },
		{ path: "missing.ts", change: "edit", repository: "repo" },
	];
	const result = architectureFootprint(value, repos);
	expect(
		result.files
			.filter((f) => f.path === "shared.ts" && f.valid)
			.map((f) => f.repository),
	).toEqual(["repo", "other"]);
	expect(
		result.warnings.filter((w) => w.code === "unresolved-path"),
	).toHaveLength(2);
	expect(
		result.warnings.find((w) => w.code === "outside-repository")!.paths,
	).toEqual(["escape/new.ts"]);
	expect(result.files.find((f) => f.path === "dangling/new.ts")!.valid).toBe(
		false,
	);
	expect(
		result.warnings.find((w) => w.code === "operation-mismatch")!.paths,
	).toEqual(["missing.ts"]);
});

it("rejects false coverage links and incomplete deliverables, while retaining the historical schema", () => {
	const value = proposal();
	expect(ArchitectureSchema.safeParse(value).success).toBe(true);
	value.candidate.steps[0]!.traces = [{ criterion: "invented" }];
	expect(ArchitectureSchema.safeParse(value).success).toBe(false);
	value.candidate.steps[0]!.traces = [{ added: "Independent preparation" }];
	expect(ArchitectureSchema.safeParse(value).success).toBe(false);
	value.criteria![0]!.status = "deferred";
	expect(ArchitectureSchema.safeParse(value).success).toBe(true);
	value.candidate.steps[0]!.what = undefined;
	expect(ArchitectureSchema.safeParse(value).success).toBe(false);
	delete value.briefVersion;
	delete value.problem;
	delete value.criteria;
	delete value.nonGoals;
	delete value.acceptance;
	value.candidate.steps = [
		{ title: "Historical step", files: ["src/factory/WorkflowRuntime.ts"] },
	];
	expect(ArchitectureSchema.safeParse(value).success).toBe(true);
});

it("counts canonical and symlinked repository paths once and flags conflicting operations", () => {
	const { home, workspace, repos } = fixture();
	const alias = join(home, "repo-alias");
	symlinkSync(workspace, alias);
	repos[0]!.workspace = alias;
	const value = proposal();
	value.candidate.steps[0]!.files = [
		{ path: join(alias, "apps/plugins/wago/parse.ts"), change: "edit" },
		{ path: join(workspace, "apps/plugins/wago/parse.ts"), change: "delete" },
	];
	const result = architectureFootprint(value, repos);
	expect(result.files).toHaveLength(1);
	expect(result.files[0]).toMatchObject({
		path: "apps/plugins/wago/parse.ts",
		valid: true,
		change: "unspecified",
	});
	expect(result.warnings.map((w) => w.code)).toEqual([
		"conflicting-operations",
	]);
});

it("binds the runtime footprint to approval and retains review requirements in the implementation plan", async () => {
	const { home, repos } = fixture();
	const value = proposal();
	const saved = await snapshotProposal(
		value,
		"architecture",
		1,
		home,
		new AbortController().signal,
		[],
		repos,
	);
	expect(saved.content.candidate.plan).toContain(
		JSON.stringify(value.acceptance),
	);
	expect(() => verifyProposal(saved)).not.toThrow();
	saved.footprint!.files.length = 0;
	expect(() => verifyProposal(saved)).toThrow("content changed");
	// A retained proposal without runtime metadata keeps its original digest shape.
	delete saved.footprint;
	saved.digest = proposalDigest(saved);
	expect(() => verifyProposal(saved)).not.toThrow();
});
