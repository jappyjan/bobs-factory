# Clean-source native binary verification — f926f6c1

Source: `f926f6c18be3ccdf1acd1593648719ae9523d247`. Native target: `darwin-arm64`. Toolchain: Bun 1.4.2, Node 24.21.0, pnpm 10.33.1. Checkout status was empty before and after all binary checks; build/runtime metadata reports `dirty: false`. All outputs remained under `/tmp` while repository gates ran; parked revision evidence was not accessed.

The canonical `scripts/build-binary.ts` built the actual complete CLI executable: SHA-256 `7f761a6fe467294b6aef670aefc6d18f72dd8750a16a5046f81dca38ffb6782f`, size 111,630,834 bytes, resource digest `dfef96a2353a2f1dfa272d2ae7761b4f7571138a674291ef3da5527b574bf54b`. Runtime identity matched adjacent immutable metadata. Both before build and after smoke, all 1,136 production inputs and 1,740 built artifact files matched the exact final build manifest (artifact digest `773c896829c5bb92961c5b7b67184e5a9c5ea434ee00ee98763f29457184b247`), with no source/artifact drift.

Actual CLI private JSON validator dispatch, useful acyclic schemas and unsafe-schema rejection passed. For deterministic R1 resource enforcement, the smoke sends SIGSTOP only to its own observed validator child to simulate a nonresponsive engine. The production parent deadline reclaims it and returns the 2-second wall-limit error; complete HTTP request: 2,165 ms. 17 concurrent catalogue probes stayed responsive (maximum 18 ms). No validator child remained before response; cancellation reclaimed a second stopped child; subsequent validation succeeded. This explicitly labelled fault injection proves the real product parent's OS-child deadline/cancellation path, separately from the earlier compiled fixture's natural pathological-regex timeout.

Canonical `scripts/smoke-binary.sh` passed guided startup, shell/assets, protected API, runtime identity, scoped MCP, shutdown and restart with an OS-only PATH. The isolated installer invoked `scripts/install-binary.sh` twice, verifying immutable reinstall, separate state preservation, ownership/hash validation and installed private-helper dispatch. An incorrect checksum manifest was rejected without changing the installed link or state.

Commands:

```sh
bun run scripts/build-binary.ts --target darwin-arm64 --output /tmp/ticket136-binary-final-f926f6c1/artifacts
node /tmp/ticket136-binary-final-f926f6c1/schema-isolation-smoke.mjs /tmp/ticket136-binary-final-f926f6c1/artifacts/bobs-factory-1.0.0-beta-darwin-arm64/bobs-factory
BOBS_FACTORY_SMOKE_PORT=46397 bash scripts/smoke-binary.sh /tmp/ticket136-binary-final-f926f6c1/artifacts/bobs-factory-1.0.0-beta-darwin-arm64/bobs-factory
python3 /tmp/ticket136-binary-final-f926f6c1/install-smoke.py
python3 /tmp/ticket136-binary-final-f926f6c1/collect-evidence.py
```

Complete logs, immutable metadata, pre/post input proofs and driver sources accompany this file. Raw JSON uses `.json.txt`. Metadata's builder-owned `validation: pending runtime smoke` field is preserved; separate passing logs establish runtime validation. The actual binary/archive remains outside this evidence directory under `/tmp/ticket136-binary-final-f926f6c1/artifacts`; it was not published. No paid/native coding-agent calls occurred. This validates native macOS ARM64 only.
