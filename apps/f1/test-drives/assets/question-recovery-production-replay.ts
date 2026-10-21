// bun apps/f1/test-drives/assets/question-recovery-production-replay.ts <private-clone> [owned-launch-assets]
// Raw snapshots and binary attachments stay outside this repository. This drive
// uses scripted RuntimeHooks, never a native agent or a live provider command.
import "../../../../packages/edge-worker/src/factory/defaultWorkflows.js";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	linkSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { JsonSnapshotStore } from "../../../../packages/core/src/JsonSnapshotStore.js";
import {
	type ImpactAssessment,
	type ImpactDecision,
	type ImpactSnapshot,
	recordConvergence,
} from "../../../../packages/edge-worker/src/factory/Impact.js";
import {
	type ExecutionContext,
	type FactoryRun,
	type GraphCheckpoint,
	WorkflowRuntime,
} from "../../../../packages/edge-worker/src/factory/WorkflowRuntime.js";

const source = process.argv[2];
assert(source, "Pass the isolated production-data clone, never a live home");
const privateClone = realpathSync(source);
const liveHome = resolve(homedir(), ".bobs-factory");
assert(
	privateClone !== liveHome && !privateClone.startsWith(`${liveHome}${sep}`),
	"Refuse a live Factory home",
);
const originalFactory = join(privateClone, "factory");
const originalRuns = join(originalFactory, "runs");
const originalChunks = join(originalFactory, "run-chunks");
const hash = (bytes: string | Buffer) =>
	createHash("sha256").update(bytes).digest("hex");
const files = (directory: string) => readdirSync(directory).sort();
const manifestNames = files(originalRuns).filter((name) =>
	name.endsWith(".json"),
);
const chunkNames = files(originalChunks);
const manifestsBefore = new Map(
	manifestNames.map((name) => [
		name,
		hash(readFileSync(join(originalRuns, name))),
	]),
);
let chunkBytes = 0;
for (const name of chunkNames) {
	assert.match(name, /^[a-f0-9]{64}\.json$/);
	const path = join(originalChunks, name);
	assert(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink());
	const bytes = readFileSync(path);
	assert.equal(hash(bytes), name.slice(0, -5), "Original chunk hash mismatch");
	chunkBytes += bytes.length;
}
const sourceStore = new JsonSnapshotStore(originalChunks);
const originals = manifestNames.map(
	(name) => sourceStore.load<FactoryRun>(join(originalRuns, name)).value,
);
const waiting = originals.filter((run) => run.status === "waiting");
assert.equal(originals.length, 6, "This replay expects the six-run capture");
assert.equal(waiting.length, 4, "This capture contains four assistance waits");
assert.equal(originals.filter((run) => run.status === "running").length, 2);
console.error("Verified the six-run capture and all original chunk hashes.");

const home = mkdtempSync(join(tmpdir(), "factory-question-working-"));
const factory = join(home, "factory");
const runs = join(factory, "runs");
const chunks = join(factory, "run-chunks");
mkdirSync(runs, { recursive: true });
mkdirSync(chunks);
// Chunks are immutable. Snapshot writes use a new temporary file and rename,
// replacing only a working-directory entry, never an existing source inode.
for (const name of chunkNames) {
	try {
		linkSync(join(originalChunks, name), join(chunks, name));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
		copyFileSync(join(originalChunks, name), join(chunks, name));
	}
}
for (const name of manifestNames)
	copyFileSync(join(originalRuns, name), join(runs, name));

const workspace = join(home, "repository");
mkdirSync(workspace);
const git = (...args: string[]) =>
	execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
		cwd: workspace,
		stdio: "pipe",
		encoding: "utf8",
	}).trim();
git("-c", "init.templateDir=", "init", "-b", "main");
git(
	"-c",
	"user.name=Scripted reproduction",
	"-c",
	"user.email=fixture@example.invalid",
	"-c",
	"commit.gpgsign=false",
	"commit",
	"--allow-empty",
	"-m",
	"Disposable replay boundary",
);
assert.equal(git("remote"), "", "The replay repository must have no remotes");

