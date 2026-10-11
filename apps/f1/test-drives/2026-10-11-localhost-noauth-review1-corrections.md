# PR99 review-one corrections and ASAR integration

Date: 2026-10-11. Taskbot [116](https://taskbot.apps.janjaap.de/p/bobs-factory/t/116) /
[121](https://taskbot.apps.janjaap.de/p/bobs-factory/t/121). Draft [PR99](https://github.com/jappyjan/bobs-factory/pull/99).

Original review head: `05a2c7d314c6b1afa62905e6e8026d331f2d82e5`, base
`8deb7e7704bb6cf75d3dca757dc917ea8f23ff23`. Original commits and reports remain
preserved; local ref `archive/pr99-review1-05a2` retains the original history.
The original [browser/F1 report](2026-10-11-localhost-noauth.md) and every asset
remain byte-identical. Those receipts describe their original source, not this
corrected implementation.

New base: `c7caa8ecbd0a235f33eb163d48348b21c489c54d` (reviewed ASAR PR98 merge).
Tested corrected implementation: `f713ee75f80bae096227cf4f7caa6abb6ab6e3e8`.
The later commit adds only this report and raw evidence. Root owns fresh
independent Standards/Spec review, CI monitoring and merge; original reviewers
were not asked to review a moving target.

## Original independent reports and responses

The original [Standards report](assets/2026-10-11-localhost-noauth-corrections/standards-review-05a2.md.raw)
is retained exactly, SHA-256
`00d848083da60e3de433626ff2a338030ebd70e7e7393a43544da833fc800c3d`.
It found two P2 issues and no P1.

| Finding | Correction | Evidence |
| --- | --- | --- |
| P2: IPv6 setup visibility/read/save rejected despite authenticated local status | Both configuration visibility and onboarding handlers now reuse `localFor(request)`, which already validates socket peer and HTTP loopback authority. Remote setup restrictions remain. | New actual-socket IPv4/localhost/IPv6 regression was red against the original FactoryServer bytes: IPv6 configuration omitted setup and setup read/project/GitHub returned 409. It is green after correction, with no auth credentials or sessions, and a public Host on the real IPv6 socket remains 401. |
| P2: contradictory live capability paragraph still required localhost passkeys | Correct the complete exported capability reference, including local startup, dashboard local/remote access and Settings wording. Correct migration access instructions too. | The hardcoded complete expected routing prompt was updated to match the maintained contract; `.expectUserPrompt()` and `.verify()` still assert the whole prompt. All nine prompt-assembly files pass. Current owned docs/prompts/skills contain none of the obsolete every-address or local-enrollment instructions searched. |

The original [Spec report](assets/2026-10-11-localhost-noauth-corrections/spec-review-05a2.md.raw)
is retained exactly, SHA-256
`833be6d4d97558f34a32c19e2bfdf3f6e4abc13dd7abfa8fef615c07b1fd15b0`.
It was CLEAR on its pinned source, with 47 existing plus three targeted tests and
88 foreign-origin/metadata requests. That result does not waive the Standards
findings or certify this new head; root's new round reassesses both axes against
the complete original brief.

## CI regression and conflict resolution

The exact failed [Node22 CI log](assets/2026-10-11-localhost-noauth-corrections/ci38174355068-failed.log.raw)
from [38174355068](https://github.com/jappyjan/bobs-factory/actions/runs/38174355068)
has three failed files, not just the reported prompt assertion: routing context,
local onboarding denial, and local video-media denial. The Node24 dependent job
was cancelled. The full prompt mismatch reproduced locally before correction
([red log](assets/2026-10-11-localhost-noauth-corrections/routing-red.log.raw)).

Onboarding assertions now distinguish local access without enrollment from remote
unauthenticated denial and authenticated remote machine-setup refusal. Its local
mutation tests still demand exact Origin and the custom request header. The
video test now uses the real server with an explicitly configured remote origin:
remote GET/HEAD for media, poster and captions stay 401/no-store, while local
bytes/ranges work without a fixture session. Stale/replaced/missing media checks
remain. The obsolete local logout-to-401 expectation was removed; existing real
remote logout/expiry/recovery tests still protect remote session revocation.

The new [IPv6 regression red log](assets/2026-10-11-localhost-noauth-corrections/ipv6-onboarding-red.log.raw)
shows all three local setup endpoints returning 409 and missing configuration on
IPv6 before the production correction. No partial prompt assertions were added.

Both replayed commits conflicted only in `CHANGELOG.md` at the same Unreleased
insertion. Resolution retained the exact ASAR PR98 entry and the localhost PR99
entry/link; no ASAR implementation or fixture changes were made. The
[integration receipt](assets/2026-10-11-localhost-noauth-corrections/integration.json.raw)
hashes all 32 non-changelog paths added/changed by PR98 and confirms they are
byte-identical to main, including the physical-filesystem adapter, helper closure,
ASAR tests, atomic shell fixture and historical native evidence.

## Fresh validation

```sh
PATH="/tmp/localhost121-media-tools/bin:$PATH" pnpm --filter bobs-factory-edge-worker test:run prompt-assembly test/FactoryOnboarding.test.ts test/Video.test.ts test/FactoryAccess.test.ts test/FactoryAuth.test.ts test/FactoryWebClient.test.ts test/FactoryServer.test.ts test/FactoryServer.update-startup.test.ts
PATH="/tmp/localhost121-media-tools/bin:$PATH" pnpm --filter bobs-factory-edge-worker test:run
pnpm --filter bobs-factory test:run src/local.test.ts
pnpm --filter bobs-factory-desktop test:run
F1_AGENT_MODE=mock bun run apps/f1/test-drives/assets/localhost-noauth.ts
```

- [Focused green](assets/2026-10-11-localhost-noauth-corrections/focused-green.log.raw):
  16 files / 116 tests passed, covering all full-prompt fixtures and relevant auth,
  onboarding, media, client, listener and startup behavior.
- [Broader EdgeWorker suite](assets/2026-10-11-localhost-noauth-corrections/edge-all-green.log.raw):
  147 files passed; 1,929 tests passed and one existing test skipped.
- [CLI launch](assets/2026-10-11-localhost-noauth-corrections/cli-green.log.raw): 7 passed.
- [Desktop](assets/2026-10-11-localhost-noauth-corrections/desktop-green.log.raw):
  34 passed, one ASAR test skipped because this checkout has no materialized Electron
  binary. The ASAR owner's real pinned-Electron evidence remains intact; no new
  native acceptance is inferred from the skipped check.
- [Normal code hooks](assets/2026-10-11-localhost-noauth-corrections/code-hooks.log.raw):
  Biome, full monorepo build and typecheck passed. Migration skill quick validation
  passed. Local test runtime was Node24.20.0; these are not new Node22 CI results.

The initial local media reproduction lacked `ffmpeg` and `ffprobe`, unlike CI.
That [failed setup log](assets/2026-10-11-localhost-noauth-corrections/media-tools-missing.log.raw)
is retained. Static tools were installed only under `/tmp/localhost121-media-tools`
and exposed through per-command PATH. No global install, dependency/lockfile
change or weakened media assertion was used.

## Relevant F1 applicability and results

F1 applies to the corrected authentication/onboarding workflow and the maintained
fixture's functional extension. The existing isolated mock/script drive now
asserts setup visibility/read over all three local authorities and completes the
actual project-onboarding mutation over `::1`.

Fresh [log](assets/2026-10-11-localhost-noauth-corrections/f1.log.raw) and
[source-bound receipt](assets/2026-10-11-localhost-noauth-corrections/f1-result.json.raw)
at corrected commit `f713ee75f80bae096227cf4f7caa6abb6ab6e3e8` record seven
passed assertions and exit 0: actual loopback APIs/setup without enrollment,
actual IPv6 project save, real EdgeWorker worktree and completed script,
foreign-origin/forwarded-request rejection, real Host-preserving TLS proxy remote
software-WebAuthn enrollment/login/logout, and token-free local SSE retained
across remote enrollment. All twelve runtime/fixture fingerprints match the
tested source. Owned listeners and worker stopped; disposable fixture retained.

This drive uses mocks, prepared-tool stubs, a script, software authenticator and
self-signed TLS. It does not repeat the original eight-check browser hold drive
or establish packaged-native, physical authenticator or minimum-platform proof.
The original external-browser rejection captures remain historical evidence.
Public proxies must preserve configured Host/Origin; a raw forward that strips
every forwarding signal and rewrites Host to localhost is still indistinguishable
from a local client and is unsupported. No production state/credentials/providers,
service/tunnel changes, native candidate mutation, build dispatch, release,
publication, global install, merge or status closure occurred. Old 6f/c061 and
the separate Mac helper acceptance evidence remain unchanged.
