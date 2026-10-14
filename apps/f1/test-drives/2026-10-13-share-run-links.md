# Share dashboard run links

Date: 2026-10-13. Tested HEAD `537e19d9f5b037d1b6b3a96ba36af3b0ae047287` plus the uncommitted implementation. Final served browser build: `8fcd366cd2763c0ba51fbb39`. Exact changed-source hashes are retained in `implementation-revision.json` in the evidence directory.

## Applicability and fixture

F1 applies to the dashboard presentation and clipboard interactions. This focused drive uses an isolated WorkflowRuntime and the real protected FactoryServer, compiled dashboard assets, API, SSE, authentication boundary and HashRouter. An agent step completed with a deterministic simulated-agent handler. Remaining statuses and questions are seeded fixtures. There is no EdgeWorker/tracker routing change to validate. No provider CLI, production ticket or inference API was invoked. WorkflowRuntime does not launch background title agents; fixture titles are assigned directly.

The fixture uses fresh temporary homes, HTTP localhost port 3597 and a self-signed HTTPS proxy on port 3598. HTTPS authentication is a seeded test session, not a real passkey ceremony. Existing authentication/access tests cover that separate behavior. The encoding case uses a synthetic in-memory ID containing a space, percent sign and accented character; normal run creation accepts only simple IDs.

Evidence directory: `/Users/jappy/.bobs-factory/factory/evidence/manual-0fee5712-6eed-426d-b41d-1e9b5442324b`.

```sh
pnpm --filter 'bobs-factory-edge-worker...' build
pnpm --filter bobs-factory-edge-worker typecheck
node packages/edge-worker/scripts/build-factory-web.mjs
pnpm --filter bobs-factory-edge-worker exec vitest run test/FactoryWebClient.test.ts test/FactoryPwa.test.ts test/FactoryAccess.test.ts test/FactoryAuth.test.ts test/FactoryServer.test.ts
F1_AGENT_MODE=mock EVIDENCE=<evidence-directory> node <evidence-directory>/share-fixture.mjs
agent-browser --headed false --ignore-https-errors --session share-manual-5442324b open 'http://localhost:3597/#/'
EVIDENCE=<evidence-directory> node <evidence-directory>/share-browser.mjs
```

## Results

All 30 executable browser assertions passed against the final build:

- Focus question and failure cards, collapsed Working rows, queued runs, Settled pebbles and Settled list rows copy the selected run's exact absolute URL.
- Current scheme and port are preserved for HTTP and HTTPS. Unrelated page query strings are excluded. The synthetic ID is encoded as one path segment.
- Successful writes announce “Run link copied.” Rejected writes and absent clipboard support open a read-only, selectable exact link without a success announcement.
- Retrying successfully closes the dialog and restores Share focus. Escape restores trigger focus. Enter activates Share through the keyboard. Browser verification caught and fixed loss of trigger focus caused by temporarily disabling Share.
- Share buttons are native buttons outside links and other buttons. Working Share leaves rows collapsed and the current page unchanged.
- Copied routes load the correct active, waiting, failed, stopped, completed and capacity-waiting run. Every loaded detail header offers Share, without duplicating it in the full Focus card.
- Runtime records and mutation requests remain unchanged across an isolated Share action. Route opening can still record the existing seen state; this is independent of sharing.
- Desktop 1440×1000 and mobile 390×844 light/dark layouts, plus the 320×720 failure dialog, remain usable without horizontal overflow.
- A restored native Chromium clipboard API resolved an actual headless write. Its exact argument was captured after resolution.
- Opening a shared HTTPS run URL without a session showed the sign-in boundary and no private run header. With a seeded authenticated session, HTTPS sharing retained the origin and port.

The final browser error collection was empty. Fixture setup was corrected to persist seeded statuses before checking presentations. Browser scripts explicitly scroll controls into view and use CSS selectors supported by the installed agent-browser CLI.

## Quality checks and evidence

