# Generic Display node test drive

**Date:** 2026-10-26  
**Mode:** deterministic mocked agent and Taskbot adapter; real Factory runtime,
authenticated HTTP server and Chromium dashboard. No live model/provider calls.

The scenario authors a document with the `display` output format, displays it
through `from`, publishes its answer protocol to a mock Taskbot ticket, restarts
while waiting, and submits form values, item actions and code-note comments with
the keyboard through the real dashboard/API.

Run after building the edge worker:

```sh
F1_AGENT_MODE=mock F1_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
  bun scripts/qa-display-node.mjs
```

The script uses an isolated temporary Factory home and port 3672 (override with
`F1_DISPLAY_PORT`), and shuts down the browser, server, runtime and tracker.
It never reads or modifies a configured production instance or ticket.

Passed assertions are retained in [receipt.json](assets/2026-10-26-display-node/receipt.json):

- Agent document is validated, rendered and retained; no injected script executes.
- Taskbot receives the current explicit answer protocol.
- A cold restart preserves the waiting document and both digests; the author runs once.
- Desktop and 390px light/dark layouts have no page overflow; the 360px check also passes.
- Code-tour notes fit the 360px layout; reading position restores after a user scroll and reload.
- Trusted keyboard submission persists the form, an explicitly blank custom answer,
  original per-item values, follow-ups, comments and code-note comments.
- The explicit ticket/terminal reply path accepts an identical retry idempotently.
- No browser page errors.

Screenshots:

- [Desktop light](assets/2026-10-26-display-node/display-1280-light.png)
- [Desktop dark](assets/2026-10-26-display-node/display-1280-dark.png)
- [390px light](assets/2026-10-26-display-node/display-390-light.png)
- [390px dark](assets/2026-10-26-display-node/display-390-dark.png)

The focused `DisplayNode.test.ts` tests separately cover non-blocking content,
form validation, stale document/submission digests, content changes while waiting,
per-item routing, API answers after restart, Ask threads, builder previews and all
sixteen component renderers/text fallbacks. Existing HumanViews and registry
regressions cover coexistence with legacy steps. This drive does not test live
webhook ingestion, model quality or real external ticket delivery.

## Review corrections

Validated the correction diff on top of `ecb30c45c5af2156c66481617fd9dc7d66a5c324`
with the same mocked agent/tracker and real authenticated dashboard/API:

```sh
F1_AGENT_MODE=mock F1_DISPLAY_RECEIPT=review-receipt.json \
  F1_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
  bun scripts/qa-display-node.mjs
```

[Review receipt](assets/2026-10-26-display-node/review-receipt.json) records:

- Typing an item comment selects no radio and cannot satisfy a required action.
- Enter in a valid single-line text field sends zero answers, both with an action
  bar and with plain Submit. Keyboard activation of a document button still sends
  exactly one answer.
- Optional reactions omit unanswered items from routing. A comment draft still
  needs a declared action when actions exist; comment-only cards retain comments.
- Cold restart, ticket protocol, original-value routing, code-note comments,
  reading-position restoration and narrow light/dark layouts continue to pass.
- No browser page errors. The normal layout is unchanged, so the original
  screenshots and receipt above are preserved. Set
  `F1_DISPLAY_REFRESH_SCREENSHOTS=1` only when new captures are needed.

The runtime regression additionally executes 101 content-only foreach displays,
retains all 101 history entries, and accepts the following interactive display.
That limit test stubs routine saves to avoid hundreds of filesystem syncs; the
restart tests and browser drive use real durable storage.
The restart regression retains waiting-human interactivity even when the current
source document no longer resolves. Source validation when accepting an answer
continues to apply. No live provider or external ticket delivery was tested.

Focused verification passed: **9 files, 221 tests**, including all 31 DisplayNode
tests. Edge-worker typecheck and Biome checks for the changed source/test/script
files passed. The focused command (from `packages/edge-worker`) was:

```sh
pnpm exec vitest run test/DisplayNode.test.ts test/View.test.ts \
  test/HumanViewsRuntime.test.ts test/HumanViewsApi.test.ts \
  test/FactoryViewIntegration.test.tsx test/DeclarativeView.test.ts \
  test/NodeRegistry.test.ts test/ViewAssets.test.ts test/ForeachRuntime.test.ts \
  --maxWorkers=2
```
