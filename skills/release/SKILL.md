---
name: release
description: Prepare, validate or recover a Bob’s Factory binary release candidate when the user requests release work.
---

# Binary release candidates

Read `apps/cli/RELEASING.md`, `docs/distribution/README.md` and
`docs/distribution/PUBLIC_RELEASES.md`. The public procedure defines candidate
identity, integrity inventories, evidence, approval and publication recovery.

1. Freeze once. Nightly uses eligible changed main and its allocated version;
   stable promotes an explicitly selected complete validated published nightly's
   frozen source. Retain candidate digest, runtime source and reviewed tooling.
2. Validate the exact version on all four native targets and each shipped desktop
   target. Stable rebuilds need fresh byte-bound evidence. Import actual review,
   migration, source/license and full-payload F1 assessments; reuse only with
   independently reviewed scope. Mock agents/controlled protocols are the release
   test scope; live tests require specific credit authorization.
3. Prepare with read-only credentials. Validate candidate-bound SHA-256/size
   inventories, source semantic intake and real evidence. Review retained assets
   and publication-plan digest. Distribution is unsigned over GitHub HTTPS;
   Apple Developer ID, notarization, stapling, publisher signatures/key pins and
   protected signing infrastructure are not requirements. Free local ad-hoc
   signing serves only Apple Silicon executable validity, without host key reads.
4. Publish only at the authorized stage. Stable approval binds its exact frozen
   candidate and prepared unsigned asset digest. Automatic nightlies require
   separate rollout activation and the same eligibility/evidence gates. Use the
   repository publication lock and recheck complete provider history.
5. Recover from the exact retained inventory/receipt. Reconcile matching tags,
   drafts/assets; retain conflicting immutable state. If only Pages failed,
   retry synchronization. Preserve quarantine; macOS first launch uses the user's
   per-app Open Anyway action documented in `DESKTOP.md`.

Completion means the requested stage passed its actual checks, with remaining
blockers stated. Implementation leaves publication disabled and production
installations untouched. Historical evidence and sealed preparation packets remain
immutable: changed tooling requires a new reviewed candidate, never relabeling old
runs/receipts. Preserve native credential stores, session IDs, checkpoints,
worktrees and attribution. Workspace npm packages stay private.