const leaf = (frame: GraphCheckpoint): GraphCheckpoint => {
	if (!frame.active?.children?.length) return frame;
	assert.equal(
		frame.active.children.length,
		1,
		"Assistance must have one owner",
	);
	return leaf(frame.active.children[0]!);
};
const workingStore = new JsonSnapshotStore(chunks);
const attachmentSources = new Map<string, string>();
let copiedAttachments = 0;
for (const original of waiting) {
	const path = join(runs, `${original.id}.json`);
	const run = workingStore.load<FactoryRun>(path).value;
	run.workspace = workspace;
	for (const repository of run.repositories ?? []) {
		repository.workspace = workspace;
		repository.repositoryPath = workspace;
		git("update-ref", `refs/remotes/origin/${repository.baseBranch}`, "HEAD");
	}
	if (run.launchAttachments) {
		const assetSource =
			process.argv[3] ?? join(originalFactory, "launch-assets");
		const sourceFolder = join(assetSource, "runs", run.id);
		const targetFolder = join(factory, "launch-assets", "runs", run.id);
		mkdirSync(targetFolder, { recursive: true });
		const manifest = join(sourceFolder, "manifest.json");
		assert(
			existsSync(manifest),
			"Supply the original owned launch-asset store",
		);
		assert(!lstatSync(manifest).isSymbolicLink());
		attachmentSources.set(manifest, hash(readFileSync(manifest)));
		copyFileSync(manifest, join(targetFolder, "manifest.json"));
		for (const asset of Object.values(run.launchAttachments).flat()) {
			assert.match(asset.id, /^[a-f0-9-]{36}$/);
			const sourcePath = join(sourceFolder, asset.id);
			assert(
				lstatSync(sourcePath).isFile() &&
					!lstatSync(sourcePath).isSymbolicLink(),
			);
			const bytes = readFileSync(sourcePath);
			assert.equal(bytes.length, asset.size);
			assert.equal(hash(bytes), asset.sha256);
			attachmentSources.set(sourcePath, asset.sha256);
			asset.path = join(targetFolder, asset.id);
			writeFileSync(asset.path, bytes, { flag: "wx", mode: 0o400 });
			copiedAttachments++;
		}
	}
	await workingStore.write(
		path,
		run as unknown as Record<string, unknown>,
		{ id: run.id, status: run.status, createdAt: run.createdAt },
		["outputs", "repositoryOutputs"],
		[],
		{ history: 1, events: 8 },
	);
}
await workingStore.flush();
console.error(
	"Prepared disposable manifests, repository and verified attachment copies.",
);

const question =
	"Scripted replay: the independently required prerequisite remains unresolved.";
