// F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/repository-io-nodes.ts
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createCLIIssueTracker,
	type EdgeWorkerConfig,
} from "bobs-factory-core";
import { EdgeWorker } from "../../../../packages/edge-worker/src/EdgeWorker.ts";
import { WorkflowSchema } from "../../../../packages/edge-worker/src/factory/Workflow.ts";
import type { WorkflowRuntime } from "../../../../packages/edge-worker/src/factory/WorkflowRuntime.ts";
import { f1AgentHandlers } from "../../src/MockAgentRunner.ts";

assert.equal(process.env.F1_AGENT_MODE, "mock");
const root = mkdtempSync(join(tmpdir(), "f1-repository-io-"));
const repo = join(root, "repo"),
	home = join(root, "home"),
	bin = join(root, "bin"),
	remote = join(root, "remote.git");
mkdirSync(repo);
mkdirSync(bin);
process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_NOSYSTEM = "1";
const git = (cwd: string, ...args: string[]) =>
	execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
git(repo, "init", "-q", "-b", "main");
git(repo, "config", "user.name", "F1");
git(repo, "config", "user.email", "f1@example.invalid");
git(repo, "config", "commit.gpgsign", "false");
writeFileSync(join(repo, "README.md"), "Fixture\n");
git(repo, "add", ".");
git(repo, "commit", "-qm", "Fixture");
git(repo, "clone", "-q", "--bare", repo, remote);
git(repo, "remote", "add", "origin", remote);
const base = git(repo, "rev-parse", "HEAD");
// Verify that the recipe's opt-out works with a real failing commit hook.
const hook = join(repo, ".git", "hooks", "pre-commit");
writeFileSync(hook, "#!/bin/sh\nexit 1\n");
chmodSync(hook, 0o755);
const statePath = join(root, "provider.json");
writeFileSync(statePath, JSON.stringify({ creates: 0, notes: [] }));
process.env.F1_IO_STATE = statePath;
const glab = join(bin, "glab");
writeFileSync(
	glab,
	`#!/usr/bin/env node
const fs=require('node:fs'), cp=require('node:child_process');
const file=process.env.F1_IO_STATE, s=JSON.parse(fs.readFileSync(file,'utf8'));
const args=process.argv.slice(2), path=args[1], method=args[args.indexOf('--method')+1]||'GET';
const fields={}; for(let i=0;i<args.length;i++) if(args[i]==='--raw-field') {const p=args[++i], n=p.indexOf('=');fields[p.slice(0,n)]=p.slice(n+1);}
const git=(...a)=>cp.execFileSync('git',a,{encoding:'utf8'}).trim();
const save=()=>fs.writeFileSync(file,JSON.stringify(s));
const out=(v)=>{save();process.stdout.write(JSON.stringify(v));};
if(path.includes('/merge_requests?')) out(s.mr?[s.mr]:[]);
else if(path.endsWith('/merge_requests')&&method==='POST') {
 s.creates++; s.mr={web_url:'https://gitlab.example/team/project/-/merge_requests/1',iid:1,title:fields.title.trim(),description:fields.description+'\\n',
 source_branch:fields.source_branch,target_branch:fields.target_branch,sha:git('rev-parse','HEAD'),state:'opened',draft:true,
 source_project_id:1,target_project_id:1,detailed_merge_status:'draft_status',labels:['fixture'],head_pipeline:{id:1,sha:git('rev-parse','HEAD'),status:'success'}};
 save(); process.stderr.write('Simulated lost response after creation');process.exit(1);
}
else if(path.endsWith('/approvals')) out({approvals_left:0,approved_by:[{user:{username:'fixture'}}]});
else if(path.includes('/discussions')) out([]);
else if(path.includes('/notes')) {
 if(method==='POST'){const note={id:s.notes.length+1,body:fields.body};s.notes.push(note);out(note);}else out(s.notes);
}
else if(path.includes('/repository/branches/')) out({commit:{id:git('rev-parse','origin/main')}});
else if(path.includes('/pipelines/1/jobs')) out([{id:1,name:'build',status:'success',allow_failure:false}]);
else if(path==='projects/team%2Fproject') out({id:1,only_allow_merge_if_pipeline_succeeds:true,squash_option:'always'});
else if(path.includes('/merge_requests/1')) {
 if(method==='PUT'){if(fields.title){s.mr.title=fields.title;s.mr.draft=/^Draft:/.test(fields.title);}if(fields.description)s.mr.description=fields.description;}
 if(path.includes('with_merge_status_recheck')&&!s.mr.draft&&!s.staleObserved){s.staleObserved=true;out({...s.mr,sha:${JSON.stringify(base)}});}
 else out(s.mr);
}
else {process.stderr.write('Unhandled fixture API '+path);process.exit(2);}
`,
);
chmodSync(glab, 0o755);
process.env.PATH = `${bin}:${process.env.PATH}`;
const port = Number(process.env.F1_NODE_PORT ?? 3667),
	origin = `http://localhost:${port}`;
