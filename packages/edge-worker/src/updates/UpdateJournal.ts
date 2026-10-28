import {
	closeSync,
	fsyncSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { DataBaseline } from "./DataSummary.js";

/** Durable step journal, a sidecar of `state.json` so that older supervisors
 * (which rewrite `state.json` through a schema that drops unknown keys) never
 * strip it. The step names the last side effect this transaction *started*;
 * recovery re-derives the truth from links, the worker lock and the migration
 * manifest and never trusts the name alone. */
export const JOURNAL_STEPS = [
	"claimed",
	"maintenance",
	"drained",
	"stopped",
	"switched",
	"started",
	"healthy",
	"committed",
	"released",
] as const;
export type JournalStep = (typeof JOURNAL_STEPS)[number];
export const stepAtLeast = (step: JournalStep, minimum: JournalStep) =>
	JOURNAL_STEPS.indexOf(step) >= JOURNAL_STEPS.indexOf(minimum);

export interface JournalIdentity {
	version: string;
	commit: string | null;
	target: string | null;
}
export interface Journal {
	schema: 1;
	id: string;
	candidateKey: string;
	plan: {
		candidate: JournalIdentity;
		previous: JournalIdentity;
		nextLink?: string;
		prevLink?: string;
		migration?: { from: number; to: number } | null;
	};
	baseline: DataBaseline | null;
	step: JournalStep;
	intent: "forward" | "rollback";
	history: Array<{ step: string; at: string }>;
}

/** The single place bytes reach disk, so tests can fail it like a full volume. */
export interface JournalIo {
	write(path: string, text: string): void;
}
export const atomicJournalIo: JournalIo = {
	write(path, text) {
		const temporary = `${path}.${process.pid}.tmp`;
		const fd = openSync(temporary, "w", 0o600);
		try {
			writeFileSync(fd, text);
			fsyncSync(fd);
		} catch (error) {
			closeSync(fd);
			rmSync(temporary, { force: true });
			throw error;
		}
		closeSync(fd);
		renameSync(temporary, path);
		const directory = path.slice(0, path.lastIndexOf("/"));
		const directoryFd = openSync(directory, "r");
		try {
			fsyncSync(directoryFd);
		} finally {
			closeSync(directoryFd);
		}
	},
};

/** Interrupted/environmental rollbacks per candidate. Survives old-reader
 * rewrites of `state.json` because it lives next to the journals. */
interface Attempts {
	[candidateKey: string]: { count: number; notBefore: number };
}
export const MAX_FAILED_ATTEMPTS = 2;
const BACKOFF_BASE_MS = 60_000;
const BACKOFF_MAX_MS = 60 * 60_000;

export class UpdateJournal {
	readonly directory: string;
	private readonly attemptsFile: string;
	constructor(
		updatesDirectory: string,
		private readonly io: JournalIo = atomicJournalIo,
	) {
		this.directory = join(updatesDirectory, "journal");
		this.attemptsFile = join(this.directory, "attempts.json");
	}
	private path(id: string) {
		return join(this.directory, `${id}.json`);
	}
	private write(path: string, value: unknown) {
		mkdirSync(this.directory, { recursive: true, mode: 0o700 });
		this.io.write(path, `${JSON.stringify(value, null, 2)}\n`);
	}
	read(id: string): Journal | undefined {
		let text: string;
		try {
			text = readFileSync(this.path(id), "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
			throw error;
		}
		const value = JSON.parse(text) as Journal;
		if (value.schema !== 1 || value.id !== id)
			throw new Error(`Unsupported update journal for ${id}`);
		return value;
	}
	create(entry: Omit<Journal, "schema" | "step" | "history" | "intent">) {
		const journal: Journal = {
			schema: 1,
			...entry,
			step: "claimed",
			intent: "forward",
			history: [{ step: "claimed", at: new Date().toISOString() }],
		};
		this.write(this.path(entry.id), journal);
		return journal;
	}
	update(id: string, change: (journal: Journal) => void): Journal {
		const journal = this.read(id);
		if (!journal) throw new Error(`Missing update journal for ${id}`);
		change(journal);
		this.write(this.path(id), journal);
		return journal;
	}
	step(id: string, step: JournalStep, change?: (journal: Journal) => void) {
		return this.update(id, (journal) => {
			journal.step = step;
			journal.history.push({ step, at: new Date().toISOString() });
			change?.(journal);
		});
	}
	remove(id: string) {
		rmSync(this.path(id), { force: true });
	}
	/** Journals of transactions that never reached `released`. */
	open(): Journal[] {
		let names: string[];
		try {
			names = readdirSync(this.directory);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
			throw error;
		}
		return names
			.filter((name) => name.endsWith(".json") && name !== "attempts.json")
			.map((name) => this.read(name.slice(0, -5)))
			.filter((journal): journal is Journal => Boolean(journal));
	}
	private attempts(): Attempts {
		try {
			return JSON.parse(readFileSync(this.attemptsFile, "utf8")) as Attempts;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
			return {};
		}
	}
	/** Count one more interrupted/environmental failure; returns the new count. */
	recordFailure(key: string, now = Date.now()): number {
		const attempts = this.attempts();
		const count = (attempts[key]?.count ?? 0) + 1;
		attempts[key] = {
			count,
			notBefore:
				now + Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (count - 1)),
		};
		this.write(this.attemptsFile, attempts);
		return count;
	}
	clearFailures(key: string) {
		const attempts = this.attempts();
		if (!(key in attempts)) return;
		delete attempts[key];
		this.write(this.attemptsFile, attempts);
	}
	/** Retry gate after a failure that was not the candidate's fault. */
	notBefore(key: string): number {
		return this.attempts()[key]?.notBefore ?? 0;
	}
	failures(key: string): number {
		return this.attempts()[key]?.count ?? 0;
	}
}
