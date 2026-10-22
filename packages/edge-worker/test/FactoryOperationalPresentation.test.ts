import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import {
	type MergeReadiness,
	reportReadiness,
} from "../src/factory/MergeReadiness.js";
import { validateWorkflows, WorkflowSchema } from "../src/factory/Workflow.js";
import {
	type ExecutionContext,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import {
	currentStepOf,
	phase,
	stepFixing,
	stepIcon,
} from "../src/factory/web/client.js";
import { GuideRefreshAction } from "../src/factory/web/focus.js";
import { ProviderChecks } from "../src/factory/web/review-brief.js";
import { mergeReadinessFor } from "../src/factory/web/run-output.js";
import { FactoryServer } from "./fixtures/authenticated-factory.js";
import { preCompositionWorkflows as defaultWorkflows } from "./fixtures/pre-composition.js";
import { renamedFactory } from "./fixtures/renamed-factory.js";

// The UI is rendered outside a browser; preserve its connection state without a subscription.
vi.mock("../src/factory/web/pwa.js", async (importOriginal) => {
	const original =
		await importOriginal<typeof import("../src/factory/web/pwa.js")>();
	return { ...original, usePwa: () => original.pwaState() };
});

function readiness(pending: boolean): MergeReadiness {
	return {
		headSha: "current-head",
		baseSha: "current-base",
		url: "https://example.com/repo/pull/136",
		state: "OPEN",
		isDraft: true,
		approved: true,
		reviewReady: !pending,
		fix: false,
		queued: false,
		mergeMethod: "squash",
		checks: [
			{
				name: "Build",
				state: pending ? "PENDING" : "SUCCESS",
				bucket: pending ? "pending" : "pass",
			},
		],
		blockers: pending
			? [{ kind: "checks", message: "Build pending", action: "wait" }]
			: [],
		threads: [{ body: "not dashboard data" }],
		comments: [{ body: "not dashboard data" }],
		reviews: [],
	};
}

it("uses declared readiness receipts only when no current provider state is available", () => {
	const receipt = readiness(false);
	expect(
		mergeReadinessFor({
			outputs: { "renamed/ci": receipt },
			outputRoles: { ci: "renamed/ci" },
		}),
	).toBe(receipt);
	expect(
		mergeReadinessFor({ outputs: { ci: receipt }, outputRoles: {} }),
	).toBeUndefined();
	expect(mergeReadinessFor({ outputs: { ci: receipt } })).toBe(receipt);
});

it.each([
	false,
	true,
])("projects operational readiness across HTTP polls independently of authored CI receipts (renamed=%s)", async (renamed) => {
	const home = mkdtempSync(join(tmpdir(), "factory-operational-view-"));
	const { definitions, original } = renamedFactory(defaultWorkflows);
	const accepted = validateWorkflows(renamed ? definitions : defaultWorkflows);
	const workflow = accepted.find(
		(w) => w.id === (renamed ? "renamed-factory" : "factory"),
	)!;
	const pipeline = accepted.find(
		(w) => w.id === (renamed ? "renamed-factory-pipeline" : "factory-pipeline"),
	)!;
	const ci = pipeline.steps.find((step) => step.tool === "ci")!;
	const runtime = new WorkflowRuntime(home, {});
	const run = runtime.create({
		id: `operational-${renamed}`,
		title: "Waiting for current Build",
		repositoryId: "repo",
		workspace: home,
		input: "",
		workflow,
		workflowDefinitions: accepted,
		triggerOrigin: {
			type: "manual",
			workflowId: workflow.id,
			at: new Date().toISOString(),
		},
	});
	// Project the accepted pre-142 frame, independent of current admission.
	run.workflow = structuredClone(workflow);
	run.workflowDefinitions = structuredClone(accepted);
	run.status = "running";
	run.step = `${workflow.steps[0]!.id}/${ci.id}`;
	run.outputs[ci.id] = { ...readiness(false), headSha: "old-head" };
	const context = { run, log: () => {} } as ExecutionContext;
	reportReadiness(context, readiness(true));
	const server = new FactoryServer(runtime, {
		repositories: () => [],
		sessions: () => [],
		entries: () => [],
		start: async () => run,
		stop: () => {},
	});
	try {
		expect(original(ci.id)).toBe("ci");
		const raw = await server.app.inject({ url: `/api/runs/${run.id}` });
		expect(raw.statusCode).toBe(200);
		expect(raw.json().mergeReadiness.checks[0]).toMatchObject({
			name: "Build",
			bucket: "pending",
		});
		await runtime.save(run);
		const listed = (await server.app.inject({ url: "/api/runs" }))
			.json()
			.find((item: { id: string }) => item.id === run.id);
		expect(listed.currentStep).toEqual({
			key: run.step,
			name: ci.name,
			presentation: { phase: "blue", icon: "🧪", fixing: false },
		});
		for (const view of ["dashboard", "focus"]) {
			const response = await server.app.inject({
				url: `/api/runs/${run.id}?view=${view}`,
			});
			expect(response.statusCode).toBe(200);
			expect(response.json().currentStep).toEqual(listed.currentStep);
			expect(response.json().mergeReadiness).toMatchObject({
				headSha: "current-head",
				checks: [{ name: "Build", bucket: "pending" }],
				blockers: [{ message: "Build pending", action: "wait" }],
			});
			expect(response.json().mergeReadiness.threads).toBeUndefined();
			expect(response.json().mergeReadiness.comments).toBeUndefined();
			expect(mergeReadinessFor(response.json()).headSha).toBe("current-head");
			expect(mergeReadinessFor(response.json()).blockers[0].message).toBe(
				"Build pending",
			);
			const checks = renderToStaticMarkup(
				createElement(ProviderChecks, { run: response.json() }),
			);
			expect(checks).toContain("Build pending");
			expect(checks).toContain("CI 0/1");
			expect(checks).not.toContain("CI ✓");
			expect(checks).toContain('role="status" aria-label="Merge blockers"');
		}
		reportReadiness(context, readiness(false));
		const next = await server.app.inject({
			url: `/api/runs/${run.id}?view=dashboard`,
		});
		expect(
			renderToStaticMarkup(createElement(ProviderChecks, { run: next.json() })),
		).toContain("CI ✓ 1/1");
		expect(next.json().mergeReadiness).toMatchObject({
			checks: [{ name: "Build", bucket: "pass" }],
			blockers: [],
		});
	} finally {
		await server.stop();
		await runtime.shutdown();
		rmSync(home, { recursive: true, force: true });
	}
});

it("presents configured roles consistently after rename without styling generic historical-name collisions", async () => {
	const home = mkdtempSync(join(tmpdir(), "factory-semantic-step-view-"));
	const { definitions, original } = renamedFactory(defaultWorkflows);
	const accepted = validateWorkflows(definitions);
	const runtime = new WorkflowRuntime(home, {});
	const server = new FactoryServer(runtime, {
		repositories: () => [],
		sessions: () => [],
		entries: () => [],
		start: async () => {
			throw new Error("Unused");
		},
		stop: () => {},
	});
	try {
		const presentations: Record<string, unknown>[] = [];
		for (const workflowId of ["factory-pipeline", "renamed-factory-pipeline"]) {
			const workflow = accepted.find(
				(w) => w.id === workflowId.replace("-pipeline", ""),
			)!;
			const run = runtime.create({
				id: workflowId,
				title: workflowId,
				repositoryId: "repo",
				workspace: home,
				input: "",
				workflow,
				workflowDefinitions: accepted,
				triggerOrigin: {
					type: "manual",
					workflowId: workflow.id,
					at: new Date().toISOString(),
				},
			});
			// Project the accepted pre-142 frame, independent of current admission.
			run.workflow = structuredClone(workflow);
			run.workflowDefinitions = structuredClone(accepted);
			const response = await server.app.inject({
				url: `/api/runs/${run.id}?view=dashboard`,
			});
			const projected = response
				.json()
				.workflowDefinitions.find(
					(item: { id: string }) => item.id === workflowId,
				).steps;
			const fixer = projected.find(
				(step: { id: string }) => original(step.id) === "ci-fix",
			);
			expect(fixer.presentation).toMatchObject({
				phase: "blue",
				icon: "🧪",
				fixing: true,
			});
			presentations.push(
				Object.fromEntries(
					projected.map((step: { id: string; presentation: unknown }) => [
						original(step.id),
						step.presentation,
					]),
				),
			);
		}
		expect(presentations[1]).toEqual(presentations[0]);
		const collision = WorkflowSchema.parse({
			id: "collision",
			name: "Generic collisions",
			stepConfigVersion: "step-config-v1",
			steps: ["ci-fix", "visual-review", "guide", "external-human-review"].map(
				(id) => ({
					id,
					name: id,
					type: "agent",
					prompt: "Generic",
					next: "end",
				}),
			),
		});
		const run = runtime.create({
			id: "collision",
			title: "Generic",
			repositoryId: "repo",
			workspace: home,
			input: "",
			workflow: collision,
			triggerOrigin: {
				type: "manual",
				workflowId: collision.id,
				at: new Date().toISOString(),
			},
		});
		const payload = (
			await server.app.inject({ url: `/api/runs/${run.id}?view=dashboard` })
		).json();
		for (const step of payload.workflow.steps) {
			expect(step.presentation).toEqual({
				phase: "red",
				icon: "✦",
				fixing: false,
			});
			expect([phase(step), stepIcon(step), stepFixing(step)]).toEqual([
				"red",
				"✦",
				false,
			]);
		}
		const acceptedStep = {
			key: "saved/renamed",
			name: "Saved correction",
			presentation: { phase: "blue", icon: "🧪", fixing: true },
		};
		expect(
			currentStepOf(
				{
					step: acceptedStep.key,
					currentStep: acceptedStep,
					workflow: { steps: [] },
				},
				{},
			),
		).toEqual(acceptedStep);
	} finally {
		await server.stop();
		await runtime.shutdown();
		rmSync(home, { recursive: true, force: true });
	}
});

it.each([
	"human-review",
	"external-human-review",
])("projects graph-derived refresh capability and keeps the API action aligned for valid step %s", async (reviewId) => {
	const home = mkdtempSync(join(tmpdir(), "factory-review-capability-"));
	const workflow = WorkflowSchema.parse({
		id: `review-${reviewId}`,
		name: "Review capability",
		stepConfigVersion: "step-config-v1",
		steps: [
			{
				id: "recap",
				name: "Guide",
				type: "agent",
				prompt: "Guide",
				output: { format: "guide-v1" },
				checks: ["requirement-coverage"],
				next: "ready",
			},
			{
				id: "ready",
				name: "Verify handoff",
				type: "tool",
				tool: "handoff",
				next: reviewId,
			},
			{
				id: reviewId,
				name: "Review",
				type: "tool",
				tool: "human-review",
				reads: { guide: "recap" },
				next: "end",
			},
		],
	});
	const runtime = new WorkflowRuntime(home, {});
	const run = runtime.create({
		id: workflow.id,
		title: "Review",
		repositoryId: "repo",
		workspace: home,
		input: "",
		workflow,
		triggerOrigin: {
			type: "manual",
			workflowId: workflow.id,
			at: new Date().toISOString(),
		},
	});
	run.status = "waiting";
	run.step = reviewId;
	run.checkpoint = {
		current: reviewId,
		visits: {},
		active: { phase: "waiting" },
	};
	run.reviewGate = {
		id: "current-review",
		headSha: "current-head",
		url: "https://example.com/repo/pull/136",
		status: "pending",
	};
	const launch = vi.spyOn(runtime, "launch").mockResolvedValue(run);
	const server = new FactoryServer(runtime, {
		repositories: () => [],
		sessions: () => [],
		entries: () => [],
		start: async () => run,
		stop: () => {},
	});
	try {
		for (const view of ["dashboard", "focus"]) {
			const payload = (
				await server.app.inject({ url: `/api/runs/${run.id}?view=${view}` })
			).json();
			expect(payload.reviewCapabilities).toEqual({ refreshGuide: true });
			expect(
				renderToStaticMarkup(
					createElement(GuideRefreshAction, {
						run: payload,
						busy: false,
						onRefresh: () => {},
					}),
				),
			).toContain("Refresh guide");
		}
		const stale = await server.app.inject({
			method: "POST",
			url: `/api/runs/${run.id}/guide/refresh`,
			headers: { "x-factory-request": "1" },
			payload: { reviewId: "stale-review" },
		});
		expect(stale.statusCode).toBe(409);
		expect(run.checkpoint.current).toBe(reviewId);
		expect(launch).not.toHaveBeenCalled();
		const refreshed = await server.app.inject({
			method: "POST",
			url: `/api/runs/${run.id}/guide/refresh`,
			headers: { "x-factory-request": "1" },
			payload: { reviewId: "current-review" },
		});
		expect(refreshed.statusCode).toBe(202);
		expect(run.checkpoint.current).toBe("recap");
		expect(run.reviewGate).toBeUndefined();
		expect(launch).toHaveBeenCalledOnce();
		expect(
			(
				await server.app.inject({ url: `/api/runs/${run.id}?view=dashboard` })
			).json().reviewCapabilities,
		).toEqual({ refreshGuide: false });
	} finally {
		await server.stop();
		await runtime.shutdown();
		rmSync(home, { recursive: true, force: true });
	}
});

it("does not advertise guide refresh for arbitrary pending gates or the stock external gate", async () => {
	const home = mkdtempSync(join(tmpdir(), "factory-unsupported-review-"));
	const runtime = new WorkflowRuntime(home, {});
	const workflow = defaultWorkflows.find((w) => w.id === "factory")!;
	const server = new FactoryServer(runtime, {
		repositories: () => [],
		sessions: () => [],
		entries: () => [],
		start: async () => {
			throw new Error("Unused");
		},
		stop: () => {},
	});
	try {
		for (const current of ["plan-review", "external-human-review"]) {
			const run = runtime.create({
				id: current,
				title: current,
				repositoryId: "repo",
				workspace: home,
				input: "",
				workflow,
				workflowDefinitions: defaultWorkflows,
				triggerOrigin: {
					type: "manual",
					workflowId: workflow.id,
					at: new Date().toISOString(),
				},
			});
			run.status = "waiting";
			run.step = `pipeline/${current}`;
			run.checkpoint = {
				current: "pipeline",
				visits: {},
				active: {
					phase: "executing",
					children: [{ current, visits: {}, active: { phase: "waiting" } }],
				},
			};
			run.reviewGate = {
				id: "unsupported-review",
				headSha: "head",
				url: "https://example.com/repo/pull/136",
				status: "pending",
			};
			for (const view of ["dashboard", "focus"]) {
				const payload = (
					await server.app.inject({ url: `/api/runs/${run.id}?view=${view}` })
				).json();
				expect(payload.reviewCapabilities).toEqual({ refreshGuide: false });
				expect(
					renderToStaticMarkup(
						createElement(GuideRefreshAction, {
							run: payload,
							busy: false,
							onRefresh: () => {},
						}),
					),
				).toBe("");
			}
			const action = await server.app.inject({
				method: "POST",
				url: `/api/runs/${run.id}/guide/refresh`,
				headers: { "x-factory-request": "1" },
				payload: { reviewId: "unsupported-review" },
			});
			expect(action.statusCode).toBe(409);
			expect(run.checkpoint.active!.children![0]!.current).toBe(current);
		}
	} finally {
		await server.stop();
		await runtime.shutdown();
		rmSync(home, { recursive: true, force: true });
	}
});
