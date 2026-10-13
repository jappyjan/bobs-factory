# Review refresh after a Factory home move

**Date:** 2026-10-13
**Source:** `3b2b0bf8` plus the `fix/relocated-review-screenshots` working changes.
**Goal:** Refresh a pending review with immutable screenshot receipts from a retired home, preserving accepted QA and requiring renewed explicit human approval.

## Reproduction

The Attractap refresh completed its guide agent but failed handoff with `Screenshot must be inside this run's evidence directory`. Its 24 accepted screenshots retained absolute source-home paths while their identical copied files existed in the current home. The focused regression failed before the fix, including with the source home entirely absent.

## Command

```sh
pnpm --filter bobs-factory-edge-worker build
F1_AGENT_MODE=mock F1_SCREENSHOT_RELOCATION=1 bun apps/f1/test-drives/assets/review-brief.ts
```

The opt-in scenario extends the existing real CLI-platform EdgeWorker drive with a scripted, accepted QA capture. It retains a source-home screenshot path whose source file does not exist; only the current run's copied image exists. Git worktrees, Factory orchestration, API actions and screenshot HTTP serving are real. Agents, screenshot content, QA inspection and GitHub responses are deterministic fixtures, with no live model or provider calls.

## Results

- Initial guide and QA-bound handoff reached pending human review using the relocated image.
- `POST /api/runs/:id/guide/refresh` reran only guide authoring and handoff. The seed/delivery step ran once; guide authoring ran twice.
- The accepted capture digest remained unchanged across refresh.
- Refresh created a new pending gate for the same revision and recorded no human approval.
- The screenshot HTTP endpoint returned the copied image bytes.
- Changing those bytes caused HTTP 409; the fixture restored the original image afterward.
- The original brief validation/correction, gap recovery and legacy chapter-reader scenarios also passed. Four guides were published, including the explicit refresh.
- The EdgeWorker stopped cleanly; no unhandled rejections were observed.

Final passing fixture: `/tmp/bobs-review-brief-f1-ai5FKv`; console result `F1_REVIEW_BRIEF_PASS`. The first extended drive completed its behavior assertions but failed the original three-publication assertion; that assertion now accounts for the fourth refreshed publication.

## Additional checks and limits

205 distinct focused tests passed across screenshot evidence, Factory API, pipeline, runtime and guide validation, including the final current-home alias regression. Repository build and TypeScript checks passed through the required pre-commit hook. Boundary regressions reject missing/invalid digests, missing copies, other-run paths, traversal, changed bytes and symlinks escaping the current evidence directory. New capture authoring remains strict; this change only resolves retained screenshots during gates and serving. Videos and other historical absolute-path artifacts are outside this change.
