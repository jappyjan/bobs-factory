# Dashboard API key authentication

Date: 2026-10-13. Repository delivery; no originating ticket.

F1 applies because dashboard authentication and runtime access change. These drives use a fresh disposable Factory home, Git repository, real EdgeWorker/FactoryServer, simulated agent handlers, prepared-tool stubs and a scripted workflow. A self-signed HTTPS proxy preserves the configured public Host and Origin. Provider webhook metadata is simulated; no live agents, provider credentials, production services or provider network calls are used.

## Source and receipts

The implementation is uncommitted on base `043eea7e540090e97261ae688ca470c6aefeddac`. That commit identifies the base, not a committed feature revision. Receipts record source SHA-256 values for the tested files.

- [Browser-assisted result](assets/2026-10-13-factory-api-keys/browser-drive-result.json) and [log](assets/2026-10-13-factory-api-keys/browser-drive.log.raw): ten assertions passed; normal exit 0 after owned cleanup.
- [Final server result](assets/2026-10-13-factory-api-keys/final-drive-result.json) and [log](assets/2026-10-13-factory-api-keys/final-drive.log.raw): ten server assertions passed; normal exit 0 after the final dangling-symlink store guard and login error redaction. This receipt additionally fingerprints the store and operator recovery implementation. Client and authentication-service fingerprints match the browser-assisted drive; the later server change only sanitizes malformed login responses.

Earlier attempts exposed fixture defects: empty DELETE bodies with a JSON content type, a request-recording hook omitted when recreating the server, and a browser hold that expired before inspection finished. Those attempts are not passing evidence. The maintained fixture now sends valid bodies, installs recording on every server instance and allows a bounded thirty-minute browser hold. The final independent drives passed.

```sh
pnpm --filter 'bobs-factory-edge-worker^...' build
pnpm --filter bobs-factory-edge-worker build
F1_AGENT_MODE=mock F1_LOCAL_ACCESS_HOLD=1 bun run apps/f1/test-drives/assets/localhost-noauth.ts
F1_AGENT_MODE=mock bun run apps/f1/test-drives/assets/localhost-noauth.ts
```

For the browser-assisted drive, the `ONBOARDING_READY` and `BROWSER_READY` log lines name the disposable fixture directory. The operator writes `onboarding-continue` and `continue` in that directory to advance the two holds. This never affects production state.

## Server assertions

The passing drives verify:

- Localhost, IPv4 and IPv6 dashboard/API access opens without keys, cookies or enrollment. IPv6 project onboarding works with disposable prepared-tool stubs.
- A local dashboard workflow saves a recipe, creates an actual EdgeWorker worktree and completes its script. A remote authenticated workflow also completes through the protected API.
- Malformed HTTPS login JSON returns only a generic invalid-key error, without reflecting submitted secrets.
- Remote access starts locked. Anonymous remote key creation is denied, including with an empty store. Local first-key creation enables remote sign-in with an opaque browser cookie.
- Local and signed-in remote key listing, creation, rotation and removal work. Listings expose metadata only, and generated secrets are absent from persisted state.
- Rotation rejects the old key and every issuing session. Another key's sessions remain valid. Removal revokes issuing sessions; last-key removal leaves local Settings available and remote sign-in locked.
- Restart preserves valid sessions and keeps revoked sessions invalid.
- Version-1 server migration empties the key/session store, invalidates a legacy session and preserves completed workflow history.
- Local SSE remains available without credentials. External-origin navigation, API reads and mutations all receive 403 with no run mutation.

## Headless browser checks

A fresh named `agent-browser` session was launched with `--headed false --ignore-https-errors` against the disposable fixture only. Both owned browser sessions were closed. Generated keys remained in test-process/component memory; secret fields were masked before screenshots. Every retained capture was inspected.