const calls: {
	id: string;
	step: string;
	nativeRetained: boolean;
	questionReceipt: boolean;
}[] = [];
const expectedNative = new Map(
	waiting.map((run) => [
		run.id,
		leaf(run.checkpoint!).active!.agent!.sessionId,
	]),
);
const runtime = new WorkflowRuntime(home, {
	agent: async (context: ExecutionContext) => {
		assert(
			context.questionRecheck,
			"Restoring a wait must not execute an agent",
		);
		assert(
			!context.resumeAgent?.result,
			"Recheck must discard the completed turn cache",
		);
		assert.equal(
			hash(
				JSON.stringify(
					(context.input as { questionRecheck?: unknown }).questionRecheck,
				),
			),
			hash(JSON.stringify(context.questionRecheck)),
		);
		const nativeRetained =
			context.resumeAgent?.sessionId === expectedNative.get(context.run.id);
		if (!context.step.impactContract) assert(nativeRetained);
		calls.push({
			id: context.run.id,
			step: context.stepKey!,
			nativeRetained,
			questionReceipt: true,
		});
		if (context.step.impactContract) {
			const snapshot = (context.input as { impactSnapshot: ImpactSnapshot })
				.impactSnapshot;
			return {
				impactContract: "impact-v1",
				status: "blocked",
				summary:
					"Scripted independent assessment; no correction or approval claimed",
				correctionRequired: true,
				readinessOnly: false,
				commentAssessments: [],
				classification: "full",
				rationale:
					"Disposable repository cannot establish the original product prerequisites",
				uncertainty: [
					"Original private repository behavior is not executed in this replay",
				],
				extractRequirements: true,
				specialists: snapshot.reviewers.map((reviewer) => reviewer.id),
				requirementIds: [],
				checks: [],
				qaCriteria: [],
				qaReuse: [],
				reuse: [],
				invalidate: [],
				targetCompatible: false,
				testAssertions: {
					inspected: false,
					weakened: false,
					evidence: "No assertions inspected or changed",
				},
				humanReview: snapshot.approval ? "renew" : "no-prior-approval",
				approvalRationale:
					"All independent evidence and explicit approval remain required",
				questions: [question],
			} satisfies ImpactAssessment;
		}
		return {
			summary:
				"Scripted blocker re-evaluation; no source changes or dispositions claimed",
			questions: [question],
		};
	},
	script: async () => {
		throw new Error("Unexpected script execution");
	},
	tool: async () => {
		throw new Error("Unexpected provider/tool execution");
	},
});
const waitFor = async (condition: () => boolean, run: FactoryRun) => {
	const deadline = Date.now() + 60_000;
	while (!condition()) {
		assert(run.status !== "failed", run.error);
		assert(Date.now() < deadline, "Timed out waiting for scripted recovery");
		await new Promise((resolveWait) => setTimeout(resolveWait, 20));
	}
};
const results: {
	role: string;
	nativeConversationRetained: boolean;
	originalHistory: number;
	originalAnswers: number;
	recheckReceiptSaved: boolean;
}[] = [];
try {
	for (const original of waiting) {
		const run = runtime.get(original.id);
		const baseline = JSON.parse(
			readFileSync(join(runs, `${run.id}.json`), "utf8"),
		);
		const history = run.history.length;
		const answers = hash(JSON.stringify(run.answers));
		const decisions = hash(JSON.stringify(run.humanDecisions ?? []));
		const architecture = hash(JSON.stringify(run.architectureDecisions ?? []));
		const definitions = hash(JSON.stringify(run.workflowDefinitions));
		const visit = leaf(run.checkpoint!).visits[leaf(run.checkpoint!).current]!;
		void runtime.launch(run);
		await waitFor(() => runtime.canRecheckQuestions(run.id), run);
		assert.equal(
			hash(JSON.stringify(run.questions)),
			hash(JSON.stringify(original.questions)),
		);
		assert.equal(calls.filter((call) => call.id === run.id).length, 0);
		const context = {
			step: run.step!,
			questionBatchId: run.questionBatchId!,
			questions: [...run.questions],
		};
		await assert.rejects(
			runtime.recheckQuestions(run.id, {
				...context,
				questionBatchId: "stale",
			}),
			/changed/,
		);
		const rechecking = runtime.recheckQuestions(run.id, context);
		assert.equal(
			leaf(run.checkpoint!).active!.agent!.sessionId,
			expectedNative.get(run.id),
		);
		assert(!leaf(run.checkpoint!).active!.agent!.result);
		await rechecking;
		await waitFor(
			() =>
				runtime.canRecheckQuestions(run.id) &&
				run.questionBatchId !== context.questionBatchId,
			run,
		);
		assert.deepEqual(run.questions, [question]);
		assert.equal(calls.filter((call) => call.id === run.id).length, 1);
		assert.equal(
			leaf(run.checkpoint!).visits[leaf(run.checkpoint!).current],
			visit + 1,
		);
		assert.equal(run.history.length, history + 1);
		assert.equal(hash(JSON.stringify(run.answers)), answers);
		assert.equal(hash(JSON.stringify(run.humanDecisions ?? [])), decisions);
		assert.equal(
			hash(JSON.stringify(run.architectureDecisions ?? [])),
			architecture,
		);
		assert.equal(hash(JSON.stringify(run.workflowDefinitions)), definitions);
		assert(run.history.at(-1)!.questionRecheck);
		await runtime.flush(run.id);
		const saved = JSON.parse(
			readFileSync(join(runs, `${run.id}.json`), "utf8"),
		);
		assert.equal(
			hash(JSON.stringify(saved.fields.history.pages.slice(0, history))),
			hash(JSON.stringify(baseline.fields.history.pages)),
		);
		results.push({
			role: original.step!,
			nativeConversationRetained: calls.find((call) => call.id === run.id)!
				.nativeRetained,
			originalHistory: history,
			originalAnswers: original.answers.length,
			recheckReceiptSaved: true,
		});
		console.error(
			`Rechecked copied assistance ${results.length}/${waiting.length}; original evidence retained.`,
		);
	}
} finally {
	await runtime.shutdown();
}

