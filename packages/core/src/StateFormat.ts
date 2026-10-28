import {
	closeSync,
	fsyncSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeSync,
} from "node:fs";
import { dirname, join } from "node:path";

/** Layout of the data under the Factory home that this build writes. */
export const STATE_FORMAT = 1;
/** Oldest on-disk layout this build can migrate from. */
export const STATE_FORMAT_MIN_MIGRATE = 1;
export const STATE_FORMAT_FILE = "state-format.json";
/** `EX_CONFIG`: service managers must not hot-loop a start that can never succeed. */
export const STATE_FORMAT_EXIT_CODE = 78;
const MAX_APPLIED = 20;

export interface StateFormatSupport {
	writes: number;
	migratesFrom: number;
}

export interface StateFormatRecord {
	schema: 1;
	/** Layout of the data on disk right now. */
	format: number;
	/** Oldest build format that can still read this data safely. */
	minReader: number;
	writtenBy?: { version: string; commit: string | null };
	updatedAt: string;
	/** Audit only, capped at the most recent entries. */
	applied: Array<{ id: string; from: number; to: number; at: string }>;
}

export class StateFormatError extends Error {
	readonly exitCode = STATE_FORMAT_EXIT_CODE;
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = "StateFormatError";
	}
}

export type StateFormatComparison =
	| "current"
	| "migrate"
	| "too-new"
	| "too-old";

export function compareStateFormat(
	onDisk: number,
	support: StateFormatSupport,
): StateFormatComparison {
	if (onDisk > support.writes) return "too-new";
	if (onDisk < support.migratesFrom) return "too-old";
	return onDisk < support.writes ? "migrate" : "current";
}

/** A missing file is format 1: today's layout predates the version file. */
export function readStateFormatRecord(
	home: string,
): StateFormatRecord | undefined {
	const path = join(home, STATE_FORMAT_FILE);
	let text: string;
	try {
		text = readFileSync(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw error;
	}
	let value: Partial<StateFormatRecord>;
	try {
		value = JSON.parse(text);
	} catch (error) {
		throw new StateFormatError(
			`${path} is not valid JSON; refusing to start without touching state. Restore it from a backup or remove it only if you know the data is format 1.`,
			{ cause: error },
		);
	}
	if (
		value?.schema !== 1 ||
		!Number.isInteger(value.format) ||
		(value.format as number) < 1 ||
		!Number.isInteger(value.minReader)
	)
		throw new StateFormatError(
			`${path} has an unrecognized layout; refusing to start without touching state.`,
		);
	return { ...(value as StateFormatRecord), applied: value.applied ?? [] };
}

export function readStateFormat(home: string): number {
	return readStateFormatRecord(home)?.format ?? 1;
}

export function newStateFormatRecord(
	format: number,
	options: {
		minReader?: number;
		writtenBy?: StateFormatRecord["writtenBy"];
		previous?: StateFormatRecord;
		applied?: StateFormatRecord["applied"];
		now?: Date;
	} = {},
): StateFormatRecord {
	return {
		schema: 1,
		format,
		minReader: options.minReader ?? format,
		...(options.writtenBy ? { writtenBy: options.writtenBy } : {}),
		updatedAt: (options.now ?? new Date()).toISOString(),
		applied: [
			...(options.previous?.applied ?? []),
			...(options.applied ?? []),
		].slice(-MAX_APPLIED),
	};
}

/** tmp + fsync + rename, mode 0600. */
export function writeFileAtomic(path: string, text: string) {
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const tmp = `${path}.${process.pid}.tmp`;
	const fd = openSync(tmp, "w", 0o600);
	try {
		writeSync(fd, text);
		fsyncSync(fd);
	} catch (error) {
		closeSync(fd);
		try {
			unlinkSync(tmp);
		} catch {}
		throw error;
	}
	closeSync(fd);
	renameSync(tmp, path);
}

export function writeStateFormatRecord(
	home: string,
	record: StateFormatRecord,
	write: (path: string, text: string) => void = writeFileAtomic,
) {
	write(join(home, STATE_FORMAT_FILE), `${JSON.stringify(record, null, 2)}\n`);
}
