import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { startOwnedCommand } from "./owned-command.mjs";
import { startLimitEvidence, stopOwnedUnit } from "./service-protocol.mjs";

const unit = "factory-regression.service";
const stopped = {
	ActiveState: "failed",
	SubState: "failed",
	MainPID: "0",
	ControlPID: "0",
	Job: "",
};
const exhausted = {
	...stopped,
	Result: "signal",
	NRestarts: "4",
	StartLimitBurst: "3",
	StartLimitIntervalUSec: "2min",
	RestartUSec: "10s",
};
const event = JSON.stringify({
	USER_UNIT: unit,
	MESSAGE: "Start request repeated too quickly.",
});
const stateText = (p) =>
	Object.entries(p)
		.map(([k, v]) => `${k}=${v}`)
		.join("\n");

test("v255 preserved signal result proves exhaustion only with exact-unit rejection and terminal state", () => {
	assert(startLimitEvidence(unit, exhausted, event));
	assert(!startLimitEvidence(unit, exhausted, ""));
	assert(!startLimitEvidence("unowned.service", exhausted, event));
	for (const changed of [
		{ Job: "42" },
		{ SubState: "auto-restart" },
		{ MainPID: "42" },
		{ NRestarts: "1" },
		{ NRestarts: undefined },
		{ NRestarts: "unknown" },
		{ StartLimitBurst: "10" },
	])
		assert(!startLimitEvidence(unit, { ...exhausted, ...changed }, event));
});

test("already-inactive unloaded unit with a retained owned definition needs no force kill", async () => {
	const calls = [];
	await stopOwnedUnit({
		unit,
		verifyDefinition: () => true,
		manager: async (...args) => {
			calls.push(args);
			if (args[0] === "kill" || args[0] === "stop")
				throw Error("Unit is not loaded");
			return args[0] === "show"
				? stateText({
						...stopped,
						ActiveState: "inactive",
						SubState: "dead",
						LoadState: "loaded",
					})
				: "";
		},
		until: async (check) => assert(await check()),
	});
	assert.deepEqual(
		calls.filter(([op]) => op !== "show"),
		[["disable", unit]],
	);
});

test("queued manager start is replaced by exact-unit stop and must reach terminal state", async () => {
	let state = {
		...stopped,
		Job: "42",
		ActiveState: "activating",
		SubState: "start",
	};
	const mutations = [];
	await stopOwnedUnit({
		unit,
		verifyDefinition: () => false,
		manager: async (...args) => {
			if (args[0] === "show") return stateText(state);
			mutations.push(args);
			if (args[0] === "stop") state = stopped;
			return "";
		},
		until: async (check) => assert(await check()),
	});
	assert.deepEqual(mutations, [["stop", "--no-block", unit]]);
});

test("manager permission errors and changed ownership are never hidden by terminal state", async () => {
	for (const changedOwnership of [false, true]) {
		await assert.rejects(
			stopOwnedUnit({
				unit,
				verifyDefinition: () => {
					if (changedOwnership) throw Error("ownership changed");
					return true;
				},
				manager: async () => {
					throw Error("Permission denied");
				},
				until: async () => {},
			}),
			changedOwnership ? /ownership changed/ : /Permission denied/,
		);
	}
});

test("a genuine state-query error cannot be erased by a successful kill fallback", async () => {
	const mutations = [];
	await assert.rejects(
		stopOwnedUnit({
			unit,
			verifyDefinition: () => false,
			manager: async (...args) => {
				if (args[0] === "show") return stateText({ ...stopped, Job: "42" });
				mutations.push(args);
				return "";
			},
			until: async () => {
				throw Error("manager query permission denied");
			},
		}),
		/manager query permission denied/,
	);
	assert.deepEqual(mutations, [["stop", "--no-block", unit]]);
});

test("unloaded stop race is accepted only after independent terminal verification", async () => {
	let state = {
		...stopped,
		ActiveState: "active",
		SubState: "running",
		MainPID: "42",
	};
	await stopOwnedUnit({
		unit,
		verifyDefinition: () => true,
		manager: async (...args) => {
			if (args[0] === "show") return stateText(state);
			if (args[0] === "stop") {
				state = stopped;
				throw Object.assign(Error("systemctl failed"), {
					stderr: "Unit is not loaded.",
				});
			}
			return "";
		},
		until: async (check) => assert(await check()),
	});
});

for (const mode of ["abort", "leader-exit"]) {
	test(`owned process group drains detached-pipe descendant on ${mode}`, {
		timeout: 5000,
	}, async () => {
		const root = mkdtempSync(join(tmpdir(), "factory-command-regression-"));
		const marker = join(root, "late-mutation");
		const controller = new AbortController();
		// Mirrors a synchronous CLI manager child that spawns a late asynchronous
		// mutation with closed pipes. Killing/reaping only the CLI leaves it alive.
		const script = `const {spawn}=require('node:child_process');
spawn(process.execPath,['-e',${JSON.stringify(`setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(marker)},'mutated'),500)`)}],{stdio:'ignore'});
console.log('manager-entered');
${mode === "abort" ? "setInterval(()=>{},1000);" : "process.exit(0);"}`;
		const owned = startOwnedCommand(process.execPath, ["-e", script], {
			signal: controller.signal,
			timeout: 2000,
		});
		const outcome = owned.done.then(
			() => null,
			(error) => error,
		);
		try {
			await new Promise((resolve, reject) => {
				owned.child.stdout.once("data", resolve);
				owned.child.once("error", reject);
			});
			if (mode === "abort") controller.abort(Error("cancelled"));
			const error = await outcome;
			if (mode === "abort") assert.match(error.message, /cancelled/);
			else assert.equal(error, null);
			await delay(700);
			assert.equal(
				existsSync(marker),
				false,
				"descendant mutated after command drained",
			);
		} finally {
			owned.kill();
			await outcome;
			rmSync(root, { recursive: true, force: true });
		}
	});
}
