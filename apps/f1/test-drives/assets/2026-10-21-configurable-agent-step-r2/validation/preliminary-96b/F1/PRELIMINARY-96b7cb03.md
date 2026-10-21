# Preliminary Factory drive, interrupted for a subsequent source revision

Source: `96b7cb0306b4ec526e702e3becb935432d40087f`. Command: `F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/configurable-agent-step-r1.ts`. The maintained driver was unchanged and imported the clean-built distribution. Scripted agents/forge only; paid calls: 0.

The stock Factory completed through `pipeline/merge`; its activity and comment evidence is retained. The renamed Factory was still running when the coordinator requested interruption for a separately observed sparse historical chapter browser crash. There was no assertion failure in this drive. The active session received a successful stopSession RPC, then the harness process was terminated (exit143). This is not a complete passing stock-versus-renamed comparison and is not final evidence.

Both before/after identity checks passed: source was clean and every production input and built artifact matched the supplied manifest. Input digest: `27781ec124783f16807c96b655dd5854fb57743aa2ef379421104a7eeb71e152`. Artifact digest: `0e013d08140f0ff132ce27e1ad02c5d7ea6201b0e020165d66eb326376763e31`.

The accepted-config rule smoke separately completed in Node24.21.0 and a compiled Bun1.4.2 parser fixture, with external8s process deadlines. Both 5k/20k cases reached the total-work limit while heartbeat timers ran; cancellation and a useful small rule passed. This fixture executable is distinct from the entire product CLI binary. See `rule-results.json.txt` and both complete build/runtime logs. Subsequent source requires a fresh F1 and smoke run.
