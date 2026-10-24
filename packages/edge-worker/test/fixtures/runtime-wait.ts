import { vi } from "vitest";

// Runtime state transitions await real disk commits. Retain the assertions
// while allowing independent workflows to settle under parallel suite load.
export const waitForRuntime: typeof vi.waitFor = (callback, options) => {
	const settings = typeof options === "number" ? { timeout: options } : options;
	return vi.waitFor(callback, {
		...settings,
		timeout: Math.max(settings?.timeout ?? 0, 60000),
	});
};
