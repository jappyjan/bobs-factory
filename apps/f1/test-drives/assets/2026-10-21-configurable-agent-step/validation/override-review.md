# Ticket 136: bounded override review

Read-only review completed against current worktree HEAD `fdb38ec765a53f00ba71615c1e63089db1883bd0` and the historical base `a4990127`. No repository file, dependency, or lockfile was changed by this review. No install, registry resolution, or audit was run during it.

## Decision for the next single cleanup/install

Remove **`postcss`, `picomatch`, and `body-parser`** together, in addition to the already removed `ajv`, `hono`, and `@hono/node-server` overrides. Their installed original parent manifests permit the currently locked patched package identities; no remaining incompatible original constraint was found on those three packages.

This metadata result is a removal candidate decision, not a claim that semver compatibility proves a fresh upstream resolution. The parent will remove these three together, install once, compare the resolved graph, run `pnpm audit`, and run the required gates. Existing overrides outside the changed owners are classified below rather than inaccurately described as all still necessary.

## Changed owning dependencies examined

- MCP SDK: owning `packages/config-updater` and `packages/mcp-tools` change `^1.31.0` to `^1.32.1`. Natural shared resolution also updates the SDK used by `fastify-mcp` and the Claude SDK peer.
- Vitest, UI, and coverage: their existing workspace owners change 4.1.11 to 4.1.12.
- Vite: edge-worker now owns compatible peer `^8.3.5`; current resolved Vite is 8.3.5.
- Ajv: edge-worker now owns exact 8.20.0.

## Current graph identities, before cleanup

These are observations from the two lockfiles, not predicted results of the pending removal/install.

| Package | Base a4990127 | Current pre-cleanup |
| --- | --- | --- |
| MCP SDK | 1.31.0 | 1.32.1 |
| Vitest | 4.1.11 | 4.1.12 |
| Vite | 8.0.16 | 8.3.5 |
| Ajv | 8.20.0 | 8.20.0 |
| Hono | 4.13.11 | 4.13.13 |
| @hono/node-server | 2.1.3 | 2.1.5 |
| Picomatch | 4.0.4, 4.0.7 | 4.0.4, 4.0.7 |
| PostCSS | 8.5.29 | 8.5.31 |
| body-parser | 2.3.0 | 2.3.0 |
| semver | 5.7.2, 7.7.4, 7.8.5 | unchanged |
| esbuild | 0.28.1, 0.28.2 | unchanged |
| Undici | 8.11.2 | unchanged |

## Three removal candidates and complete parent evidence

### PostCSS override >=8.5.26

Only current locked consumer is `vite@8.3.5`. Its original package manifest requests **`^8.5.30`**, which itself excludes versions below the existing patched override floor. It resolves to **8.5.31**. This is a definite redundancy introduced by the owning Vite bump.

### Picomatch override >=4.0.4

All locked parent manifests permit their current patched resolution:

| Parent | Original range | Locked result |
| --- | --- | --- |
| vitest 4.1.12 | ^4.0.3 | 4.0.7 |
| vite 8.3.5 | ^4.0.7 | 4.0.7 |
| tinyglobby 0.2.17 | ^4.0.4 | 4.0.7 |
| fdir 6.5.0 (peer) | ^3 or ^4 | 4.0.7 |
| lint-staged 16.4.0 (unchanged root owner) | ^4.0.3 | 4.0.4 |

The old lower floor in Vitest/lint-staged permits 4.0.3, but it does **not** prove an override is required to obtain the current patched 4.0.4/4.0.7 resolution. No incompatible original range remains. Remove and verify the natural graph, rather than claiming every parent now declares a patched minimum.

### body-parser override >=2.3.0

Both original parent ranges permit current **2.3.0**:

- `apps/cli` still owns `express:^5.2.1`, locked to Express 5.2.1; its original dependency is **`body-parser:^2.2.1`**.
- MCP SDK 1.32.1 requests **`express:^5.2.1`**, naturally locked to Express **5.3.0**; Express 5.3.0 requests **`body-parser:^2.3.0`**.

