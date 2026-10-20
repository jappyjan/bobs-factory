# Trusted approval for six-digit device pairing

Date: 2026-10-20. F1 applies because authentication and pairing change.

This drive supersedes the earlier direct-exchange behavior; the original report
and fixture remain as historical evidence. The new flow requires a matching
trusted-device approval before issuing a key, binds collection to the receiving
browser, throttles requests without revoking active pairing, and denies framing.

## Source and reproduction

Tested as uncommitted changes on `6eff6a21af141b20361f55161cf6c6dae8f5fc12`. Exact authentication/server/client/style/fixture SHA-256 values are
recorded in the [receipt](assets/2026-10-20-device-pairing-approval/drive-result.json).
The [log](assets/2026-10-20-device-pairing-approval/drive.log.raw) records seven
passing server checks and clean shutdown with exit 0. All source fingerprints
were checked against the final working tree.

```sh
pnpm --filter bobs-factory-edge-worker build
F1_AGENT_MODE=mock F1_DEVICE_HOLD=1 bun run apps/f1/test-drives/assets/device-pairing-approval.ts
```

The fixture creates a disposable home/repository, prepared-tool stubs, real
EdgeWorker/FactoryServer, local self-signed HTTPS proxy and a scripted workflow.
Agent handlers and provider metadata are mocked; there are no native agent runs,
provider credentials, production services or paid inference. It prints
`BROWSER_READY` after testing the real throttling window. Write `continue` in its
printed directory to end the bounded browser hold. Omit `F1_DEVICE_HOLD` for an
automated server-only drive.

## Server assertions

- Remote APIs and pairing start locked; anonymous code generation is denied.
- Two browsers using the same valid code get different confirmation numbers and
  separate receiving-browser cookies. Neither receives a key or authenticated
  session. Unauthenticated collection fails, including with the correct request
  ID. Public status reveals only the cookie holder’s pending request.
- Exact trusted approval selects one request and invalidates the other. It still
  creates no key. The other browser’s cookie cannot collect the selected key.
- Two concurrent collections by the approved browser produce exactly one
  full-strength key. Plaintext keys are absent from persisted state. Standard
  API-key login accepts the key and preserves opt-in no-expiry sessions.
- The paired session launches a real isolated EdgeWorker worktree, completes the
  fixture script and reads the completed run through the protected HTTPS API.
- Removing that key revokes its session and subsequent key login.
- Repeated HTTPS guesses return 429 and `Retry-After` while keeping the grant
  active. After the actual window elapses, the same code creates a pending
  request without regeneration. Explicit code cancellation then invalidates it.

## Browser assertions

T3 preview was tried first and failed twice with
`Navigation to https://127.0.0.1:3601/ failed: ERR_CERT_AUTHORITY_INVALID`.
Two fresh named `agent-browser` sessions, scoped to the disposable fixture, used
`--headed false --ignore-https-errors`. No responses were mocked in the browser.

- Local Settings enabled a named code. A receiving browser at 390 × 844 entered
  only six digits and displayed its separate confirmation number. While pending,
  status was unauthenticated, protected runs returned 401, cookies were unreadable
  to JavaScript, and no key existed. Reload restored the same pending request.
- Both screens showed matching confirmation `035046` (a comparison value, not a
  credential). The trusted UI’s exact matching button approved the request. A
  read-only fetch observer recorded a 43-character collected key, the same key
  passed to standard login, and no key in web storage. Status became
  `authenticated: true, expires: null`; reload retained the session. The temporary
  pairing request disappeared after collection. No horizontal overflow occurred.
- A separate receiving browser submitted another code. Trusted **Reject request**
  removed only that request: it remained unauthenticated and the code stayed
  enabled. A fresh request from that browser could be cancelled using its own
  **Cancel request** button, again leaving the code enabled and no key issued.
- Removing the successfully paired key through the local confirmation dialog
  returned the original receiving browser to empty-store setup. Status was
  unauthenticated and private navigation disappeared.

All retained captures were inspected:
[pending mobile device](assets/2026-10-20-device-pairing-approval/device-pending-mobile.png),
[trusted approval screen](assets/2026-10-20-device-pairing-approval/trusted-approval-desktop.png),
[approved mobile device](assets/2026-10-20-device-pairing-approval/approved-device-mobile.png),
[revoked device](assets/2026-10-20-device-pairing-approval/revoked-device-mobile.png).
The enrollment code is masked in the trusted screenshot; the matching comparison
number remains visible on both screens.

## Other checks and limits

- All 347 Factory tests passed across 23 files. Focused service/route/client checks
  also passed. New security coverage includes collection before approval, wrong
  cookies/origins/IDs, stale or mismatched approval, competing code holders,
  concurrent collection, request rejection/withdrawal, approved-request expiry,
  issuer revocation/recovery/restart, failed persistence, bounded pending requests,
  peer/global throttling, spoofed forwarding headers, retry headers and framing
  denial. Existing normal login/key/session tests continue to pass.
- Edge-worker build/typecheck and changed TypeScript/fixture Biome checks passed.
  Repository lint passed with 25 warnings.

These are controlled-clock unit tests, real local HTTPS integration and headless
browser checks. Physical mobile keyboards, installed PWAs, packaged desktop and
production proxy deployment were not tested. Proxy clients share the socket-peer
limit; a sustained request flood can still delay pairing. Approval depends on the
operator comparing the displayed number with the device in their possession.

Both owned browser sessions, T3 preview tab, worker and listeners closed. The
disposable home/repository was removed after preserving the receipt and log.
The version-3 authentication store and existing keys/sessions need no migration.
