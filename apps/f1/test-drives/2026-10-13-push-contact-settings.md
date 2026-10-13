# Push contact configuration in Settings

Date: 2026-10-13. Tested base revision: `043eea7e540090e97261ae688ca470c6aefeddac` plus the uncommitted push-contact implementation in this worktree. No real agent CLI or inference API ran.

## Running-worker scenario

An embedded F1 EdgeWorker used a fresh temporary Git repository and Factory home. Factory HTTP listened on localhost:3591 and the worker listener on localhost:3691. `F1_AGENT_MODE=mock` and `f1AgentHandlers("mock", ...)` intercepted provider/title runners. A controlled in-process role hook returned question results, avoiding production role subprocesses. A recording sender replaced external push delivery.

Passed assertions:

- Startup without the subject environment variable exposes an unconfigured server.
- A simulated role reaches a normal question wait before configuration. The protected HTTP configuration endpoint initializes push immediately.
- Explicit simulated device registration followed by saving the existing question sends nothing.
- Answering the question creates a fresh question wave and sends exactly once.
- Updating the contact through HTTP preserves every persisted field except the contact. The next question wave uses the new contact.
- Restart preserves the public key and saved contact, and sends no replay of the question wait.
- Both workers stop and release their listeners.

Command:

```sh
F1_AGENT_MODE=mock bun run /Users/jappy/.bobs-factory/factory/evidence/manual-78f0d34d-836e-4bdb-b22d-5b97847c09f3/push-contact-drive.ts
```

Result: `F1_PUSH_CONTACT_PASS`. Final fixture home: `/var/folders/_r/fld8l71j7ts635hlb5vtgnb80000gn/T/f1-push-contact-DsbR9n`. Driver and `push-contact-f1.log` are retained in the run evidence directory. Earlier fixture attempts revealed incomplete synthetic recovery state and production role-context subprocess requirements; the passing drive uses normal question checkpoints and an explicit controlled role hook.

## Browser and focused checks

Headless agent-browser sessions `manual847-push` and `manual847-push-final` exercised a separate isolated home. Browser checks covered empty setup, invalid input feedback, keyboard submission, mailto and HTTPS saves, navigation clearing, reload and worker-restart persistence. Instrumented permission/subscription calls remained zero during saves with denied permission; device preference remained absent and server devices remained empty. Deleting browser PushManager support also allowed saving. A foreground refresh after an external contact change replaced a stale unsaved draft with authoritative state.

Desktop and 390px-wide screenshots were inspected. Screenshots are retained in the run evidence directory: `push-contact-desktop.png`, `push-contact-mobile-saved.png`, and `push-contact-final-desktop.png`. Browser captures precede a final request-sequence guard that prevents a pre-save refresh response from replacing saved status; the guard passed type/build checks. Both named browser sessions were closed. Isolated worker listeners were stopped; lingering fixture processes were terminated after their shutdown receipts.

```sh
pnpm --filter 'bobs-factory-edge-worker^...' build
pnpm --filter bobs-factory-edge-worker exec vitest run test/FactoryPush.test.ts test/FactoryServer.test.ts test/FactoryNotifications.test.ts test/FactoryWebClient.test.ts test/prompt-assembly.routing-context.test.ts
pnpm --filter bobs-factory-edge-worker typecheck
pnpm --filter bobs-factory-edge-worker build
pnpm exec biome check <changed TypeScript files>
git diff --check
```

All 68 focused tests passed. After adding stopped/unavailable status diagnostics, the 35 push/server tests passed again. Typecheck, build, changed-source Biome and whitespace checks passed. The clean worktree initially lacked dependency builds and generated web assets; building those resolved the initial import/asset failures.

## Limitations

Delivery is simulated. Physical-device foreground/background receipt, native notification display, trusted OS clicks and production HTTPS proxy behavior remain unverified. This drive does not claim real-agent suggestion quality or production push-service acceptance. Publication, independent review and revision-bound human approval belong to later workflow steps.
