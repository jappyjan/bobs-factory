# Round 2 failed service evidence

[Run 38132934881](https://github.com/jappyjan/bobs-factory/actions/runs/38132934881),
job 114450836918, artifact 11699348770, exact harness
`c3cc8644ac34c53b185e6b8598966fcf366497ca`. Production source remains
`b82c37c4fb9a3e18d1cb222c6d56d3fef852096f`, candidate
`1.0.0-nightly.20261010.21`, digest
`ca323a599f606523965d996ff871eeee784d7f5a419ce9158675077b3e4e43ec`.

The ZIP and every extracted member were copied byte-for-byte from the independent
round 2 download. The official artifact API digest was checked again before copy.
[inventory.json](inventory.json) hashes all copied raw files and the GitHub job log.
ZIP SHA-256: `3be06acbbf201b9b0bd36f0b016cc4bde6390eb5b5a7e8f7b2e28976b6eacd3f`.
Main receipt SHA-256: `17677feb23feff51ef774c9a941a0d0012166256340e76c4c12feccaee171ee3`.
SIGINT receipt SHA-256: `252fcf9570e8381ec4ad8b82f2512815e0f8585267d568bcef56c98a13c398f6`.

Main: `passed:false`, `cleanup:true`, no survivors, first backoff 11352 ms.
The exact worker journal records “Start request repeated too quickly” at 10:44:11;
properties show `ActiveState=failed`, `SubState=failed`, `MainPID=0`, `NRestarts=4`
and `Result=signal`. The harness incorrectly required `Result=start-limit-hit`.
[systemd v255 service.c](https://raw.githubusercontent.com/systemd/systemd/v255/src/core/service.c)
preserves a prior service failure result when entering dead/failed state; the
result string alone is insufficient exhaustion proof. The updater process belongs
to its separate unit. The captured evidence does not establish blocking worker
descendants or any production defect.

SIGINT: `passed:false`, `cleanup:false`, no survivors. Cleanup force-killed an
already-inactive external fixture; the unloaded-unit error was misclassified
because the retained definition could be loaded by the follow-up show. That
failure left the temporary home and prevented the old workflow's SIGTERM case.
Maintenance, resume, remove and retention assertions were not reached.

These failed results remain failed. Corrective code and pending acceptance live
outside this historical raw evidence folder. The earlier f48 failed ZIP/receipt/log
and all 101 historical, 53 prior-candidate and 56 source-b82 raw files are preserved.
