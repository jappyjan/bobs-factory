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
