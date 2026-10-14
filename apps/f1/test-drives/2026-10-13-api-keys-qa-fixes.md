# API key QA corrections

Date: 2026-10-13. Tested the fix working tree based on `2dd287fa` for draft PR #117. The source receipts identify the tested files; the base commit alone is not evidence of the corrections. Historical reports remain unchanged.

F1 applies to the authentication UI corrections and the functional onboarding fixture change. Both drives used disposable homes/repositories, simulated agents and provider responses, prepared-tool stubs, and real local workers and Git operations. No real agents or provider credits were used.

## Results

- [Localhost fixture receipt](assets/2026-10-13-api-keys-qa-fixes/localhost-result.json): all ten assertions passed; exit 0. Includes local and remote protected scripted workflows, issuing-session revocation, other-key preservation, restart, migration, last-key recovery and local SSE.
- [Onboarding fixture receipt](assets/2026-10-13-api-keys-qa-fixes/onboarding-result.json): exit 0 through timeline pagination, publication/readiness, stale approval rejection, simulated exact-head merge and cleanup. GitHub responses and merge are simulated; real local Git commit/push targets a disposable bare repository.
- [Headless browser receipt](assets/2026-10-13-api-keys-qa-fixes/qa-fix-browser-receipt.json): eight checks passed against an isolated real FactoryServer and self-signed HTTPS proxy. API keys stayed in process/component memory and are absent from these captures. Owned session, server, proxy and runtime closed.
- Authentication, access, web-client and PWA tests: all 80 passed. Edge-worker build/typecheck, changed TypeScript Biome checks and whitespace checks passed. CSS retains existing lint warnings.

Commands:

```sh
pnpm --filter bobs-factory-edge-worker build
pnpm --filter bobs-factory-edge-worker typecheck
pnpm --filter bobs-factory-edge-worker test:run test/FactoryAuth.test.ts test/FactoryAccess.test.ts test/FactoryWebClient.test.ts test/FactoryPwa.test.ts
F1_AGENT_MODE=mock F1_ONBOARDING_PORT=3750 bun run apps/f1/test-drives/assets/simple-install-onboarding.ts
F1_AGENT_MODE=mock F1_LOCAL_ACCESS_PORT=3791 F1_LOCAL_ACCESS_TLS_PORT=3792 bun run apps/f1/test-drives/assets/localhost-noauth.ts
```

Browser verification used a fresh `agent-browser --headed false --ignore-https-errors --session fix7520-<timestamp>` session and Playwright CDP on that owned session. The sanitized receipts and executed browser script are also retained in the run evidence directory under `qa-fix-*`.

## Findings and rationale

Removing the last issuing key now refreshes access status immediately. The remote page shows [localhost recovery instructions](assets/2026-10-13-api-keys-qa-fixes/qa-fix-last-removal.png) without reload or a sign-in field. Local Settings can create a new working key. Self-rotation still preserves the one-time replacement reveal until dismissal, then permits sign-in with the replacement.

Key-management buttons and their request path now require a ready connection. The browser forwarded a stale build header to the actual server, which returned its real 409 response. Fresh version verification was held to keep the mismatch unresolved. [The buttons stayed disabled](assets/2026-10-13-api-keys-qa-fixes/qa-fix-mismatch-controls.png); a programmatic submit sent no second POST, and persisted state remained unchanged. Releasing verification restored controls after fresh successful version/data checks. Holding verification matters because this artificial stale request otherwise reconnects successfully to the still-compatible server.

Long unbroken names wrap while action buttons retain their width and stay within the card at [1440px](assets/2026-10-13-api-keys-qa-fixes/qa-fix-long-name-1440.png) and [390px](assets/2026-10-13-api-keys-qa-fixes/qa-fix-long-name-390.png). All four selected screenshots were inspected.

The onboarding fixture previously expected a raw agent reply in the CLI tracker timeline. Current publication sends validated Factory role outcomes through ticket tracking; CLI tracking uses issue comments, while the raw agent stream remains in Factory activity. The corrected fixture asserts the full accepted role output and its presence in Factory activity, separately verifies CLI routing/activity shape and pagination, and retains all subsequent simulated merge checks. The metadata stub now also handles unauthenticated GitHub webhook metadata rather than reporting it as a credential-selection failure. Fixture log messages no longer claim passkey registration.

The maintained access guide now describes key login, once-only secrets, local/remote management authority, revocation and localhost recovery. Its preceding dashboard-only contract remains intact.

Earlier browser harness attempts failed due to blocking the embedded server with a synchronous CLI call, selecting an initial blank tab, or checking an artificial mismatch after successful reconnection. These attempts are not passing evidence; the final explicit-page, asynchronous, held-verification drive exited 0.

## Limits

No production proxy, packaged Electron, physical mobile or real-agent behavior was tested. These focused corrections require subsequent independent review, CI and QA reassessment. No human approval or production merge occurred.
