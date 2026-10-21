# Preliminary native binary verification — 9d985f91

This evidence is tied to source `9d985f91bf5accedac2c64949ff2731aeb8a1e70`, target `darwin-arm64`, Bun 1.4.2, Node 24.21.0 and pnpm 10.33.1. Later production fixes require a fresh final binary; this directory is historical preliminary evidence.

The canonical `scripts/build-binary.ts` produced the actual complete CLI executable, SHA-256 `7804ac5b4cf9079aa71446f2db075f26c3c5048853a4d811fd57d56796211e80`, size 111,630,834 bytes. Runtime `/api/version` matched its adjacent immutable `build.json`. The builder's `dirty: true` records the untracked revision evidence directory present at build start. The input proof records subsequent coordinator test-only changes separately; no other production inputs or built artifact bytes differed in that verification.

The actual executable's private JSON validator dispatch, useful acyclic schema and unsafe schema rejection passed. The R1 HTTP smoke deliberately sends SIGSTOP only to its own observed validator child, simulating a nonresponsive engine. The production parent deadline reclaims it, returns the 2-second resource-limit error, and has no remaining validator child before returning. Concurrent catalogue requests remained responsive (20 probes, max 71 ms; total 2,188 ms). HTTP cancellation reclaimed a second stopped child and the next validation succeeded. This deterministic fault injection is explicitly distinguished from the earlier compiled microbinary's natural pathological-regex timeout.

The canonical `scripts/smoke-binary.sh` passed protected startup, identity, assets, API/MCP, shutdown and restart with an OS-only PATH. `scripts/install-binary.sh` passed installation into an isolated prefix, identical immutable reinstall, preservation of a separate state marker, installed helper dispatch, ownership/hash verification and rejection of an incorrect checksum manifest without changing the installed link/state.

Commands:

```sh
bun run scripts/build-binary.ts --target darwin-arm64 --output /tmp/ticket136-r1-product-binary-9d985f91
node /tmp/ticket136-r1-product-smoke.mjs /tmp/ticket136-r1-product-binary-9d985f91/bobs-factory-1.0.0-beta-darwin-arm64/bobs-factory
BOBS_FACTORY_SMOKE_PORT=46397 bash scripts/smoke-binary.sh /tmp/ticket136-r1-product-binary-9d985f91/bobs-factory-1.0.0-beta-darwin-arm64/bobs-factory
python3 /tmp/ticket136-r1-install-smoke.py
```

Complete logs, exact immutable metadata and smoke driver sources accompany this file. JSON evidence uses `.json.txt` to preserve raw bytes without introducing JSON-format lint changes. The builder's immutable `validation: pending runtime smoke` metadata is preserved; the separate successful smoke logs supply validation evidence. No release was published and no paid/native agent calls occurred. This covers the native macOS ARM64 target only.
