// Local operator authorization. This command never starts or restarts services.
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { requestFactoryAuthRecovery } from "../packages/edge-worker/dist/factory/FactoryAuthOperator.js";

const { values } = parseArgs({
	options: {
		home: { type: "string", default: join(homedir(), ".bobs-factory") },
		recover: { type: "boolean" },
		confirm: { type: "string" },
	},
});
const home = resolve(values.home!.replace(/^~(?=\/)/, homedir()));
if (values.recover) {
	requestFactoryAuthRecovery(home, values.confirm);
	console.log(
		"Factory authentication recovery requested. All API keys and sessions will be revoked. Create a new key in localhost Settings → Access.",
	);
} else {
	console.log(
		"Open the localhost dashboard, then Settings → Access to add, remove or rotate API keys.",
	);
}
