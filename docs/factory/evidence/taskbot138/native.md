# Compiled-product For each smoke

Result **PASS**, exit 0. UTC `2026-10-21T23:32:15.765779+00:00`–
`2026-10-21T23:32:22.329913+00:00` (2026-10-22 Europe/Athens).
This is a local development darwin-arm64 build, not a release publication or
all-target release qualification.

```sh
python3 /tmp/taskbot138-native-foreach-smoke.py /tmp/taskbot138-native-9b79a19f/bobs-factory-1.0.0-beta-darwin-arm64/bobs-factory
```

The driver launches the actual compiled `bobs-factory --home ... --repo ...
--agent claude --port ... --no-open` with a fresh home, local Git repository and
local bare remote. Its protected, same-origin loopback API saves custom recipes
alongside the retained stock catalog and launches three manual runs. The binary
PATH contains only an explicit temporary set of OS tools/Git/ps and a controlled
`claude` stub: Node and Bun are absent. The stub supports `--version` and rejects
every provider execution. Three background title starts were rejected; recipe
work contains no model steps. Paid calls: **0**. No native credential store or
production home/run was changed.

The nested success recipe executes an actual shell source → For each → Call
recipe → nested For each → shell/Check per item → child Check → final Check.
The source collection is two regions with three total assignments. Call mapping
retains the outer region ID while `/item` and `/index` change in each inner frame;
the leaf JSON and named-read Check assertions validate their exact ownership.
The body scripts execute through the product's ordinary command runner and real
MachineCapacity, with two slots. The real file logs contain each leaf once:
`north/a1`, `north/a2`, `south/b1`.

Both inline failure-policy runs use a shell exit-1 item at concurrency one.
`all-must-succeed` retains the completed `good` item, fails `bad`, marks
undispatched `later` cancelled, and never executes the downstream Check.
`keep-successful` executes `good`, `bad`, `later`, returns only successful keyed
outputs, preserves the explicit failed-item summary, and passes a Check asserting
two completed plus one failed item. The expected failed run is an intentional
passing assertion of the configured policy.

After all three runs settle, the driver cleanly stops and starts the same binary
with the same home. Every run retains its exact ID, terminal status and outputs;
shell-call logs remain byte-equivalent, proving no terminal completed leaf replay
on normal startup. Both process shutdowns exit 0. This is a restart **after
terminal completion/failure**, not a mid-iteration crash or native-agent
continuation test. The dedicated production-runtime tests establish those other
boundaries; this smoke does not claim arbitrary exactly-once side effects.

| Scenario | Runtime status | Observed shell item calls |
| --- | --- | --- |
| `native-foreach-nested` | completed | `north/a1`, `north/a2`, `south/b1` |
| `native-foreach-all-must-succeed` | failed as required | `/good`, `/bad` |
| `native-foreach-keep-successful` | completed with explicit failure | `/good`, `/bad`, `/later` |

Actual startup and restart `/api/version` both report embedded source
`9b79a19f7b672a8a759400cc9f715aec3f140635`, dirty `false`, target
`darwin-arm64`, version `1.0.0-beta`, web build
`37aae3292ed089cb18e738f1`, and embedded resource digest
`0bbbb395b08a3ed6e240f7fadfb6e04c1df0843310108e2d162d8fb932f932d0`.
Binary SHA-256:
`066ac9cb51b513628c989a85b0b15fe70a47240862186e434b8a7b8d9a8c615e`.
Driver SHA-256:
`0aecbcb1b9a3541ffc90f0819a26336615460367a6bbca302eb65745a958b513`.

Full receipt, raw runs, startup/restart logs and item-call files remain in
`/var/folders/5m/3pxzz_nd1v7f34rd9vnm01380000gn/T/taskbot138-native-foreach-31_evsfx`.
Receipt `results.json`: 45,985 bytes, SHA-256
`fbbb52245a8817590df7337a1f90b56ba2ae082799f8ba96fc812ff1e48e4b28`.
Outer command log `/tmp/taskbot138-native-foreach-final.log`: SHA-256
`2769e461ba944186d7a004253ece51c14a7b2cc9bc8ac04213f40394b3e51b56`.

A preliminary attempt failed before API readiness because its fixture omitted
the required repository `linearWorkspaceId`; the binary correctly rejected that
configuration. Zero model/stub starts or scenarios ran. The failed home
`taskbot138-native-foreach-555r2e1w`, `/tmp/taskbot138-native-foreach-preliminary.log`
and `/tmp/taskbot138-native-foreach-smoke.preliminary.py` remain preserved.
The final harness adds the ordinary `cli-workspace` fixture ID without a token
or real tracker connection. No product guard, accepted receipt, production code,
binary input or build identity changed to obtain the pass.

The reproducible [driver](native-foreach-smoke.py), exact [results receipt](native-results.json), [build command metadata](native-build.json), [standard binary smoke metadata](native-standard-smoke.json) and compressed raw logs in the validation index are retained with this report. The ordinary binary smoke also passed startup/restart, assets, protected same-origin local APIs, public/foreign-origin rejection, MCP and shutdown (exit0, 8.735s).

Generated JSON receipts have readable repository-formatted copies; [original byte receipts](raw-json.json) retain their exact original JSON in gzip form. Recorded original hashes refer to the decompressed raw copies. PNG and driver bytes are unchanged.
