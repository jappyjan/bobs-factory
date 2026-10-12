# Native dashboard validation correction

Date: 2026-10-11. Taskbot116/121, [PR100](https://github.com/jappyjan/bobs-factory/pull/100).
Tested implementation: `1c3c887fc84909ecde075a2e3fd0e70affe20d2c`.
Exact base: PR99 merge `599a67d12cb204de7e6c5387b83e6d05e28b659e`.
The final evidence/changelog commit leaves all five implementation hashes in
[bindings](assets/2026-10-11-native-dashboard-validation/bindings.json.raw) unchanged.

Functional native test-harness assertions changed, so relevant F1 applies. This
source-level drive tests the same shared shell and Electron assertions used by the
native workflows against the real FactoryServer, immutable built web shell,
LocalOnboarding and WorkflowRuntime. No agent is invoked. Its desktop IPC handler
is controlled fixture code; the actual packaged worker/menu lifecycle is a later
candidate gate.

Reproduce after the ordinary frozen dependency/source build:

```sh
F1_AGENT_MODE=mock BOBS_FACTORY_TEST_ELECTRON=/absolute/retained/Electron \
  node apps/f1/test-drives/assets/native-dashboard-validation.mjs
```

The executable is supplied explicitly, avoiding package-index auto-installation.
The tested GUI executable reported Electron44.7.0/Node24.21.0 and SHA-256
`6c7bfa625e72ad31e564b262c916aa6a9d5b88f570dea195dec52255e9c6305d`.
The unchanged retained official desktop executable separately used by the existing
physical-ASAR test reported the same versions, SHA-256
`b1efb41331bfc7631bd89250df9b276fd339aaccfada01bc4094d1e8909f8e31`.
Exact paths/version output are retained in [version evidence](assets/2026-10-11-native-dashboard-validation/electron-version-readonly.json.raw).

The [committed drive](assets/2026-10-11-native-dashboard-validation/f1-committed.json.raw)
passed with these observations:

- The old native assertion requires401; the actual unauthenticated direct-loopback
  `/api/config` returns200. The original check exits1, retained as
  [red evidence](assets/2026-10-11-native-dashboard-validation/original-stale401-red.json.raw).
- The maintained OS curl probes require local200 plus onboarding-required payload,
  `access: local`, authenticated authority and no setup requirement; public Host401
  with `FACTORY_AUTH_REQUIRED`; foreign Origin, cross-site and forwarded-local403.
- Actual Electron loads the built onboarding UI, finds `Choose your project`, and
  validates API200, protocol/runtime fields, no auth cookie, no local passkey/login
  prompt, no setup fragment, unavailable require/launcher bridge and the single
  scoped dashboard method. The production preload invokes a controlled IPC handler.
- Real local logout returns200/authenticated true; reload still satisfies the same
  positive local assertions. Public/foreign-origin denials remain checked separately.
  The source runtime honestly reports `packaged:false` and unknown commit/target;
  no packaged identity is synthesized.

Focused existing FactoryServer/FactoryAuth tests passed32/32; desktop passed35/35
with no skips, including the actual pinned Electron physical-ASAR test. Normal
commit hooks passed lint-staged/Biome, source build and typecheck. Shell and module
syntax checks and `git diff --check` passed. Production authentication, local access,
ASAR, runner and service implementation paths are unchanged from the exact base.

Workflow-driver audit: native helpers use controlled HTTPS/synthetic scoped GitHub
credentials; prepared-agent boundaries use synthetic SDK/mocked adapters; public
installer checks actual archives, wrong hash/size/source/manifest and retained state;
service smoke checks disposable GitHub user managers; packed trial tests assert the
native bootstrap; Linux shell update already expects local `/api/version` success.
None has a consequential stale local401/passkey requirement. The older manual
`run-native-acceptance.mjs` is explicitly pinned to historical `ed7bcaf` and is not
called by the current native workflows; its original evidence stays historical.
The prepared-release smoke consumer's terminal marker and Startup1/2 requirements
remain intact, now backed by separate local access and remote protections.

Three new fixture attempts failed before the passing source drive: the initial
stop method was incorrect; an inherited `ELECTRON_RUN_AS_NODE` prevented GUI access;
top-level ESM readiness waited until the bounded45s child timeout. All raw failures
remain separate in this directory. They are fixture setup failures, not passing
native lifecycle receipts.

An initial `require(existing electron package)` path lookup unexpectedly invoked
that package's auto-installer, printing `Downloading Electron binary...` and
materializing its dist/path.txt. Network transfer was not observed, so zero network
acquisition is not claimed. [Exact lookup output and path facts](assets/2026-10-11-native-dashboard-validation/electron-auto-installer.json.raw)
are retained; subsequent tests invoke explicit executable paths without requiring
the package index. Offline frozen dependencies reused732/downloaded0.

This is assertion-correction evidence only. Fresh four-target native binary smoke,
prepared agents/helpers, installer/trial counts, actual packaged desktop
ownership/Stop/maintenance checks, native Linux upgrade/rollback, quarantined Mac
first launch and complete app updates remain the coordinator's next frozen
candidate stage after independent review and merge. The old desktop diagnostic
receipt fails the real typed publication consumer because it lacks candidate-bound
fields; [the negative](assets/2026-10-11-native-dashboard-validation/typed-consumer-negative.json.raw)
is retained without relabeling. No candidate freeze, workflow dispatch, publication,
signing, production operation or Taskbot status change occurred.
