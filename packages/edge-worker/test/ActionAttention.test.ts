import { describe, expect, it } from "vitest";
import { attention, workingLabel } from "../src/factory/RunAttention.js";

const parent = {
	status: "waiting",
	createdAt: "2026-10-22T01:00:00.000Z",
	launchActions: {
		batch: { items: [{ status: "queued" }, { status: "waiting" }] },
	},
};
describe("passive child batch attention", () => {
	it("tracks children without an empty human-question form", () => {
		expect(attention(parent)).toBeUndefined();
		expect(workingLabel(parent)).toBe("Tracking child runs");
	});
	it("does not hide pending Display input or a failed parent behind child tracking", () => {
		expect(
			attention({ ...parent, viewDecision: { id: "batch", kind: "display" } }),
		).toBe("question");
		expect(attention({ ...parent, status: "failed" })).toBe("stuck");
	});
});
