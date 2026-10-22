import { closeSync, lstatSync, opendirSync, openSync, readSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

const migrationNames = [
	["20260127222353_familiar_lady_ursula", 1769552633000],
	["20260211171708_add_project_commands", 1770830228000],
	["20260213144116_wakeful_the_professor", 1770993676000],
	["20260225215848_workspace", 1772056728000],
	["20260227213759_add_session_workspace_id", 1772228279000],
	["20260228203230_blue_harpoon", 1772310750000],
	["20260303231226_add_workspace_fields", 1772579546000],
	["20260309230000_move_org_to_state", 1773097200000],
	["20260312043431_session_message_cursor", 1773290071000],
] as const;

function present(path: string): boolean {
	try {
		lstatSync(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}
function entries(path: string, limit: number): string[] {
	const directory = opendirSync(path);
	try {
		const names: string[] = [];
		for (
			let entry = directory.readSync();
			entry;
			entry = directory.readSync()
		) {
			names.push(entry.name);
			if (names.length > limit)
				throw new Error("Native directory exceeds metadata bound");
		}
		return names;
	} finally {
		directory.closeSync();
	}
}
function empty(path: string): boolean {
	const directory = opendirSync(path);
	try {
		return directory.readSync() === null;
	} finally {
		directory.closeSync();
	}
}
function identity(path: string): string {
	const stat = lstatSync(path, { bigint: true });
	if (!stat.isFile() || stat.isSymbolicLink())
		throw new Error("Not a regular native database");
	return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
}
function settled(path: string) {
	for (const suffix of ["-wal", "-journal"]) {
		if (!present(path + suffix)) continue;
		const stat = lstatSync(path + suffix);
		if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== 0)
			throw new Error("Native database has uncheckpointed writes");
	}
}

/** Only schema/approval metadata is queried. No native history or auth value is read. */
export function inspectContextStore(dataHome: string, sessionId?: string) {
	if (!dataHome || resolve(dataHome) !== dataHome)
		throw new Error("Unknown native data home");
	const data = join(dataHome, "opencode"),
		path = join(data, "opencode.db");
	if (
		!present(data) ||
		(lstatSync(data).isDirectory() &&
			!lstatSync(data).isSymbolicLink() &&
			empty(data))
	) {
		if (sessionId) throw new Error("Missing original native store");
		return {
			fresh: true,
			verify() {
				if (
					present(data) &&
					(!lstatSync(data).isDirectory() ||
						lstatSync(data).isSymbolicLink() ||
						!empty(data))
				)
					throw new Error("Native store changed before startup");
			},
		};
	}
	if (!lstatSync(data).isDirectory() || lstatSync(data).isSymbolicLink())
		throw new Error("Unknown native store");
	const original = identity(path);
	const header = Buffer.alloc(16),
		fd = openSync(path, "r");
	try {
		if (
			readSync(fd, header, 0, 16, 0) !== 16 ||
			header.toString("binary") !== "SQLite format 3\0"
		)
			throw new Error("Unknown native database format");
	} finally {
		closeSync(fd);
	}
	settled(path);
	const uri = pathToFileURL(path);
	uri.search = "?mode=ro&immutable=1";
	// Immutable mode cannot create WAL/SHM files. Refuse uncheckpointed WAL above
	// and recheck below rather than accidentally authorize a stale main database.
	const db = new DatabaseSync(uri, { readOnly: true, allowExtension: false });
	let remoteOrg: boolean;
	try {
		if (
			db
				.prepare(
					"SELECT name FROM sqlite_schema WHERE type='table' AND name IN ('__drizzle_migrations','account_state','permission','session') LIMIT 5",
				)
				.all().length !== 4
		)
			throw new Error("Unsupported native tables");
		const columns = db
			.prepare(
				"SELECT name, type, pk, \"notnull\" AS required FROM pragma_table_info('__drizzle_migrations') LIMIT 6",
			)
			.all();
		if (
			columns.length !== 5 ||
			!columns.some(
				(c) => c.name === "id" && c.type === "INTEGER" && c.pk === 1,
			) ||
			!columns.some(
				(c) => c.name === "hash" && c.type === "TEXT" && c.required === 1,
			) ||
			!columns.some((c) => c.name === "created_at" && c.type === "NUMERIC") ||
			!["name", "applied_at"].every((name) =>
				columns.some((c) => c.name === name && c.type === "TEXT"),
			)
		)
			throw new Error("Unsupported native schema");
		const migrations = db
			.prepare(
				'SELECT name, created_at, substr(hash, 1, 65) AS hash FROM "__drizzle_migrations" LIMIT 10',
			)
			.all();
		if (
			migrations.length !== migrationNames.length ||
			!migrationNames.every(([name, at]) =>
				migrations.some(
					(m) => m.name === name && m.created_at === at && m.hash === "",
				),
			)
		)
			throw new Error("Unsupported native migration journal");
		if (
			db
				.prepare(
					"SELECT name FROM pragma_table_info('session') WHERE name IN ('id', 'project_id', 'permission') LIMIT 4",
				)
				.all().length !== 3
		)
			throw new Error("Unsupported native session schema");
		const account = db
			.prepare(
				"SELECT EXISTS(SELECT 1 FROM account_state WHERE id = 1 AND active_account_id IS NOT NULL AND active_org_id IS NOT NULL) AS active",
			)
			.get();
		remoteOrg = account?.active !== 0;
		const permissions = sessionId
			? db
					.prepare(
						"SELECT data <> '[]' AS saved FROM permission WHERE project_id = (SELECT project_id FROM session WHERE id = ?) LIMIT 1001",
					)
					.all(sessionId)
			: db
					.prepare("SELECT data <> '[]' AS saved FROM permission LIMIT 1001")
					.all();
		if (permissions.length > 1000 || permissions.some((p) => p.saved !== 0))
			throw new Error("Saved project approvals");
		if (sessionId) {
			const row = db
				.prepare(
					"SELECT CASE WHEN length(permission) <= 16384 THEN permission ELSE NULL END AS permission FROM session WHERE id = ? LIMIT 1",
				)
				.get(sessionId);
			if (typeof row?.permission !== "string")
				throw new Error("Missing or excessive session permissions");
			const rules: unknown = JSON.parse(row.permission);
			if (
				!Array.isArray(rules) ||
				rules.length > 100 ||
				rules.some(
					(rule) =>
						!rule ||
						typeof rule.permission !== "string" ||
						typeof rule.pattern !== "string" ||
						(rule.action !== "deny" &&
							!(
								rule.action === "allow" &&
								[
									"factory-context_list_context",
									"factory-context_read_context",
								].includes(rule.permission) &&
								rule.pattern === "*"
							)),
				)
			)
				throw new Error("Broader saved session permissions");
		}
	} finally {
		db.close();
	}
	function verify() {
		if (identity(path) !== original)
			throw new Error("Native database changed during metadata checks");
		settled(path);
		// Pinned 1.2.27 Global/Log startup must have nothing to create or remove in
		// the original data root. --print-logs avoids log creation; <=10 entries
		// makes its cleanup a no-op. Contents of existing logs are never read.
		for (const child of ["bin", "log"]) {
			const stat = lstatSync(join(data, child));
			if (!stat.isDirectory() || stat.isSymbolicLink())
				throw new Error("Unsupported native startup layout");
		}
		entries(join(data, "log"), 10);
	}
	verify();
	return { fresh: false, remoteOrg, verify };
}
