# Takeover reuse of an existing branch worktree

Date: 2026-10-24. Tested the working change based on `fcb220f41beed64dbfc3d6716311b931573077a8`.

A fresh Takeover can have a new issue/run identifier while its branch is already checked out at the old worktree. Git correctly returns that existing directory. Retention previously tried to register the unused requested directory and failed with ENOENT before any agent work.

## Evidence

- The real Git regression fixture fails before the repair at `StorageRetentionStore.register` on `worktrees/MANUAL-takeover`.
- The repaired fixture passes for both registered and externally created existing worktrees. The existing root is reserved for continuation; no unused directory or new deletion ownership is registered.
- GitService, Takeover and retention checks: 61 passed before the additional external-root case; the final focused GitService environment suite passes all 5 cases.
- Command: `bun apps/f1/test-drives/media/2026-10-24-takeover-worktree-reuse/drive.ts`.
- Final F1 result: PASS, run `manual-56a6e218-8d49-4c30-80c8-6f68ede65e03`, isolated home `/var/folders/5m/3pxzz_nd1v7f34rd9vnm01380000gn/T/f1-takeover-reuse-OA3T9C`.
- Protected launch returned 202. The new Takeover reused the worktree originally created as `OLD-1`, bound the original CLI-backed Linear ticket, completed assessment and reached clarification questions. Its existing HEAD `ca0f3afb025ee0935e828783005afffaacdabeff` and uncommitted sentinel file were unchanged.

## Scope and cleanup

EdgeWorker setup, Git commands, worktree selection, retention registration/reservation, ticket binding, workflow transitions and activities are real. All agent/title turns are mocked and consume no inference. The isolated ticket has no hosted PR provider, so only the read-only `inspect-existing` observation is supplied by a controlled fixture. This does not prove live GitHub or native Codex execution; the production continuation checks remain separate.

The first fixture attempt reached setup but lacked a hosted provider observation; the next used an incomplete clarification response. Those fixture defects were corrected before the final PASS. The final fixture explicitly creates the old worktree under a different identifier, exercising the repaired reuse path. `finally` stops the worker and restores the port environment variable; isolated evidence/worktree files remain available under the recorded temporary home. No production state or credentials are changed by this drive.
