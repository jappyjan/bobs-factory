# Final native binary verification — 50e02029

Source: `50e020294b8b414b2920af8952fd1467ae521180`; native target: `darwin-arm64`; tooling: Bun 1.4.2, Node 24.21.0, pnpm 10.33.1.

The canonical `scripts/build-binary.ts` built the actual complete CLI executable, SHA-256 `fa86b4743d796c309cdd5f79c232ab55eb07943dfbe8829f22f383ee3faddf33`, size 111,630,834 bytes. Runtime `/api/version` matched adjacent immutable metadata, including source, target, dirty flag and resource digest `dfef96a2353a2f1dfa272d2ae7761b4f7571138a674291ef3da5527b574bf54b`. All 1,136 production inputs and 1,740 built artifact files matched the final clean-build manifest both before building and after all checks. The `dirty: true` flag records only the untracked revision evidence directory; source files were clean throughout these checks.

The actual executable's private JSON validator dispatch, useful acyclic schemas and unsafe schema rejection passed. For deterministic R1 resource enforcement, the HTTP smoke deliberately sends SIGSTOP only to its own observed validator child to simulate a nonresponsive engine. The production parent's 2-second deadline kills and reclaims it before returning the resource-limit error. The complete request took 2,325 ms; 15 concurrent catalogue probes stayed responsive (maximum 21 ms); no validator child remained at response. Cancelling a second stopped child reclaimed it and allowed a subsequent successful validation. The SIGSTOP fault injection is explicit: it proves the actual product parent's OS-child deadline and cancellation path, separately from the earlier compiled fixture's natural pathological-regex timeout.

The canonical `scripts/smoke-binary.sh` passed startup, shell/assets, protected API, runtime identity, scoped MCP, shutdown and restart using an OS-only PATH. The installer smoke invokes `scripts/install-binary.sh` into an isolated prefix twice, verifying identical immutable reinstall, preserved separate state, ownership/hash verification and installed private-helper dispatch. An incorrect checksum manifest was rejected without changing the installed link or state.

Commands:

```sh
bun run scripts/build-binary.ts --target darwin-arm64 --output /tmp/ticket136-r1-product-binary-50e02029
node /tmp/ticket136-r1-final-product-smoke.mjs /tmp/ticket136-r1-product-binary-50e02029/bobs-factory-1.0.0-beta-darwin-arm64/bobs-factory
BOBS_FACTORY_SMOKE_PORT=46397 bash scripts/smoke-binary.sh /tmp/ticket136-r1-product-binary-50e02029/bobs-factory-1.0.0-beta-darwin-arm64/bobs-factory
python3 /tmp/ticket136-r1-final-install-smoke.py
```

Complete logs, exact metadata, pre/post input proofs and smoke driver sources accompany this file. Raw JSON retains its original bytes under `.json.txt`. The builder's immutable `validation: pending runtime smoke` field is preserved; the separate passing logs establish runtime validation. The binary/archive remains under `/tmp`; nothing was published. No paid/native coding-agent calls occurred. This proves native macOS ARM64 only and makes no claim for other targets.
