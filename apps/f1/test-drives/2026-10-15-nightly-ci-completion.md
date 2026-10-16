# Nightly CI completion repair

The failed nightly `38706796563` built all four native runtimes successfully,
but its localhost drive exceeded 30 minutes and every Electron menu-race drive
exceeded 45 minutes. This is a functional F1-harness change, so the affected
real fixture paths were reproduced and exercised again with controlled agents.

On the isolated checkout based on `568e60b2`, the unmodified localhost command
`F1_AGENT_MODE=mock bun run apps/f1/test-drives/assets/localhost-noauth.ts`
reproduced an unhandled JSON parsing exception and remained alive past a
20-second outer deadline. The authenticated TLS DELETE helper sent JSON without
a Content-Length; its response callback also let parsing errors escape its
promise. Supplying the exact payload length and rejecting malformed responses
lets the drive run cleanup and complete in 1.1 seconds. All ten assertions pass,
including real EdgeWorker worktrees, IPv4/IPv6 onboarding, remote API-key login,
rotation/removal/restart, legacy-auth migration and local SSE authority.

The original native menu smoke command was run under the real Electron 44.7.0
on macOS ARM64 with the unchanged `393eb379` runtime artifact from that failed
CI run, private temporary HOME/state and no installed app or host service. It
remained alive past a 45-second outer deadline. Its controlled `isIdle()` always
returned false after proving the confirmation/maintenance race. The newer
runtime deliberately keeps admission drained and waits while busy, so the
fixture must cancel its controlled candidate through the actual paused policy.
With that change the same native command finishes in 6.7 seconds. Its separate
receipt reports local/remote authority, isolated bridges, close/reopen PID
continuity, prepared-tool PATH, explicit Stop, maintenance-race rejection and
suppressed automatic restart as passed.

Only the fixture's temporary native children were stopped during diagnosis.
Operator Factory state and credentials were untouched. Native inference,
provider authentication, physical device QA, other OS targets and final release
publication are not claimed by this local drive. The fresh CI candidate must
still pass the complete existing native/desktop matrices and current checks.
New CI step deadlines expose stalled phases promptly; no passing gate is skipped.
The Linux complete-shell fixture used the same old busy/cancelled assumption.
It now observes the actual native drain remaining busy under its held capacity
lease, checks that UI/worker are unchanged, cancels that controlled probe and
then restores policy for the retained external helper's real switch/rollback.
This Linux-only packaged path requires the fresh native CI lane; the existing
scripted shell-update drive covers the shared lifecycle on the local host.

The newly reachable architecture drive first failed because the removed legacy
`platform: "cli"` selector no longer injects the CLI tracker. It now explicitly
uses `createCLIIssueTracker`. The full mocked drive passes in 101.6 seconds:
Factory and takeover each preserve three discussion versions and run exactly
one accepted implementation, routine work bypasses the decision, and an invalid
revision exhausts correction without replacing the accepted proposal. The real
Linear SDK/controlled GraphQL publication drive also passes with no unhandled
errors or restart duplicates. These checks use no provider inference.

The source-material baseline remains the original accepted `84433882` candidate
and exact published source/receipt bytes. A separate automated source-coverage
review binds the merged API-key migration `d318160c` and exact before/after
SHA-256 of `packages/edge-worker/package.json` and `pnpm-lock.yaml`. The delta
only removes the two WebAuthn declarations and five unused lock records; all
remaining versions, integrity records, workspace policy, native inputs and
maintained notices are unchanged. The original material closure remains a
superset. Regression checks reject absent/stale reviews, changed pins, added
lock entries and removed licensing declarations, including reviews that bind
those disallowed bytes. This is a dependency-removal coverage assessment, not
a new legal, compiler/object or relink observation.
