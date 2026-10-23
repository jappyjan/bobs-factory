// Only changed accounting/owner seams; no unchanged UI, prompt or counter matrix.
import original from "./vitest.config.ts";
export default {
	...original,
	test: {
		...original.test,
		include: [
			"test/RunDiagnostics.test.ts",
			"test/DiagnosticsBoundariesF1.test.ts",
		],
	},
};
