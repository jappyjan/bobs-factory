# Taskbot 116 native evidence and remaining gates

This is implementation validation for draft [PR #91](https://github.com/jappyjan/bobs-factory/pull/91), not release approval. All production lanes #84–#90 and the combined integration were independently reviewed clear; the exact trigger correction `ad6f0f8553f9c6df26591fc033764bf4bc354712` was integrated as `22e8b08d` and pushed with its changelog follow-up at `b82c37c4fb9a3e18d1cb222c6d56d3fef852096f`. The final documentation/evidence delta still requires the coordinator's independent review.

## Verified corrected-source candidate

The corrected push [run 38086228778](https://github.com/jappyjan/bobs-factory/actions/runs/38086228778), attempt 1, completed successfully: freeze plus all four binary and all four desktop jobs. Its exact source/tooling is `b82c37c4fb9a3e18d1cb222c6d56d3fef852096f`, version `1.0.0-nightly.20261010.21`, committed package `1.0.0-beta`, digest `ca323a599f606523965d996ff871eeee784d7f5a419ce9158675077b3e4e43ec`, Bun `1.4.2`, Node `24.18.0`. The workflow blob is `dd1e7d78d4a32a303147ac1c84cdb428dde23e00`, identical at the reviewed `ad6f0f85` correction, integration `22e8b08d`, source `b82c37c4` and documentation head `2673564a`. Changes after `b82c37c4` contain documentation/raw evidence and isolated acceptance tooling only, so these receipts remain bound to that candidate rather than being relabeled as a later source freeze.

All eight artifacts were downloaded outside the checkout (about 1.9 GiB). Each actual binary archive, desktop installer and complete-app update archive matched its manifest/build-inventory size and SHA-256. The runtime archive reused in each desktop artifact is byte-identical to the corresponding binary archive. Every binary archive member was inventoried and hashed against its downloaded extracted counterpart, including executable, build metadata, LICENSE, NOTICE and THIRD_PARTY_NOTICES. Large binaries/installers are excluded from Git.

The separate [source-b82 artifact index](evidence/taskbot116-source-b82/artifact-index.json) extends the evidence schema with the exact frozen candidate, source/run/job/artifact links, GitHub container digests, independently verified payload hashes, archive-member inventories, receipt hashes and preservation inventory. The [freeze log](evidence/taskbot116-source-b82/freeze.log.raw), byte-preserved candidate output line and GitHub API metadata retain provenance. `candidate.json` is the parsed output, not a newly executed freeze. The earlier `.15` [index](evidence/taskbot116-final-native/artifact-index.json) and all 53 files in its folder remain byte-identical and separate; all 101 historical lane assets remain byte-identical.

| Target | Binary job / artifact | Desktop job / artifact | Verified runtime archive (bytes; SHA-256) |
| --- | --- | --- | --- |
| `darwin-arm64` | [job 114313238650](https://github.com/jappyjan/bobs-factory/actions/runs/38086228778/job/114313238650) / [artifact 11682123495](https://github.com/jappyjan/bobs-factory/actions/runs/38086228778/artifacts/11682123495) | [job 114313825577](https://github.com/jappyjan/bobs-factory/actions/runs/38086228778/job/114313825577) / [artifact 11682473066](https://github.com/jappyjan/bobs-factory/actions/runs/38086228778/artifacts/11682473066) | `32587783`; `02ab491ad4f2c64136f324502796f96ce737338aeb9530afcda39961f8bcbfec` |
| `darwin-x64` | [job 114313238644](https://github.com/jappyjan/bobs-factory/actions/runs/38086228778/job/114313238644) / [artifact 11682007647](https://github.com/jappyjan/bobs-factory/actions/runs/38086228778/artifacts/11682007647) | [job 114313825696](https://github.com/jappyjan/bobs-factory/actions/runs/38086228778/job/114313825696) / [artifact 11682293543](https://github.com/jappyjan/bobs-factory/actions/runs/38086228778/artifacts/11682293543) | `35002322`; `216cc56ce97a6b66f37b15d2d96d7136fccc6375be6ae51489267dc92f7e4274` |
| `linux-x64` | [job 114313238604](https://github.com/jappyjan/bobs-factory/actions/runs/38086228778/job/114313238604) / [artifact 11682662326](https://github.com/jappyjan/bobs-factory/actions/runs/38086228778/artifacts/11682662326) | [job 114313825609](https://github.com/jappyjan/bobs-factory/actions/runs/38086228778/job/114313825609) / [artifact 11682198644](https://github.com/jappyjan/bobs-factory/actions/runs/38086228778/artifacts/11682198644) | `43233224`; `d75afb47d49de95e87832c9eb987277375de8d112d794e041534883dda7b6c62` |
| `linux-arm64` | [job 114313238622](https://github.com/jappyjan/bobs-factory/actions/runs/38086228778/job/114313238622) / [artifact 11681708067](https://github.com/jappyjan/bobs-factory/actions/runs/38086228778/artifacts/11681708067) | [job 114313825654](https://github.com/jappyjan/bobs-factory/actions/runs/38086228778/job/114313825654) / [artifact 11682588144](https://github.com/jappyjan/bobs-factory/actions/runs/38086228778/artifacts/11682588144) | `43213238`; `c8f276447a1d846e0e82b6dbb501097d4471d0253ea3f4db61bdaebabfe9826a` |

All binary receipts report native runtime/installer/helper/prepared-agent boundary checks passed with synthetic scoped credentials and mocked/synthetic adapters, without authenticated provider inference; Gemini has one skipped adapter test. Observed platforms were macOS 15.7.9 (ARM virtual M1 and Intel runner) and Ubuntu 24.04.5/glibc 2.39 (both architectures). The October 11 user decision selects first-release minimums of macOS 15 and Ubuntu 24.04/glibc 2.39 on ARM64+x64. Observed coverage does not prove macOS 15.0, every Ubuntu kernel/image variant or other Linux distributions.

All four desktop service and Electron receipts passed. Electron 44.7.0 used CDP virtual authenticator enrollment/login/logout; close-window worker retention, same-PID reopen, explicit Stop and maintenance-race rejection passed. Native credentials explicitly remain untested. Mac packages/update archives are unsigned; virtual-auth/service checks do not prove Apple signing, signed app activation/rollback, physical passkeys or login/reboot behavior. Factory LICENSE/NOTICE/THIRD_PARTY and packaged Electron/Chromium notice checks passed, but do not complete redistribution/relink licensing acceptance.

Both Linux shell-update receipts report actual unsigned AppImage/Electron/native-worker replacement and failed-health rollback: same worker PID/nonce, waiting-checkpoint byte preservation, active-lease deferral, external helper entry/Electron exit, candidate health identity, candidate stop before rollback and failed-candidate suppression. Cleanup is `passed: true` with no surviving fixture PIDs on either architecture. Their exact scope is test-only RSA, simulated outer release trust, Xvfb with `--no-sandbox`, and no real provider or Apple signing. This is complete-app shell updating; it does not prove authenticated provider continuation through backend runtime replacement.

Linux Electron stdout contains DBus diagnostics before the trailing JSON. Both [x64 raw output](evidence/taskbot116-source-b82/desktop/linux-x64/native-electron-receipt.json.raw) and [arm64 raw output](evidence/taskbot116-source-b82/desktop/linux-arm64/native-electron-receipt.json.raw) are copied unchanged. Parsing locates a complete trailing JSON object and rejects any non-whitespace suffix; both objects report `passed: true`. These diagnostics are retained as headless-test observations; no production defect is inferred from them.

[Node CI 38086231619](https://github.com/jappyjan/bobs-factory/actions/runs/38086231619) for source `b82c37c4` and [Node CI 38086852959](https://github.com/jappyjan/bobs-factory/actions/runs/38086852959) for documentation head `2673564a38202e258b20c2627eae7121e4e5d556` both passed Node 22 and Node 24. These results do not substitute for CI on a subsequent documentation commit. GitGuardian [check 114315123906](https://github.com/jappyjan/bobs-factory/runs/114315123906) failed with four generic high-entropy findings across 97 commits, zero annotations. Public output references incidents `38083768`/`38084076` in historical F1 maintenance receipts; private dashboard disposition was unavailable. The coordinator’s code audit identifies all four historical findings as capacity UUID fixture identifiers rather than credentials. The private dashboard incidents remain undisposed; operator disposition remains a gate.

## Verified historical candidate run

The exact frozen source/tooling was `1fa3ba1ba19a8ea79ad3994a45af19f56a5fad32` (`1fa3ba1b`), version `1.0.0-nightly.20261010.15`, committed package version `1.0.0-beta`, candidate digest `d053b7c2993931d93c88754fe7922e3c3c0352f2cb3bb18201584d2a7b2dea7f`, Bun `1.4.2`, Node `24.18.0`, four targets. [Run 38085071118](https://github.com/jappyjan/bobs-factory/actions/runs/38085071118) completed successfully, attempt 1, with all four binary and all four desktop jobs successful. The run source and tooling were both `1fa3ba1b`; the current PR head is newer.

Every binary archive was downloaded from its matching artifact and its actual byte count and SHA-256 matched the target manifest. Desktop jobs reused those exact archives. Each delivered DMG, AppImage, DEB or complete-app update archive was downloaded outside the checkout; its actual size and SHA-256 matched `desktop-build.json`. The target runtime archive inside each desktop artifact also matched the binary archive byte for byte. No binary or installer package is committed.

| Target | Binary artifact / archive (bytes; SHA-256) | Desktop artifact / delivered assets (bytes; SHA-256) |
| --- | --- | --- |
| `darwin-arm64` | [artifact 11682705327](https://github.com/jappyjan/bobs-factory/actions/runs/38085071118/artifacts/11682705327), 65,829,871-byte artifact; runtime `32,587,788`, `54bc4f6f4fc758da2e63c289b8426613aa312f5c0632b2e94c629eb5a03947d5` | [artifact 11681761848](https://github.com/jappyjan/bobs-factory/actions/runs/38085071118/artifacts/11681761848), 369,530,465-byte artifact; DMG `166,726,620`, `3184aa7150831a76a3c9a9fb3e06ee41012e07507d5e15990d4db0fa8a909985`; update archive `170,975,817`, `c28f410e098490b84160d56f7621873620d78533d04d1c362a5be0c57adb907c` |
| `darwin-x64` | [artifact 11681681882](https://github.com/jappyjan/bobs-factory/actions/runs/38085071118/artifacts/11681681882), 70,190,988-byte artifact; runtime `35,002,336`, `f130c66f7f2ac4c39ee7bf8f1ce3fc02945f3e1591bce24ad44c405fbaca3867` | [artifact 11682461487](https://github.com/jappyjan/bobs-factory/actions/runs/38085071118/artifacts/11682461487), 382,514,850-byte artifact; DMG `172,850,583`, `84a34e5e4d53d48afcc8fe25e856fe1077070022fa97e40fa32efc7d6a82defb`; update archive `175,415,023`, `9d06f4a8841d8514d34e69e4aef49473d5eecdb2e6f3ddca50800d924f37ad9d` |
| `linux-x64` | [artifact 11682520582](https://github.com/jappyjan/bobs-factory/actions/runs/38085071118/artifacts/11682520582), 86,717,407-byte artifact; runtime `43,233,207`, `d00eda40ffda81550976ce8b7ed560cdcd2748d02f8dace6adcb366365470064` | [artifact 11682026688](https://github.com/jappyjan/bobs-factory/actions/runs/38085071118/artifacts/11682026688), 352,342,379-byte artifact; AppImage `173,057,129`, `d7a977f8cd8969a60970a70f2818a7c5bdeaaa0d54d1a100ef0675060a29b31f`; DEB `136,880,060`, `0c322a22d29f57d2dfacb9653061dbbd2031b1b10bfdf77a9ab2ed6164988a29` |
| `linux-arm64` | [artifact 11681876339](https://github.com/jappyjan/bobs-factory/actions/runs/38085071118/artifacts/11681876339), 87,208,554-byte artifact; runtime `43,213,483`, `4451d8a0c39ed0d51c1b99409f3dc9d6cbd7180909fb2aa6bfa8c34b4dc69dd1` | [artifact 11682820563](https://github.com/jappyjan/bobs-factory/actions/runs/38085071118/artifacts/11682820563), 346,583,638-byte artifact; AppImage `174,324,258`, `a26aa60e78b3d1832bc05a2293e7da53cd04868859beb0923a5c9e90395c1a54`; DEB `129,930,920`, `8adeb0cae2343d5437bec908a9083de35c67e75d6241deba6acc21abc1dbbd43` |

Artifact-container SHA-256 digests, artifact creation times, exact job IDs/URLs, executable and resource hashes, per-file raw receipt hashes, platform versions, license inventory and the full asset verification results are in the [artifact index](evidence/taskbot116-final-native/artifact-index.json). GitHub run/job/artifact API responses are retained as `.json.raw` alongside it. Binary and desktop receipt bytes are preserved by target under [the evidence directory](evidence/taskbot116-final-native/). Linux Electron receipt stdout contains DBus error lines before its JSON receipt; the raw file is retained unchanged instead of being rewritten as valid JSON.

## What these native jobs prove

- Each binary job passed native startup, dashboard/assets, protected API, scoped MCP, shutdown/restart, controlled public-installer behavior, native helper checks and prepared-agent protocol boundaries. Manifests, `build.json` and receipts bind each target's archive/executable to `1fa3ba1b`, the same candidate digest and a clean build. Prepared agent coverage used mocked/synthetic adapters, no authenticated provider inference; Gemini records one skipped test.
- Native helper receipts report macOS 15.7.9 (Apple M1 virtual and Intel runner) and Ubuntu 24.04.5/glibc 2.39 (x64 and arm64). Factory `LICENSE`, `NOTICE` and per-target `THIRD_PARTY_NOTICES.txt` size/hashes are indexed. Desktop metadata records Electron 44.7.0, `LICENSE` SHA-256 `5154e165bd6c2cc0cfbcd8916498c7abab0497923bafcd5cb07673fe8480087d` (1,096 bytes), and `LICENSES.chromium.html` SHA-256 `3375e2a9bd7bc631738fde10be6548a76efe8cf5e4b8826b8140ba8b0c4d6353` (20,115,518 bytes). These are recorded build-time notice checks, not the missing full source/relink license review.
- All four desktop jobs passed app packaging, service ownership and Electron lifecycle/virtual-auth checks. The receipt records close-window worker retention, same-PID reopen, explicit Stop and stop-vs-maintenance race rejection. It explicitly says native credentials were not tested. Both Mac outputs are unsigned; no signed/notarized macOS activation or rollback was run.
- Linux x64 and arm64 ran the actual complete-AppImage upgrade and failed-health rollback. Both cleanup receipts say `passed: true`, list no surviving fixture PIDs and bind the candidate version/digest/source. Assertions include active-lease deferral, external Electron helper entry/exit, candidate health identity, same worker PID/nonce, waiting checkpoint byte preservation, candidate stop before rollback and suppression of a failed candidate. Linux Electron output also carries the DBus errors described above; workflow/job and embedded receipt report passed, but the warnings remain visible evidence.

These are successful jobs and bound artifact checks for their exact historical candidate. The unsigned desktop metadata still states `native install/auth/lifecycle receipts required`; these jobs do not constitute signed release readiness.

## Taskbot 116 child acceptance snapshot

Acceptance descriptions were reread from Taskbot #116 and all children on 2026-10-10. Parent #116 remains `in_progress`; statuses below are unchanged. Implementation evidence does not close the following remaining acceptance.

| Child | Status | Actual evidence | Remaining acceptance |
| --- | --- | --- | --- |
| [#117](https://taskbot.apps.janjaap.de/p/bobs-factory/t/117) stable/nightly publication | `done` | Frozen identity and all four native artifact pairs passed; publication mechanism independently reviewed. | Genuine publisher pin, protected signing, complete source/relink/licensing receipt and authorized six-hour nightly rollout/stable promotion; demonstrate public complete-target discovery and failed-publication recovery. |
| [#118](https://taskbot.apps.janjaap.de/p/bobs-factory/t/118) verified installer/bootstrap | `in_review` | Four native controlled-download installer receipts passed integrity, identity, repeat-install, removal/state and ownership guards. | Genuinely trusted published stable/nightly bootstrap on clean supported-minimum hosts; unavailable/offline/interrupted staging and saved-policy handoff across upgrades with host prerequisites/credentials intact. |
| [#119](https://taskbot.apps.janjaap.de/p/bobs-factory/t/119) safe update/restart/recovery | `in_progress` | Combined mock runtime/drain/recovery evidence and both actual Linux shell-upgrade/failed-health rollback receipts passed. Shell replacement kept the worker unchanged. | Authentically signed runtime replacement with real provider/native conversation continuation, interruption/reboot recovery and remote-instance isolation; preserve config, accepted results, drafts, waiting gates and native stores under supported ownership. |
| [#120](https://taskbot.apps.janjaap.de/p/bobs-factory/t/120) nightly subscription/update policy | `in_progress` | Controlled defaults, both overrides, pause/pin, queued-consent reconciliation and independent shell/backend policy evidence passed. | Published install → subscribe → later nightly automatic-idle update and stable manual/override flows; offline/coalescing, durable settings across entry points, pause/pin and safe compatibility-checked stable return on real installations. |
| [#121](https://taskbot.apps.janjaap.de/p/bobs-factory/t/121) native desktop | `in_progress` | Four unsigned packaged targets; Electron CDP virtual enrollment/login/logout, close/reopen same worker and explicit Stop passed. Linux AppImage update/rollback passed under test trust. | Signed/notarized macOS DMG drag/open and first-launch onboarding; genuine signed app activation/rollback; physical passkeys/native credentials, local/remote attachment and real provider continuation; acceptance against the selected macOS 15 / Ubuntu 24.04-glibc 2.39 ARM64+x64 matrix and mismatch behavior. |
| [#122](https://taskbot.apps.janjaap.de/p/bobs-factory/t/122) headless/service delivery | `in_progress` | Native disposable user-service ownership receipts and controlled protected remote/API lifecycle evidence passed; backend does not depend on a desktop window. | Real or isolated headless host, same-user service restart/reboot and real credential/provider access; separate second-machine UI acceptance coordinates with #84; connection loss, busy/idle runtime updates and native continuation under actual launchd/systemd constraints. |
| [#123](https://taskbot.apps.janjaap.de/p/bobs-factory/t/123) installation entry points | `in_review` | DMG, AppImage, DEB and Mac complete-app archive hashes verified; controlled trial/recipe and ownership checks passed. | Choose/verify Homebrew tap or catalog, AUR maintainers and Bob-owned minimal npm launcher identity; publish only genuine signed eligible assets, then clean-machine install/trial/open/upgrade/remove and ownership-conflict acceptance for each advertised entry point. Upstream monorepo npm remains retired. |
| [#124](https://taskbot.apps.janjaap.de/p/bobs-factory/t/124) startup/service lifecycle | `in_progress` | Disposable install/status/start/stop/restart/remove, close/reopen and Stop-versus-maintenance receipts passed. | Isolated login/reboot/logout/lingering, enable/disable, crash/backoff and interrupted-setup acceptance; deliberate PM2/manual/Nix adoption/migration without duplicate workers; workflow/native-session/waiting-gate recovery. macOS GUI LaunchAgent does not prove pre-login keychain access. |

## Outstanding release and operator gates

- Exact pinned WebKit source and the four `.21` candidate-to-upstream-runtime byte relationships are now independently reviewed clear for their concrete research claims; prior HTTP 422 attempts remain historical evidence. The [compact source-proof record](evidence/taskbot116-source-proof/README.md) binds the evidence and records its limits. All four genuine native object/config/toolchain/link-response inputs and actual relink logs, complete dependency/license review, and an independent candidate-bound `licensingAndSource` receipt remain **UNASSEMBLED**. No actual linker or signing invocation is claimed. Packaged notices and successful native jobs do not supply this receipt or full-payload release approval.
- Genuine publisher trust pin, protected signing and explicit nightly/stable rollout approval. The legacy [`v1.0.0-beta` prerelease](https://github.com/jappyjan/bobs-factory/releases/tag/v1.0.0-beta) exists; **new stable/nightly/native-desktop channels and catalogs have not been activated**. Candidate version/tag fields are preparation identity, not evidence of a published release. No new public tag/channel/installer/package was created by this work.
- Apple signing/notarization and authentic signed Mac install/activation/rollback; physical passkeys/native credentials, real or isolated headless host acceptance (Taskbot #122), separate second-machine UI acceptance (#84), real provider/native continuation, supported minimum macOS/glibc/CPU acceptance and login/reboot/logout/lingering proofs.
- Homebrew/AUR catalog ownership, minimal Bob-owned npm package identity/owner and public entry-point activation with clean-machine lifecycle receipts. Existing private/upstream monorepo npm publication stays retired.
- Operator GitGuardian incident disposition for check `114315123906`; four findings/97 commits, zero annotations, no private disposition. Historical evidence is preserved rather than edited to hide findings.
- Coordinator independent review of the final documentation/raw-evidence commit and any resulting CI status. No approval or missing acceptance receipt is fabricated.

The preceding 2026-10-10 assembly changed only documentation and compact evidence. Direct JSON/provenance/link/hash checks and normal commit hooks verify this delta; no new tests, native builds/drives, historical signed23 replay, signing, publishing, catalogs, production homes/services, merge or ticket closure were performed by that assembly. The native and F1 receipts above remain tied to their actual tested source and scope.

## Isolated service acceptance follow-up (2026-10-11)

Taskbot #122 permits a real **or isolated** headless host. Its core service work
is independent of #84's second-machine UI acceptance; a second physical machine
is not a prerequisite for every #122 criterion. Reboot and genuine provider
continuation remain unproved.

The new [bounded Linux acceptance workflow](../../.github/workflows/isolated-service-acceptance.yml)
and [ownership/handoff procedure](acceptance/README.md) reuse the frozen `.21`
Linux x64 artifact. They test actual foreground/external systemd processes,
interrupted setup, native crash/backoff/burst limits, enrollment and maintenance.
PM2/Nix definitions and native/waiting markers are explicitly synthetic fixtures.
The workflow is reviewable preparation, not an executed Linux PASS. No supported
minimum-platform compatibility is inferred beyond the observed runner versions. No production payload changed.

Product audit: automatic arbitrary PM2/manual/Nix adoption is unsupported; active
owners and target-definition conflicts are refused. Dormant arbitrary external
startup must be inventoried and disabled by its owner with explicit consent. Nix
remains declaratively owned. Native crash limit exhaustion requires deliberate
`systemctl --user reset-failed` before CLI start/restart; the CLI does not reset it.
These limits are documented rather than represented as completed real takeover.

Local validation: CLI build passed; all 183 existing CLI tests passed (18 files),
including service/lock cases. JavaScript syntax, Biome and refusal outside GitHub
Actions passed. F1 is not applicable to this CI/native-acceptance tooling and
manual procedure delta: no product runtime or F1 harness behavior changed.
All historical101, prior53 and source-b82 raw56 evidence files remain unchanged.
CI results and the new receipt require coordinator review when the run completes.


## Service correction and failed evidence (2026-10-11)

Run [38132078627](https://github.com/jappyjan/bobs-factory/actions/runs/38132078627),
job 114448312709, at harness f48 failed the repeated-crash assertion after observing
11178 ms first-crash recovery. Exhaustion, maintenance, resume, removal and retained
state assertions did not complete. Its actual receipt says `passed:false`,
`cleanup:true`, `survivors:[]`; it is not Linux acceptance PASS. The receipt, ZIP and
job log are preserved byte-for-byte in the separate
[correction evidence folder](evidence/2026-10-11-service-correction/README.md).

The correction keeps the same crash assertions and bounds. It signals the exact
fixture unit's main process through systemd, captures actual unit properties,
bounded journal and matching process/cgroup details before teardown, and uses
one cancellation-aware cleanup/final-receipt path. SIGINT/SIGTERM actual fixture
checks require nonpassing receipts and complete cleanup. A production cause is
not established by the old receipt; the diagnostic run is pending. The frozen
runtime remains b82 / candidate `.21`; the new harness SHA is separate. No PASS
or resolution of the crash finding is claimed before actual diagnostics and all
acceptance/cleanup assertions are reviewed.

The first-release matrix is now chosen: macOS 15, Ubuntu 24.04/glibc 2.39,
ARM64+x64. Native observations remain macOS 15.7.9 and Ubuntu 24.04.5. No macOS
15.0 or universal Linux kernel coverage is asserted. Signing, physical passkeys,
native credentials/providers, reboot/login/logout/lingering, actual native relink
and independent licensing/catalog ownership remain open. Static source/runtime byte
correspondence is proved; it does not establish installable or trusted signatures.
GitGuardian
f48 check 114448313898 references the historical capacity-lease UUID findings;
incidents 38083768/38084076 remain undisposed in the operator dashboard.


## Round 2 service failure and correction context (2026-10-11)

Round 2 is **NOT CLEAR** at `c3cc8644ac34c53b185e6b8598966fcf366497ca`,
reviewed against `f48c51ca9352cbd6caa29b3a3b70882046bfc1ce` and cumulatively
`97acf7ba6e00c81a480cd2f8d01c519ea2cf5f05`. Actual failed
[run38132934881/job114450836918](https://github.com/jappyjan/bobs-factory/actions/runs/38132934881/job/114450836918)
and its ZIP, both receipts and all properties/journal/process diagnostics are
[byte-preserved separately](evidence/2026-10-11-service-round2-failure/README.md).
The main receipt failed observation of exhausted native start limits while cleanup
passed; SIGINT cleanup failed and SIGTERM never ran. Later main assertions remained
unexecuted. The latest correction is implementation pending independent review and
actual owned CI receipts, not acceptance PASS.

- P1 cause: systemd v255 preserves `Result=signal` after start-limit rejection.
  The exact worker journal and failed/no-PID/NRestarts=4 properties establish the
  harness predicate error. Updater activity belongs to a separate unit; the earlier
  blocking-descendant hypothesis is unsupported by these diagnostics. The fix
  requires a fresh exact-unit JSON journal rejection, known StartLimit properties,
  failed/inactive terminal state, no main/control PID or queued job, and stable
  NRestarts for more than RestartSec. Arbitrary signal failures cannot satisfy it.
  Original 45-second crash waits and full maintenance/resume/remove/retention
  assertions remain; no production defect or runtime correction is established.
- P2 cleanup cause: force kill of an already-inactive external fixture raised an
  unloaded error; reloading its retained definition did not mean a live process.
  Cleanup now checks exact definition bytes and independently terminal state,
  skips unnecessary force kill, replaces queued start/restart jobs with an exact
  stop, and confirms no PID/job. Genuine manager/ownership errors remain failures.
- P2 cancellation gaps: both exact worker/updater identities and their expected
  frozen definition bytes are registered before initial installation. CLI/manager
  processes use private groups; cancellation, timeout and leader exit drain their
  inherited descendants before cleanup, including closed-pipe asynchronous manager
  mutations. No host process group or manager-wide shutdown is used. Six independent
  native CI cases interrupt initial install, an actual manager start submission,
  and healthy units with both SIGINT and SIGTERM. A prior case failure cannot skip
  another receipt. Every cancellation remains nonpassing until verified cleanup.
- P2 crash PID: the round 2 CLEAR exact-unit main-process signaling is retained;
  no retained owner PID is used to inject crashes.

Local focused verification: eleven meaningful tests cover both real signals/repeated
signals, combined work/cleanup errors, the preserved-result exhaustion predicate,
wrong-unit/arbitrary failure rejection, inactive unloaded definitions, queued-job
reconciliation, genuine permission/ownership failures, and late descendant mutation
on cancellation and leader exit. JavaScript syntax, scoped Biome, YAML parsing,
non-runner refusal and preservation checks are recorded in PR91. Normal commit
hooks remain required. F1 is not applicable to this tooling/docs-only change.
Actual CI and its separate harnessSha/script hashes still require review. All
101 historical +53 prior-candidate +56 source-b82 raw files and prior f48/c3 failed
evidence are preserved; no native rebuild/full matrix or signed23 replay is used.

## Round 3 independent service status (2026-10-11)

The independent round 3 terminal result reports the main native acceptance as
`CLEAR`/`PASS` and four cancellation cases as `PASS`. Two cancellation cases remain
P2 failures: stdout-drop handling and outer-timeout handling with nested process
groups. The complete six-case cancellation set is therefore not passing. These
results do not establish a production service defect, do not replace the retained
round 2 failure artifacts, and do not alter the source-proof review scope. The
assigned round 4 service fix is isolated from this PR #91 documentation/evidence
checkout; its code and CI results remain separate pending work.

Coordinator handoff retains the original scope: #122 real **or isolated** host
acceptance, #84 second-machine UI separate, explicit manual PM2/Nix ownership,
synthetic checkpoint/waiting-gate preservation, and the selected macOS15 /
Ubuntu24.04-glibc2.39 ARM64+x64 minimums with observed limits. Reboot/login/logout/
lingering, native providers/credentials, physical authentication, protected signing/
publication/catalog ownership and complete minimum-platform acceptance remain open.
Full WebKit acquisition and candidate-to-runtime byte binding are now complete and
independently reviewed clear for the concrete source claims. Static runtime
correspondence does not establish native relink success, trusted/installable Mac
signatures, complete dependency licensing review or a candidate-bound
licensingAndSource receipt.
The latest supplied GitGuardian count is **two** undisposed historical mock UUID
occurrences, incidents38083768/38084076; historical four-occurrence reports above
remain historical, not a current clearance. Parent/child statuses remain unchanged.


## Round 4 implementation response (2026-10-11; native CI pending)

The harness fixes are integrated after the source-retention commit
`d5cde18eab21c01c23b90c4e118d6922094c720d`. Production runtime remains frozen at
`b82c37c4fb9a3e18d1cb222c6d56d3fef852096f`, `.21` candidate digest
`ca323a599f606523965d996ff871eeee784d7f5a419ce9158675077b3e4e43ec`.
This is the Taskbot #116/#122/#124 per-finding implementation response, not ticket
closure or an independent round 4 clearance.

- Service P2 nonzero-exit stdout: the actual manager wrapper now preserves stdout,
  stderr and exit status. `disabled`/exit 1 remains visible to the unchanged native
  state assertion. Safe wrapper subprocess checks reach the actual gated START
  descendant for both signal cases and reject delayed fork mutation. CI must still
  prove the real systemd START boundary for both SIGINT and SIGTERM.
- Service P2 outer timeout: a private registry is created before fixture launch;
  held group leaders wait for registration before target code and prevent PID reuse.
  Outer timeout persists FAIL before cooperative SIGTERM, then permits a bounded
  30-second cleanup grace. Escalation closes the gate, drains registered nested
  groups after reparenting, and reconciles only preregistered exact unit/jobs after
  definition-byte checks. Unknown survivors or changed identities cannot claim
  clean. Primary timeout, work and cleanup errors are preserved. All six signal
  cases still run independently; a seventh real outer-timeout case is armed at
  START and added to the same owned Linux CI workflow.
- Source-retention P1 raw-storage CI: all 27 original JSON copies and the original
  review module now use `.raw` extensions with unchanged bytes/hashes. The original
  research index/report and external archives are unchanged; the maintained
  retention mapping, README and checksum inventory explain the new paths. No
  global Biome file-size increase or broad lint exclusion was added.
- Source-retention P2 archive path: the source-materials guide now points precisely
  to Bun/TinyCC in the durable `source-inputs/official-pinned-sources/` directory
  and WebKit directly in `source-inputs/`, with the retained sizes and hashes.

Nineteen meaningful local subprocess/protocol tests and acceptance-module syntax
checks pass. `pnpm biome ci` passes with 19 existing warnings. The focused code commit passed normal lint-staged, workspace build and typecheck
hooks; the documentation/storage commit retains the same required checks. F1 is not applicable to this acceptance
harness, raw-storage and documentation change. Fresh Node 22 and Node 24 CI jobs
and native main/seven-case receipts remain pending; the earlier Node 22 job failed
at Biome and the Node 24 job was cancelled by fail-fast, not 24 cancelled test cases.

[Round 3 run/artifact evidence](evidence/2026-10-11-service-round3-failure/README.md)
is retained separately: main success applies only to `db93374e`, four signal cases
passed, two manager-mutation cases failed before interruption, and the complete
six-case matrix failed. Its ZIP and all seven receipt hashes are unchanged; no
round 4 result reuses that PASS. Historical 101+53+56 raw files, f48/c3 failure
artifacts and the d5 source-proof immutable research copies remain preserved.
All previously listed native/provider/signing/licensing/minimum-host gates remain
open. GitGuardian's two historical mock UUID incidents remain undisposed.
