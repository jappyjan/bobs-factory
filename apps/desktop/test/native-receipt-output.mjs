import { writeFileSync } from "node:fs";
import { isAbsolute } from "node:path";

export function writeNativeReceipt(receipt, path) {
	const bytes = `${JSON.stringify(receipt, null, 2)}\n`;
	if (!path) {
		process.stdout.write(bytes);
		return;
	}
	if (!isAbsolute(path))
		throw new Error("Native receipt path must be absolute");
	writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
}
