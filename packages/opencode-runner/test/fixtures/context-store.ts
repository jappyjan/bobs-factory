import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

// Synthetic metadata-only fixture for the published OpenCode 1.2.27 journal.
// There are no real sessions/messages/parts/credentials in these test databases.
export function initializeStore(
	dataHome: string,
	sessionId = "ses_context_only",
) {
	const root = join(dataHome, "opencode");
	for (const child of ["bin", "log"])
		mkdirSync(join(root, child), { recursive: true });
	const db = new DatabaseSync(join(root, "opencode.db"));
	db.exec(`CREATE TABLE __drizzle_migrations(id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC, name TEXT, applied_at TEXT);
 CREATE TABLE account_state(id INTEGER PRIMARY KEY, active_account_id TEXT, active_org_id TEXT);
 CREATE TABLE permission(project_id TEXT PRIMARY KEY, data TEXT);
 CREATE TABLE session(id TEXT PRIMARY KEY, project_id TEXT, permission TEXT);
 INSERT INTO __drizzle_migrations(hash,created_at,name) VALUES
 ('',1769552633000,'20260127222353_familiar_lady_ursula'),
 ('',1770830228000,'20260211171708_add_project_commands'),
 ('',1770993676000,'20260213144116_wakeful_the_professor'),
 ('',1772056728000,'20260225215848_workspace'),
 ('',1772228279000,'20260227213759_add_session_workspace_id'),
 ('',1772310750000,'20260228203230_blue_harpoon'),
 ('',1772579546000,'20260303231226_add_workspace_fields'),
 ('',1773097200000,'20260309230000_move_org_to_state'),
 ('',1773290071000,'20260312043431_session_message_cursor');`);
	db.prepare("INSERT INTO session VALUES (?, 'fixture-project', ?)").run(
		sessionId,
		JSON.stringify([{ permission: "question", action: "deny", pattern: "*" }]),
	);
	db.close();
}
export function metadata(dataHome: string, value: unknown) {
	const db = new DatabaseSync(join(dataHome, "opencode/opencode.db"));
	try {
		if (
			!Array.isArray(value) ||
			value.length !== 1 ||
			value[0].remoteOrg === undefined
		) {
			db.exec("DROP TABLE account_state");
			return;
		}
		const row = value[0];
		db.exec("DELETE FROM account_state; DELETE FROM permission;");
		if (row.remoteOrg)
			db.exec(
				"INSERT INTO account_state VALUES (1,'synthetic-account','synthetic-org')",
			);
		if (row.savedPermissions)
			db.exec(
				"INSERT INTO permission VALUES ('fixture-project','[{\"action\":\"allow\"}]')",
			);
		db.prepare("UPDATE session SET permission = ?").run(row.sessionPermission);
	} finally {
		db.close();
	}
}
