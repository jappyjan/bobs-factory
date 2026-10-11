# Desktop ASAR fingerprint and retained-helper test drive

Date: 2026-10-11. PR [#98](https://github.com/jappyjan/bobs-factory/pull/98), Taskbot [116](https://taskbot.apps.janjaap.de/p/bobs-factory/t/116), [121](https://taskbot.apps.janjaap.de/p/bobs-factory/t/121), [119](https://taskbot.apps.janjaap.de/p/bobs-factory/t/119).

Base: `8deb7e7704bb6cf75d3dca757dc917ea8f23ff23`. Physical app implementation: `55fea26ee0b30f96f54fedc62371853bc4d1ae99`. Atomic scripted F1 receipts: `d08ff116f76b6c51f39b87bc4bf43a753ad9c2cc`. Final evidence/changelog commit adds no runtime behavior.

## Applicability and assertions

Desktop update ownership, complete-app activation and recovery change, so the maintained shell lifecycle F1 drive is applicable. Expected: active leases defer activation; candidate identity and full physical app bytes/type/mode match published metadata; UI replacement retains the native worker and waiting checkpoint bytes; interrupted/failed replacements retain ownership checks and recover. Mock F1 uses real protected FactoryServer, WorkflowRuntime, UpdateDrain and leases with scripted UI processes. It cannot prove Electron's Mac ASAR path. Actual Mac checks below are separate.

## Reproduction and correction

The unchanged old packaged app's `Contents/Resources/app.asar` is a physical file, 41,739,706 bytes, mode `0644`, SHA256 `e90ee5abfdd969ba6d6486a034e0497bf0c1869efcd390b359227d522143997d`. System Node24.20 fingerprints the full app as `c5d07506f7beebe69490b71fad770527ca8ee219259e87beb65e9b32991d4d26`. Actual Electron44.7.0/Node24.21's patched node:fs instead sees a directory/size0, yielding `e6abea3221922d310e6375341a13b588a2be735ccbdcec7d64ea5058ba62ae8d`. Baseline read-only reproduction and focused failing regression are retained in assets.

The updater now uses Electron's documented [original-fs](https://www.electronjs.org/docs/latest/tutorial/asar-archives#treating-an-asar-archive-as-a-normal-file) for physical inventory, archive reads/writes, recursive replacement copying, ownership, licenses and quarantine inspections. System Node keeps node:fs. The adapter is retained with the standalone helper (eight modules). Ordinary ASAR module loading remains enabled; process.noAsar is never toggled. Public inventory/proof/health/ownership checks retain their existing semantics.

Unchanged baseline and current full app inventories now agree between both runtimes with published fingerprints `c5d07506…` and `2dd4bb16cbe80e35a02e179b8e173fe2383466653d10be39286aaea5c622f25d`. Current physical ASAR: 41,741,728 bytes, mode0644, SHA256 `bc66de6bb46f5d6fd123b7d383745b97de3a942ac9b6a65af4df33603d590099`.

## Actual Mac helper acceptance

Host: macOS26.5.2 ARM64, pinned Electron44.7.0/Node24.21. Baseline packaged UI: source3b198/version38159155146. Native worker and candidate app: actual source6f40898469c9083dda4d74f37dc1c408718eaa67/version38169876374, candidate digestc061fe484df2aa34318b780a4247a21f674017c0029504e190d6ad72fb190966. Native/desktop runs38169876374/38170274459. No new native binary or packaged desktop build, download, dispatch, signing, production installation or publisher operation.

The actual retained helper's eight modules were copied outside the app. Seven match exact committed source `55fea26ee0b30f96f54fedc62371853bc4d1ae99`; `update-services.mjs` is byte-exact from the actual current packaged closure, SHA256 `219ccb41db28804240d70127ca561a465ae49a2052c6201abc942b965843389e`. An external observer captures real child stdio/exits; it does not replace the app, worker, helper lifecycle or health checks. Outer release transport/evidence are visibly simulated; the waiting agent checkpoint is completed mock data, with no provider request.

- `actual-update-fixed3`: actual complete transaction PASSED with an archive-unpacked baseline and absent quarantine. No artificial quarantine was injected or cleared. This proves Electron helper replacement/readiness independently of OS allowance and does not claim quarantined first-launch acceptance.
- `actual-update-fixed6`: actual complete transaction PASSED using the exact current6f app from `actual-update-fixed2` as a copy-only source. User allowance was independently observed changing that app's quarantine0083→00c3. Fresh copy and staged app carry that real attribute using maintained inheritAppQuarantine, with exact current fingerprint confirmed before copying. Candidate health and installation both verify; real00c3 persists. No synthetic OS approval, attribute removal or global security change.
- Both successful fixtures prove live-lease deferral, precise old UI quit, full physical replacement, genuine current packaged readiness, unchanged native worker PID/nonce, unchanged waiting checkpoint bytes, and exact current full fingerprint. All owned assessment processes and 18 listeners independently verified absent after cleanup.

Raw receipts, closure hashes, copy-only allowance observation, reproducible fixture/stdio observer and input/evidence inventory are in [assets](assets/2026-10-11-desktop-asar/final-evidence.json.raw). Large apps/archives, disposable homes and complete originals remain outside Git at `/Users/jappy/code/jappy/bobs-factory-delivery-materials-116/asar-fix-121-20261011`.

## Preserved failures and limits

Original owner's `test-preparation-pr96-20261011-195337/desktop-update-attempt2` and sealed release materials were read-only.

The first fixed helper passed full physical copying but candidate exited before readiness; genuine rollback and maintenance release were acknowledged. Second traced attempt stalled before Electron entry (`_dyld_start`,96KB footprint, empty stderr). Full bytes still matched, but OS quarantine/provenance made W_OK return EPERM, so ownership checks correctly preserved recovery-required. Later user0083→00c3 was observed after that terminal attempt; it does not retroactively pass the failure. Both attempts remain preserved. Two further fixture-only failures (checking hexadecimal quarantine as ASCII, and ditto rewriting copied metadata) occurred before helper activation; fresh fixtures corrected the test setup, with no product relaxation.

The maintained F1 wrapper exposed an existing truncated fixture-ui.json read during scripted process replacement. Generated UI/health fixture records now write a PID-specific temporary file and rename atomically. The failed log remains; fixed wrapper and fresh drive pass. No broad production launch or auth change.

This is MacARM source-helper validation on existing actual artifacts. A newly packaged candidate containing this correction, concurrent localhost/auth changes, other targets/minimum OS and public release acceptance still require coordinator-owned review/build/acceptance. No status closure or overall current release PASS.

## Commands and results

- Scoped `ELECTRON_RUN_AS_NODE=1` child environment for actual baseline readonly reproduction; old focused physical-tree regression failed as expected.
- `BOBS_FACTORY_TEST_ELECTRON=<actual pinned binary> BOBS_FACTORY_TEST_ASAR=<actual ASAR> node --test apps/desktop/test/*.test.mjs`:35/35 PASS, no skips. Expanded regression verifies physical bytes/type/mode0751, symlinks, raw copy/archive round trips, tampered-ASAR fingerprint change, and continued virtual package access. It auto-selects materialized pinned Electron for ordinary native checks; an unmaterialized ignore-scripts checkout explicitly skips that one test.
- `F1_AGENT_MODE=mock node apps/f1/test-drives/assets/desktop-shell-update.mjs`: five scoped lifecycle assertions PASS.
- `node --test scripts/tests/desktop-shell-drive.test.mjs`: PASS after atomic scripted record correction; historical failure retained.
- `node <owned>/actual-update-fixed3.mjs` and `node <owned>/actual-update-fixed6.mjs`: actual functional PASS within distinct scopes above.
- `node <owned>/final-evidence.mjs`: exact source/packaged closure hashes and independently empty owned process/listener inventory PASS.
- Normal Husky commits: Biome/lint-staged, pnpm build and pnpm typecheck PASS. Initial checkout lacked generated Husky wrappers after ignore-scripts install; wrappers were initialized and the source commit amended through normal hooks before push. No hooks bypassed.
