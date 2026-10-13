# Manual launch inputs and attachments

The manual launcher selects a grouped project in its heading. Each launch keeps
its primary repository and every selected group member. A large prompt sits above
additional workflow fields and attachments; the bottom controls select a workflow
and open agent/execution settings. The launcher uses the current instance. Machine
selection belongs to BOBS-84.

New stock Factory, Takeover and Simple definitions declare an optional attachment
field. Saved recipes and accepted runs retain their existing declarations. To
add uploads to a custom recipe, declare a launch field in Recipes:

```json
{"name":"attachments","label":"Attachments","type":"files","required":false}
```

Set `required` to `true` to require at least one file. File fields cannot declare
text defaults or choices. Text/textarea/select fields continue to use string-valued
`inputs`. All declared fields remain visible; Takeover still requires its source.

The picker accepts any file type, including unknown extensions and empty MIME
values. Limits are **10 files per launch, 25 MiB per file, 100 MiB total**. Errors
and upload state appear beside the file list. Remove failed files and select them
again to retry. Launch stays disabled while uploads or removals are pending,
when an upload failed, or while required inputs are missing. Changing project,
workflow, configuration or page clears unsent choices. Uploads do not automatically
parse documents, unpack archives, execute files or render active browser content.

## Guarded HTTP API

Use the same authentication, exact Origin, `X-Factory-Request: 1`, current
`X-Factory-Build` and `X-Factory-Config` headers as other dashboard writes.
`/api/config` supplies `configRevision`; `/api/version` supplies `build`.

1. Generate a UUID draft token. POST raw file bytes with
   `Content-Type: application/octet-stream` to
   `/api/launch-assets?metadata=<URL-encoded JSON>`. Metadata:

   ```json
   {"draft":"UUID","workflow":"factory","repositoryId":"app","repositoryIds":["app","api"],"field":"attachments","name":"spec.pdf","mime":"application/pdf"}
   ```

   The response contains an opaque UUID `id`, original display name, field,
   MIME, size and SHA-256. Every file must use the same draft, workflow and
   repository scope. Uploads to undeclared fields are rejected.
2. Remove an unsubmitted file with
   `DELETE /api/launch-assets/<draft UUID>/<file UUID>`.
3. POST `/api/runs` with ordinary text `inputs`, the same repository scope,
   `attachmentDraft`, and a separate map of attachment IDs:

   ```json
   {"workflow":"factory","repositoryId":"app","repositoryIds":["app","api"],"inputs":{"prompt":"Implement the attached spec"},"attachmentDraft":"UUID","attachments":{"attachments":["file UUID"]}}
   ```

The server validates required fields and the whole attachment selection before
claiming files. Failed validation retains staged files. Once admitted, the draft
is claimed atomically and cannot be reused or recreated by a late upload. Setup
and retry use the persisted run manifest. If a response is lost after admission,
check the run list; do not retry the consumed upload IDs as a new launch.

## Storage and execution

Files live outside Git worktrees in `<factoryHome>/factory/launch-assets`. Generated
IDs form storage paths; original names are display metadata. Private files have
read-only, non-executable permissions. Upload bodies are bounded during receipt;
interrupted bodies never create stored files. Symlink storage roots/files and
invalid IDs are rejected. There is no public file-serving endpoint.

Runs retain `launchAttachments`, a map of fields to manifests containing ID,
name, MIME, size, SHA-256 and canonical readable path. Factory-context exposes
this manifest to roles, including clarification/planning and frozen review
context. Explicit step inputs can request an attachment field by name. If that name
also identifies an existing step result, the result keeps its name; read the files
through `launchAttachments.<field>`. `launchAttachments` names the full manifest. Tools and
scripts receive the same manifests in their input; script JSON is also available
through `FACTORY_INPUT_FILE`. Simple receives the manifest in its instructions.
Runner read allowances include only the claimed directory. Sandbox write
allowances do not expand to the Factory home. Files are checked for missing or
changed content at execution and step boundaries, causing a visible failure.

Retries/restarts keep the same paths and bytes. Follow-ups copy source-run assets
into their own private directory, so source cleanup cannot remove their inputs.
Nested workflows retain the manifest. Plans relying on uploaded files should list
those paths in their candidate assets; architecture approval copies and hashes
them through the existing snapshot mechanism.

Abandoned drafts expire after 24 hours at startup. Saved runs retain claimed
assets, including completed runs. Startup removes claim directories older than
24 hours only when their persisted run has been removed; accepted architecture
snapshots are separate retained copies. A crash between claim and run persistence
can leave an unreferenced claim directory, cleaned by the same policy. Keep the
complete Factory home together when backing up. Keep its absolute path for active
runs; relocating a home requires explicit reconciliation of retained asset paths.
