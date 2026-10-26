import { expect, it } from "vitest";
import { digest } from "../src/factory/EvidenceDigest.js";
import {
	acceptedMedia,
	type MediaCandidate,
	retainVerifiedMedia,
} from "../src/factory/VerifiedMedia.js";
import { videoLimits } from "../src/factory/Video.js";
import type { ExecutionContext } from "../src/factory/WorkflowRuntime.js";

const candidate = (path: string, bytes = 1): MediaCandidate => ({
	kind: "image",
	path,
	sha256: digest(path),
	bytes,
});
function fixture() {
	return {
		run: { history: [], verifiedMedia: [] },
		step: { id: "capture" },
		stepKey: "captures/screen/capture",
	} as unknown as ExecutionContext;
}
function accept(context: ExecutionContext, output: unknown) {
	context.run.history.push({
		step: context.stepKey!,
		output,
		guarantee: {},
	} as ExecutionContext["run"]["history"][number]);
}

it("ignores superseded inventory for both run limits and retains stable historical indices", () => {
	const context = fixture();
	// A long recapture history exceeds both limits; the replacement is small.
	context.run.verifiedMedia = Array.from({ length: 2048 }, (_, index) => ({
		...candidate(`old-${index}`, videoLimits.runBytes),
		id: `old-${index}`,
		index,
		stepKey: context.stepKey!,
		outputDigest: digest(index),
	}));
	accept(context, 2047);
	expect(() =>
		retainVerifiedMedia(context, "new", [candidate("new")]),
	).not.toThrow();
	accept(context, "new");
	expect(acceptedMedia(context.run)).toEqual([
		expect.objectContaining({ path: "new", index: 2048 }),
	]);
	expect(context.run.verifiedMedia).toHaveLength(2049);
});

it("counts accepted evidence from other steps plus all new candidates atomically", () => {
	const context = fixture();
	context.stepKey = "captures/other/capture";
	retainVerifiedMedia(context, "other", [
		candidate("other", videoLimits.runBytes - 2),
	]);
	accept(context, "other");
	context.stepKey = "captures/screen/capture";
	expect(() =>
		retainVerifiedMedia(context, "too-large", [
			candidate("one", 2),
			candidate("two", 1),
		]),
	).toThrow("run byte budget");
	expect(context.run.verifiedMedia).toHaveLength(1);
	retainVerifiedMedia(context, "fits", [
		candidate("one"),
		candidate("one"),
		candidate("two"),
	]);
	accept(context, "fits");
	expect(acceptedMedia(context.run).map((asset) => asset.index)).toEqual([
		0, 1, 2,
	]);
	// An idempotent retry must neither duplicate nor double-charge existing assets.
	retainVerifiedMedia(context, "fits", [candidate("one"), candidate("two")]);
	expect(context.run.verifiedMedia).toHaveLength(3);
});

it("enforces the entry cap against accepted entries and the complete candidate batch", () => {
	const context = fixture();
	context.stepKey = "other";
	retainVerifiedMedia(
		context,
		"other",
		Array.from({ length: 2047 }, (_, i) => candidate(`other-${i}`)),
	);
	accept(context, "other");
	context.stepKey = "capture";
	expect(() =>
		retainVerifiedMedia(context, "too-many", [
			candidate("one"),
			candidate("two"),
		]),
	).toThrow("inventory limit");
	expect(context.run.verifiedMedia).toHaveLength(2047);
	retainVerifiedMedia(context, "fits", [candidate("one")]);
	accept(context, "fits");
	expect(acceptedMedia(context.run)).toHaveLength(2048);
});
