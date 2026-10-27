#!/usr/bin/env node
// Refuses to continue a release build unless "CI / Validate" passed for the
// exact frozen commit. Waits for a running CI, or dispatches one when missing.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { REPOSITORY, requireValue } from "./lib/binary-release.mjs";
import { decideCiGate } from "./lib/ci-gate.mjs";
import { githubClient } from "./lib/github-release.mjs";
import { validateCandidate } from "./lib/release-candidate.mjs";

const { values } = parseArgs({
	options: {
		candidate: { type: "string" },
		output: { type: "string" },
		"timeout-minutes": { type: "string", default: "50" },
		"poll-seconds": { type: "string", default: "30" },
	},
});
requireValue(values.candidate, "Provide --candidate FILE");
const repository = REPOSITORY;
const { candidate } = validateCandidate(
	JSON.parse(readFileSync(values.candidate)),
);
const commit = candidate.commit;
const client = githubClient();
const deadline = Date.now() + Number(values["timeout-minutes"]) * 60_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let dispatchedAt;
for (;;) {
	const runs = await client.pages(
		`actions/workflows/ci.yml/runs?head_sha=${commit}`,
		"workflow_runs",
	);
	const mainSha = (await client.api("git/ref/heads/main")).object.sha;
	const decision = decideCiGate(runs, { commit, repository, mainSha });
	if (decision.action === "pass") {
		const run = decision.run;
		console.log(`CI / Validate passed for ${commit}: ${run.html_url}`);
		const evidence = {
			runId: run.id,
			runAttempt: run.run_attempt,
			event: run.event,
			headSha: run.head_sha,
			conclusion: run.conclusion,
			url: run.html_url,
		};
		if (values.output) writeFileSync(values.output, JSON.stringify(evidence));
		if (process.env.GITHUB_STEP_SUMMARY)
			appendFileSync(
				process.env.GITHUB_STEP_SUMMARY,
				`CI / Validate passed for \`${commit}\`: ${run.html_url}\n`,
			);
		process.exit(0);
	}
	requireValue(decision.action !== "fail", decision.reason);
	requireValue(Date.now() < deadline, `Timed out waiting for CI for ${commit}`);
	if (decision.action === "dispatch") {
		if (dispatchedAt === undefined) {
			console.log(
				`No CI run for ${commit}; dispatching CI / Validate on main.`,
			);
			await client.api("actions/workflows/ci.yml/dispatches", {
				method: "POST",
				body: { ref: "main" },
			});
			dispatchedAt = Date.now();
		} else {
			// The dispatched run can take a moment to appear in the listing.
			requireValue(
				Date.now() - dispatchedAt < 3 * 60_000,
				`CI dispatched for ${commit} did not produce a usable run`,
			);
			console.log("Waiting for the dispatched CI run to appear.");
		}
	} else console.log(`Waiting for CI run ${decision.run.html_url}`);
	await sleep(Number(values["poll-seconds"]) * 1000);
}
