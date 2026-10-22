These snapshots were created by the compiled production runtime from
`66668d8fffc63fc5dfcb37c9940f123491cd4c0f`, whose production inputs are identical
to published `339f0573f2b4bac37accf1783a552ddb08e0fd26`. The provenance inventories
pin the executing modules, generation driver and original persisted bytes.

- `notified-crash-gap`: interrupt publication after the old runtime saved its
  notification flag, before its publication method records any ticket intent.
- `unsent-initial-after-ask`: retain the actual original batch-only ticket intent,
  complete an ordinary Ask, and capture the persisted current discussion.
- `raw-native-failure`: start the actual Codex runner with an unavailable synthetic
  executable in an owned empty directory, use the production failure wrapper,
  and retain the old persisted raw diagnostic and pending decision digest.

No run receipt, checkpoint, definition or accepted answer was manufactured or
patched. All homes, tickets, native paths and conversations are disposable
synthetic fixtures. No provider/model, real private store or tracker was contacted.
The `.raw` suffix preserves exact JSON bytes outside the source formatter. Tests
copy those bytes into a fresh disposable home under their original filenames and
reconstruct the normal runtime. The old home paths are historical fixture identity;
tests do not execute or edit those paths.
