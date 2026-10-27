import assert from "node:assert/strict";
import test from "node:test";
import { decideCiGate } from "../lib/ci-gate.mjs";

const repository = "jappyjan/bobs-factory";
const commit = "a".repeat(40);
const run = (overrides = {}) => ({
	id: 1,
	head_sha: commit,
	head_branch: "main",
	path: ".github/workflows/ci.yml",
	event: "push",
	status: "completed",
	conclusion: "success",
	created_at: "2026-10-27T10:00:00Z",
	html_url: "https://github.com/jappyjan/bobs-factory/actions/runs/1",
	repository: { full_name: repository },
	head_repository: { full_name: repository },
	...overrides,
});
const decide = (runs, mainSha = commit) =>
	decideCiGate(runs, { commit, repository, mainSha });

test("passes only on a completed successful canonical run for the exact commit", () => {
	assert.equal(decide([run()]).action, "pass");
	assert.equal(decide([run({ event: "workflow_dispatch" })]).action, "pass");
});

test("ignores runs that are not canonical CI for the exact commit", () => {
	for (const other of [
		{ head_sha: "b".repeat(40) },
		{ head_branch: "feature" },
		{ path: ".github/workflows/release-channel.yml" },
		{ event: "pull_request" },
		{ head_repository: { full_name: "someone/fork" } },
		{ repository: { full_name: "someone/fork" } },
	])
		assert.notEqual(decide([run(other)], "c".repeat(40)).action, "pass");
});

test("a later failure does not hide the passed run, and a failed run never passes", () => {
	assert.equal(
		decide([
			run({ id: 2, conclusion: "failure", created_at: "2026-10-27T11:00:00Z" }),
			run(),
		]).action,
		"pass",
	);
	const failed = decide([run({ conclusion: "failure" })]);
	assert.equal(failed.action, "fail");
	assert.match(failed.reason, /failure/);
});

test("waits for a queued or running CI run", () => {
	for (const status of ["queued", "in_progress"])
		assert.equal(decide([run({ status, conclusion: null })]).action, "wait");
});

test("dispatches CI only when main still points at the commit", () => {
	assert.equal(decide([]).action, "dispatch");
	assert.equal(decide([run({ conclusion: "cancelled" })]).action, "dispatch");
	const moved = decide([], "c".repeat(40));
	assert.equal(moved.action, "fail");
	assert.match(moved.reason, /main has moved on/);
	assert.equal(
		decide([run({ conclusion: "cancelled" })], "c".repeat(40)).action,
		"fail",
	);
});

test("a skipped or timed-out run is a failure, not a pass", () => {
	for (const conclusion of [
		"skipped",
		"timed_out",
		"neutral",
		"startup_failure",
	])
		assert.equal(decide([run({ conclusion })]).action, "fail");
});
