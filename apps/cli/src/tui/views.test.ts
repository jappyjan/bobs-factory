import { expect, it, vi } from "vitest";
import { TodayApp } from "./app.js";
import type { FactoryClient } from "./client.js";

it("submits a terminal view decision only with the displayed batch, digest and explicit consent", async () => {
	const snapshot = {
		id: "627507d5-f895-42ac-b716-7ca2050d2500",
		digest: "b".repeat(64),
		kind: "approve",
		title: "Approve displayed artifact",
	};
	const run = {
		id: "terminal-view",
		title: "View fixture",
		status: "waiting",
		createdAt: new Date().toISOString(),
		viewDecision: snapshot,
	};
	const post = vi.fn(async () => ({}));
	const client = {
		origin: "http://localhost:3457",
		get: vi.fn(async (path: string) => {
			if (path === "/api/config?view=dashboard")
				return { repositories: [], workflows: [] };
			if (path === "/api/runs") return [run];
			return {
				...run,
				viewText: "Artifact content is inert and reviewed here.",
			};
		}),
		post,
		events: () => () => {},
	} as unknown as FactoryClient;
	let frame = "";
	const app = new TodayApp({
		client,
		theme: "dark",
		sgr: () => "",
		write: (value) => {
			frame = value;
		},
		size: () => ({ columns: 120, rows: 32 }),
		openUrl: async () => {},
		quit: () => {},
	});
	app.start();
	try {
		await vi.waitFor(() => expect(frame).toContain(snapshot.title));
		app.key({ name: "text", text: "a" });
		expect(frame).toContain("Decision JSON");
		app.key({
			name: "paste",
			text: JSON.stringify({
				batchId: snapshot.id,
				digest: snapshot.digest,
				approved: true,
			}),
		});
		app.key({ name: "enter" });
		await vi.waitFor(() => expect(frame).toContain("explicit accepted:true"));
		expect(post).not.toHaveBeenCalled();
		app.key({ name: "escape" });
		app.key({ name: "text", text: "a" });
		const payload = {
			batchId: snapshot.id,
			digest: snapshot.digest,
			accepted: true,
			approved: false,
			feedback: "Clarify the example",
		};
		app.key({ name: "paste", text: JSON.stringify(payload) });
		app.key({ name: "enter" });
		await vi.waitFor(() =>
			expect(post).toHaveBeenCalledExactlyOnceWith(
				"/api/runs/terminal-view/view-answer",
				payload,
			),
		);
	} finally {
		app.stop();
	}
});
