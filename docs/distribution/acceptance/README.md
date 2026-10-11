# Isolated service acceptance

`isolated-service-acceptance.yml` runs one disposable Linux x64 GitHub runner.
It reuses artifact `11682662326` from run `38086228778`, verifies its API
source/container digest and retained archive hash, and executes source
`b82c37c4fb9a3e18d1cb222c6d56d3fef852096f`, candidate
`ca323a599f606523965d996ff871eeee784d7f5a419ce9158675077b3e4e43ec`.
It does not build or publish a new payload. The current checkout supplies the
acceptance harness; its SHA and script hash are recorded separately.

The harness requires `GITHUB_ACTIONS=true`, Linux and explicit
`BOBS_FACTORY_ACCEPTANCE_HANDOFF=fixture-only`. It creates a unique Factory home,
port and external unit. It uses the runner's existing user manager, changing only
its own uniquely named units. The foreground and external systemd fixtures run
the actual frozen binary without a display, browser or provider inference.

Assertions cover active manual/external owner refusal, disable-before-handoff,
retained external definitions, dormant Nix-style definition refusal, interrupted
stopped installation and modified-definition refusal, actual enrollment,
crash backoff and burst exhaustion, maintenance/start suppression, explicit Stop
and removal. PM2/Nix owner records, synthetic native checkpoint and waiting-gate
bytes must remain unchanged. These opaque markers prove retention, not executable
workflow recovery; the historical mock F1/native workflow receipts supply their
own separately scoped continuation evidence.

Every service operation is bounded and active harness subprocesses can be cancelled.
SIGINT/SIGTERM unwind work into one cleanup path and persist a nonpassing receipt
with exit status 130/143. The workflow separately interrupts healthy fixture units
with both signals and requires cleanup and no survivors. Cleanup disables/stops only fixture units,
uses an owned-unit kill fallback, checks all observed PIDs and process arguments
for unobserved fixture descendants, removes fixture definitions and reloads the
manager. PASS is written only after cleanup succeeds. A fresh nonpassing receipt
is reserved before work starts, and reused receipt paths are rejected.

No VM/container PID1 restart, host/user-manager reboot, login, logout or lingering
is simulated. Those proofs remain open. No physical authentication, native
credential store, real PM2/Nix activation, second-machine UI or genuine provider
continuation is exercised. Ubuntu 24.04 is the runner environment, not a declared
compatibility proof for every supported OS/kernel variant. The user-selected first
release minimums are macOS 15 and Ubuntu 24.04/glibc 2.39 on ARM64+x64; observed
native runs are macOS 15.7.9 and Ubuntu 24.04.5. A CI run is acceptance evidence only after
its actual receipt and cleanup are reviewed; this workflow file is not a PASS.

## External ownership and explicit manual migration

The product does not automatically adopt arbitrary PM2/manual/Nix definitions.
Installation refuses an active owner, an external definition at its target path,
and an executable resolving into `/nix/store`. It cannot discover every dormant
PM2/Nix/service definition under an arbitrary name. The operator must inventory
and reconcile those definitions before enrolling the replacement.

1. Identify the exact state home, executable, account, worker/descendant PIDs,
   old manager and its startup enrollment. Record who owns the tunnel separately.
   Retain the old PM2 ecosystem/dump, unit/plist, Nix configuration and state.
   Keep native credentials in their existing host stores.
2. Obtain explicit operator consent for that named owner and home. Drain work and
   retain checkpoints, accepted definitions/results, waiting gates and worktrees.
   Stop and disable the old owner's restart/startup before replacement. For PM2,
   use its owner to remove only the selected process from resurrection and save
   the reviewed process list; `pm2 stop` alone does not remove saved startup.
   A foreground process has no startup owner: inspect its parent supervisor.
   For manual launchd/systemd, unload/disable the exact selected definition.
3. For Nix, change the declarative service configuration through its owner and
   apply the reviewed generation. Never edit `/nix/store` or assume its generated
   definitions are mutable. Keeping Nix as owner is supported: continue managing
   the service/update through Nix, without installing a second managed owner.
4. Verify the old service is inactive and unenrolled, and its worker/descendants
   have exited. A worker lock alone is not proof that dormant startup is disabled.
   Retry the managed `service install` only with the intended packaged executable.
   Inspect `service status` before opting into `service enable` and `service start`.
   Enrollment and starting are separate actions. Verify actual manager PID,
   executable/home and health. Never remove an externally changed definition
   merely to bypass refusal.
5. Recheck retained state/gates and native continuation under that same account.
   Rollback requires stopping/disabling the replacement before restoring the old
   definition/enrollment. Retain both definitions and the migration evidence.

Linux crash burst exhaustion intentionally leaves the unit failed. Inspect the
exact owned unit and logs, address the failure, then deliberately clear its limit
with `systemctl --user reset-failed UNIT` before `service start`/`restart`.
The CLI currently does not clear systemd's failure counter itself. The fixture
records exhaustion and uses that explicit owned-unit recovery; it does not claim
automatic recovery beyond the configured burst limit.


## Crash failure diagnosis

The original harness f48 run38132078627 failed at repeated crash restart or burst
exhaustion after one 11178 ms recovery. Later assertions never completed. Its raw
[failed evidence](../evidence/2026-10-11-service-correction/README.md) remains unchanged.
It did not record systemd properties/journal, so no actual cause can be established
from that receipt. The corrected harness retains the original timeout/assertions,
uses `systemctl --user kill --kill-whom=main --signal=SIGKILL EXACT_FIXTURE_UNIT`,
and captures the unit properties/journal plus matching process/cgroup details
before each crash and before teardown, including failure/cancellation. Killing an
entire cgroup would change the tested failure and is reserved for owned cleanup.

One diagnostic hypothesis is surviving unit descendants: systemd explicitly says
`SendSIGKILL=no` with `KillMode=mixed` can prevent restart when prior processes
remain in the cgroup ([systemd v255 kill contract](https://github.com/systemd/systemd/blob/v255/man/systemd.kill.xml)).
Actual properties/journal are needed to distinguish that from a start-limit or
harness observation error. No production setting or frozen source has been changed,
and no timeout increase or passing result has been substituted for the failure.
