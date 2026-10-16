# Review convergence and API-key integration

Date: 2026-10-15. PR: [#124](https://github.com/jappyjan/bobs-factory/pull/124).

Validated the merge working tree combining approved PR head `6151da173e2301b4a251ab355ff4a43eb222fa34` with fetched main `d318160c58f6489f32856019c17ab3c97fa9ae7b`, including the resolutions committed with this report. Main replaces remote passkeys with managed API keys. Both changelog histories, impact assessment safeguards, protected reader progress and the complete routing-prompt assertion are preserved. The operator fixture retains its shared runtime-shutdown cleanup and explanatory comment. No assertions were weakened.

## Validation

- Monorepo build and typecheck passed. All 269 focused edge-worker tests across 12 suites and all 75 MCP tests across 13 suites passed.
- Repository Biome CI passed with 20 warnings. Changed-file Biome and diff checks passed. Frozen-lockfile installation succeeded; `pnpm audit` found no known vulnerabilities.
- A fresh simulated-agent EdgeWorker drive passed both correction rounds: two impact assessments, one requirement extraction, one retained authorization review, two quality/coverage reviews, repository-scoped grouped comment assessments and immutable QA provenance reuse. The tracker session emitted its final response. No human approval was fabricated. Worker shutdown and temporary-home removal passed.
- The existing localhost/API-key F1 fixture passed all ten checks against the combined source: actual IPv4/IPv6 access, onboarding, protected workflow execution, rejected spoofed requests, remote TLS login and key management, session revocation and preservation, restart, last-key recovery, legacy authentication migration and local event streams. It used a disposable home, mocked agents, prepared-tool stubs and a local TLS proxy. Its listeners and worker stopped; the fixture retains its disposable files for evidence.

Commands:

```sh
env -u BOBS_FACTORY_INTERNAL_EXECUTABLE F1_AGENT_MODE=mock \
  BOBS_FACTORY_FACTORY_PORT=4863 bun <evidence>/native-feedback-drive.mjs
env -u BOBS_FACTORY_INTERNAL_EXECUTABLE F1_AGENT_MODE=mock \
  F1_LOCAL_ACCESS_PORT=4931 F1_LOCAL_ACCESS_TLS_PORT=4932 \
  bun apps/f1/test-drives/assets/localhost-noauth.ts
```

Evidence is retained in this run's `ci-integration-api-keys` directory: fixture copy, execution logs, native results, access receipt and cleanup receipt. The access receipt records the pre-merge HEAD and source fingerprints; it validates the combined working tree, not a clean pre-merge revision. Historical evidence is unchanged. These drives use simulated agents and local providers; they do not establish real-model judgment, remote delivery, fresh browser lifecycle QA or production rollout. Fresh provider CI and revision-bound review/approval safeguards remain required.
