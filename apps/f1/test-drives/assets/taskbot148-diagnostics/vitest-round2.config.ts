// Only the two Round2 owner/cache/readiness seams; prior matrices are authenticated reuse.
import original from "./vitest.config.ts";
export default {
	...original,
	test: {
		...original.test,
		include: [
			"test/DiagnosticsUpdatesF1.test.ts",
			"test/DiagnosticsReadiness.test.ts",
		],
	},
};
