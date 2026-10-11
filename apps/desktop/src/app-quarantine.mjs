import { execFileSync } from "node:child_process";
import { lstatSync } from "node:fs";

// Host-owned per-app OS metadata is separate from the published byte inventory.
// Never delete quarantine or change Gatekeeper settings; metadata errors block.
const attribute = "com.apple.quarantine";
const nativeMac = (target) =>
	process.platform === "darwin" && target.startsWith("darwin-");
export function appQuarantine(path, target) {
	if (!nativeMac(target)) return;
	if (lstatSync(path).isSymbolicLink())
		throw Error("Cannot inspect quarantine through an app link");
	try {
		const hex = execFileSync("/usr/bin/xattr", ["-p", "-x", attribute, path], {
			encoding: "utf8",
			timeout: 10_000,
			maxBuffer: 65536,
			stdio: ["ignore", "pipe", "pipe"],
		}).replace(/\s/g, "");
		if (!/^(?:[a-fA-F0-9]{2})+$/.test(hex))
			throw Error("Invalid app quarantine metadata");
		return hex.toLowerCase();
	} catch (error) {
		if (
			error.status === 1 &&
			/No such xattr: com\.apple\.quarantine\s*$/.test(String(error.stderr))
		)
			return;
		throw error;
	}
}
export function retainAppQuarantine(path, target, hex) {
	if (!nativeMac(target) || hex === undefined) return;
	if (
		!/^(?:[a-f0-9]{2})+$/.test(hex) ||
		hex.length > 65536 ||
		lstatSync(path).isSymbolicLink()
	)
		throw Error("Invalid retained app quarantine metadata");
	execFileSync("/usr/bin/xattr", ["-w", "-x", attribute, hex, path], {
		timeout: 10_000,
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (appQuarantine(path, target) !== hex)
		throw Error("App quarantine preservation failed");
}
export function inheritAppQuarantine(source, destination, target) {
	retainAppQuarantine(destination, target, appQuarantine(source, target));
}
