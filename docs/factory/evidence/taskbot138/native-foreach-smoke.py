"""Actual compiled product API smoke; no Node/Bun or live inference in PATH.

Usage: python3 /tmp/taskbot138-native-foreach-smoke.py /absolute/bobs-factory
Runs only in a newly-created disposable home/repository. No release publication.
"""
import datetime
import hashlib
import json
import os
import pathlib
import shlex
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

binary = pathlib.Path(sys.argv[1]).resolve()
assert binary.is_file() and os.access(binary, os.X_OK), binary
root = pathlib.Path(tempfile.mkdtemp(prefix="taskbot138-native-foreach-"))
home = root / "home"
repo = root / "repo"
tools = root / "path"
for directory in [home, repo, tools, root / "empty-capacity", root / "stub-claude-config"]:
    directory.mkdir()
for tool in ["git", "ps", "sed", "cat", "mkdir", "rm", "sleep", "dirname", "basename", "date", "which", "env", "chmod", "xargs", "wc", "head", "tail", "tr", "cut", "readlink", "stat", "ls", "find", "uname", "touch", "sh"]:
    executable = shutil.which(tool)
    if executable:
        os.symlink(executable, tools / tool)
stub = tools / "claude"
stub.write_text("#!/bin/sh\nif [ \"$1\" = --version ]; then printf '%s\\n' '2.1.200 (controlled Claude stub)'; exit 0; fi\nprintf '%s\\n' 'Provider execution rejected by compiled-binary smoke stub' >> " + shlex.quote(str(root / "rejected-provider-starts.log")) + "\nprintf '%s\\n' 'Controlled smoke: all model execution is disabled' >&2\nexit 86\n")
stub.chmod(0o700)
environment = dict(os.environ)
for key in list(environment):
    if key.startswith("BOBS_FACTORY_") or key in {"ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"}:
        del environment[key]
