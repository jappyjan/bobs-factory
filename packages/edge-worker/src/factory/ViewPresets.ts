import type { ViewDefinition, ViewSource } from "./View.js";
export type NativeViewPreset = "ask" | "approve" | "review" | "external-review";
export const sectionIds = [
	"since",
	"understood",
	"plan",
	"notice",
	"open",
	"check-0",
	"check-1",
	"check-2",
	"size",
	"limits",
	"notes",
] as const;
const component = (id: string, type: string, path: string) => ({
	id,
	type,
	data: { path },
});
/** Stock declarations are copied into new definitions; frozen runs get the same semantics in memory. */
export function nativeViewPreset(preset: NativeViewPreset): ViewSource {
	return {
		version: "view-v1",
		preset,
		reads: { human: "@human" },
		components:
			preset === "ask"
				? [component("questions", "questions", "/inputs/human/questions")]
				: preset === "approve"
					? sectionIds.map((id) =>
							component(id, "checkin-section", `/inputs/human/sections/${id}`),
						)
					: [component("guide", "review-guide", "/inputs/human/guide")],
	} as ViewDefinition;
}
