# Share layout QA correction

The accepted Share plan adds Share to the detail header and preserves existing
actions. Resume belongs to the full Focus content below that header
(`focus.tsx`); moving it was never required. The later QA scenario incorrectly
required Resume inside `.run-header`. That expectation caused the only failed
criterion despite an independent page-wide check passing.

`story.json` replaces the `share-detail-and-url` scenario from visual scope.
It keeps the URL, status and narrow-layout requirements, and corrects the action
and `share-detail-layout` expectation to preserve Resume in its existing location.
`check.mjs` executes that corrected criterion. `receipt.json` records its fresh
pass against source `efc6a0a5` and browser build `a21b9b09107c7989812a2d28`.
This commit changes QA records only; product source and browser assets are unchanged.

At 390×844, sharing the resumable stopped run copied its exact URL, kept runtime
records unchanged, sent no mutation requests and left Resume enabled with identical
bounds (x=32, right=358). The queued header's Share, capacity message and Stop
controls fit without overlap or horizontal overflow. Agents and clipboard writes
were simulated. Physical-device clipboard behavior remains unverified.

The original failed receipts remain untouched under the run evidence directory:
`qa-efc6-20261014/`. The separate `qa-resume-layout-fix/` directory contains the
fixture script, fresh receipt, `corrected-scope.json` and `corrected-qa-result.json`.
The corrected QA result replaces only the failed layout criterion with this fresh
pass; it retains the other 19 historical passes and existing screenshots. It is
input for reviewer reassessment, not an approval or a fresh run of all 20 criteria.
The runtime-owned historical `/outputs/capture` snapshot is immutable.

Reproduce from the repository root, with `EVIDENCE` pointing to the run evidence
directory's `qa-resume-layout-fix` subdirectory:

```sh
F1_AGENT_MODE=mock EVIDENCE="$EVIDENCE" node "$EVIDENCE/fixture.mjs"
# In another shell, after the isolated fixture reports ready:
agent-browser --headed false --session share-resume-fix-5442324b open http://localhost:3597/#/runs/resumable
RECEIPT="$EVIDENCE/receipt.json" node docs/qa/share-run-layout/check.mjs
```

The check closes its named browser session. Stop the fixture with Ctrl-C afterward.
No product or F1 harness behavior changed, so this correction needs only the focused
browser rerun and script/JSON validation. No additional F1 report was created.
