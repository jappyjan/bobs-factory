import { vi } from "vitest";

// Runtime state transitions await real disk commits. Retain the assertions
// while allowing independent workflows to settle under parallel suite load.
export const waitForRuntime: typeof vi.waitFor = (callback, options) =>
	vi.waitFor(callback, options ?? { timeout: 5000 });
