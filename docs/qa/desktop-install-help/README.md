# Standalone browser help capture

Replacement evidence for PR [#113](https://github.com/jappyjan/bobs-factory/pull/113)
and finding `qa-standalone-help-screenshot-missing`, captured on 2026-10-13.

The [screenshot](standalone-help.png) was freshly captured and visually inspected
against clean product revision `50f77d74cf6fce7034a39748abc5f588860984bd`.
Rebuilding the dashboard produced `5bc39f259df2cb7709153a81`, matching the
isolated fixture's `/api/version` response. This commit adds evidence only.

The fresh browser simulated installed-PWA mode with the retained `pwa-init.js`
before navigation and suppressed trusted automatic installation events with
`qa-no-native-prompt.js`. The desktop bridge was absent. Before opening the
dialog, the DOM showed **App help**. The dialog contained the existing platform
guidance and only its close button, without a native installation action.
Escape closed it; navigation to Settings retained **App help**. The final
DOM assertion checked all of those resulting state values.

The image shows readable guidance and the close control without clipping.
The accepted backdrop blur remains visible; separate DOM evidence establishes
the background header label. This is simulated PWA evidence, not OS installation,
native Electron, remote HTTPS, or real-agent validation.

The default Chrome for Testing 148 screenshot stalled, including a fresh launch
with GPU disabled. A fresh dedicated Chromium headless-shell 149 session captured
successfully without changing page content or CSS:

```sh
agent-browser --headed false --session qa-fix-d187-shell \
  --executable-path /Users/jappy/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell \
  --init-script "$EVIDENCE/pwa-init.js" \
  --init-script "$EVIDENCE/qa-no-native-prompt.js" open http://localhost:3761
agent-browser --session qa-fix-d187-shell set viewport 1440 1000
agent-browser --session qa-fix-d187-shell find role button click --name 'Install app and help'
agent-browser --session qa-fix-d187-shell screenshot "$EVIDENCE/qa-fix-standalone-shell.png"
```

`EVIDENCE` denotes the run's supplied evidence directory. The fixture uses
`F1_AGENT_MODE=mock` and injected simulated handlers; no agents were launched.
This evidence-only correction has no additional F1 workflow behavior to test.
The existing QA results remain unchanged. See [receipt.json](receipt.json) for
image integrity and observed state. Reviewer reassessment remains required.