Thus remove and verify natural resolution. Do not claim the MCP SDK itself changed its Express minimum to 5.3.0: the installed SDK 1.31.0 and 1.32.1 original manifests both request ^5.2.1.

## Already removed overrides

| Override | Original owner/constraint | Why removal was valid |
| --- | --- | --- |
| ajv >=8.18.0 | edge-worker now owns exact 8.20.0; MCP SDK requests ^8.17.1 | The earlier removal/install/audit verified Ajv 8.20.0 naturally, with zero advisories. SDK range alone does not declare a patched minimum. |
| hono >=4.13.5 | MCP SDK requests ^4.11.4 | Earlier removal/install/audit verified natural Hono 4.13.13, zero advisories. |
| @hono/node-server >=2.0.5 | MCP SDK requests ^1.19.9 or ^2.0.5 | Earlier removal/install/audit verified natural 2.1.5, zero advisories. |

These were removed during the dependency refresh, not because SDK 1.32.1 necessarily raised these three declared ranges: installed SDK 1.31.0 and 1.32.1 manifests use the same ranges above. The actual install/audit evidence establishes the successful patched resolution.

## Every remaining entry after the proposed three removals

### Active constraints that still require a fallback

| Override | Original ranges and owner path | Classification |
| --- | --- | --- |
| app-builder-lib > @electron/get =5.1.0 | `apps/desktop` -> unchanged electron-builder 26.15.3 -> app-builder-lib 26.15.3 requests **^3.0.0**; original range excludes patched get 5.1.0 | Retain. Existing inline rationale documents that get 5 removes the old global-agent/roarr/sprintf-js chain. Direct desktop owner is unchanged by this task. |
| @opentelemetry/core >=2.8.0 <3 | `apps/cli` -> unchanged @sentry/node 10.65.0 -> node-core -> exporter-trace-otlp-http 0.218.0 and related OTLP packages/resources/sdk-metrics/sdk-logs/sdk-trace-base pin **2.7.1 exactly**. Some sibling SDKs pin 2.9.0; Sentry peer is **^1.30.1 or ^2.1.0** | Retain. Exact 2.7.1 pins cannot naturally reach the existing patched >=2.8 floor. Current 2.12.0 is within the Sentry 2.x peer. The added <3 ceiling prevents the broad historical override from drifting to an incompatible peer major during refresh. |
| js-yaml >=5.2.2 | unchanged desktop builder path: app-builder-lib 26.15.3, builder-util 26.15.3, dmg-builder 26.15.3 all request **^4.1.0** | Retain. Those original ranges exclude the current patched 5.4.3 result and existing >=5.2.2 floor. No owning builder bump occurred in this task. |
| undici >=7.28.0 | unchanged `packages/cursor-runner` -> @connectrpc/connect-node 1.7.0 requests **^5.28.4**; desktop rebuild -> node-gyp 12.4.0 requests **^6.25.0**; @electron/get 5.1.0 optional dependency requests **^7.24.4** | Retain. The 5.x/6.x branches cannot naturally reach the existing patched >=7.28 floor. Current 8.11.2 was already the base resolution; this task did not introduce that major or bump these owning dependencies. |

### Unchanged compatibility guards outside the bumped owners

These are not presented as necessary for the current locked identities. They were inherited before this task; the changed owners did not make a previously constrained branch redundant.

| Override | Original parent evidence | Classification |
| --- | --- | --- |
| semver >=7.0.0 <7.5.2 -> >=7.5.2 | unchanged node-gyp 12.4.0 and node-api-version 0.2.1 request **^7.3.5**; app-builder-lib requests **~7.7.3**; node-abi **^7.6.3**; Fastify **^7.6.0**; get 5 **^7.6.3**; make-dir/simple-update-notifier **^7.5.3**. Base/current identities remain 5.7.2, 7.7.4, 7.8.5. | Existing conditional guard outside the changed MCP/Vitest/Vite dependency edges. Compatible patched identities already existed at base; not a newly redundant override from an owning bump in this task. |
| esbuild <=0.24.2 -> >=0.25.0 | unchanged tsx 4.23.0 requests **~0.28.0**; edge-worker direct esbuild **^0.28.2** is unchanged; Vite 8.0.16 and 8.3.5 both have optional peer **^0.27.0 or ^0.28.0**. Base/current identities remain 0.28.1, 0.28.2. | Existing inactive conditional guard. Neither old nor new Vite edge exercised the vulnerable selector; no owning bump newly made it redundant. |

