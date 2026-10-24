# Agent CLI minimums and native Codex Share

**Date:** 2026-10-24  
**Source:** implementation diff on `80d511df4d16f58092f61e7b7995ea6c485ede13`.  
**Behavior:** execution-profile admission accepts prepared agent CLIs at or above a minimum, including newer majors; native Codex Share suppresses desktop integrations only in Bob child processes.

F1 applies to admission and native configuration. The drive uses an embedded
EdgeWorker, protected Factory HTTP API, actual execution-profile resolver, real
Codex `--version`, real isolated Git worktree and deterministic mocked model/title
responses. Local Git preparation is controlled because this scenario has no remote
account/server. Synthetic API credentials are never sent to a provider. No live
model inference, production tracker write, production restart or release is part
of this evidence.

```sh
pnpm build
F1_AGENT_MODE=mock bun apps/f1/test-drives/media/2026-10-24-agent-cli-minimum/drive.ts
pnpm --filter bobs-factory-edge-worker test:run test/ExecutionCapabilities.test.ts test/ExecutionProfiles.test.ts test/FactoryExecution.test.ts test/NativeExecutionShare.test.ts
pnpm --filter bobs-factory-codex-runner test:run test/inspectNativeLogin.test.ts test/CodexRunner.mcp-config.test.ts test/guarded-mcp.test.ts test/CodexConfigBuilder.environment.test.ts
BOBS_FACTORY_CODEX_CONTEXT_NATIVE_TEST=/opt/homebrew/bin/codex pnpm --filter bobs-factory-codex-runner test:run test/contextOnly.native.test.ts
```

## Results

- Protected launch with the installed **Codex CLI 0.163.0** returned HTTP 202,
  retained the explicit synthetic profile, and completed the mocked Simple run.
  Execution diagnostics identify the actual CLI. A controlled older 0.158.99
  executable returned HTTP 409 with the minimum-version remedy before another run
  was created. The fixture stopped its worker in `finally`.
- Unit coverage accepts exact minima and newer patch/minor/major versions for
  Claude, Codex, Gemini and OpenCode, including Codex 1.0.0 and 10.0.0. Older,
  unreadable and below-minimum prerelease versions reject. Cursor SDK and Node
  runtime requirements retain their existing independent checks.
- Native Codex 0.163.0 protocol/OS sandbox probe passed without inference: the
  context-only environment refuses out-of-scope filesystem/network operations.
- A separate read-only inspection of the selected existing ChatGPT account root
  initially rejected its enabled desktop plugins and notification command.
  Inspection and execution now share process-only `notify=[]` and disabled
  hooks/plugins/apps feature overrides. Native inspection subsequently passed,
  returned the expected account and MCP inventory, and the host `config.toml`
  SHA-256 remained unchanged. No login/token was copied or printed. Profile tests
  verify these restrictions reach the runner, retained auth remains unchanged,
  wrong-account recovery still rejects, and ineffective suppression rejects.
- Focused worker suites: **74 passed**. Focused Codex suites: **25 passed**.
  Native context-only probe: **1 passed**. Changed-file Biome and workspace build
  passed; repository commit hooks additionally run full build/typecheck.

The passing isolated drive log is retained at `/tmp/f1-agent-minimum.log`. Initial
fixture attempts exposed its unbound local remote and missing CLI tracker/title
fixtures; these were corrected rather than weakening production validation.
Older reports that reject nonempty native integrations remain historical evidence
for the previous policy; this change replaces rejection with verified process-only
suppression.

This establishes local 0.163.0 configuration and admission plus controlled future
version comparisons. It does not establish behavioral compatibility with every
future major CLI, authenticated API-key inference, remote Git delivery, all native
targets or completed takeover work. Normal account, policy, effective configuration
and permission checks continue after the version floor. The public nightly's own
candidate-bound CI/native/evidence gates remain required before updating the user
instance.
