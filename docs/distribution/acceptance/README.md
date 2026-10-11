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

Every CLI/manager command has a held leader in a newly owned session/process
group. The leader waits for a durable registration handshake before target code
runs and stays alive through target exit; Linux start ticks bind the identity
before any group signal. Cancellation and target exit drain inherited descendants,
including closed-pipe forks. The host/harness process group is never signaled.
For the cancellation matrix, nested groups share a precreated private registry.
An outer 90-second deadline first persists a nonpassing timeout and sends SIGTERM
to the fixture, allowing 30 seconds for `withOwnedCleanup`. Escalation closes the
registration gate, drains exact registered groups even after reparenting, and
reconciles preregistered exact units and jobs against their owned definition bytes.
A changed/missing live leader identity or unknown survivor keeps cleanup nonpassing;
it never authorizes signaling an unrelated group. Unexpected fixture death and exit without cleanup proof also reconcile exact
registered units, independently of group-cleanup failures. Failed cleanup retains
the closed ownership registry and reports its path. The supervisor allocates the
private temporary root before child execution and retains its canonical parent,
device/inode/owner/birth identity in memory and `filesystem.json`. Removal checks
that identity and the exact manifest root after native/group cleanup, refuses
untrusted/replaced/linked roots, and preserves symlink targets and external
receipts. Filesystem errors keep cleanup nonpassing and the registry retained;
verified unit, group and filesystem cleanup is required before deleting it. Primary fixture/timeout and cleanup
errors survive in the receipt and every independent matrix outcome. Both worker
and updater exact unit identities are registered before installation. Definition
bytes are checked against the frozen b82 Linux contract before cleanup; changed
or linked definitions cause a nonpassing result and are preserved for diagnosis.

The workflow generates six independent signal cancellation receipts: SIGINT and SIGTERM
at initial installation's real manager descendant, a real manager start submission,
and healthy managed units. A fixture-only PATH gate exposes the frozen CLI's actual
execFileSync descendant and schedules a delayed real systemctl mutation with closed
pipes. Cancellation must drain it, reconcile the exact unit's manager jobs, and
leave no late-mutation marker. A seventh case arms an actual outer deadline at the same START descendant boundary
and verifies cooperative timeout, exact-unit cleanup and no late mutation. The
wrapper preserves nonzero-exit stdout, stderr and status: `is-enabled` returning
`disabled` with exit 1 remains an actual disabled state, not a globally successful
exit. Every case runs even if another case fails. Signal
receipts must remain `passed:false`, exit130/143, with `cleanup:true` and no survivors;
these intentional cancellations are not runtime acceptance PASS.

Cleanup independently verifies terminal unit state, MainPID/ControlPID zero and no
queued job, tolerates already-inactive unloaded fixtures without force-killing them,
and disables/stops only registered fixture units. Force kill is an exact-owned-unit
fallback for a bounded stop timeout. Unloaded/stopped races are tolerated only with
specific errors and independently terminal state; permission/ownership errors remain
failures. Fixture definitions/backups and temporary state are removed only after
ownership and cleanup checks. Fresh FAIL receipts are reserved before work; a reused
receipt path is refused. Main PASS requires every original assertion and cleanup.

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

The c3 diagnostic [run38132934881](https://github.com/jappyjan/bobs-factory/actions/runs/38132934881)
establishes a harness observation error, not a production defect: the worker's
journal records native start-limit rejection while its failure result stays
`signal`. [Raw failed receipts and diagnostics](../evidence/2026-10-11-service-round2-failure/README.md)
are preserved separately. systemd v255 retains a preceding failure result in
[service_enter_dead](https://raw.githubusercontent.com/systemd/systemd/v255/src/core/service.c).

Exhaustion now requires a fresh exact-unit JSON journal rejection since the crash
series began, known StartLimitBurst/StartLimitInterval/RestartSec properties,
failed/inactive terminal state with MainPID/ControlPID zero and no queued job,
and stable NRestarts/terminal state across more than RestartSec. Arbitrary signal
failures cannot satisfy it. The original 45-second restart waits are unchanged.
All maintenance, resume, remove and retained-byte assertions remain required.
Corrected CI must supply actual verified main, all six signal cancellation receipts and the outer-timeout receipt
before any full Linux acceptance PASS is claimed. No runtime source was changed.


## Exact round 4 evidence and subsequent correction

[Exact482 evidence and remaining P2 response](../evidence/2026-10-11-service-round4/README.md)
retain run38135977321/artifact11700339615, all94 original files and the provider
metadata/digest. Main acceptance, all six signal cleanup cases and the seventh
outer-deadline case pass at that exact harness. The subsequent unexpected-death
cleanup correction is covered by 22 focused checks; its fresh CI and independent
review remain separate. No older receipt is relabeled as new-harness acceptance.


[Exact834 native receipts and review5 filesystem correction](../evidence/2026-10-11-service-834/README.md)
retain run38137269848/artifact11702185760 and all94 original files. Those eight
receipts pass at834 but do not exercise unexpected death. The subsequent
identity-bound filesystem fallback has27 focused safe checks; it needs fresh
review6 and its own CI and is not represented by an older native PASS.