process.env.BOBS_FACTORY_FACTORY_PORT = String(port);
delete process.env.BOBS_FACTORY_FACTORY_ORIGIN;
delete process.env.BOBS_FACTORY_FACTORY_PUBLIC_ORIGIN;
process.env.BOBS_FACTORY_DISABLE_REMOTE_SESSION_STORE = "1";
const workflow = WorkflowSchema.parse({
	id: "repository-io",
	name: "Repository IO",
	stepConfigVersion: "step-config-v1",
	allowedTriggers: ["manual"],
	steps: [
		{
			id: "seed",
			name: "Metadata",
			type: "agent",
			prompt: "Return fixture metadata",
		},
		{
			id: "write",
			name: "Write",
			type: "script",
			script: "printf 'Changed\\n' >> README.md",
		},
		{
			id: "commit",
			name: "Commit",
			type: "git",
			op: "commit",
			verify: false,
			reads: { message: "seed/message" },
		},
		{ id: "push", name: "Push", type: "git", op: "push" },
		{
			id: "pr",
			name: "Ensure PR",
			type: "pr",
			op: "ensure",
			reads: { title: "seed/title", body: "seed/body" },
		},
		{
			id: "read",
			name: "Read PR",
			type: "pr",
			op: "read",
			reads: { pr: "pr" },
		},
		{
			id: "comment",
			name: "Comment",
			type: "pr",
			op: "comment",
			reads: { pr: "pr", body: "seed/body" },
		},
		{
			id: "ready",
			name: "Ready",
			type: "pr",
			op: "ready",
			reads: { pr: "pr" },
		},
		{ id: "ci", name: "CI", type: "ci", op: "status", reads: { pr: "pr" } },
		{
			id: "ciFresh",
			name: "CI fresh",
			type: "ci",
			op: "status",
			reads: { pr: "pr" },
		},
		{ id: "diff", name: "Diff", type: "git", op: "diff" },
	],
});
const config: EdgeWorkerConfig = {
	platform: "cli",
	factoryHome: home,
	issueTrackerFactory: createCLIIssueTracker,
	serverHost: "127.0.0.1",
	serverPort: port + 1,
	defaultRunner: "claude",
	linearWorkspaces: { "cli-workspace": { linearToken: "fixture" } },
	repositories: [
		{
			id: "fixture",
			name: "Fixture",
			repositoryPath: repo,
			workspaceBaseDir: join(root, "worktrees"),
			baseBranch: "main",
			isActive: true,
			linearWorkspaceId: "cli-workspace",
			gitlabUrl: "https://gitlab.example/team/project",
			gitProvider: { type: "gitlab" },
		},
	],
	handlers: f1AgentHandlers(
		"mock",
		JSON.stringify({
			message: "feat: IO fixture",
			title: "IO fixture\n",
			body: "Fixture body",
			questions: [],
		}),
	),
};
let worker: EdgeWorker | undefined,
	passed = false;
const runtime = () =>
	(
		worker as unknown as { getFactoryRuntime(): WorkflowRuntime }
	).getFactoryRuntime();
