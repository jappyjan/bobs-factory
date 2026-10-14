"""Retest only file-path and full-plan keyboard navigation on the real fixture UI."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import time

parser = argparse.ArgumentParser()
parser.add_argument("--fixture-log", type=Path, required=True)
parser.add_argument("--evidence", type=Path, required=True)
parser.add_argument("--session", required=True)
args = parser.parse_args()
args.evidence.mkdir(parents=True, exist_ok=True)
fixture = json.loads(args.fixture_log.read_text().splitlines()[0])
receipt = {
    "finding": "QA-ARCHITECTURE-PLAN-NAVIGATION",
    "passed": False,
    "testedHead": subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(),
    "driverSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    "fixture": fixture,
    "boundary": "Isolated real dashboard/runtime with scripted agents; no proposal acceptance or provider calls.",
    "correction": "Show files reveals candidate step paths. Full plan for Bob is a separate native details disclosure. Assert each independently using keyboard input.",
    "checks": [],
    "commands": [],
}


def call(*command):
    result = subprocess.run(
        ["agent-browser", "--session", args.session, *command],
        capture_output=True, text=True, timeout=30,
    )
    receipt["commands"].append({
        "action": command, "exitCode": result.returncode,
        "output": result.stdout + result.stderr,
    })
    result.check_returncode()
    time.sleep(0.5)
    return result.stdout.strip()


def evaluate(source):
    return json.loads(call("eval", source))


def check(label, observed):
    receipt["checks"].append({"label": label, "passed": bool(observed)})
    assert observed, label


def tab_to(selector):
    for _ in range(80):
        if evaluate(f"document.activeElement.matches({json.dumps(selector)})"):
            return
        call("press", "Tab")
    raise AssertionError(f"Keyboard could not reach {selector}")


try:
    call("--headed", "false", "open", fixture["origin"] + "/#/runs/" + fixture["runId"] + "/architecture")
    call("set", "viewport", "1440", "1000")
    call("wait", ".arch-full-plan")
    call("snapshot", "-i")
    candidate = evaluate("(async()=>{const run=await(await fetch('/api/runs/" + fixture["runId"] + "')).json();return run.architectureProposals.at(-1)})()")
    receipt["proposalBefore"] = {k: candidate.get(k) for k in ["id", "version", "status", "digest"]}
    expected = [" · ".join(step["files"]) for step in candidate["content"]["candidate"]["steps"] if step["files"]]
    check("Step paths start hidden", evaluate("document.querySelectorAll('.arch-steps small').length===0"))
    check("Full plan starts closed", evaluate("!document.querySelector('.arch-full-plan').open"))
    tab_to(".arch-card:has(.arch-steps) .arch-map-tools .arch-link-button")
    check("Keyboard reaches Show files", evaluate("document.activeElement.textContent==='Show files'"))
    call("press", "Enter")
    paths = evaluate("[...document.querySelectorAll('.arch-steps small')].map(e=>e.innerText)")
    receipt["expectedPaths"] = expected
    receipt["visiblePaths"] = paths
    check("All candidate paths are rendered and visible", paths == expected and bool(paths))
    check("Paths have visible layout", evaluate("[...document.querySelectorAll('.arch-steps small')].every(e=>e.getBoundingClientRect().height>0)"))
    check("Showing files leaves full plan closed", evaluate("!document.querySelector('.arch-full-plan').open"))
    call("screenshot", str(args.evidence / "file-paths.png"))
    call("press", "Tab")
    check("Tab from file toggle reaches Full plan summary", evaluate("document.activeElement.matches('.arch-full-plan > summary')"))
    call("press", "Enter")
    check("Enter opens Full plan", evaluate("document.querySelector('.arch-full-plan').open"))
    plan = evaluate("document.querySelector('.arch-full-plan .markdown').innerText")
    receipt["visiblePlan"] = plan
    check("Full plan content is visible and readable", evaluate("document.querySelector('.arch-full-plan .markdown').getBoundingClientRect().height>0") and "Full implementation plan for the Jira adapter." in plan and "Extend TicketReferenceSchema..." in plan and "Connections:" in plan)
    call("press", "PageDown")
    call("screenshot", str(args.evidence / "full-plan.png"))
    check("Opening plan preserves visible paths", evaluate("[...document.querySelectorAll('.arch-steps small')].map(e=>e.innerText)") == expected)
    call("press", "Space")
    check("Space closes Full plan", evaluate("!document.querySelector('.arch-full-plan').open"))
    call("press", "Shift+Tab")
    check("Shift+Tab returns to Hide files", evaluate("document.activeElement.matches('.arch-card:has(.arch-steps) .arch-map-tools .arch-link-button') && document.activeElement.textContent==='Hide files'"))
    call("press", "Space")
    check("Space hides paths", evaluate("document.querySelectorAll('.arch-steps small').length===0"))
    call("press", "Tab")
    call("press", "Space")
    check("Space reopens Full plan independently", evaluate("document.querySelector('.arch-full-plan').open && document.querySelectorAll('.arch-steps small').length===0"))
    after = evaluate("(async()=>{const run=await(await fetch('/api/runs/" + fixture["runId"] + "')).json();return run.architectureProposals.at(-1)})()")
    receipt["proposalAfter"] = {k: after.get(k) for k in ["id", "version", "status", "digest"]}
    check("Navigation does not alter proposal or approval", receipt["proposalAfter"] == receipt["proposalBefore"])
    receipt["passed"] = True
    print(f"PASS: {len(receipt['checks'])} keyboard/path/plan assertions")
finally:
    try:
        call("close")
    finally:
        (args.evidence / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
