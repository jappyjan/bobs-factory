import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const here = import.meta.dirname;
const read = (name) => JSON.parse(readFileSync(join(here, name), "utf8"));
const receipt = read("identity.json"),
	observation = receipt.observations.at(-1);
const sha = (data) => createHash("sha256").update(data).digest("hex");
const output = {
	at: new Date().toISOString(),
	source: receipt.head,
	build: receipt.build,
	assertions: [],
	api: [],
};
assert(observation, "Driver retained an actual final observation");
const check = (name, run) => {
	run();
	output.assertions.push(name);
};
check(
	"Source research executes once; Ask is a separate single invocation",
	() => {
		assert.equal(
			observation.calls.filter(
				(c) => c.runId === receipt.ids.decide && c.step === "research",
			).length,
			1,
		);
		assert.equal(
			observation.calls.filter((c) => c.step === "view-follow-up").length,
			1,
		);
	},
);
const choose = observation.runs.decide,
	artifact = observation.runs.approve,
	overview = observation.runs.runs;
check("Ordinary routes use exact accepted choices and hasFollowUps", () => {
	assert.equal(choose.status, "completed");
	assert.equal(choose.outputs.choose.hasFollowUps, true);
	assert.deepEqual(
		choose.outputs.choose.choices.map((c) => [c.itemId, c.action]),
		[
			["cache", "fix"],
			["labels", "issue"],
			["unsafe", "skip"],
		],
	);
	assert(choose.history.some((e) => e.step === "followups"));
	assert(!choose.history.some((e) => e.step === "finished"));
	assert.deepEqual(
		choose.outputs.research,
		receipt.original.runs.decide.outputs.research,
	);
	assert.equal(choose.outputs.choose.followUps[0].thread[0].status, "answered");
});
check(
	"Both explicit approval outcomes retain fields, feedback and exact displayed digest",
	() => {
		assert.equal(artifact.status, "completed");
		assert.equal(artifact.decision.answer.approved, false);
		assert.equal(artifact.decision.answer.fields.understood, true);
		assert(artifact.decision.answer.feedback.length > 0);
		assert(artifact.history.some((e) => e.step === "changes"));
		assert.equal(overview.decision.answer.approved, true);
		assert.equal(artifact.decision.digest, artifact.decision.answer.digest);
		assert.equal(
			overview.status,
			"waiting",
			"Independent pending child obligations remain",
		);
	},
);
check(
	"Notifications are distinct by actual run and notice text; both real reconstructions preserve notice count",
	() => {
		const keys = observation.notifications.map((n) => n.runId + "\n" + n.text);
		assert.equal(new Set(keys).size, keys.length);
		assert.equal(receipt.restarts.length, 2);
		for (const restart of receipt.restarts) {
			assert.deepEqual(
				restart.before.runs.decide.records,
				restart.after.runs.decide.records,
			);
			assert.deepEqual(
				restart.before.runs.approve.records,
				restart.after.runs.approve.records,
			);
			assert.equal(
				restart.before.notifications.length,
				restart.after.notifications.length,
			);
		}
	},
);
const ask = read("ask-keyboard-interaction.json.raw");
check(
	"Real Ask preserves drafts and invalidates only content confirmation, with native keyboard focus",
	() => {
		assert.equal(ask.before.selected, true);
		assert.equal(ask.after.selected, true);
		assert.equal(ask.before.comment, ask.after.comment);
		assert.equal(ask.before.confirmed, true);
		assert.equal(ask.after.confirmed, false);
		assert.equal(ask.after.askOpen, true);
		assert.notEqual(ask.original.digest, ask.after.decision.digest);
		assert.equal(ask.keyboard.arrowRight.value, "issue");
		assert.equal(ask.keyboard.arrowRight.outline, "solid");
		assert.equal(ask.keyboard.tabFocus.tag, "TEXTAREA");
	},
);
check(
	"Stale answers, incomplete approval fields, HTML/private pointer/remote media inputs are rejected by production API",
	() => {
		const negatives = read("negative-api-interaction.json.raw");
		assert.equal(negatives.results.length, 7);
		for (const result of negatives.results)
			assert([400, 409].includes(result.status), result.name);
		assert.equal(negatives.attack, null);
	},
);
check(
	"Builder live sample/last-run preview, path discovery, provenance and invalid Save were exercised",
	() => {
		const b = read("builder-interaction.json.raw"),
			p = read("builder-path-and-errors.json.raw");
		assert(b.sample.preview.includes("Sample finding"));
		assert(b.lastRun.preview.includes("Treat untrusted strings as text"));
		assert(b.lastRun.provenance[0].includes("accepted definition matches"));
		assert(
			b.differing.provenance[0].includes(
				"retained accepted input snapshot; draft configuration differs",
			),
		);
		assert.equal(
			b.valid.saveButtons.find((x) => x.text === "Save").disabled,
			false,
		);
		assert.equal(
			b.invalid.saveButtons.find((x) => x.text === "Save").disabled,
			true,
		);
		assert(b.invalid.error.length > 0);
		assert.equal(p.pathInsertion.path, "/inputs/research/summary");
		assert.equal(p.pathInsertion.available, true);
		assert.deepEqual(p.pathInsertion.errors, []);
	},
);
check(
	"All six 360px/theme audits have zero overflow, remote resource or executable DOM",
	() => {
		const audits = read("360-accessibility-audit-settled.json.raw").audits;
		assert.equal(audits.length, 6);
		for (const a of audits) {
			assert.equal(a.theme, a.expectedTheme);
			assert.equal(a.width, 360);
			assert.equal(a.document, 360);
			assert.equal(a.body, 360);
			assert.deepEqual(a.overflows, []);
			assert.equal(a.unsafeDOM, 0);
			assert.equal(a.remoteResources, 0);
			assert.equal(a.attack, null);
		}
	},
);
check(
	"Twelve current source screenshots have the exact required viewport/theme matrix",
	() => {
		const screenshots = read("screenshots.json.raw");
		assert.equal(screenshots.length, 12);
		for (const screenshot of screenshots) {
			assert.equal(
				screenshot.audit.theme,
				screenshot.name.includes("-dark") ? "dark" : "light",
			);
			assert.equal(
				screenshot.audit.width,
				screenshot.name.includes("390px") ? 390 : 1440,
			);
			const bytes = readFileSync(join(here, screenshot.name));
			assert.equal(bytes.toString("hex", 0, 8), "89504e470d0a1a0a");
		}
	},
);
const originalDriver = readFileSync(join(here, "driver-executed.mjs"));
check("Executed driver bytes match the original execution identity", () =>
	assert.equal(
		sha(originalDriver),
		receipt.source["apps/f1/test-drives/assets/taskbot140-views-ui.mjs"],
	),
);
output.driverCorrection = {
	executedSha256: sha(originalDriver),
	correctedReusableSha256: sha(
		readFileSync(resolve(here, "../../../taskbot140-views-ui.mjs")),
	),
	reason:
		"The run,text notification hook cannot infer Show publication identity from the previous run.viewDecision. The reusable driver now deduplicates exact run+text; this external verifier checks the actual original execution without hotpatching it.",
};
const headers = {
	"Content-Type": "application/json",
	"X-Factory-Request": "1",
	"X-Factory-Build": receipt.build,
	Origin: receipt.origin,
};
const post = async (path, body) => {
	const response = await fetch(receipt.origin + path, {
		method: "POST",
		headers,
		body: JSON.stringify(body),
	});
	const result = await response.json();
	output.api.push({ path, body, status: response.status, result });
	return { status: response.status, result };
};
for (const run of [choose, artifact, overview]) {
	const answer = run.records.find((r) => r.answer)?.answer;
	assert(answer, "Canonical accepted request retained");
	const replies = await Promise.all([
		post(`/api/runs/${run.id}/view-answer`, answer.request),
		post(`/api/runs/${run.id}/view-answer`, answer.request),
	]);
	for (const reply of replies) {
		assert.equal(reply.status, 200);
		assert.deepEqual(reply.result.output, answer.output);
	}
}
output.assertions.push(
	"Six concurrent identical accepted retries return the original canonical outputs without replacing human decisions",
);
const request = choose.records.find((r) => r.answer).answer.request;
const conflict = {
	...request,
	choices: request.choices.map((c, i) => (i ? c : { ...c, action: "skip" })),
};
assert.equal(
	(await post(`/api/runs/${choose.id}/view-answer`, conflict)).status,
	409,
);
const after = await (
	await fetch(receipt.origin + `/api/runs/${choose.id}`, { headers })
).json();
assert.deepEqual(after.viewDecision.answer, choose.decision.answer);
output.assertions.push(
	"Conflicting accepted retry is rejected and original decision remains immutable",
);
writeFileSync(
	join(here, "verification.json.raw"),
	JSON.stringify(output, null, 2) + "\n",
);
for (const name of output.assertions) console.log("PASS " + name);
console.log(
	JSON.stringify({
		passed: output.assertions.length,
		source: output.source,
		build: output.build,
		apiRequests: output.api.length,
		scriptSha256: sha(readFileSync(import.meta.filename)),
	}),
);
