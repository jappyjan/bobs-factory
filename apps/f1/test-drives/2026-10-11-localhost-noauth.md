# Direct localhost access without passkeys

Date: 2026-10-11. Taskbot [116](https://taskbot.apps.janjaap.de/p/bobs-factory/t/116) / [121](https://taskbot.apps.janjaap.de/p/bobs-factory/t/121).

F1 applies because this changes Factory authentication, onboarding and dashboard
workflow access. The scenario exercises a real FactoryServer and EdgeWorker in a
fresh disposable home and Git repository, with mock agents and a scripted run.
It does not use production state, services, provider credentials or live agents.

## Tested source and commands

Initial browser drive: uncommitted implementation on base
`6f40898469c9083dda4d74f37dc1c408718eaa67`. The immutable
[result](assets/2026-10-11-localhost-noauth/result.json.raw) records source SHA-256
values, eight passed assertions, actual external-browser requests and fixture
path. Its commit field names the base, not a committed implementation. The
[raw log](assets/2026-10-11-localhost-noauth/drive.log) preserves that distinction.
The later committed-source receipt is recorded below when available.

```sh
F1_AGENT_MODE=mock F1_LOCAL_ACCESS_HOLD=1 bun run apps/f1/test-drives/assets/localhost-noauth.ts
F1_AGENT_MODE=mock bun run apps/f1/test-drives/assets/localhost-noauth.ts
pnpm --filter bobs-factory-edge-worker test:run test/FactoryAccess.test.ts test/FactoryAuth.test.ts test/FactoryWebClient.test.ts test/FactoryServer.test.ts test/FactoryServer.update-startup.test.ts
pnpm --filter bobs-factory test:run src/local.test.ts
pnpm --filter bobs-factory-desktop test:run
pnpm build
pnpm typecheck
```

The hold mode pauses on fresh onboarding, then keeps the completed run and a
controlled external page available for the collaborative browser. Create the
printed fixture's `onboarding-continue` and `continue` files to advance those
two bounded pauses. Ports 3631–3634 belong only to the disposable fixture.

## Results

- Actual TCP requests to localhost, IPv4 and IPv6 opened auth status, configuration,
  run inventory and updates without credentials, enrollment, deadline or cookie.
- Fresh project/provider onboarding was available before enrollment. Its project
  mutation completed with disposable prepared-tool availability stubs.
- Saving and starting a dashboard recipe created an actual EdgeWorker worktree,
  executed a controlled script and returned a completed run.
- Invalid Origin, Fetch Metadata and forwarded localhost reads/mutations returned
  403 before protected actions. Focused tests also cover nonloopback socket peers,
  rebinding Host, wrong port, spoofed forwarding headers, foreign Referer and
  remote-session transplantation.
- A real self-signed TLS proxy preserving its configured public Host and Origin
  remained unauthenticated (401) until software WebAuthn enrollment/login. Its
  opaque remote cookie authorized that origin; logout returned it to 401.
  Forwarding localhost with that cookie returned 403.
- Local SSE opened without a token and remained available after remote enrollment.
  Focused existing remote tests retain stream expiry/logout/recovery revocation.
- The actual collaborative browser opened fresh onboarding, the completed-run
  dashboard and local access settings without an auth screen or cookie. Local
  settings displayed no passkey or sign-out buttons.
- An actual browser page at another origin attempted a configuration read, run
  stop POST and iframe navigation. All three server responses were 403; browser
  fetches rejected and the run was unchanged. The raw receipt records method,
  path, status and supplied Origin rather than relying on CORS errors alone.

Focused automated checks passed: Factory 66, CLI launch 7 and desktop 34. Full
monorepo build and typecheck passed. The launch skill's isolated quick validator
passed. Normal commit hooks provide the final build/type gate.

Screenshots: [fresh onboarding](assets/2026-10-11-localhost-noauth/onboarding.png),
[completed-run dashboard](assets/2026-10-11-localhost-noauth/dashboard.png),
[local settings](assets/2026-10-11-localhost-noauth/access-settings.png), and
[external page](assets/2026-10-11-localhost-noauth/external-page.png).

## Failures, cleanup and limits

The first fixture mistakenly replaced mandatory stock workflows when adding its
script; configuration correctly rejected that with 409. The fixture now appends
its workflow. The [failed log](assets/2026-10-11-localhost-noauth/failed-fixture-default.log)
is retained, not relabeled as a passing run.

The browser drive passed all eight assertions and closed its owned listeners and
worker, but mock background timers kept its controller alive. Only the verified
owned controller was terminated. The maintained fixture now exits after its
listener/worker cleanup; a subsequent non-hold drive passed seven assertions and
exited 0. No native agents or provider calls were made.

This is source-level browser/API workflow evidence, not packaged Electron,
physical authenticator, minimum-platform or production proxy acceptance. Native
desktop bridge/navigation guards and unsigned source/hash/inventory/update
protections were preserved. The old frozen 6f/c061 release candidate and its Mac
fixture evidence are unchanged; a new reviewed runtime candidate is coordinator
work after integration.

A raw TCP forward or proxy that strips every forwarding signal and rewrites Host
to localhost is indistinguishable from a genuine local process socket. Such
exposure is unsupported. Remote proxies/tunnels must preserve the configured
public Host and browser Origin; neither loopback proxy peers nor forwarded IP
headers grant that public origin local authority.
