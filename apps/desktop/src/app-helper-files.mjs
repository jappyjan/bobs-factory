import { cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// Keep the standalone helper's entire runtime closure outside the app being
// replaced. Production handoff and native shell acceptance use the same copy.
export function retainAppHelper(sourceDirectory, retained) {
	mkdirSync(retained, { recursive: true, mode: 0o700 });
	for (const file of [
		"app-helper.mjs",
		"app-lifecycle.mjs",
		"app-source.mjs",
		"app-archive.mjs",
		"app-licenses.mjs",
		"app-quarantine.mjs",
		"update-services.mjs",
	])
		cpSync(join(sourceDirectory, file), join(retained, file));
}
