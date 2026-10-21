# R11 independent Bun VM clock characterization

Read-only against `/Users/jappy/.t3/worktrees/bobs-factory/ticket-136-agent-step-recovery`. No repository edits, builds, installs, or commits. Probes use Bun 1.4.2 (`/opt/homebrew/bin/bun`) and Node 24.21.0 comparison.

## Established behavior

1. `InlineSchemaEngine.ts` invokes `runInNewContext('run()', {run: host callback}, {timeout: 250})`. Ajv construction, `compile`, and optional value validation all happen in this callback. Imports and child stdin collection/JSON parsing happen beforehand.
2. A 500 ms delay before a raw VM invocation plus 120 ms host callback work passes, for both Bun and Node. The VM budget does not begin at process startup.
3. Bun interrupts `Atomics.wait(...,400)` inside its host callback at about 256 ms with only 1.8 ms CPU. Therefore the 250 ms engine budget measures elapsed time and includes blocked host execution; it is not a CPU budget.
4. Bun also rejects 400 ms host JavaScript callback work, although its interruption can be delayed until a callback safepoint (~401 ms); direct VM JavaScript stops near 254 ms. The parent hard wall limit remains necessary.
5. With the actual imported `executeInlineSchemaJob` and exact `{type:'null',title:'After faults'}`, delayed stdin by 600 ms, a pre-VM delay by 600 ms, and both together all pass. VM callback duration was about 22–24 ms. This excludes time waiting for parent RSS startup sampling/input delivery from the VM budget.
6. Pausing the fresh child for 500 ms immediately after entering the actual engine callback reproduced the identical `Inline JSON Schema compilation exceeded the 250 ms execution limit` result six times out of six. Measured child CPU during this operation was only ~1.4–2.8 ms; VM elapsed time was ~501–505 ms. Scheduling/stop time while inside the callback can therefore reject this trivial schema.
7. Twelve fresh-process compiles passed immediately after four groups containing a child killed before input, a child stopped/killed inside the VM, and a child that reached its VM timeout. Recovery VM duration ranged from 13.4 to 52.6 ms. No timeout state is carried by JavaScript memory into a fresh child. These finite probes do not exclude indirect system-load effects.

## Limits of the conclusion

The original unchanged stress run's failed child had no phase/CPU telemetry, so these probes do **not** prove that it was descheduled, nor identify which OS/runtime event lengthened that particular compile. They establish a concrete sufficient mechanism and exclude startup/input delay and inherited VM state as explanations. A captured failure with phase elapsed-time and CPU measurements is needed to attribute the historical sample. No blanket execution-limit bump is supported by these results alone.

## Evidence

- `/tmp/ticket136-r11-vm-clock-matrix.jsonl`: raw Bun/Node host callback, native wait, pre-delay and stop/resume matrix.
- `/tmp/ticket136-r11-vm-clock-probe.mjs`, `/tmp/ticket136-r11-vm-clock-matrix.mjs`: raw probe and orchestrator.
- `/tmp/ticket136-r11-engine-clock-matrix.jsonl`: actual engine delayed-input/pre-VM-delay and exact-schema stop/resume reproduction.
- `/tmp/ticket136-r11-engine-clock-child.ts`, `/tmp/ticket136-r11-engine-clock-matrix.mjs`: actual engine wrapper and orchestrator. Wrapper injects evaluate only to timestamp and wrap the same callback; source engine unchanged.
- `/tmp/ticket136-r11-vm-recovery.jsonl`, `/tmp/ticket136-r11-vm-recovery.mjs`: 24 jobs, including 12 passing fresh-process recovery checks.
