import { expect, it } from "vitest";
import { drive, fixture, mocks } from "./fixtures/factory-v2-composition.js";
import { waitForRuntime } from "./fixtures/runtime-wait.js";

it("returns revise-plan from check-in through the composition", async () => {
	const f = fixture("repository", "factory", { revision: true });
	await drive(f);
	expect(f.state.plans).toBe(2);
	expect(f.run.status).toBe("completed");
}, 180000);
it("returns human corrections to review and CI before approving the latest head", async () => {
	const f = fixture("repository", "factory");
	await drive(f, { reject: true });
	expect(f.state.scopes).toBe(2);
	expect(f.provider.merge).toHaveBeenCalledOnce();
	expect(f.state.mergedHeads).toEqual([f.state.head]);
}, 180000);
it("carries explicit approval after a mid-merge head change, repeating review and CI for the latest PR", async () => {
	const f = fixture("repository", "factory", { carry: true });
	await drive(f);
	expect(f.run.outputs["merge-explicit"]).toMatchObject({
		outcome: "to-review",
	});
	expect(f.run.outputs["merge-carried"]).toMatchObject({
		outcome: "completed",
	});
	expect(f.state.scopes).toBe(2);
	expect(f.state.mergedHeads).toEqual([f.state.head]);
	expect(
		f.run.history.filter((h) => h.step === "approval/approval-display"),
	).toHaveLength(1);
}, 180000);
it("asks for assistance before pushing an empty implementation", async () => {
	const f = fixture("repository", "factory", { empty: true });
	void f.runtime.launch(f.run);
	await waitForRuntime(() => {
		expect(f.run.step, f.run.error).toBe("implementation/empty-answer");
		expect(f.run.status, f.run.error).toBe("waiting");
		expect(f.run.viewDecision).toBeDefined();
	});
	expect(
		mocks.command.mock.calls.some(([, , args]) => args[0] === "push"),
	).toBe(false);
	expect(f.provider.create).not.toHaveBeenCalled();
	expect(f.provider.merge).not.toHaveBeenCalled();
}, 180000);
