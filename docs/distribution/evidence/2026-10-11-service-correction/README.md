# PR91 isolated-service correction evidence

Failed run [38132078627](https://github.com/jappyjan/bobs-factory/actions/runs/38132078627),
job 114448312709, harness `f48c51ca9352cbd6caa29b3a3b70882046bfc1ce`,
frozen source `b82c37c4fb9a3e18d1cb222c6d56d3fef852096f`.

Downloaded artifact 11699875556 and its job log on October 11. ZIP bytes are
retained in `failed-artifact.zip` with SHA-256
`a0e45ec25f40bed72171240d2efbc391995328ee221cc4866fa9e8175970ab1c`.
Extracted receipt bytes are `failed-receipt.json.raw` with SHA-256
`779ae9c53c0481bd13d029a23d3ae2b43e053071028f75f61f985d467f4696c2`.
`failed-job.log.raw` is the original GitHub job-log response, without edits.
The failed receipt reports cleanup completed/no survivors, first backoff 11178 ms,
and timeout at repeated crash restart or burst exhaustion. Later acceptance
assertions did not complete. No unit-property/journal evidence survived that run.

Review response:

- P1 remains pending diagnosis and genuine full acceptance. The harness retains
  its original 45-second crash waits and all exhaustion/maintenance/resume/remove/
  retention assertions. New diagnostics capture unit properties, bounded journal
  and matching processes/cgroups before crashes and teardown. Surviving cgroup
  processes under mixed kill/no forced shutdown are a hypothesis, not a proven
  production defect. No frozen runtime bytes have changed.
- P2 cancellation: one cleanup path unwinds cancellable commands/waits, reacts
  to repeated SIGINT/SIGTERM, confirms owned processes/units exited and persists
  a nonpassing receipt. Exact fixture definition backups are also cleaned up.
  Local real-signal tests passed; actual systemd signal checks are queued in CI.
- P2 PID signaling: crash injection now addresses the exact fixture unit's main
  process through systemd after checking the definition. No retained owner PID
  is used for crash signals. Whole-unit force termination is cleanup only.

Local targeted checks passed: three cleanup tests (actual SIGINT/SIGTERM,
repeated signal during cleanup, combined work/cleanup error), JavaScript syntax,
Biome, Ruby Psych YAML parsing, whitespace and refusal outside a Linux GitHub
runner. No native Linux PASS or root-cause resolution is claimed here. Normal
commit-hook results and the pushed harness/run identity are reported in PR91.
The 101 historical, 53 prior-candidate and 56 source-b82 raw evidence files are
unchanged. No new native build, public signing/publication or production service
operation occurred. F1 does not apply to this tooling/documentation correction.
