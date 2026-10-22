# R2 residual: metadata commands migrate native history before refusal

Inspected immutable implementation HEAD `339f0573f2b4bac37accf1783a552ddb08e0fd26`. This audit made no repository edits, build/test runs, OpenCode invocations, or real credential/history reads. Only the reviewer synthetic receipts and packaged binary bytes were read.

## Evidence

Native package `/tmp/taskbot140-r2-standards/package/package.json` identifies `opencode-darwin-arm64` 1.2.27. Its 94,720,784-byte executable SHA256 is `3036292cd25a74682d08545ae12de2cf1df864fea812934bfee1ec759f301083`. Plain embedded native source confirms the upstream implementation; the four small source excerpts and binary byte offsets are in this directory's manifest.

Upstream `packages/opencode/src/index.ts` lines 82–117 checks exactly `Global.Path.data/opencode.db` in the common command middleware. When absent it opens `Database.Client()` and runs `JsonMigration` before the command handler. `storage/json-migration.ts` lines 24–26, 100–109, 170–212 and 218–289 scan and import stored sessions, messages and parts. Thus the read-only flag in `cli/cmd/db.ts` line 27 does not cover command startup. `storage/db.ts` lines 28–34 can select a channel database even though the middleware marker is always the canonical filename.

Reviewer `opencode-native-preflight.json` proves this with synthetic data: initially no DB; after the runner's metadata refusal a 4096-byte DB exists containing one session, message and part. Auth bytes remained unchanged; this does not make the history migration acceptable.

Current runner locations: `OpenCodeRunner.ts:625` checks permissions; `:639` invokes `providers list` before classifying the data store; `:662–666` accepts any `opencode[-channel].db` name rather than the exact startup marker. Current new tests `context-only.test.ts:127–149` use a stub that does not execute native startup; `:170–187` positively accepts auth-only/no-DB state. Those fixtures need the actual startup behavior, not weakened preservation assertions.

## Narrow recommendation

Add one read-only native-store classifier at the start of `checkNativePermissions`, before **any** `spawnSync`, shared by new and attested resumed turns. Keep native data home/session/model/profile receipts unchanged; never create a marker, copy credentials/history, point at a different native store, or invoke a migration as a repair.

| Store observation | Behavior before any native CLI |
| --- | --- |
| Data root absent, or truly empty; no auth, legacy storage, channel DB or other retained state; new turn | Genuinely fresh. Existing normal native new-session initialization can proceed. No metadata CLI is needed because no native auth/permissions exist. |
| Exact canonical marker absent, but `storage/`, `auth.json`, any channel DB, symlink, unreadable entry or other existing state is present | Refuse clearly. Treat as legacy/unknown native storage, including auth-only stores. No provider/db/run command may start. This deliberately narrows previous auth-only positive fixtures; initialized native API/OAuth stores remain supported. |
| Resume requested but canonical supported store is absent, even when the profile receipt exists | Refuse with original native ID retained. Never treat a lost/legacy store as fresh and never start a replacement conversation. |
| Exact `opencode.db` is a readable regular file with valid SQLite header | Marker precondition is established. Then use supported read-only schema/permission metadata checks and provider-type verification. Missing/unsupported/ambiguous schema or version fails closed before a model turn. |
| Only `opencode-*.db` exists | Refuse; native middleware still sees missing canonical marker and may migrate into the channel DB. Do not silently force a different channel/data store. |

Use bounded directory observation (`opendir`/one-entry check for a fresh directory) and `lstat`/bounded header reads; do not traverse or read `storage/` or `auth.json`. The canonical marker must be real, not a directory/sentinel/empty arbitrary file. Revalidate the same marker identity before metadata invocations if intervening work can change its state. A valid SQLite header is a marker/format check, **not** proof of OpenCode schema/version.

The narrow history-migration fix does not require a new SQLite dependency: exact marker + format classification before native CLI prevents the known middleware migration, and the existing native `db ... --format json` handler then checks metadata read-only. If the owner requires schema/version evidence before *all* native invocations, use an in-process built-in read-only SQLite adapter (Node 24 `node:sqlite`, and verify the compiled Bun 1.4.2 equivalent), query only `sqlite_schema`/migration metadata, and refuse unsupported runtimes. Do not claim this extra adapter was validated by this audit. Do not add external sqlite3 as an undeclared product prerequisite.

Avoid using cache `version` (native cache version 21 is unrelated) or SQLite `user_version` as an OpenCode version. OpenCode uses Drizzle `__drizzle_migrations`; recognize only an explicitly supported schema/migration set when claiming version support. A future/unknown native version is not established by the marker alone. `OPENCODE_SKIP_MIGRATIONS` is not a fix: it does not disable `JsonMigration` and still allows migration journal work. No startup-disable flag for JSON migration exists in v1.2.27's flag catalog.

## Consequential regression fixture

1. In a fresh disposable directory construct only synthetic auth bytes and native legacy project/session/message/part JSON, matching the reviewer fixture. Use an invocation-recording wrapper around the actual installed 1.2.27 binary; do not execute a model or permit network. Run the production runner. Assert error, **zero native CLI invocations**, no canonical/channel DB created, unchanged original synthetic file bytes, no receipt/model/session replacement. The pre-fix source is already demonstrated red by the retained reviewer receipt; preserve it.
2. Repeat through an attested resume path with a legitimate runner-produced context receipt and the original native ID; force the store to remain legacy/missing-marker in the synthetic fixture. Check the store guard, not merely the unattested-resume guard.
3. Table-test missing canonical marker with channel DB only, auth-only, unknown nonempty root, inaccessible/invalid marker, and supported regular SQLite marker. Add a genuinely empty new-store positive and missing-store resume negative.
4. Keep provider API/OAuth positive cases, but initialize a supported synthetic SQLite store first. Unknown/well-known provider rejection must retain that exact existing DB. For native provider/db positive checks, the wrapper can invoke actual metadata commands and intercept only `run` with deterministic JSON so zero paid/model/network work occurs.
5. Teach the ordinary spawned stub the real middleware ordering (migration effect before providers/db when the marker is absent). Test the production boundary, not just the requested allowlist or source text. Preserve original exact permission/model/session/data-home assertions.

Primary sources:
- https://raw.githubusercontent.com/anomalyco/opencode/v1.2.27/packages/opencode/src/index.ts
- https://raw.githubusercontent.com/anomalyco/opencode/v1.2.27/packages/opencode/src/storage/json-migration.ts
- https://raw.githubusercontent.com/anomalyco/opencode/v1.2.27/packages/opencode/src/storage/db.ts
- https://raw.githubusercontent.com/anomalyco/opencode/v1.2.27/packages/opencode/src/cli/cmd/db.ts
- https://raw.githubusercontent.com/anomalyco/opencode/v1.2.27/packages/opencode/src/global/index.ts
- https://raw.githubusercontent.com/anomalyco/opencode/v1.2.27/packages/opencode/src/flag/flag.ts