const impactRun = originals.find((run) =>
	run.step?.endsWith("/assess-impact"),
)!;
const ordinary = sourceStore.load<FactoryRun>(
	join(originalRuns, `${impactRun.id}.json`),
).value;
const priorOrdinary = ordinary.impactDecisions!.at(-1)!;
assert.match(
	recordConvergence(
		ordinary,
		priorOrdinary.snapshot.key,
		{
			...structuredClone(priorOrdinary),
			status: "completed",
			questions: [],
		},
		3,
	)[0]!,
	/returned 4 times/,
);
const blocked = impactRun.impactDecisions!.at(-1)!;
const fresh: ImpactDecision = {
	...structuredClone(blocked),
	status: "completed",
	questions: [],
	at: new Date().toISOString(),
};
const convergence = structuredClone(impactRun.impactConvergence);
assert.deepEqual(
	recordConvergence(impactRun, blocked.snapshot.key, fresh, 3, {
		key: blocked.snapshot.key,
		snapshotDigest: blocked.snapshot.digest,
		at: blocked.at,
	}),
	[],
);
assert.deepEqual(impactRun.impactConvergence, convergence);
impactRun.impactDecisions!.push(fresh);
assert.match(
	recordConvergence(impactRun, blocked.snapshot.key, fresh, 3)[0]!,
	/returned 4 times/,
);

assert.deepEqual(files(originalChunks), chunkNames);
for (const name of chunkNames)
	assert.equal(
		hash(readFileSync(join(originalChunks, name))),
		name.slice(0, -5),
	);
for (const [name, digest] of manifestsBefore)
	assert.equal(hash(readFileSync(join(originalRuns, name))), digest);
for (const [path, digest] of attachmentSources)
	assert.equal(hash(readFileSync(path)), digest);
const sourceHashes = Object.fromEntries(
	[
		"packages/edge-worker/src/factory/WorkflowRuntime.ts",
		"packages/edge-worker/src/factory/Impact.ts",
		"apps/f1/test-drives/assets/question-recovery-production-replay.ts",
	].map((name) => [name, hash(readFileSync(name))]),
);
console.log(
	JSON.stringify(
		{
			mode: "scripted runtime hooks; no native agents or live provider I/O",
			manifests: manifestNames.length,
			chunks: chunkNames.length,
			chunkBytes,
			attachments: copiedAttachments,
			rechecks: results,
			convergence:
				"ordinary assessment reblocks at repeat 4; exact prior wait permits one correction with repeat 3 retained; next unchanged assessment blocks at repeat 4",
			priorHistoryPagesRetained: true,
			answersAndApprovalsUnchanged: true,
			originalManifestChunkAndAttachmentHashesUnchanged: true,
			sourceHashes,
			workingHome: home,
		},
		null,
		2,
	),
);
