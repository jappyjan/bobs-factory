import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export const registryVariable = "BOBS_FACTORY_ACCEPTANCE_GROUP_REGISTRY";

export function persistRegistry(path, value) {
	const temporary = `${path}.${randomUUID()}.tmp`;
	writeFileSync(temporary, JSON.stringify(value), { flag: "wx", mode: 0o600 });
	renameSync(temporary, path);
}

export function groupMembers(pid) {
	return execFileSync("ps", ["-eo", "pid=,pgid=,stat="], {
		encoding: "utf8",
		timeout: 1000,
	})
		.split("\n")
		.map((line) => line.trim().split(/\s+/))
		.filter(
			([, group, state]) => Number(group) === pid && !state?.startsWith("Z"),
		);
}

export function groupIdentity(pid) {
	assert(Number.isInteger(pid) && pid > 1 && pid !== process.pid);
	// Linux start ticks are exact; lstart supports the safe subprocess tests on macOS.
	if (process.platform === "linux") {
		const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
		const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
		assert.equal(Number(fields[2]), pid, "Owned leader lost its process group");
		return fields[19];
	}
	const text = execFileSync("ps", ["-p", String(pid), "-o", "pgid=,lstart="], {
		encoding: "utf8",
		timeout: 1000,
	}).trim();
	const [group, ...birth] = text.split(/\s+/);
	assert.equal(Number(group), pid, "Owned leader lost its process group");
	return birth.join(" ");
}

export function registerGroup(directory, pid) {
	const identity = { pid, birth: groupIdentity(pid) };
	if (directory) {
		assert(!existsSync(join(directory, "closed")), "Owned registry is closed");
		mkdirSync(join(directory, "groups"), { recursive: true, mode: 0o700 });
		persistRegistry(join(directory, "groups", `${pid}.json`), identity);
		// Closing races with registration: the held leader cannot run target code yet.
		assert(!existsSync(join(directory, "closed")), "Owned registry is closed");
	}
	return identity;
}

export function killRegisteredGroup(identity) {
	if (!groupMembers(identity.pid).length) return;
	assert.equal(
		groupIdentity(identity.pid),
		identity.birth,
		"Owned group leader identity changed; refuse to signal",
	);
	process.kill(-identity.pid, "SIGKILL");
}

export async function waitForGroupDrain(pid, deadline = Date.now() + 2000) {
	while (groupMembers(pid).length) {
		assert(
			Date.now() < deadline,
			`Owned group ${pid} descendants did not drain`,
		);
		await delay(20);
	}
}

export async function drainRegistry(directory, { exclude = [] } = {}) {
	writeFileSync(join(directory, "closed"), "closed", { mode: 0o600 });
	const errors = [];
	const groups = readdirSync(join(directory, "groups"))
		.filter((name) => name.endsWith(".json"))
		.map((name) => JSON.parse(readFileSync(join(directory, "groups", name))))
		.filter(({ pid }) => !exclude.includes(pid));
	// Signal every registered leader before waiting, even when one has lost ownership.
	for (const identity of groups) {
		try {
			killRegisteredGroup(identity);
		} catch (error) {
			errors.push(error.message);
		}
	}
	const deadline = Date.now() + 2000;
	for (const { pid } of groups) {
		try {
			await waitForGroupDrain(pid, deadline);
		} catch (error) {
			errors.push(error.message);
		}
	}
	assert.equal(errors.length, 0, errors.join("; "));
}

export function registrySurvivors(directory) {
	return readdirSync(join(directory, "groups"))
		.filter((name) => name.endsWith(".json"))
		.flatMap((name) => {
			const { pid } = JSON.parse(readFileSync(join(directory, "groups", name)));
			return groupMembers(pid).map((member) => member.join(" "));
		});
}
