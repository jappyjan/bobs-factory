# Canonical marker present: exact 1.2.27 startup and schema gate

Read-only source audit of implementation `339f0573f2b4bac37accf1783a552ddb08e0fd26` and packaged native binary SHA256 `3036292cd25a74682d08545ae12de2cf1df864fea812934bfee1ec759f301083`. No OpenCode CLI, SQL command, model, network provider, real native store or repository mutation was performed. The SQL below is a proposed integration input, not a passing execution receipt.

## Native startup proof

- Native `index.ts` lines 82–117 has one common middleware call to `Database.Client()`/`JsonMigration`, guarded by absence of exact `Global.Path.data/opencode.db`. The installed main bundle has exactly one `Database2.Client(` call, at byte offset 75099694, inside this condition. This matches primary tagged source.
- `storage/db.ts` lines 77–108 assigns `Database.Client = lazy(...)`; initialization defines the function, does not run it. Its write PRAGMAs and Drizzle migrate are inside the lazy body. `util/lazy.ts` returns the wrapper without calling it. The native command helper `cmd.ts` merely returns the command definition.
- `cli/cmd/db.ts` lines 24–44 handles SQL with `new BunDatabase(Database.Path,{readonly:true})`, prepares the supplied constant query, prints results, closes, and returns. It does not enter `Instance.provide`, `Config.get`, `Database.use`, `Database.Client`, or Drizzle. An unknown/corrupt schema produces a read-only SQLite error; it does not initialize/upgrade the schema. The dangerous `db migrate` and query-less interactive branches are separate and must never be invoked by the guard.
- Therefore exact canonical marker present -> this pinned native metadata SQL path does not perform JSON or Drizzle migration, even before schema is recognized. This is narrower than globally non-writing startup: `Global` creates its directories, `Log.init` cleans original data/log and normally writes a log. `--print-logs` skips log creation but not cleanup. Do not describe the whole native command as zero filesystem writes.
- All commands import provider/models.ts. Lines 116–124 start background models.dev refresh unless `OPENCODE_DISABLE_MODELS_FETCH=1`; set it on **db and providers** metadata commands. The existing runner only applied it to providers. Native imports may do normal isolated cache maintenance. This flag is source-supported, not invented.

## Exact native path selection

The examined executable embeds `Installation.VERSION = "1.2.27"` and `CHANNEL = "latest"`; `Database.Path` is canonical. Tagged `storage/db.ts` lines 28–34 uses canonical for latest/beta or OPENCODE_DISABLE_CHANNEL_DB, otherwise opencode-<safe channel>.db. Entry middleware always checks canonical regardless of channel. There is no other native DB-path environment flag in this source; OPENCODE_TEST_HOME affects Global.Path.home, not Global.Path.data; data comes from XDG_DATA_HOME/opencode.

Require an absolute original data-home path and preserve it. Do not silently enable channel override or switch stores to make validation pass. Add `(SELECT file FROM pragma_database_list WHERE name='main')` to the metadata query and compare privately to the exact canonical file checked by fs. This detects a native binary/channel that opens a different existing database despite a canonical marker. Missing, differing or unbounded path -> fail closed. Do not log returned private paths unnecessarily.

## Supported 1.2.27 migration metadata

The binary embeds nine migrations, extracted without evaluating code in `migrations-1.2.27.json.raw` (SHA256 b5257ce5e839a2514660a3449e2d2e64fb8126a507b3e46cd2d3487fd37d80ba). Latest: `20260312043431_session_message_cursor`, timestamp `1773290071000`.

The embedded dependency is Drizzle `1.0.0-beta.16-ea816b6`. Its array-journal adapter deliberately sets `hash: ""`; do not require SQL SHA256 for the native freshly written rows. `__drizzle_migrations` version 1 columns are id INTEGER primary key, hash TEXT NOT NULL, created_at NUMERIC, name TEXT, applied_at TEXT. Version 0 lacks name/applied_at and would run ALTER on a real Database.Client invocation. Recognize exact nine names/timestamps and five-column version1 shape, rejecting missing/extra/duplicate/unknown journal entries. The proposal allows each row's hash to be either native empty string or the matching known raw-SQL SHA256 (for a legitimately upgraded file-based journal); it accepts no arbitrary hash. Actual v1.2.27's pending-migration selection uses names, so all nine names must be present; checking only maximum timestamp is insufficient.

`proposed-supported-schema.sql` SHA256 `06be27f7cbf51ad1f2e101c4d31a1b59d5954f1ce44936c8974b4931d7499cbe` is a bounded-output constant query for the owner to integrate and validate. It reads at most ten migration rows, verifies the exact supported journal and required account_state/permission/session table/column shape, and returns only supportedSchema Boolean plus a bounded nativeDatabase path. It reads no account tokens, auth values, messages, parts, titles or arbitrary history. No standalone SQLite dependency is needed: after fs proves canonical marker, use this exact native read-only SQL handler. Keep existing 5s/max16KiB subprocess bounds, verify single strict result, then query existing bounded permission/remote-org metadata, then providers list.

A matching store schema establishes the supported storage format; it does not identify an arbitrary installed executable's version. This safety proof is for the examined 1.2.27 path. Unknown native version/path/schema should fail closed rather than be called equivalent by field coincidence. Existing ordinary non-context OpenCode behavior need not change.

## Marker races and tests

Capture the original data-root and canonical marker identity with lstat and bounded header read before the first metadata CLI. Revalidate regular-file identity/header immediately before each native invocation and before the model child; reject disappearance/replacement/unknown state without creating a marker or moving the original native ID. Prefer owner-local serialization across the guard and invocation. Fs checks cannot be an atomic lock on independently administered native state: disclose that an external process can replace/delete the marker in the check-to-exec gap. Do not claim stat revalidation eliminates that race. Eliminating it absolutely requires an OS-enforced read-only preflight boundary or replacing native metadata CLI with in-process read-only metadata inspection; neither was implemented/validated in this audit.

Consequential native regression: place a real marker with an intentionally old/unknown migration journal in a synthetic disposable native store, run the production schema-preflight path, and assert no schema/journal/history changes, no provider discovery and no run invocation. Also cover canonical-plus-channel DB mismatch, missing-marker legacy refusal with zero invocation, valid nine-row journal, old three-column journal, missing/extra/duplicate migration rows, malicious long hashes, and metadata environment flags. Keep model transport stubbed; do not call a paid provider or copy real native credentials/history.

Primary tagged sources:
- https://raw.githubusercontent.com/anomalyco/opencode/v1.2.27/packages/opencode/src/index.ts
- https://raw.githubusercontent.com/anomalyco/opencode/v1.2.27/packages/opencode/src/storage/db.ts
- https://raw.githubusercontent.com/anomalyco/opencode/v1.2.27/packages/opencode/src/cli/cmd/db.ts
- https://raw.githubusercontent.com/anomalyco/opencode/v1.2.27/packages/opencode/src/util/lazy.ts
- https://raw.githubusercontent.com/anomalyco/opencode/v1.2.27/packages/opencode/src/cli/cmd/cmd.ts
- https://raw.githubusercontent.com/anomalyco/opencode/v1.2.27/packages/opencode/src/util/log.ts
- https://raw.githubusercontent.com/anomalyco/opencode/v1.2.27/packages/opencode/src/provider/models.ts
- https://raw.githubusercontent.com/anomalyco/opencode/v1.2.27/packages/opencode/src/global/index.ts
