import { expect, it } from "vitest";
import { drive, fixture } from "./fixtures/factory-v2-composition.js";
import { plan } from "./fixtures/v2-planning.js";

it.each([
	{ stopExternal: false, carry: false },
	{ stopExternal: true, carry: false },
	{ stopExternal: false, carry: true },
])("keeps post-merge external revisions out of implementation (%j)", async ({
	stopExternal,
	carry,
}) => {
	const kind = carry ? "carried" : "explicit";
	const f = fixture("mixed", "factory", { externalRevision: true, carry });
	await drive(f, { stopExternal });
	expect(f.run.status, f.run.error).toBe("completed");
	expect(f.provider.merge).toHaveBeenCalledOnce();
	expect(f.state.implementations).toBe(1);
	expect(f.state.plans).toBe(stopExternal ? 1 : 2);
	expect(f.run.outputs.plan).toMatchObject({
		summary: plan.summary,
		deliveryMode: "mixed",
	});
	if (!stopExternal)
		expect(f.run.outputs[`external-planning-${kind}/plan`]).toMatchObject({
			summary: "Only remaining external operations",
			deliveryMode: "external",
		});
	expect(
		f.visits.filter((step) => step === `external-planning-${kind}/plan-review`),
	).toHaveLength(stopExternal ? 0 : 1);
	expect(f.run.history.some((h) => h.step === `external-replan-${kind}`)).toBe(
		true,
	);
	expect((await f.ticket.read()).state?.type).toBe(
		stopExternal ? "started" : "completed",
	);
	expect(f.setStatus).toHaveBeenCalledTimes(stopExternal ? 0 : 1);
}, 180000);

it("takes over an existing request and skips clarification/planning", async () => {
	const f = fixture("repository", "takeover");
	await drive(f);
	expect(f.run.status, f.run.error).toBe("completed");
	expect(f.visits).toContain("intake/assess-existing");
	expect(f.visits).not.toContain("planning/clarify");
	expect(f.provider.create).not.toHaveBeenCalled();
	expect(f.provider.merge).toHaveBeenCalledOnce();
}, 180000);