### Already dormant inherited entries

The following six override targets have **no package entry or parent edge in either the a4990127 lockfile or the current lockfile**. Consequently no original parent range exists in the installed graph to quote, and no current runtime necessity is claimed. They are unchanged historical guards outside the bumped owners, rather than new redundant edges introduced by this refresh:

- uuid >=11.1.1
- shell-quote >=1.9.0
- simple-git >=3.36.0
- systeminformation >=5.31.7
- @grpc/grpc-js >=1.14.4
- @opentelemetry/propagator-jaeger >=2.9.0

## Bounded method and reproducibility

1. Read `pnpm-workspace.yaml` and compared owning `package.json` changes since a4990127.
2. Parsed the base and current lockfiles with the already installed `yaml` package. Compared package identities and importer/snapshot edges.
3. Read original package manifests under `node_modules/.pnpm/*/node_modules/{name}/package.json`, filtering out stale store copies **not present in the current lockfile**. This avoided treating old unused Vitest/Vite metadata as active.
4. Looked up each override target in all locked parent `dependencies`, `optionalDependencies`, and peers; followed snapshot parents and workspace importers to identify unchanged CLI, cursor, and desktop owners.
5. Used the already installed semver package to compare original ranges with locked results. This established range compatibility, not a new install outcome.

Representative read-only commands:

```sh
cat pnpm-workspace.yaml
git diff a4990127 -- 'packages/*/package.json' 'apps/*/package.json'
git show a4990127:pnpm-lock.yaml
rg -n 'express:|5\.2\.1|postcss:' pnpm-lock.yaml
```

The lockfile inspection used Node `fs.globSync`, `yaml.parse`, and `semver.satisfies`; all data came from the local lockfiles and installed original manifests. No network or dependency mutation was required. The parent must preserve the post-removal actual identity comparison and audit outcome as the final evidence.

## Implementation decision after the bounded review

The implementation also removes the six dormant inherited targets and the two
inactive conditional selectors in the same cleanup. They have no active need in
the reviewed graph; retaining them would preserve known override rot. This does
not claim those eight were made redundant by this ticket's dependency bumps.
Their reasons are the absent target/edge or inactive selector observations above.
Only the four documented incompatible upstream constraints remain. The actual
post-removal install, identity comparison and audit below decide whether this
cleanup is safe; no removed safeguard is assumed safe from range inspection alone.

## Actual cleanup verification

The single removal/install completed with exit 0, zero downloaded/added packages,
and zero audit advisories. All 892 locked package identities and all 950 unique
installed resolved identities are identical before and after cleanup.
The normalized before/after identity files have the same SHA-256:
`ba1ea08fbb722db2a6b9ca9d2e10cb1e29410a5c714c3f16dfe600450c139957`.
Cleaned lockfile SHA-256:
`4d5086fbe1f4c882dd7466a569a75da99817eda5a9adeb89aa7526cc86406e72`.
The lockfile diff removes the eleven overrides and restores fdir's original
optional picomatch peer range `^3 || ^4`; package versions/integrities and
resolved dependency edges are preserved. The importer/snapshot sections are byte-identical (SHA-256 `0af3685287f314a23c0845d7436902992cdb87fe8a5854ff3493338ec1cecf1c`), as are package resolution records (SHA-256 `e4560f195e8bd9f88f9833e16c356f3cf9932fff7c0a6e52cd368b268632fba7`).

See [before identities](resolved-before.json.txt),
[after identities](resolved-after.json.txt),
[comparison](identity-comparison.json.txt), [install output](install.log),
[audit output](audit.log), and [audit JSON](audit.json.txt).
