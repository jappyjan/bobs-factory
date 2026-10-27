# Native startup after the node-engine cutover

Date: 2026-10-27. Source: `bfeb80f7` plus the focused startup follow-up.
Mode: controlled agents/providers, disposable homes and real loopback HTTP.

## Applicability

Bundled schema initialization changes a runtime startup path. Validate cold
startup, catalog/schema acceptance, saved Display restart and API responsiveness.
The native trial timeout/diagnostic change also receives its direct native and
controlled checks. Full-payload nightly validation remains required for release.

## Measured cause and change

The first nightly candidate failed three x64 packed-trial cases with
`Timed out: usable dashboard` after the ten-second readiness wait. Its two ARM64
native lanes passed. Exact-main CI and all current-node candidate workflow gates
passed. That unpublished candidate is retained as a failed/cancelled attempt.

A Bun CPU profile of CLI import attributed 53.6% of sampled time to synchronous
child spawning through `defaultWorkflows`, `validateWorkflows`, `stepConfigIssues`
and inline schema compilation. The stock catalog has 19 recipes, 260 steps and
30 distinct inline output schemas. Fresh import took about 2,949 ms; repeated
validation took about 36 ms. The 64-entry cache already held all 30 schemas.

Compiling those bundled constants with the existing strict engine took about
73 ms. The follow-up warms that same content-keyed cache from code-defined
constants, preserving eager graph/schema checks. Saved/request schemas use the
isolated compiler, and every output value uses isolated validation. The compiler
selection is a host function parameter, with no corresponding workflow JSON flag.

## Native observations

Same ARM machine, fresh isolated trial homes, actual packed launcher and native
executables; browser handoff uses a controlled executable. Milliseconds:

| Build | `--version` | Dashboard readiness, browser / no-browser |
| --- | ---: | ---: |
| Published October 25 nightly | 290–410 | 2,284 / 2,155 |
| Frozen `bfeb80f7` candidate | 4,168–4,345 | 6,308 / 6,146 |
| Local diagnostic build with fix | 359 / 359 | 2,716 / 2,586 |

The fixed executable is a local dirty diagnostic build, not publication evidence.
An earlier pair during overlapping local work measured 2,506 / 6,169 ms; timings
still vary. Native readiness therefore gets 30 seconds and its enclosing test
60 seconds; controlled protocol checks retain ten seconds. Child exits fail
immediately and readiness failures include captured child output.

## Completed verification

- Focused schema, child/Bun watchdog, catalog, step-config and configuration API
  suites: **40 passed**. A new check retains rejection of invalid output values,
  mutated schemas and invalid bundled schemas after cache warming.
- Controlled trial-launcher/bootstrap suites: **14 passed**.
- Exact ARM64 candidate with the timeout/diagnostic patch: **2 native cases passed**.
- Fixed local native executable: both trial cases passed in two runs; this
  establishes local behavior, not x64 or four-target release acceptance.
- Desktop unit/protocol suite: **41 passed, 1 existing skip** (Electron binary
  unavailable for the physical ASAR helper check).
- `F1_AGENT_MODE=mock` desktop lifecycle: persisted Display, exact checkpoint,
  native ID and activity survive restart; two controlled calls, one completion.
- `F1_AGENT_MODE=mock` localhost/no-auth: **10 lifecycle checks passed**, including
  real worktree/Exec output, remote authentication and restart; external requests
  were empty.
- `F1_AGENT_MODE=mock` API responsiveness: saved Display/history survive cold
  restart and role preparation; one full context read, 400 version probes,
  observed maximum about **52.5 ms**.
- Package build, workspace typecheck, focused Biome and diff checks passed.

No live inference, provider mutation or physical desktop-install acceptance is
claimed. Fresh PR CI, four native targets, desktop packaging, complete source and
candidate-bound evidence remain gates before the replacement nightly publishes.
