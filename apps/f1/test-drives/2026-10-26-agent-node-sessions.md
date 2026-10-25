# Scripted Factory drive: generic agent sessions (#161)

**Date:** 2026-10-26  
**PR:** https://github.com/jappyjan/bobs-factory/pull/200  
**Implementation baseline:** `7ed64c68`, plus this PR's generic context-prompt follow-up.  
**Mode:** controlled native-runner stubs; no provider credits or external writes.

## Applicability and scenario

This changes Factory runner/session lifecycle, so relevant F1 validation applies.
The drive uses the real `WorkflowRuntime`, `EdgeWorker.executeFactoryAgent`,
checkpoint persistence, graph routing, wait phases and MCP context preparation.
The non-Codex paths run the real scoped MCP preflight against the built owned
stdio server; the test substitutes the built entrypoint for source imports.
Native agents are deterministic stubs. Issue-tracker ingress and external
activity publishing are unchanged and are outside this drive.

Recipe: `packages/edge-worker/test/fixtures/agent-node-needs-input.json`.
B2 display is not on the base branch, so the test registers a pure status node
and a fake human node. The fake human waits through `ctx.phase("waiting-human")`;
the runtime neither renders an embedded agent form nor interprets `needs-input`.

Expected path: agent → status → human wait → stop/reload/resume → answer → same
agent native session with new reads → status → end.

## Commands and results

From the isolated `epic156-b4` worktree:

```sh
pnpm --filter 'bobs-factory-edge-worker^...' build
pnpm --filter ./packages/edge-worker exec vitest run test/AgentNode.test.ts test/FactoryRolePrompts.test.ts test/EvidenceChecks.test.ts --reporter=verbose
```

**Passed: 3 files, 37 tests.** The broader focused run also passed 8 files / 89
tests, including node registry, generic output protocols, step configuration,
legacy resume and native recovery. Edge-worker typecheck and the pre-commit
formatting, complete monorepo build and complete monorepo typechecks passed.

Assertions exercised:

- Claude, Codex, Gemini, Cursor and OpenCode each receive exactly their original
  native session ID on the second graph visit, including after cold restart.
- First turn has no resume ID; the returning message contains the newly supplied
  `{"answer":"Use the saved value"}` read. The completed result from the earlier
  visit is not replayed. History is `compose,status,human,compose,status`.
- The agent leaves `run.questions` empty; the registered human node owns waiting.
- Default `fresh` starts another conversation even with convergence/session
  bookkeeping enabled. Interrupted visits and output corrections retain sessions.
- A missing file fails `verify`, preserves the rejected candidate/issues in
  context, and makes a correction turn with the same Codex native ID. The accepted
  output names the existing file. All four generic checks also reject invalid
  files, code references, media and IDs; IDs use the current named read.
- Missing native resume IDs and cross-runner IDs fail explicitly.
- Legacy flags, embedded human settings and domain checks reject at definition
  time; invalid generic verification selectors/adapters reject as well.
- Builder projection and serialization retain `nodes-v1`, Session and Verify
  without introducing legacy fields. Large/native-transcript reads remain on
  scoped MCP access rather than being inserted directly in the prompt.
- Complete maintained stock/frozen legacy role prompt fixtures remain unchanged.

## Limits and cleanup

This validates orchestration and adapter configuration forwarding, not live CLI
resume behavior, native model output quality or B2's real display rendering.
Native resume implementations were inspected locally: Claude SDK `resume`,
Codex app-server thread resume, Gemini `-r`, Cursor agent resume and OpenCode
`--session`. No currently selectable runner lacks a native resume adapter.
Provider-specific errors retain existing recovery semantics.

Every fixture shuts down its runtime, stops scoped MCP processes and removes its
owned temporary home/repository. No production tracker, repository or provider
session is touched.
