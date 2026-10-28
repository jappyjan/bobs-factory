import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { factoryRuntimeIdentity, resolvePath } from "bobs-factory-core";
import {
	backupSlot,
	candidateKey,
	discardBackup,
	readManifest,
	requestFactoryTerminalSession,
	restoreMigrationBackup,
	UpdateManager,
	type UpdateSettingsPatch,
} from "bobs-factory-edge-worker";
import type { Command } from "commander";
import { ownerAlive, workerOwner } from "../services/InstanceLock.js";
import { OwnedUpdateLifecycle } from "../services/OwnedUpdateLifecycle.js";
import { FactoryClient } from "../tui/client.js";

/** Filesystem-authorized offline settings/status, authenticated running-instance
 * operations. Never stop the worker from its own API process. */
export function addUpdateCommands(program: Command) {
	const update = program
		.command("update")
		.description("Inspect and configure updates for this instance");
	const home = () => resolve(resolvePath(program.opts().home));
	const manager = () => new UpdateManager(home());
	const client = () =>
		new FactoryClient({
			home: home(),
			port: Number(program.opts().port),
			requestSession: requestFactoryTerminalSession,
		});
	const output = (value: unknown) =>
		console.log(JSON.stringify(value, null, 2));
	update
		.command("status")
		.description(
			"Show persisted channel, policy, installed identity and pending/result",
		)
		.action(() => output(manager().status()));
	update
		.command("settings")
		.option("--channel <channel>", "stable or nightly")
		.option(
			"--policy <policy>",
			"manual, idle-auto or default (selected channel)",
		)
		.option("--pause", "Pause activation")
		.option("--resume", "Resume updates")
		.option(
			"--pin <version>",
			"Freeze to an exact version; automatic activation stays paused",
		)
		.option("--unpin", "Remove exact-version freeze")
		.action(
			(options: {
				channel?: UpdateSettingsPatch["channel"];
				policy?: UpdateSettingsPatch["policy"];
				pause?: boolean;
				resume?: boolean;
				pin?: string;
				unpin?: boolean;
			}) => {
				if ((options.pause && options.resume) || (options.pin && options.unpin))
					throw new Error("Choose pause/resume or pin/unpin, not both.");
				const current = manager();
				const patch: UpdateSettingsPatch = {};
				if (options.channel) patch.channel = options.channel;
				if (options.policy) patch.policy = options.policy;
				if (options.pause || options.resume)
					patch.paused = Boolean(options.pause);
				if (options.pin) patch.pin = options.pin;
				if (options.unpin) patch.pin = null;
				output(
					Object.keys(patch).length
						? current.configure(patch, current.status().revision)
						: current.status(),
				);
			},
		);
	for (const action of ["check", "stage"] as const)
		update
			.command(action)
			.description(
				`${action === "check" ? "Check signed published releases" : "Download and verify an isolated candidate"} through authenticated local dashboard`,
			)
			.action(async () =>
				output(await client().post(`/api/updates/${action}`)),
			);
	update
		.command("install")
		.description(
			"Queue explicit Install for the current candidate; owned supervisor drains active work",
		)
		.requiredOption(
			"--candidate <identity>",
			"Exact candidate identity shown by check/status",
		)
		.requiredOption("--revision <number>", "Current settings revision")
		.option("--retry", "Deliberately retry a known failed candidate")
		.action(
			async (options: {
				candidate: string;
				revision: string;
				retry?: boolean;
			}) => {
				output(
					await client().post(
						`/api/updates/${options.retry ? "retry" : "install"}`,
						{
							candidate: options.candidate,
							revision: Number(options.revision),
						},
					),
				);
			},
		);
	update
		.command("candidate")
		.description("Print the exact pending candidate identity for Install")
		.action(() => {
			const state = manager().status();
			if (!state.pending)
				throw new Error("No pending candidate. Run update check first.");
			output({
				candidate: candidateKey(state.pending.candidate),
				revision: state.revision,
			});
		});
	update
		.command("recover")
		.description(
			"Resolve an update paused because a different build than the update expects is installed",
		)
		.option(
			"--adopt-installed",
			"Keep the installed build as the truth and close the interrupted update",
		)
		.option("--yes", "Confirm; without it nothing is changed")
		.action(async (options: { adoptInstalled?: boolean; yes?: boolean }) => {
			if (!options.adoptInstalled)
				throw new Error("Choose --adopt-installed to resolve the notice.");
			const { recovery } = manager().status();
			if (!recovery) {
				output({ adopted: false, reason: "No unexpected runtime to adopt." });
				return;
			}
			if (!options.yes)
				throw new Error(
					`${recovery.steps.join("\n")}\nRe-run with --yes to adopt the installed build.`,
				);
			let lifecycle: OwnedUpdateLifecycle | undefined;
			try {
				lifecycle = new OwnedUpdateLifecycle(
					home(),
					Number(program.opts().port),
				);
			} catch {
				// Foreground/external install: no owned supervisor lifecycle to ask.
			}
			// Without a lifecycle, end maintenance best-effort and drop the fence.
			const release = async (transactionId: string) => {
				await client()
					.post("/api/updates/maintenance", { transactionId, action: "end" })
					.catch(() => undefined);
				const fence = join(home(), "runtime", "update-owner.json");
				if (
					existsSync(fence) &&
					JSON.parse(readFileSync(fence, "utf8")).transactionId ===
						transactionId
				)
					rmSync(fence);
			};
			output(
				await new UpdateManager(home(), undefined, lifecycle).adoptInstalled(
					factoryRuntimeIdentity,
					{ release },
				),
			);
		});
	const backupCommand = (
		name: "restore-backup" | "discard-backup",
		description: string,
		act: (home: string) => void,
	) =>
		update
			.command(name)
			.description(description)
			.option("--yes", "Confirm; without it nothing is changed")
			.action((options: { yes?: boolean }) => {
				const manifest = readManifest(backupSlot(home()));
				if (!manifest) throw new Error("There is no migration backup.");
				const owner = workerOwner(home());
				if (owner && ownerAlive(owner))
					throw new Error(
						`Stop the running Bob's Factory (PID ${owner.pid}) first.`,
					);
				if (!options.yes)
					throw new Error(
						`Migration backup is ${manifest.status} (data format ${manifest.fromFormat} -> ${manifest.toFormat}, ${manifest.files.length} files). Re-run with --yes to ${name === "restore-backup" ? "restore those files and the previous data format" : "delete it and keep the current files"}.`,
					);
				act(home());
				output({
					[name === "restore-backup" ? "restored" : "discarded"]: true,
				});
			});
	backupCommand(
		"restore-backup",
		"Restore the files saved before the last data migration (worker must be stopped)",
		(dir) => restoreMigrationBackup(dir),
	);
	backupCommand(
		"discard-backup",
		"Delete the saved pre-migration files and keep the current data (worker must be stopped)",
		(dir) => discardBackup(dir),
	);
}