Browser interactions verified local first-key creation, the once-only reveal and dismissal, manual selection after clipboard failure, invalid-key input clearing, remote sign-in, remote creation, rotation of another key without losing the managing session, and self-rotation. Self-rotation removed protected navigation, returned an unauthenticated status and displayed only the replacement key. A visibility-change event did not discard that panel. Dismissal returned to sign-in; the old key failed and the replacement succeeded.

The browser CLI's pointer clicks missed the below-fold removal buttons. The remaining checks used the mounted buttons' DOM `click()` method in the same headless session. Remote removal of another key succeeded. Removing the current last key displayed the confirmation explaining remote lockout and localhost recovery, signed the browser out and cleared protected views. Local Settings then showed no keys and remained authenticated through local authority. These are real browser/server checks, not mocked HTTP responses.

Representative continuation commands:

```sh
agent-browser --session manual7520final eval 'document.querySelector("button[aria-label=\"Remove Browser secondary\"]").click(); true'
agent-browser --session manual7520final eval 'document.querySelector("button[aria-label=\"Remove Browser primary\"]").click(); true'
agent-browser --session manual7520final wait --text 'Your API key changed'
agent-browser --session manual7520final open http://localhost:3631/#/settings/access
agent-browser --session manual7520final wait --text 'No API keys'
agent-browser --session manual7520final open http://localhost:3634
```

Captures: [local Settings](assets/2026-10-13-factory-api-keys/keys-local-settings.png), [masked local reveal](assets/2026-10-13-factory-api-keys/keys-local-reveal.png), [remote locked state](assets/2026-10-13-factory-api-keys/keys-remote-locked.png), [remote sign-in](assets/2026-10-13-factory-api-keys/keys-remote-signin.png), [remote Settings](assets/2026-10-13-factory-api-keys/keys-remote-settings.png), [masked self-rotation reveal](assets/2026-10-13-factory-api-keys/keys-self-rotation.png).

## Additional verification

- `pnpm --filter bobs-factory-edge-worker test:run test/Factory`: 258 tests passed in 21 files after the final store-file guard and login error redaction. This includes route fixtures, onboarding, notifications, delivery and web-client access behavior.
- `pnpm --filter bobs-factory-edge-worker test:run test/FactoryAuth.test.ts test/FactoryAccess.test.ts`: final 25 tests passed, including the new dangling-symlink regression and malformed-login error redaction. One prior concurrent run timed out in the socket/SSE test and cleanup; the subsequent isolated runs passed, most recently in 5.37 seconds. No timeout thresholds were increased.
- The focused five-file authentication/access/client/onboarding/server check passed 64 tests before that final guard.
- Edge-worker build/typecheck and CLI typecheck passed. CLI local-launch tests passed all seven tests. CLI build passed; `node apps/cli/dist/src/app.js --home /tmp/manual-7520ab27-auth-message factory-auth` printed only the localhost Settings instructions, without creating an enrollment code.
- `node --test apps/desktop/test/launcher.test.mjs apps/desktop/test/contracts.test.mjs`: both tests passed. Changed native acceptance fixtures passed `node --check`; packaged Electron acceptance was not run.
- `pnpm lint` passed across 1,114 files with 19 existing warnings. Changed-file Biome checks also passed. Factory CSS has 17 of those warnings, confirmed against the base version; changes there only rename key-management selectors.
- `pnpm install` completed after removing both WebAuthn direct dependencies. `pnpm audit` reported no known vulnerabilities. No WebAuthn consumer remains; existing overrides are unrelated to the removed graph.

## Limits and cleanup

This proves source-level behavior with simulated agents, scripted workflows and a controlled local TLS proxy. It does not establish real model output, production proxy routing, physical mobile/PWA behavior, packaged desktop operation or a binary release. Native desktop fixtures were adapted to key sign-in but only their source syntax and relevant launcher contracts were checked.

All owned browser sessions, listeners and workers stopped. The generated homes/repositories contained only disposable data and were removed after saving their receipts and redacted captures here. Existing historical reports remain unchanged. Publication, independent review and human approval belong to subsequent workflow steps.
