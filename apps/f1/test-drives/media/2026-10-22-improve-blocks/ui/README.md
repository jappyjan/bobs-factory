# Changed UI evidence

T3 collaborative preview, 2026-10-22. Real Factory HTTP on the disposable F1
driver at localhost:52759. Desktop CSS viewport 1440×1000; mobile 390×844.
The PNG tool scales desktop output and captures mobile at 2×. [Index](index.json)
records the exact routes and distinguishes stock from edited-fork run pages.

- Stock graph: research, full-flow overview, selected approval/dispatch stage,
  and the callable research graph (coordinator → nested assignments → verifier).
- Decide/Approve: actual one-perspective, one-prompt catalog fork. The plan card
  shows its actual parsed criteria/dependencies/paths and independent checks.
- Primary stock parent: actual child tracking after exact human acceptance.
- 360px inspection: canvas, expanded palette, Decide with Ask selected and
  Approve each measured document scrollWidth = viewport width; the decision
  panels had no elements beyond the right edge. Palette bounded height 560px,
  scrollHeight1441px, scrollTop881px; all callable entries remain reachable.
- Keyboard: selecting Ask exposed its optional comment; Tab reached the
  textarea. Approve remained disabled before acknowledgement; checking the
  displayed-content acknowledgement enabled Approve, and Tab reached it.
  Request changes remained disabled without feedback. These browser edits were
  local form drafts only. No browser approval was submitted. Actual API route,
  stale digest rejection, approval and request-changes behavior are covered by
  the F1/runtime tests. Existing #140 component matrices are reused.

The new callable palette initially overflowed vertically. Source CSS now bounds
its scrolling. The running Factory server snapshots its shell at startup; to
avoid repeating unchanged research, canvas captures loaded the exact freshly
built stylesheet `styles.b3a05c5d6d98412a20201bd6.css` from a temporary loopback
static server into the original live app. No markup, graph, run data, provider
permissions or API handlers were replaced. Build7e428c055615fde9904e2594 came
from `node packages/edge-worker/scripts/build-factory-web.mjs`.

An initial attempt to proxy the whole app to the temporary port was correctly
refused with403 `Invalid Factory authority`; it supplied no evidence and no
guard was changed. Captures use the original Factory origin. Both the temporary
asset server (PID95219) and the owned F1 driver (PID77318) were stopped after
capture. [Cleanup](../cleanup.json) records all five runs and worker stopped.
