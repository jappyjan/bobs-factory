import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import type { StateFormatSupport } from "bobs-factory-core";
import { type FsOps, realFs } from "../../src/migrations/fsOps.js";
import type { StateMigration } from "../../src/migrations/types.js";

export const SUPPORT_2: StateFormatSupport = { writes: 2, migratesFrom: 1 };

export function makeHome() {
	const home = mkdtempSync(join(tmpdir(), "state-format-"));
	const put = (rel: string, text: string) => {
		const path = join(home, rel);
		mkdirSync(join(path, ".."), { recursive: true });
		writeFileSync(path, text);
	};
	put("config.json", JSON.stringify({ repositories: [], note: "keep" }));
	put("factory/workflows.json", JSON.stringify({ workflows: [{ id: "w" }] }));
	for (const id of ["a", "b", "c"])
		put(`factory/runs/${id}.json`, JSON.stringify({ id }));
	put("factory/runs/notes.txt", "not a run manifest");
	put("factory/run-chunks/r/0001.bin", "x".repeat(4096));
	put("factory/evidence/e.png", "png");
	put("state/chunks/c1/data", "chunk");
	put("state/edge-worker-state.json", "{}");
	return home;
}

/** Content hash of everything except the backup slot and the format file. */
export function treeHash(home: string): string {
	const hash = createHash("sha256");
	const walk = (dir: string) => {
		for (const name of readdirSync(dir).sort()) {
			const path = join(dir, name);
			const rel = relative(home, path);
			if (rel === "updates" || rel === "state-format.json") continue;
			if (statSync(path).isDirectory()) {
				hash.update(`d:${rel}\n`);
				walk(path);
			} else hash.update(`f:${rel}:${readFileSync(path).toString("base64")}\n`);
		}
	};
	walk(home);
	return hash.digest("hex");
}

export function listTree(root: string, rel = ""): string[] {
	const dir = join(root, rel);
	return readdirSync(dir).flatMap((name) => {
		const next = rel ? `${rel}/${name}` : name;
		return statSync(join(root, next)).isDirectory()
			? listTree(root, next)
			: [next];
	});
}

const stamp = (text: Buffer) => {
	const value = JSON.parse(text.toString("utf8"));
	return Buffer.from(`${JSON.stringify({ ...value, format: 2 })}\n`);
};

/** Rewrites config.json, workflows.json and every run manifest, then creates a marker. */
export function fixtureMigration(
	options: {
		failAfterWrites?: number;
		failVerify?: boolean;
		touchOutside?: string;
	} = {},
): StateMigration {
	return {
		id: "0002-fixture",
		from: 1,
		to: 2,
		minReader: 1,
		touches: [
			{ file: "config.json" },
			{ file: "factory/workflows.json" },
			{ dir: "factory/runs", ext: ".json" },
			{ file: "factory/migrated.json" },
		],
		async apply(ctx) {
			let writes = 0;
			const write = (rel: string, data: Buffer) => {
				if (options.failAfterWrites === writes++)
					throw new Error("fixture failure");
				ctx.writeAtomic(rel, data);
			};
			write("config.json", stamp(ctx.read("config.json")));
			write(
				"factory/workflows.json",
				stamp(ctx.read("factory/workflows.json")),
			);
			for (const rel of ctx.list({ dir: "factory/runs", ext: ".json" }))
				write(rel, stamp(ctx.read(rel)));
			if (options.touchOutside) ctx.writeAtomic(options.touchOutside, "x");
			write("factory/migrated.json", Buffer.from("{}"));
		},
		async verify() {
			if (options.failVerify) throw new Error("verify failed");
		},
	};
}

type Op = Exclude<keyof FsOps, "readFile" | "size" | "readdir" | "freeBytes">;
const MUTATING: Op[] = [
	"writeFileSynced",
	"cloneFile",
	"rename",
	"unlink",
	"removeTree",
	"mkdirp",
];

/** Wraps the real fs. `crashAfter(n)` lets n writes land, then every call fails (a dead process). */
export function faultFs(
	options: {
		crashAfter?: number;
		enospc?: { op: Op; nth: number; match?: RegExp };
		freeBytes?: number;
	} = {},
) {
	const counts: Record<string, number> = {};
	let writes = 0;
	let dead = false;
	const fs: FsOps = { ...realFs };
	for (const key of Object.keys(realFs) as Array<keyof FsOps>) {
		const original = realFs[key] as (...args: unknown[]) => unknown;
		(fs as unknown as Record<string, unknown>)[key] = (...args: unknown[]) => {
			if (dead) throw new Error("process crashed");
			if (key === "freeBytes" && options.freeBytes !== undefined)
				return options.freeBytes;
			if ((MUTATING as string[]).includes(key)) {
				if (
					options.crashAfter !== undefined &&
					writes++ >= options.crashAfter
				) {
					dead = true;
					throw new Error("process crashed");
				}
				const rule = options.enospc;
				if (
					rule?.op === key &&
					(!rule.match || rule.match.test(String(args[0])))
				) {
					counts[key] = (counts[key] ?? 0) + 1;
					if (counts[key] === rule.nth)
						throw Object.assign(new Error("ENOSPC: no space left"), {
							code: "ENOSPC",
						});
				}
			}
			return original(...args);
		};
	}
	return { fs, writes: () => writes };
}