environment.update({"PATH": str(tools), "BOBS_FACTORY_MIGRATION_SOURCE_CAPACITY_DIRECTORY": str(root / "empty-capacity"), "BOBS_FACTORY_SENTRY_DISABLED": "1", "CLAUDE_CONFIG_DIR": str(root / "stub-claude-config"), "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull})
assert shutil.which("node", path=environment["PATH"]) is None
assert shutil.which("bun", path=environment["PATH"]) is None

def git(directory, *args):
    return subprocess.check_output([str(tools / "git"), *args], cwd=directory, env=environment, stderr=subprocess.STDOUT, text=True).strip()

git(root, "init", "--bare", "-q", str(root / "origin.git"))
git(repo, "init", "-q", "-b", "main")
git(repo, "config", "user.name", "Compiled runtime fixture")
git(repo, "config", "user.email", "native-fixture@example.invalid")
git(repo, "config", "commit.gpgsign", "false")
(repo / "README.md").write_text("# Disposable compiled For each smoke\n")
(repo / ".gitignore").write_text(".claude/\n.codex/\n.cursor/\n.opencode/\nAGENTS.md\nCLAUDE.md\n")
git(repo, "add", ".")
git(repo, "commit", "-qm", "Disposable native fixture")
git(repo, "remote", "add", "origin", str(root / "origin.git"))
git(repo, "push", "-qu", "origin", "main")
(home / "config.json").write_text(json.dumps({"repositories": [{"id": "local", "name": "Compiled For each fixture", "repositoryPath": str(repo), "workspaceBaseDir": str(home / "worktrees"), "baseBranch": "main", "linearWorkspaceId": "cli-workspace", "isActive": True}], "defaultRunner": "claude", "maxConcurrentSessions": 2}, indent=2) + "\n")
(home / "config.json").chmod(0o600)
while True:
    first = socket.socket()
    first.bind(("127.0.0.1", 0))
    port = first.getsockname()[1]
    first.close()
    if port >= 65535:
        continue
    second = socket.socket()
    try:
        second.bind(("127.0.0.1", port + 1))
        second.close()
        break
    except OSError:
        second.close()
origin = "http://localhost:" + str(port)
command = [str(binary), "--home", str(home), "--repo", str(repo), "--agent", "claude", "--port", str(port), "--no-open"]
receipt = {"startedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(), "binary": str(binary), "binarySha256": hashlib.sha256(binary.read_bytes()).hexdigest(), "driverSha256": hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(), "command": command, "restrictedPath": environment["PATH"], "nodeOnPath": None, "bunOnPath": None, "directory": str(root), "paidCalls": 0, "cases": []}
worker = None
log = None
revision = None

def request(path, payload=None, method=None):
    data = None if payload is None else json.dumps(payload).encode()
    headers = {"Content-Type": "application/json", "x-factory-request": "1", "Origin": origin}
    if revision:
        headers["x-factory-config"] = revision
    req = urllib.request.Request(origin + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, json.load(error)

def start(label):
    global worker, log
    log = (root / (label + ".log")).open("w")
    worker = subprocess.Popen(command, cwd=root, env=environment, stdout=log, stderr=subprocess.STDOUT)
    for _ in range(160):
        assert worker.poll() is None, "Compiled product exited before readiness: " + str(worker.returncode)
        try:
            status, runtime = request("/api/version")
            if status == 200:
                receipt[label + "Runtime"] = runtime
                return
        except (OSError, urllib.error.URLError):
            pass
        time.sleep(0.25)
    raise AssertionError("Compiled API readiness timeout")

def stop(label):
    global worker, log
    if worker is None:
        return
    worker.terminate()
    try:
        code = worker.wait(timeout=20)
    except subprocess.TimeoutExpired:
        worker.kill()
        worker.wait()
        raise AssertionError("Compiled product did not stop cleanly")
    finally:
        log.close()
        worker = None
    receipt[label + "Exit"] = code
    assert code == 0, (label, code)

def step(identifier, script, next_step="end", reads=None):
    return {"id": identifier, "name": identifier, "type": "script", "script": script, "inputs": [], "reads": reads or {}, "next": next_step}

def check(identifier, reads, conditions, next_step="end"):
    return {"id": identifier, "name": identifier, "type": "check", "reads": reads, "check": {"results": {"valid": {"all": conditions}}, "passed": {"path": "/results/valid", "equals": True}}, "next": next_step}

inspect = r'''id=$(printf '%s' "$FACTORY_INPUT" | sed -n 's/.*"item":{"id":"\([^"]*\)".*/\1/p')
index=$(printf '%s' "$FACTORY_INPUT" | sed -n 's/.*"index":\([0-9][0-9]*\).*/\1/p')
owner=$(printf '%s' "$FACTORY_INPUT" | sed -n 's/.*"owner":"\([^"]*\)".*/\1/p')
[ -n "$id" ] && [ -n "$index" ] || exit 7
printf '%s/%s\n' "$owner" "$id" >> "$FACTORY_EVIDENCE_DIR/native-leaf-calls.txt"
if [ "$id" = bad ]; then printf '%s\n' 'Controlled shell item failure' >&2; exit 1; fi
printf '{"id":"%s","index":%s,"owner":"%s"}\n' "$id" "$index" "$owner"
'''
regions = [{"id": "north", "assignments": [{"id": "a1"}, {"id": "a2"}]}, {"id": "south", "assignments": [{"id": "b1"}]}]
def workflow(identifier, steps, internal=False):
    return {"id": identifier, "name": identifier, "stepConfigVersion": "step-config-v1", "steps": steps, "allowedTriggers": ["workflow"] if internal else ["manual"], **({"internal": True} if internal else {})}

child = workflow("native-foreach-child", [
    {"id": "assignments", "name": "Nested assignments", "type": "foreach", "items": {"from": "/item/assignments"}, "concurrency": 2, "body": [step("inspect", inspect, "verify-item", {"owner": "@callInputs/owner"}), check("verify-item", {"result": "inspect", "current": "@item", "position": "@index", "owner": "@callInputs/owner"}, [{"path": "/inputs/result/id", "equalsPath": "/inputs/current/id"}, {"path": "/inputs/result/index", "equalsPath": "/inputs/position"}, {"path": "/inputs/result/owner", "equalsPath": "/inputs/owner"}])], "next": "verify-child"},
    check("verify-child", {"batch": "assignments"}, [{"path": "/inputs/batch/summary/failed", "equals": 0}, {"path": "/inputs/batch/summary/completed", "min": 1}]),
], True)
definitions = [
    workflow("native-foreach-nested", [
        step("source", "printf '%s\\n' " + shlex.quote(json.dumps({"items": regions}, separators=(",", ":"))), "batch"),
        {"id": "batch", "name": "For each region", "type": "foreach", "items": {"from": "/source/items"}, "concurrency": 2, "body": [{"id": "call", "name": "Call assignment recipe", "type": "workflow", "workflow": child["id"], "inputMapping": {"owner": "/item/id"}, "next": "end"}], "next": "verify"},
        check("verify", {"batch": "batch"}, [{"path": "/inputs/batch/summary/failed", "equals": 0}, {"path": "/inputs/batch/summary/completed", "equals": 2}]),
    ]), child,
]
for policy in ["all-must-succeed", "keep-successful"]:
    definitions.append(workflow("native-foreach-" + policy, [
        {"id": "batch", "name": "Failure policy", "type": "foreach", "items": {"values": [{"id": "good"}, {"id": "bad"}, {"id": "later"}]}, "concurrency": 1, "failure": policy, "body": [step("inspect", inspect)], "next": "verify"},
        check("verify", {"batch": "batch"}, [{"path": "/inputs/batch/summary/completed", "equals": 2}, {"path": "/inputs/batch/summary/failed", "equals": 1}]),
    ]))

try:
    start("startup")
    status, config = request("/api/config")
    assert status == 200, (status, config)
    revision = config["configRevision"]
    assert config["repositories"], config
    repository_id = config["repositories"][0]["id"]
    catalog = config["workflows"]
    status, configured = request("/api/workflows", {"workflows": catalog + definitions, "defaultWorkflow": "native-foreach-nested"}, "PUT")
    assert status == 200, (status, configured)
    revision = configured["configRevision"]
    for definition in [value for value in definitions if not value.get("internal")]:
        identifier = definition["id"]
        status, launched = request("/api/runs", {"repositoryId": repository_id, "workflow": identifier, "prompt": "Execute the disposable shell-only For each recipe.", "runner": "claude", "execution": {}})
        assert status == 202, (identifier, status, launched)
        run_id = launched["id"]
        for _ in range(240):
            status, run = request("/api/runs/" + run_id)
            assert status == 200, (status, run)
            if run["status"] in ["completed", "failed", "stopped", "waiting"]:
                break
            time.sleep(0.25)
        else:
            raise AssertionError((identifier, "did not settle", run))
        expected = "failed" if identifier.endswith("all-must-succeed") else "completed"
        assert run["status"] == expected, (identifier, run)
        if expected == "failed":
            assert "Controlled shell item failure" in str(run.get("error")), run
            assert "verify" not in run["outputs"]
            assert [value["status"] for value in run["foreach"]["batch"]["items"]] == ["completed", "failed", "cancelled"], run["foreach"]
        else:
            assert run["outputs"]["verify"]["passed"] is True, run["outputs"]
            if identifier.endswith("keep-successful"):
                assert list(run["outputs"]["batch"]["results"]) == ["good", "later"]
                assert run["outputs"]["batch"]["summary"]["failures"][0]["id"] == "bad"
            else:
                for region in regions:
                    called = run["outputs"]["batch"]["results"][region["id"]]["call"]
                    assert called["completed"] is True
                    for index, item in enumerate(region["assignments"]):
                        result = called["outputs"]["assignments"]["results"][item["id"]]
                        assert result["inspect"] == {"id": item["id"], "index": index, "owner": region["id"]}, result
                        assert result["verify-item"]["passed"] is True
        activity_status, activity = request("/api/runs/" + run_id + "/activity?limit=200")
        assert activity_status == 200, (activity_status, activity)
        calls_file = home / "factory" / "evidence" / run_id / "native-leaf-calls.txt"
        calls = calls_file.read_text().splitlines()
        assert len(calls) == len(set(calls)), calls
        assert len(calls) == (2 if expected == "failed" else 3), calls
        case = {"workflow": identifier, "id": run_id, "status": run["status"], "outputs": run["outputs"], "foreach": run["foreach"], "calls": calls, "callsFile": str(calls_file), "activity": activity}
        receipt["cases"].append(case)
        (root / (identifier + ".json")).write_text(json.dumps(run, indent=2) + "\n")
    stop("firstShutdown")
    start("restart")
    for case in receipt["cases"]:
        status, run = request("/api/runs/" + case["id"])
        assert status == 200 and run["status"] == case["status"], (status, run)
        assert run["outputs"] == case["outputs"], case["id"]
        assert pathlib.Path(case["callsFile"]).read_text().splitlines() == case["calls"], "Completed terminal runs must not replay shell leaves on startup"
    receipt["restartAssertions"] = {"sameRunIds": True, "sameTerminalStatuses": True, "sameOutputs": True, "noCompletedLeafReplay": True, "boundary": "Restart after terminal completion/failure; not a mid-iteration crash"}
    receipt["result"] = "PASS"
except BaseException as error:
    receipt["result"] = "FAIL"
    receipt["error"] = repr(error)
    raise
finally:
    try:
        stop("finalShutdown")
    finally:
        receipt["finishedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        rejected = root / "rejected-provider-starts.log"
        receipt["rejectedProviderStarts"] = len(rejected.read_text().splitlines()) if rejected.exists() else 0
        (root / "results.json").write_text(json.dumps(receipt, indent=2) + "\n")
        print(json.dumps({"directory": str(root), "result": receipt.get("result"), "cases": len(receipt["cases"]), "binarySha256": receipt["binarySha256"], "rejectedProviderStarts": receipt["rejectedProviderStarts"]}))
