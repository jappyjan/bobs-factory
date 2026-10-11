# Architecture run backup

Portable design handoff for [PR #74](https://github.com/jappyjan/bobs-factory/pull/74), captured on 2026-10-11 from [this Factory run](https://bobs-factory-jappy.shares.zrok.io/#/runs/manual-ca2bb7eb-c67e-4b8b-ac2f-1e62bf6cad37/review).

Download `run-backup.zip` with GitHub’s Download raw file action, or check out this PR branch with Git LFS installed and run `git lfs pull`. The ZIP is stored in Git LFS; a plain Git checkout without LFS may contain only its pointer.

From this directory, verify and unpack it:

```sh
shasum -a 256 -c run-backup.zip.sha256
unzip run-backup.zip
```

Give Claude the extracted `START-HERE.md` and ask:

> Read START-HERE.md and its referenced artifacts. Explain what this run produced, then help me refine the design and UX.

The archive includes complete tracked source and Git history at revision `1e269637f6acb0389b4dd0d38a7ccf73cf39c6ee`, 23 current artifacts, all 50 historical step results, 1,500 events, 2,780 activity entries, 26 native Codex conversations and 236 evidence files, including screenshots, test receipts, logs and review patches. Its manifests preserve original paths with a portable path mapping.

Host credentials and unrelated runs are excluded. Three temporary browser cookie files are omitted and their captured values are redacted. The original Factory run and its evidence remain unchanged. This archive predates the backup commit and does not import or approve the run, nor resume a native Claude session.

Validation: ZIP CRC and inventory SHA-256 checks passed; an offline Git restore matched the exact reviewed revision and retained every role revision. This commit only adds backup data and retrieval documentation; F1 is not applicable to these additions.
