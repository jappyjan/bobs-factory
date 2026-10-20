# GitHub Actions

Workflow names use `Area / Purpose`. Release stages are numbered in execution
order; reusable builders sit beside them. Keep workflow names and their
`workflow_run.workflows` subscribers in sync when renaming.

| Workflow | File | When it runs | Responsibility |
| --- | --- | --- | --- |
| CI / Validate | [ci.yml](workflows/ci.yml) | Main pushes and pull requests targeting main | Lint once; build and test on Node 22 and 24; verify installation and release safeguards. |
| Release / 1. Build candidates | [release-channel.yml](workflows/release-channel.yml) | Hourly eligibility poll or manual dispatch | Freeze a candidate, build four native targets and desktop installers, and collect current test receipts. |
| Release / 2. Collect evidence | [release-evidence.yml](workflows/release-evidence.yml) | Successful candidate workflow or manual evidence import | Validate and retain candidate-bound source and evidence. |
| Release / 3. Publish | [binary-release.yml](workflows/binary-release.yml) | Successful evidence workflow or manual dispatch | Prepare immutable assets; publish only when the existing channel and approval gates permit it. |
| Release / Build CLI | [binary-build.yml](workflows/binary-build.yml) | Reusable call or manual frozen-candidate dispatch | Build and smoke-test CLI binaries on all four native targets. |
| Release / Build desktop | [desktop-build.yml](workflows/desktop-build.yml) | Reusable call or manual frozen-candidate dispatch | Package and validate unsigned desktop installers using verified native runtime bytes. |
| Website / Build and deploy | [website.yml](workflows/website.yml) | Relevant main pushes/PRs, published releases, or manual dispatch | Build PRs; deploy other events to GitHub Pages. |
| Diagnostics / Relink Bun | [source-relink-diagnostic.yml](workflows/source-relink-diagnostic.yml) | Manual dispatch | Run the pinned Linux source/relink experiment on demand. |

## CI and shared setup

`Lint` checks Biome formatting/code quality and validates workflows with pinned
actionlint, including shellcheck and pyflakes. `Build and test (Node 22.x)` and
`Build and test (Node 24.x)` each build the workspace and run its tests plus the
installation/publication safeguard suite. TypeScript builds already type-check
before emitting, including the dashboard's separate TypeScript project; a second
identical type-check pass adds no coverage. Superseded CI runs are canceled per
PR or branch, with bounded job durations and independent Node compatibility jobs.

The `setup-tests` composite action shares Node/Bun, locked dependency installation,
and Linux video/release tools between CI and the candidate validation job. The
smaller `install-dependencies` action is also used by lint. Native build jobs retain
their separate source/tooling checkouts and target-specific setup.

CI no longer uploads a nonexistent coverage directory or requests an OIDC token
for that upload. Website build jobs have Pages read access; only deployment gets
Pages write and OIDC permissions. Release publication retains its separate write
permissions and repository-wide mutation lock.

The previous CI matrix contexts were `test (22.x)` and `test (24.x)`. Any external
branch rules requiring those names must switch to `Lint`,
`Build and test (Node 22.x)`, and `Build and test (Node 24.x)`. At the time of this
refactor, main had no branch protection and the repository had no rulesets.

## Release boundaries and compatibility

The three release stages stay separate because artifact handoffs and read-only
preparation versus publication permissions are deliberate gates. Candidate builds
reuse the completed CLI matrix for desktop instead of rebuilding it. Candidate
tests still run against the exact frozen source; a PR result at another revision
cannot replace release evidence.

Keep the existing release workflow filenames: the release validators bind provider
run provenance to those exact paths, and retained artifacts refer to them. Native
job names retain `binary (TARGET)` and `desktop (TARGET)` prefixes because evidence
intake recognizes those prefixes and historical matrix names. Caller job names
can describe their purpose without changing those contracts. Artifact names,
candidate digests, approval requirements and publication locks are unchanged.

Desktop builds no longer listen to PR opening events or old delivery branches.
Those routes either skipped ordinary PRs or allocated special candidates for
PR #91. Use the candidate workflow, or manually dispatch the CLI/desktop builders
from the frozen tooling ref with its exact `candidate_json`.

See [release operation and evidence requirements](../docs/distribution/PUBLIC_RELEASES.md)
and [automatic nightly CI](../docs/distribution/NIGHTLY_CI.md).

## Historical diagnostics

The former isolated Linux service workflow always downloaded one October 2026
binary artifact. It is archived verbatim at
[`docs/distribution/acceptance/isolated-service-acceptance.yml`](../docs/distribution/acceptance/isolated-service-acceptance.yml)
with its [harness documentation](../docs/distribution/acceptance/README.md). Its
fixed artifact eventually expires, and a pass against that old binary would not
validate current code. Historical receipts and harness tests remain intact.
Current native service validation runs in the four-target desktop matrix.

The Bun relink experiment remains available manually. Its obsolete delivery-branch
push trigger is removed; it neither gates ordinary PRs nor publishes releases.

CI-only changes use workflow linting, setup checks and relevant release safeguard
tests. F1 product workflow drives are not applicable unless product behavior or
the F1 harness itself changes.
