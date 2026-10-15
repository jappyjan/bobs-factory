import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { resolvePath } from "bobs-factory-core";
import { z } from "zod";
import { atomicPrivateFile } from "./FactoryAuthStore.js";

const socketSchema = z
	.string()
	.trim()
	.min(1)
	.max(4096)
	.refine(
		(value) =>
			!Array.from(value).some((character) => character.charCodeAt(0) < 32),
		"Invalid socket path",
	)
	.refine(
		(value) => isAbsolute(value) || value.startsWith("~/"),
		"Use an absolute path or ~/ path",
	)
	.transform((value) => resolvePath(value));
const settingsSchema = z
	.object({
		revision: z.number().int().nonnegative(),
		socket: socketSchema.nullable(),
	})
	.strict();
const selectionSchema = z.object({ socket: socketSchema.nullable() }).strict();
const isSocket = (path: string) => {
	try {
		return statSync(path).isSocket();
	} catch {
		return false;
	}
};

/** Host-owned SSH credentials stay in the selected agent; only its socket is saved. */
export class GitSettings {
	private file: string;
	constructor(home: string) {
		this.file = join(home, "factory", "git-settings.json");
	}
	read() {
		return existsSync(this.file)
			? settingsSchema.parse(JSON.parse(readFileSync(this.file, "utf8")))
			: { revision: 0, socket: null };
	}
	status(environment: NodeJS.ProcessEnv = process.env) {
		const settings = this.read();
		const effectiveSocket =
			settings.socket ?? environment.SSH_AUTH_SOCK ?? null;
		return {
			...settings,
			inheritedSocket: environment.SSH_AUTH_SOCK ?? null,
			effectiveSocket,
			available: !!effectiveSocket && isSocket(effectiveSocket),
			detected: [
				join(
					homedir(),
					"Library/Containers/com.bitwarden.desktop/Data/.bitwarden-ssh-agent.sock",
				),
				join(homedir(), ".bitwarden-ssh-agent.sock"),
				join(homedir(), ".1password/agent.sock"),
			].filter(isSocket),
		};
	}
	save(value: unknown) {
		const { socket, expectedRevision } = selectionSchema
			.extend({
				expectedRevision: z.number().int().nonnegative(),
			})
			.parse(value);
		if (expectedRevision !== this.read().revision)
			throw new Error("Git settings changed. Reload settings before saving.");
		if (socket && !isSocket(socket))
			throw new Error(
				"SSH agent socket is unavailable on the Factory machine. Start or unlock the agent and check its socket path.",
			);
		const settings = { revision: expectedRevision + 1, socket };
		mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
		atomicPrivateFile(this.file, JSON.stringify(settings));
		return this.status();
	}
	async test(value: unknown, environment: NodeJS.ProcessEnv = process.env) {
		const { socket } = selectionSchema.parse(value);
		const effectiveSocket = socket ?? environment.SSH_AUTH_SOCK;
		if (!effectiveSocket || !isSocket(effectiveSocket))
			return {
				ready: false,
				keys: 0,
				message:
					"SSH agent socket is unavailable on the Factory machine. Start or unlock the agent and check its socket path.",
			};
		try {
			const { stdout } = await promisify(execFile)("ssh-add", ["-l"], {
				env: { ...environment, SSH_AUTH_SOCK: effectiveSocket },
				timeout: 5000,
				maxBuffer: 256 * 1024,
			});
			const keys = stdout.trim().split("\n").filter(Boolean).length;
			return {
				ready: keys > 0,
				keys,
				message: `Connected to SSH agent: ${keys} ${keys === 1 ? "key" : "keys"} available. Signing may require unlocking your password manager.`,
			};
		} catch {
			return {
				ready: false,
				keys: 0,
				message:
					"SSH agent has no accessible keys or could not be contacted. Unlock the agent and make the Git signing key available, then test again.",
			};
		}
	}
}

/** Read at each launch so a saved repair also applies to retained runs on retry. */
export function gitAgentEnvironment(home: string): Record<string, string> {
	const { socket } = new GitSettings(home).read();
	return socket ? { SSH_AUTH_SOCK: socket } : {};
}