- Dependency build, edge-worker type checking and browser build passed. The first checks lacked workspace `dist` artifacts; building dependencies resolved this without dependency changes.
- Five relevant Vitest files passed: 98 tests. Final output is retained as `targeted-tests.log`.
- Scoped Biome checks passed without errors; the stylesheet retains 17 existing specificity/style warnings. `git diff --check` passed.
- `browser-assertions.json` records the 30 assertions. `fixture.json`, `served-version.json` and `implementation-revision.json` identify the fixture and tested source/build. Runtime receipts and both executable fixture/browser scripts are retained alongside them.
- Captured and visually inspected: `share-desktop-success.png`, `share-desktop-light.png`, `share-desktop-dark.png`, `share-desktop-fallback.png`, `share-mobile-light.png`, `share-mobile-dark.png` and `share-mobile-fallback.png`.

## Limits and cleanup

Clipboard denial/unavailability and most success paths are simulated at the browser API boundary. One native headless Chromium write resolved; this does not establish physical-device clipboard behavior or clipboard contents on the host. HTTPS uses a local self-signed fixture and seeded session, not a deployed remote origin or real passkey enrollment. No tracker synchronization, provider delivery or merge is claimed.

The named headless browser and both fixture listeners were closed. Evidence and temporary fixture homes remain for reproduction. No PR was created or published by implementation; the delivery step owns publication and the eventual changelog PR link.

## Merge validation for PR #122

The CI fixer fetched and merged `origin/main` at `ef01f788`. The tested working
tree combines PR head `c4f0d9f7` with that base. The capability-reference conflict
was resolved by preserving the Share description and all current base guidance.
The auto-merged dashboard retains the Notifications move to Settings.

Fresh browser build `771ec01592a95456cd83d4cd` passed the same 30 browser
assertions with simulated agents, using the fixture and browser commands above
with evidence in the `ci-merge` subdirectory and headless session
`share-ci-5442324b`. Source fingerprints and both parent revisions are recorded
in `ci-merge/merge-revision.json`. Desktop fallback and mobile light screenshots
were inspected. All 55 browser-client/PWA tests, edge-worker build/typecheck,
scoped Biome checks and `git diff --check` passed. Physical-device clipboard
behavior remains unverified. The browser session and fixture listeners were closed.

## Main integration — 2026-10-14

Merged `origin/main` at `bfe71f41` into PR #122, whose prior head was
`3b504dca`. Reconciled the changelog and both capability-reference lines by
preserving current main guidance and the Share paragraph. The cumulative
browser diff against main retains only the planned Share controls and layout.

The focused simulated-agent fixture served browser build
`ef4b568f76b3e0006751269b`. Thirteen executable headless assertions passed:
Working Share retains collapsed rows and the route; a brought-back stopped
Focus card offers Share beside Resume; copying preserves runtime records and
produces no mutation requests; both Settled presentations copy correctly; all
six detail statuses retain exactly one Share control; and unavailable
clipboard support offers the exact recovery URL. Clipboard writes in this
smoke check are simulated. No new screenshot evidence is claimed.

Evidence and executable scripts are in the evidence directory's
`merge-20261014/` folder (`fixture.mjs`, `browser.mjs`, `fixture.json`,
`browser-results.json`). The fixture runs with `F1_AGENT_MODE=mock` using the
real WorkflowRuntime, FactoryServer and compiled dashboard. Initial harness
attempts used an incorrect Bring back field and assumed Focus ordering.
After correcting the field to `keptOpen`, Next item and direct card selection
did not switch Focus in this seeded browser session. This behavior was not
diagnosed or fixed; the completed smoke therefore checks the selected stopped
Focus card and all statuses through detail routes, not Focus-deck navigation.
Earlier full Share QA remains historical evidence.

FactoryAccess, FactoryWebClient, FactoryPwa and the complete routing-prompt
suite passed 75 tests with host GitLab settings excluded. Dependency and
dashboard builds and scoped Biome passed. The PR diff against main passes
`git diff --check`; imported historical F1 reports retain their existing
Markdown hard-break whitespace. Physical-device clipboard behavior remains
unverified.
