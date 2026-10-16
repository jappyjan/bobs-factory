import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

// Run against the isolated Share fixture, after opening this named headless session.
const session = "share-resume-fix-5442324b";
const origin = "http://localhost:3597";
function ab(...args) {
	const result = JSON.parse(
		execFileSync("agent-browser", ["--session", session, ...args, "--json"], {
			encoding: "utf8",
			timeout: 45000,
		}),
	);
	assert(result.success, JSON.stringify(result));
	return result.data;
}
const ev = (code) =>
	ab("eval", "-b", Buffer.from(code).toString("base64")).result;
async function wait(code) {
	await ev(
		`(async()=>{for(let i=0;i<100;i++){if(${code})return;await new Promise(r=>setTimeout(r,50));}throw Error('condition timeout')})()`,
	);
}
const receipts = () =>
	fetch(`${origin}/fixture/receipts`).then((r) => r.json());
const bounds = (selector) =>
	ev(
		`([...document.querySelectorAll(${JSON.stringify(selector)})].map(e=>{const r=e.getBoundingClientRect();return {text:e.textContent,disabled:e.disabled,x:r.x,right:r.right,y:r.y,bottom:r.bottom,width:r.width,height:r.height}}))`,
	);
function fits(items, width) {
	assert(items.length > 0);
	for (const item of items) {
		assert(item.width > 0 && item.height > 0);
		assert(item.x >= 0 && item.right <= width);
	}
}
function noOverlap(items) {
	for (let i = 0; i < items.length; i++)
		for (const b of items.slice(i + 1)) {
			const a = items[i];
			assert(
				a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y,
			);
		}
}
const observations = [];
await fetch(`${origin}/fixture/select/all`);
ab("set", "viewport", "390", "844");
for (const id of ["resumable", "queued"]) {
	ab("open", `${origin}/#/runs/${id}`);
	await wait(
		`document.querySelector('.run-header h1')?.textContent===${JSON.stringify(id)}`,
	);
	ev("document.documentElement.dataset.theme='light'");
	const selector = `button[aria-label="Share run: ${id}"]`;
	const resumeSelector = ".focus-card .actions button";
	const beforeButtons = await bounds(resumeSelector);
	if (id === "resumable")
		assert.equal(
			beforeButtons.filter((b) => b.text.includes("Resume run") && !b.disabled)
				.length,
			1,
		);
	ev(
		"window.copies=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:url=>{copies.push(url);return Promise.resolve()}}})",
	);
	const before = await receipts();
	const url = ev("location.href");
	ab("click", selector);
	await wait(
		"document.querySelector('.toast')?.textContent==='Run link copied'",
	);
	assert.deepEqual(ev("window.copies"), [`${origin}/#/runs/${id}`]);
	assert.equal(ev("location.href"), url);
	const after = await receipts();
	assert.deepEqual(after.runs, before.runs);
	assert(
		after.requests
			.slice(before.requests.length)
			.every((r) => r.method === "GET"),
	);
	const header = await bounds(".run-header .actions > *");
	fits(header, 390);
	noOverlap(header);
	assert.equal(ev("document.documentElement.scrollWidth"), 390);
	if (id === "resumable") {
		const afterButtons = await bounds(resumeSelector);
		assert.deepEqual(afterButtons, beforeButtons);
		fits(afterButtons, 390);
		assert.equal(after.runs.find((r) => r.id === id).status, "stopped");
	} else
		assert(
			ev(
				"document.querySelector('.run-header').textContent.includes('Waiting for instance capacity')",
			),
		);
	observations.push({
		id,
		header,
		resume: id === "resumable" ? beforeButtons : [],
		copied: ev("window.copies"),
		runtimeUnchanged: true,
		mutationRequests: [],
	});
}
const result = {
	storyId: "share-detail-and-url",
	criterionId: "share-detail-layout",
	outcome: "passed",
	exitCode: 0,
	expected:
		"The narrow queued header shows Share and the capacity message without overlap, clipping or horizontal overflow. On the stopped detail page, header Share and the existing Resume action in full Focus content remain usable. Sharing does not activate, disable or relocate Resume.",
	sourceRevision: execFileSync("git", ["rev-parse", "HEAD"], {
		encoding: "utf8",
	}).trim(),
	servedVersion: await fetch(`${origin}/api/version`).then((r) => r.json()),
	viewport: { width: 390, height: 844 },
	agentMode: "mock",
	clipboard: "simulated",
	observations,
};
writeFileSync(process.env.RECEIPT, `${JSON.stringify(result, null, 2)}\n`);
ab("close");
console.log(
	"PASS share-detail-layout: stopped Resume preserved; queued header fits",
);
