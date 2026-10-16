# Renewed chapter reading progress and page reload

Validated the reader and browser connection lifecycle using the native Factory
HTTP server with recorded runtime fixtures from the earlier simulated-agent
impact drive. No agents, provider calls, production services or delivery actions
ran. Issue routing and agent orchestration were unchanged by this correction.

Tested the working tree based on `eb2eaf152273ad7a6d07d7d05bbe0ad490555059`;
the final tested browser bundle is `a32530981141e356624ddaf8`.
The native server used a temporary home and loopback port 4971. Puppeteer ran
headlessly at desktop 1280×900 and phone 390×844.

- Original and renewed guides were replayed through the native protected APIs.
  Marking both chapters reviewed, then emitting a live run update, retained the
  independently unchanged authorization checkbox and reset affected cleanup.
- The current reviewed checkbox survived full reload. Explicitly unchecking it
  also survived reload. Decide navigation and requirement coverage remained
  accessible. The phone layout had no horizontal overflow or browser errors.
- Before the page-navigation abort correction, the same native-server replay
  cleared private storage during reload and failed the persistence assertion.
  After correction, all six browser assertions passed. Actual connection/access
  loss still uses the existing private-state cleanup.
- All 50 focused review-state, model, feedback and web-client tests passed.
  Edge-worker typechecking, changed-file Biome checks and the web build passed.

Reproduction scripts, browser results and inspected desktop/phone screenshots
are in the run evidence directory under `qa-fix-progress/`. Start
`native-replay-server.mjs`, then run `browser-check.mjs`; both use the recorded
`qa-extended/guide-original-run.json` and `guide-current-run.json` fixtures.
This is scripted runtime/browser evidence, not a fresh execution of the agents
that originally generated those guides. Real-agent judgment, remote passkey
sessions and provider delivery are outside this correction's validation scope.
