import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { GuidedReview } from "../src/factory/web/review.js";
import {
	ReviewGuideComponent,
	type ReviewGuideViewComponent,
} from "../src/factory/web/review-guide-component.js";

vi.mock("../src/factory/web/review.js", () => ({
	GuidedReview: vi.fn((props) => props.controls?.("retained-identity", true)),
}));

const component: ReviewGuideViewComponent = {
	id: "reader",
	type: "review-guide",
	data: {
		source: "renamed-call/renamed-guide",
		digest: "a".repeat(64),
		text: "Review the retained public guide <script>inert</script>",
	},
};
const guide = { summary: "The original public guide", chapters: [] };
const resource = {
	source: component.data.source,
	digest: component.data.digest,
	value: guide,
};
const run = (authority = "review", entry: unknown = resource) => ({
	id: "review-run",
	nativeView: {
		preset: "review",
		authority,
		resources: { [component.data.digest]: entry },
	},
});
const controls = () => "Native review controls";
const render = (context?: ReturnType<typeof run>) =>
	renderToStaticMarkup(
		createElement(ReviewGuideComponent, {
			component,
			run: context,
			documentPage: true,
			controls,
		}),
	);

beforeEach(() => vi.clearAllMocks());

it("keeps missing and mismatched public references inert even when controls are supplied", () => {
	for (const context of [
		undefined,
		run("review", null),
		run("review", { ...resource, source: "another-output" }),
		run("review", { ...resource, digest: "b".repeat(64) }),
	]) {
		const html = render(context);
		expect(html).toContain("Review the retained public guide");
		expect(html).toContain("&lt;script&gt;inert&lt;/script&gt;");
		expect(html).not.toContain("Native review controls");
	}
	expect(GuidedReview).not.toHaveBeenCalled();
});

it("reuses the original renderer and native controls for an exact registered guide", () => {
	for (const authority of ["review", "external-review"]) {
		const context = run(authority);
		expect(render(context)).toBe("Native review controls");
		const props = vi.mocked(GuidedReview).mock.calls.at(-1)![0];
		expect(props.value).toBe(guide);
		expect(props.run).toBe(context);
		expect(props.source).toBe(component.data.source);
		expect(props.documentPage).toBe(true);
		expect(props.controls).toBe(controls);
	}
});

it("does not turn an authored Review preset into native review authority", () => {
	for (const authority of ["ask", "approve", "show"]) {
		expect(render(run(authority))).not.toContain("Native review controls");
		expect(
			vi.mocked(GuidedReview).mock.calls.at(-1)![0].controls,
		).toBeUndefined();
	}
});
