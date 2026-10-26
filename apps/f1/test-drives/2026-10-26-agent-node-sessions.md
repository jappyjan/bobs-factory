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


## Review follow-up: nested agents and unavailable sessions

This follow-up supersedes the initial missing-ID and cross-runner failure
assertions above. It uses the same real Factory runtime/EdgeWorker/scoped MCP
path with deterministic native runners; no live provider execution or credits.

Before applying the fixes, the new focused regressions fail against `822f2cf1`:

- Revisited Parallel branches receive `[undefined, undefined]` instead of their
  first native session IDs after a cold restart.
- The first For each agent cannot resolve its named `ids-resolve` source and
  exhausts its two output-correction attempts.

The follow-up scenarios assert:

- For each agents receive the generic instructions, current item reads and
  successful `ids-resolve` verification on the first run and after restarting
  inside an unfinished cloned body.
- Parallel branches, For each items and called recipes resume their original
  session IDs when the enclosing node is revisited after cold restart. Branches
  and item IDs remain isolated, and completed outputs are not replayed.
- Manual launches without `run.runner` keep the saved runner and model even
  after the repository default changes.
- Missing native IDs, missing Codex rollouts and unavailable runner executables
  log a warning and make one fresh attempt with the prior output and current
  reads. The unavailable-runner case uses the current default runner.
- A stale bound producer starts fresh in `fresh` mode and resumes in `resume`
  mode; its consumer receives the refreshed result.

The clone/registration audit found that Parallel's selected steps already use
`inheritStepConfig`, called recipes use their accepted registered definitions,
and startup/recovery registers the frozen definitions. For each re-registration
was the missing engine marker; it now derives that marker from its accepted
parent step. Session lookup uses the existing structural graph keys (call site,
branch index, item ID), persisted independently of newly constructed child frames.

Validation from `packages/edge-worker`:

```sh
pnpm exec vitest run test/AgentNode.test.ts test/FactoryRolePrompts.test.ts test/EvidenceChecks.test.ts test/NodeRegistry.test.ts test/GenericOutputProtocols.test.ts test/StepConfig.test.ts test/LegacyStepConfigResume.test.ts test/FactoryAgentSettings.test.ts test/Workflow*.test.ts test/Foreach*.test.ts test/*Fanout*.test.ts test/CallFreshness.test.ts test/RevisionBinding*.test.ts test/prompt-assembly*.test.ts --maxWorkers=2 --reporter=dot
```

**Passed: 32 files / 426 tests**, including all 39 agent-node tests and all nine
unchanged legacy prompt-assembly files. Edge-worker typecheck and diff whitespace
checks pass. The normal pre-commit hook runs formatting, full monorepo build and
full monorepo typechecks; lint-staged's optional backup stash is disabled to honor
the no-stash instruction. Shipping results are also recorded on PR #200.
