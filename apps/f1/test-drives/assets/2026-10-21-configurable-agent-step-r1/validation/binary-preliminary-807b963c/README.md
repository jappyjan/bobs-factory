# Preliminary clean-source native binary verification — 807b963c

Status: preliminary for this exact source. A subsequently discovered Node runtime gate requires a new source build and repeat verification; these passing historical bytes remain preserved.

Source: `807b963cfd2879ae466add6e041a8907eecffd22`. Native target: `darwin-arm64`. Toolchain: Bun 1.4.2, Node 24.21.0, pnpm 10.33.1. The checkout was completely clean before and after all binary checks; build/runtime metadata reports `dirty: false`. All outputs remained under `/tmp` while repository gates ran, and the parked revision evidence was not accessed.

The canonical `scripts/build-binary.ts` built the actual complete CLI executable: SHA-256 `70285ee9c1ed3f4c4bdbe321f2f8cb97ae8a59857c8f092b0fb6347b7a048378`, size 111,630,834 bytes, resource digest `dfef96a2353a2f1dfa272d2ae7761b4f7571138a674291ef3da5527b574bf54b`. Runtime identity matched adjacent immutable metadata. Both before build and after smoke, all 1,136 production inputs and 1,740 built artifact files matched the exact final build manifest (artifact digest `4dfb184ef56e22ca6279c4abd446ad1eb8a69e246f5a68a4e03e8d1283283078`), with no source or artifact drift.

The actual CLI private JSON validator dispatch, useful acyclic schemas and unsafe-schema rejection passed. For deterministic R1 resource enforcement, the smoke sends SIGSTOP only to its own observed validator child to simulate a nonresponsive engine. The production parent deadline reclaims it and returns the 2-second wall-limit error; the complete HTTP request took 2,165 ms. Eighteen concurrent catalogue probes stayed responsive (maximum 35 ms), no validator child remained before the response, cancellation reclaimed a second stopped child, and a subsequent validation succeeded. This is an explicitly labelled fault-injection test of the real product parent's OS-child deadline/cancellation path, distinct from the earlier compiled fixture's natural pathological-regex timeout.

Canonical `scripts/smoke-binary.sh` passed guided startup, shell/assets, protected API, runtime identity, scoped MCP, shutdown and restart with an OS-only PATH. The isolated installer invokes `scripts/install-binary.sh` twice and verifies immutable reinstall, separate state preservation, ownership/hash validation and installed private-helper dispatch. An incorrect checksum manifest was rejected without changing the installed link or state.

Commands:

```sh
bun run scripts/build-binary.ts --target darwin-arm64 --output /tmp/ticket136-binary-final-807b963c/artifacts
node /tmp/ticket136-binary-final-807b963c/schema-isolation-smoke.mjs /tmp/ticket136-binary-final-807b963c/artifacts/bobs-factory-1.0.0-beta-darwin-arm64/bobs-factory
BOBS_FACTORY_SMOKE_PORT=46397 bash scripts/smoke-binary.sh /tmp/ticket136-binary-final-807b963c/artifacts/bobs-factory-1.0.0-beta-darwin-arm64/bobs-factory
python3 /tmp/ticket136-binary-final-807b963c/install-smoke.py
```

Complete logs, immutable metadata, pre/post input proofs and driver sources accompany this file. Raw JSON uses `.json.txt`; metadata's builder-owned `validation: pending runtime smoke` field is preserved, while separate passing logs establish validation. The actual executable/archive remains outside this evidence directory under `/tmp/ticket136-binary-final-807b963c/artifacts`; it was not published. No paid/native coding-agent calls occurred. This validates native macOS ARM64 only.
