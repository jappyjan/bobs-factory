import type { ViewComponent } from "../View";
import { GuidedReview, type GuidedReviewControls } from "./review";

export type ReviewGuideViewComponent = Extract<
	ViewComponent,
	{ type: "review-guide" }
>;

/** Resolve only an exact public resource supplied by this run's native view. */
export function reviewGuideValue(
	run: any,
	component: ReviewGuideViewComponent | undefined,
	presentation = run?.nativeView,
): Record<string, any> | undefined {
	if (!component) return undefined;
	const { source, digest } = component.data;
	const resources = presentation?.resources;
	if (!resources || !Object.hasOwn(resources, digest)) return undefined;
	const resource = resources[digest];
	if (
		resource?.source !== source ||
		resource.digest !== digest ||
		!resource.value ||
		typeof resource.value !== "object" ||
		Array.isArray(resource.value)
	)
		return undefined;
	return resource.value;
}

/** The accepted view chooses composition; only the native host supplies controls. */
export function ReviewGuideComponent({
	component,
	run,
	documentPage = false,
	controls,
	presentation = run?.nativeView,
}: {
	component: ReviewGuideViewComponent;
	run?: any;
	documentPage?: boolean;
	controls?: GuidedReviewControls;
	presentation?: any;
}) {
	const value = reviewGuideValue(run, component, presentation);
	if (!value || !run?.id) return <p>{component.data.text}</p>;
	const authority = presentation.authority;
	return (
		<GuidedReview
			value={value}
			run={run}
			source={component.data.source}
			documentPage={documentPage}
			controls={
				authority === "review" || authority === "external-review"
					? controls
					: undefined
			}
		/>
	);
}