async function request(path: string, body?: unknown) {
	const response = await fetch(`${origin}${path}`, {
		method: body === undefined ? "GET" : "POST",
		headers: {
			Origin: origin,
			"X-Factory-Request": "1",
			"Content-Type": "application/json",
		},
		body: body === undefined ? undefined : JSON.stringify(body),
		signal: AbortSignal.timeout(15000),
	});
	const value = await response.json();
	assert(response.ok, `${path}: ${response.status} ${JSON.stringify(value)}`);
	return value as any;
}
async function wait(check: () => boolean) {
	const deadline = Date.now() + 60000;
	while (!check()) {
		assert(Date.now() < deadline, "Run did not settle");
		await new Promise((r) => setTimeout(r, 25));
	}
}
try {
	worker = new EdgeWorker(config);
	await worker.start();
	runtime().updateWorkflows([...runtime().listWorkflows(), workflow]);
	const catalog = await request("/api/config?view=recipes");
	for (const type of ["git", "pr", "ci"]) {
		const n = catalog.nodeTypes.find((n: any) => n.type === type);
		assert(n);
		assert(n.operationEffects);
		assert.equal(
			n.operationEffects[type === "pr" ? "read" : "status"],
			"read-only",
		);
		assert(!("execute" in n));
	}
	const started = await request("/api/runs", {
		workflow: workflow.id,
		repositoryId: "fixture",
		prompt: "Exercise repository IO",
	});
	await wait(() =>
		["failed", "completed"].includes(runtime().get(started.id).status),
	);
	let run = runtime().get(started.id);
	assert.equal(run.status, "failed");
	assert.equal(run.step, "pr");
	assert.equal(JSON.parse(readFileSync(statePath, "utf8")).creates, 1);
	const committed = (run.outputs.commit as any).repositories[0].head;
	assert.notEqual(committed, base);
	assert.equal(
		git(
			remote,
			"rev-parse",
			`refs/heads/${git(run.workspace, "branch", "--show-current")}`,
		),
		committed,
	);
	assert.equal(git(run.workspace, "rev-parse", "@{upstream}"), committed);
	assert(Object.values(run.nodeEffects!).some((e) => e.phase === "uncertain"));
	await worker.stop();
	worker = new EdgeWorker(config);
	await worker.start();
	await request(`/api/runs/${started.id}/retry`, {});
	await wait(() =>
		["failed", "completed"].includes(runtime().get(started.id).status),
	);
	run = runtime().get(started.id);
	assert.equal(run.status, "completed", run.error);
	const state = JSON.parse(readFileSync(statePath, "utf8"));
	assert.equal(state.creates, 1);
	assert.equal(state.notes.length, 1);
	assert.equal(state.mr.draft, false);
	const ci = (run.outputs.ci as any).repositories[0];
	assert.equal(ci.head, committed);
	assert.equal(ci.base, base);
	assert.equal(ci.checks[0].required, true);
	assert.equal(ci.summary.failed, 0);
	assert.equal(ci.headMatches, false);
	assert.equal(ci.prHead, base);
	assert.equal(ci.localHead, committed);
	assert.equal(ci.summary.complete, false);
	const fresh = (run.outputs.ciFresh as any).repositories[0];
	assert.equal(fresh.headMatches, true);
	assert.equal(fresh.summary.complete, true);
	const read = (run.outputs.read as any).repositories[0];
	assert.equal(read.providerMergeability, "draft_status");
	assert.equal(read.queued, false);
	assert(Array.isArray(read.comments));
	assert(read.blockers.some((b: any) => b.kind === "draft"));
	assert.deepEqual((run.outputs.diff as any).repositories[0].files, [
		"README.md",
	]);
	assert(run.history.every((h) => h.inputDigest?.length === 64));
	const activity = await request(`/api/runs/${run.id}/activity?limit=50`);
	assert(JSON.stringify(activity).includes("ci"));
	console.log(
		JSON.stringify(
			{
				result: "PASS",
				mode: "mock",
				runId: run.id,
				head: committed,
				base,
				checks: [
					"registry metadata",
					"real worktree/commit/push",
					"uncertain PR creation",
					"cold restart reconciliation",
					"PR read/comment/ready",
					"head-lag CI then fresh read",
					"upstream and commit hook opt-out",
					"provider-normalized title/body",
					"diff",
					"activity and stamps",
				],
				history: run.history.map((h) => h.step),
			},
			null,
			2,
		),
	);
	passed = true;
} finally {
	await worker?.stop();
	if (passed) rmSync(root, { recursive: true, force: true });
	else console.error(`Fixture retained: ${root}`);
}
