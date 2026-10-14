import { launchFactory } from "../runtime.js";
import { BaseCommand } from "./ICommand.js";

/** Compatibility entry point used by older internal callers. */
export class StartCommand extends BaseCommand {
	async execute(_args: string[]): Promise<void> {
		await launchFactory({
			home: this.app.factoryHome,
			port: process.env.BOBS_FACTORY_FACTORY_PORT ?? "3457",
			open: false,
		});
	}
}
