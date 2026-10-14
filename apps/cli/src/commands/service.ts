import { resolve } from "node:path";
import { isPackagedExecutable, resolvePath } from "bobs-factory-core";
import { preflightFactoryState } from "bobs-factory-edge-worker";
import type { Command } from "commander";
import { launchFactory } from "../runtime.js";
import {
	allowDesktopStart,
	stopDesktop,
} from "../services/DesktopLifecycle.js";
import {
	type ServiceAction,
	ServiceLifecycle,
} from "../services/ServiceLifecycle.js";
import { runUpdateSupervisor } from "../services/UpdateSupervisor.js";
export function addServiceCommands(program: Command) {
	const service = program
		.command("service")
		.description(
			"Explicit user-service ownership and login startup (no root/system daemon)",
		);
	const lifecycle = () =>
		new ServiceLifecycle(resolve(resolvePath(program.opts().home)));
	service
		.command("install")
		.option("--executable <path>", "Absolute packaged Factory executable")
		.action((opts: { executable?: string }) => {
			if (!opts.executable && !isPackagedExecutable)
				throw new Error(
					"Checkout services require --executable pointing to a packaged binary",
				);
			console.log(
				JSON.stringify(
					lifecycle().install(
						opts.executable ?? process.execPath,
						"start",
						undefined,
						Number(program.opts().port ?? 3457),
					),
					null,
					2,
				),
			);
		});
	for (const action of [
		"status",
		"logs",
		"start",
		"stop",
		"restart",
		"enable",
		"disable",
		"remove",
		"maintenance",
	] as ServiceAction[]) {
		if (action === "install") continue;
		service
			.command(action)
			.action(async () =>
				console.log(JSON.stringify(await lifecycle().action(action), null, 2)),
			);
	}
	service
		.command("allow-desktop-start", { hidden: true })
		.action(() => allowDesktopStart(lifecycle().home));
	service
		.command("stop-desktop", { hidden: true })
		.requiredOption("--expected-nonce <nonce>")
		.requiredOption("--executable <path>")
		.action((opts: { expectedNonce: string; executable: string }) =>
			stopDesktop(lifecycle().home, opts.expectedNonce, opts.executable),
		);
	service
		.command("updates-run", { hidden: true })
		.option("--once", "One supervisor tick")
		.action(async (opts: { once?: boolean }) =>
			console.log(
				JSON.stringify(
					await runUpdateSupervisor(
						lifecycle().home,
						Number(program.opts().port ?? 3457),
						opts.once,
					),
				),
			),
		);
	service
		.command("validate-state", { hidden: true })
		.action(() =>
			console.log(JSON.stringify(preflightFactoryState(lifecycle().home))),
		);
	service.command("run", { hidden: true }).action(async () => {
		const r = lifecycle().record();
		if (!r || r.desired !== "running") return;
		process.env.BOBS_FACTORY_FACTORY_PORT = String(r.dashboardPort ?? 3457);
		if (process.env.BOBS_FACTORY_SERVICE_ID !== r.id)
			throw new Error("service run is manager-only");
		await launchFactory({ ...program.opts(), open: false });
	});
	service
		.command("resume")
		.description("Leave update maintenance after verified replacement/recovery")
		.action(async () =>
			console.log(JSON.stringify(await lifecycle().resume(), null, 2)),
		);
}
