# Six-digit device sign-in

Date: 2026-10-20. F1 applies because dashboard authentication changes.

The drive uses a fresh disposable home/repository, the real EdgeWorker and
FactoryServer, mock agent handlers, prepared-tool stubs and a scripted workflow.
A local self-signed HTTPS proxy preserves public Host/Origin. No native agent,
provider credential, production service or paid inference is used.

## Tested source and receipts

The feature was uncommitted on base `b963ba106028e0af8aacfb89558048051a372fe4`.
That is the base, not the feature revision. The
[receipt](assets/2026-10-20-device-pairing/drive-result.json) fingerprints the exact
authentication service, server, client, stylesheet and drive source with SHA-256.
The [log](assets/2026-10-20-device-pairing/drive.log.raw) records five passing server
checks, browser HTTP traffic and successful owned cleanup (exit 0).

```sh
pnpm install
pnpm --filter 'bobs-factory-edge-worker^...' build
pnpm --filter bobs-factory-edge-worker build
F1_AGENT_MODE=mock F1_DEVICE_HOLD=1 bun run apps/f1/test-drives/assets/device-pairing.ts
```

The fixture prints `BROWSER_READY` with its disposable directory and URLs. Write
`continue` in that directory to finish the bounded browser hold, or omit
`F1_DEVICE_HOLD` for the automated server checks alone.

## Server results

- Remote access starts locked, code redemption fails before explicit enablement,
  and anonymous code generation is denied.
- Local Settings enables a six-digit code even before the first API key exists.
  Public status exposes availability without the code or grant metadata.
- Two concurrent HTTPS redemptions yield exactly one key. Its 43-character secret
  is transmitted once and is absent from persisted authentication state. The
  existing login endpoint accepts it and creates a normal no-expiry session.
- That session launches a real EdgeWorker worktree, completes the fixture script,
  and reads the completed run through the protected HTTPS API.
- Removing the device key revokes its key/session while local access continues.
  Five wrong HTTPS guesses and explicit cancellation disable pairing without
  issuing another key.

## Browser results

T3 preview opened local Settings. An existing cached shell in the default profile
correctly triggered its update boundary, so inspection continued in a fresh
incognito profile. The first browser inspection exposed an empty-state bug in
the shared auth helper (`result.code` on a null pairing response); it was fixed
before the final build and passing drive.

The preview failed twice on the fixture certificate:
`net::ERR_CERT_AUTHORITY_INVALID` / `Navigation to https://127.0.0.1:3601/ failed: ERR_CERT_AUTHORITY_INVALID`.
Testing continued in one fresh named `agent-browser` session with
`--headed false --ignore-https-errors`, scoped to the disposable fixture.

Actual UI interactions verified:

- With no active code, remote sign-in shows a disabled code option. Enabling a
  named device in local Settings makes it available automatically without reload.
- At 390 × 844, the code field uses `inputMode="numeric"`,
  `autocomplete="one-time-code"`, six digits, and no horizontal overflow.
  Non-digit input is filtered; an incomplete code cannot submit. A wrong code
  produces the generic error and clears the field.
- Entering the correct code with **Stay signed in** opens the dashboard. A
  read-only fetch observer recorded `keyLength: 43`,
  `normalLoginWithIssuedKey: true`, and `keyInWebStorage: false`; it did not mock
  responses. Status returned `authenticated: true, expires: null`, protected runs
  returned 200, and JavaScript could not read the HttpOnly cookie. Reload retained
  the session.
- The local key list refreshed with the named device. Signed-in remote Settings
  also generated and cancelled a code. After generating another remote code,
  local removal of its issuing device key (through the real confirmation dialog)
  signed the remote browser out, removed protected navigation and disabled the
  pending code. Final status was `authenticated: false, pairingAvailable: false`.

One browser wait expected the normal sign-in heading after last-key removal and
timed out; the correct empty-store setup screen was then inspected directly.
This was a wait expectation error, not a passing assertion or a product failure.

Inspected captures:
[code login](assets/2026-10-20-device-pairing/device-login-mobile.png),
[paired dashboard](assets/2026-10-20-device-pairing/paired-device-mobile.png),
[desktop Access settings](assets/2026-10-20-device-pairing/access-settings-desktop.png),
[enabled code (masked)](assets/2026-10-20-device-pairing/pairing-code-mobile-masked.png),
[revoked device](assets/2026-10-20-device-pairing/revoked-device-mobile.png).

## Additional verification and limits

- `pnpm --filter bobs-factory-edge-worker test:run test/Factory`: 342 tests passed
  across 23 files.
- The final focused authentication/access/client check passed all 90 tests.
  Service tests cover exact expiry, replacement, stale cancellation, five-guess
  lockout, issuer logout/rotation/removal/expiry/replacement, recovery, restart,
  terminal-session rejection and failed persistence. Route tests cover concurrent
  redemption, origin/action/build guards, secret redaction and device revocation.
- Edge-worker build/typecheck, CLI typecheck, changed TypeScript/fixture Biome
  checks and repository lint passed. Repository lint reports 25 warnings. Commit
  hooks also passed the full `pnpm build` and `pnpm typecheck` workspace gates.

Expiry uses a controlled clock in unit tests; it was not a five-minute physical
device test. Browser dimensions establish responsive rendering, not a physical
mobile keyboard, installed PWA, packaged desktop or production proxy deployment.
The existing version-3 authentication store needs no migration. All owned browser
tabs/sessions, worker and listeners were closed; disposable homes were removed
after saving the receipts. Historical evidence is unchanged.
