# Architecture file paths and full-plan keyboard QA

The original `qa-11de73c4/architecture-ui-final.py` clicked **Show files** and
incorrectly expected `.arch-full-plan.open` to become true. File paths and
**Full plan for Bob** are independent controls. The failed receipt did not
justify marking the plan-navigation portion of `arch-owned-ui` passed.

The replacement [driver](check.py) uses a fresh, explicitly headless
`agent-browser` session. It reaches Show files through Tab, presses Enter,
compares every visible path with the candidate's saved steps, and confirms that
the full plan is still closed. The next Tab reaches the native summary. Enter
opens it; the check reads the rendered plan, including its implementation text
and appended proposal context. Space and Shift+Tab exercise closing, hiding,
returning and independent reopening. Navigation must leave proposal identity,
version, digest and approval status unchanged.

On 2026-10-14, all 15 assertions passed against product revision
`11de73c4335e4f9f3af7614d91e225a447fbcb45`. The edge-worker/dashboard build passed
and produced web build `21e72909cc7609346db22eda`. The actual `FactoryServer`
and `WorkflowRuntime` ran in the maintained architecture browser fixture's fresh
temporary home at port 3994. Agents were scripted and the environment was cleared
of inherited Factory/Cyrus settings; no external provider ran. The fixture
proposal remained pending. No proposal was accepted or implementation launched.

This change corrects only QA evidence; product code is unchanged. F1 is not
applicable to this driver/documentation correction, so no new F1 drive or report
was created. Other accepted criteria, captures and settled findings are retained.
Reviewer reassessment and the normal downstream QA gate remain required.

- [Complete passing receipt](receipt.json): commands, driver fingerprint,
  observed paths, visible plan and before/after proposal state.
- [Source and image fingerprints](provenance.json): tested source/fixture/build
  identities and exact captured bytes.
- [File paths screenshot](file-paths.png): all seven step path rows visible,
  Hide files focused, full plan closed.
- [Full plan screenshot](full-plan.png): expanded rendered proposal context,
  readable after keyboard PageDown.

Original failed evidence remains untouched in
`/Users/jappy/.bobs-factory/factory/evidence/manual-3db22f15-582b-4d93-82fb-9ab119d3f716/qa-11de73c4/`.
New evidence is in the same run's `fix-plan-navigation/` directory. Its
`locator-diagnostic.json` preserves an initial replacement-driver failure: the
generic map-tools selector reached **Show parts that stay the same**. The final
selector is scoped to the candidate steps card; `receipt.json` is the completed
passing run. Neither diagnostic failure is claimed as passing evidence.

To repeat from the repository root, first ensure port 3994 is free. Do not stop
an unknown listener. Build and run the isolated maintained fixture, then use its
printed run ID through the log supplied to the driver:

```sh
pnpm --filter bobs-factory-edge-worker build
env -i PATH="$PATH" F1_AGENT_MODE=mock \
  BOBS_FACTORY_MIGRATION_SOURCE_CAPACITY_DIRECTORY="$(mktemp -d)" \
  node apps/f1/test-drives/media/2026-10-11-architecture-decision-brief/server.mjs \
  > /tmp/architecture-navigation-server.log 2>&1
```

In another terminal:

```sh
python3 docs/qa/architecture-plan-navigation/check.py \
  --fixture-log /tmp/architecture-navigation-server.log \
  --evidence /tmp/architecture-navigation-evidence \
  --session architecture-navigation-fresh-session
```

Stop only the fixture you started. The driver closes only its named browser
session. Screenshots were inspected directly and supplement the receipt; they
do not represent human approval of this PR.
