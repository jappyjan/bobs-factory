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
	createFixtureDirectory,
	fixtureRootVariable,
	removeFixtureDirectory,
} from "./owned-filesystem.mjs";
import {
	drainRegistry,
	persistRegistry,
	registrySurvivors,
	registryVariable,
} from "./owned-registry.mjs";
import { properties, stopOwnedUnit, terminal } from "./service-protocol.mjs";

const loadReceipt = (path, allowMissing = false) => {
	try {
		const receipt = JSON.parse(readFileSync(path));
		assert(receipt && typeof receipt === "object" && !Array.isArray(receipt));
		return receipt;
	} catch (error) {
		if (allowMissing && error.code === "ENOENT")
			return { passed: false, cleanup: false };
		return { passed: false, cleanup: false, receiptError: error.message };
	}
};

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
	const filesystem = createFixtureDirectory();
	persistRegistry(join(registry, "filesystem.json"), filesystem);
	const escalationErrors = [];
	let escalated = false;
	let boundaryArmed = false;
	const persistFailure = (error, extra = {}) => {
		// A deadline may arrive before the child has written its first receipt.
		const receipt = loadReceipt(receiptPath, true);
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
		env: {
			...env,
			[registryVariable]: registry,
			[fixtureRootVariable]: filesystem.root,
		},
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
			// Native jobs are reconciled by finalization after command.done and the
			// final group drain, so no live child can submit another manager job.
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
	} catch (error) {
		escalationErrors.push(error.message);
	}
	const receipt = loadReceipt(receiptPath);
	// Every terminal path requires independent native proof. A successful child's
	// cleanup:true is a claim, not confirmation that units or queued jobs drained.
	// Reconcile even after a group error, but retain state/evidence if any proof fails.
	try {
		await reconcileFixtureUnits(registry, env, filesystem);
	} catch (error) {
		escalationErrors.push(error.message);
	}
	if (receipt.receiptError) escalationErrors.push(receipt.receiptError);
	if (primary?.cleanupError) escalationErrors.push(primary.cleanupError);
	if (receipt.cleanupError) escalationErrors.push(receipt.cleanupError);
	// Cleanup proof includes mutable filesystem state, even after cooperative exit.
	if (!escalationErrors.length) {
		try {
			const manifest = join(registry, "fixture.json");
			if (existsSync(manifest))
				assert.equal(
					JSON.parse(readFileSync(manifest)).root,
					filesystem.root,
					"Fixture root is not provider-owned",
				);
			removeFixtureDirectory(filesystem, receiptPath);
			receipt.cleanup = true;
		} catch (error) {
			escalationErrors.push(error.message);
		}
	}
	if (escalationErrors.length) {
		primary ??= Error("Fixture ownership cleanup failed");
		receipt.cleanup = false;
		receipt.outerCleanupErrors = escalationErrors;
		primary.cleanupError = escalationErrors.join("; ");
		// Keep the exact manifest and group identities when cleanup is unproven.
		primary.registryPath = registry;
		receipt.registryPath = registry;
	}
	try {
		if (primary || escalated) {
			primary ??= Error("Fixture ownership cleanup failed");
			if (escalated) receipt.outerEscalated = true;
			persistFailure(primary, receipt);
		} else persistRegistry(receiptPath, receipt);
		if (!escalationErrors.length)
			rmSync(registry, { recursive: true, force: true });
	} catch (error) {
		// Receipt publication or registry removal must not erase an earlier exit,
		// signal or deadline. Keep the registry location on the thrown failure.
		primary ??= error;
		primary.cleanupError = [primary.cleanupError, error.message]
			.filter(Boolean)
			.join("; ");
		primary.registryPath = registry;
	}
	if (primary) throw primary;
}

async function reconcileFixtureUnits(registry, env, filesystem) {
	const binding = join(registry, "filesystem.json");
	assert(
		lstatSync(binding).isFile(),
		"Fixture filesystem record is not a file",
	);
	assert.deepEqual(
		JSON.parse(readFileSync(binding)),
		filesystem,
		"Fixture filesystem record changed",
	);
	const manifest = join(registry, "fixture.json");
	try {
		assert(lstatSync(manifest).isFile(), "Fixture manifest is not a file");
	} catch (error) {
		if (error.code === "ENOENT") return; // No native units registered or mutated yet.
		throw error;
	}
	const { root, unitDirectory, units } = JSON.parse(readFileSync(manifest));
	assert.equal(root, filesystem.root, "Fixture root is not provider-owned");
	assert.equal(unitDirectory, join(homedir(), ".config", "systemd", "user"));
	assert(Array.isArray(units), "Fixture unit registry is invalid");
	// Validate the entire record before operating on any manager identity.
	for (const { unit, bytes } of units) {
		assert(
			/^(factory-acceptance-external-[a-f0-9-]+|de\.bobs-factory\.[a-f0-9]{16}(\.updates)?)\.service$/.test(
				unit,
			),
		);
		assert(bytes === null || typeof bytes === "string");
	}
	const errors = [];
	const manager = (...args) =>
		startOwnedCommand("systemctl", ["--user", ...args], {
			timeout: 1000,
			registry: null,
			env,
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
			errors.push(
				`${unit}: ${error.message}${error.stderr ? `: ${error.stderr.trim()}` : ""}`,
			);
		}
	}
	try {
		await manager("daemon-reload");
		for (const { unit } of units) {
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
				"Owned unit has a process or queued manager job after reload",
			);
		}
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
