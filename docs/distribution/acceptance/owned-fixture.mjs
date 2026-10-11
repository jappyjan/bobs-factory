// Supervisor for a fixture harness, including nested command groups and units.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	unlinkSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { startOwnedCommand } from "./owned-command.mjs";
import {
	drainRegistry,
	persistRegistry,
	registrySurvivors,
	registryVariable,
} from "./owned-registry.mjs";
import { properties, stopOwnedUnit, terminal } from "./service-protocol.mjs";

const loadReceipt = (path) =>
	existsSync(path)
		? JSON.parse(readFileSync(path))
		: { passed: false, cleanup: false };

export async function runOwnedFixture(
	program,
	args,
	{
		receiptPath,
		timeout = 90000,
		cleanupGrace = 30000,
		timeoutAfterBoundary,
		env = process.env,
	} = {},
) {
	const registry = mkdtempSync(join(tmpdir(), "factory-command-registry-"));
	mkdirSync(join(registry, "groups"), { mode: 0o700 });
	const escalationErrors = [];
	let escalated = false;
	let boundaryArmed = false;
	const persistFailure = (error, extra = {}) => {
		const receipt = loadReceipt(receiptPath);
		persistRegistry(receiptPath, {
			...receipt,
			...extra,
			passed: false,
			outerError: error.message,
			outerTimedOut: Boolean(error.timedOut),
		});
	};
	const command = startOwnedCommand(program, args, {
		timeout,
		cleanupGrace,
		cooperative: true,
		registry,
		env: { ...env, [registryVariable]: registry },
		onTimeout: (error) => persistFailure(error, { cleanup: false }),
		onEscalate: async (error) => {
			escalated = true;
			persistFailure(error, { cleanup: false, outerEscalated: true });
			// Close the registration gate before killing the fixture. New held leaders
			// cannot execute target code after this point, including cleanup commands.
			const draining = drainRegistry(registry, {
				exclude: [command.child.pid],
			});
			command.kill();
			try {
				await draining;
			} catch (failure) {
				escalationErrors.push(failure.message);
			}
			// Native manager jobs live outside process groups; reconcile only exact
			// identities preregistered before any definition write or job submission.
			try {
				await reconcileFixtureUnits(registry);
			} catch (failure) {
				escalationErrors.push(failure.message);
			}
		},
	});
	const boundaryTimer =
		timeoutAfterBoundary === undefined
			? undefined
			: setInterval(() => {
					if (boundaryArmed || !existsSync(`${receiptPath}.manager-boundary`))
						return;
					boundaryArmed = true;
					command.armTimeout(timeoutAfterBoundary);
				}, 20);
	let primary;
	try {
		await command.done;
	} catch (error) {
		primary = error;
	} finally {
		clearInterval(boundaryTimer);
	}
	// Even a cooperative exit must prove all registered nested groups drained.
	// The receipt's own root/unit scan also rejects unknown escaped descendants.
	try {
		await drainRegistry(registry);
		assert.deepEqual(registrySurvivors(registry), []);
		assert(command.drained, "Outer fixture group did not drain");
		if (primary?.timedOut && !escalated) await reconcileFixtureUnits(registry);
	} catch (error) {
		escalationErrors.push(error.message);
	}
	if (primary?.timedOut || escalated || escalationErrors.length) {
		primary ??= Error("Fixture ownership cleanup failed");
		const receipt = loadReceipt(receiptPath);
		if (primary.cleanupError) escalationErrors.push(primary.cleanupError);
		if (receipt.cleanupError) primary.cleanupError ??= receipt.cleanupError;
		if (escalated) {
			receipt.cleanup = escalationErrors.length === 0 && !receipt.cleanupError;
			receipt.outerEscalated = true;
		}
		if (escalationErrors.length) {
			receipt.cleanup = false;
			receipt.outerCleanupErrors = escalationErrors;
			primary.cleanupError = escalationErrors.join("; ");
		}
		persistFailure(primary, receipt);
	}
	if (!escalationErrors.length)
		rmSync(registry, { recursive: true, force: true });
	else primary.registryPath = registry;
	if (primary) throw primary;
}

async function reconcileFixtureUnits(registry) {
	const manifest = join(registry, "fixture.json");
	if (!existsSync(manifest)) return; // No native units registered or mutated yet.
	const { root, unitDirectory, units } = JSON.parse(readFileSync(manifest));
	assert(root.startsWith(`${tmpdir()}/factory-isolated-service-`));
	assert.equal(unitDirectory, join(homedir(), ".config", "systemd", "user"));
	const errors = [];
	const manager = (...args) =>
		startOwnedCommand("systemctl", ["--user", ...args], {
			timeout: 1000,
			registry: null,
		}).done;
	const until = async (check, label, timeout) => {
		const deadline = Date.now() + timeout;
		while (Date.now() < deadline) {
			if (await check()) return;
			await delay(20);
		}
		throw Error(`Timed out: ${label}`);
	};
	for (const { unit, bytes } of units) {
		try {
			assert(
				/^(factory-acceptance-external-[a-f0-9-]+|de\.bobs-factory\.[a-f0-9]{16}(\.updates)?)\.service$/.test(
					unit,
				),
			);
			const path = join(unitDirectory, unit);
			const verifyDefinition = () => {
				if (!existsSync(path)) return false;
				assert(!lstatSync(path).isSymbolicLink());
				assert.equal(
					readFileSync(path, "utf8"),
					bytes,
					"Fixture unit ownership changed",
				);
				return true;
			};
			await stopOwnedUnit({ unit, manager, verifyDefinition, until });
			if (verifyDefinition()) unlinkSync(path);
			assert(
				terminal(
					properties(
						await manager(
							"show",
							unit,
							"--property=ActiveState,SubState,MainPID,ControlPID,Job",
						),
					),
				),
			);
		} catch (error) {
			errors.push(`${unit}: ${error.message}`);
		}
	}
	try {
		await manager("daemon-reload");
		const survivors = execFileSync("ps", ["-eo", "pid=,ppid=,stat=,args="], {
			encoding: "utf8",
			timeout: 1000,
		})
			.split("\n")
			.filter(
				(line) =>
					line.includes(root) || units.some(({ unit }) => line.includes(unit)),
			);
		assert.deepEqual(
			survivors,
			[],
			"Unknown fixture descendant survived escalation",
		);
	} catch (error) {
		errors.push(error.message);
	}
	assert.equal(errors.length, 0, errors.join("; "));
}
