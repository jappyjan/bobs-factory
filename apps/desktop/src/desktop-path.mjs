import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

async function loginPath(env, home, timeout) {
	const child = spawn(
		env.SHELL && isAbsolute(env.SHELL) ? env.SHELL : "/bin/zsh",
		["-ilc", "printf '\\000'; /usr/bin/printenv PATH; printf '\\000'"],
		{
			env: { ...env, HOME: env.HOME ?? home },
			detached: true,
			stdio: ["ignore", "pipe", "ignore"],
		},
	);
	// Startup children can hold stdout open after the shell exits. Bound the
	// entire process group, including helpers started by the account's profile.
	const stop = () => {
		try {
			if (child.pid) process.kill(-child.pid, "SIGKILL");
		} catch {
			/* process group has already exited */
		}
	};
	let timer;
	try {
		const stdout = await new Promise((resolve, reject) => {
			let output = "";
			child.stdout.setEncoding("utf8");
			child.stdout.on("data", (data) => {
				output += data;
				if (Buffer.byteLength(output) > 128 * 1024) {
					stop();
					reject(new Error("Login shell output exceeded its limit"));
				}
			});
			child.once("error", reject);
			child.once("close", (code) => {
				if (code === 0) resolve(output);
				else reject(new Error("Login shell failed"));
			});
			timer = setTimeout(() => {
				stop();
				reject(new Error("Login shell timed out"));
			}, timeout);
		});
		// Shell startup scripts may print banners. Read only the delimited PATH.
		return stdout.split("\0")[1]?.replace(/\r?\n$/, "");
	} finally {
		clearTimeout(timer);
		stop();
	}
}

/** Finder/LaunchServices do not inherit the account's terminal PATH. */
export async function desktopPath(
	env = process.env,
	{ platform = process.platform, home = homedir(), timeout = 5000 } = {},
) {
	if (platform !== "darwin") return env.PATH;
	const inherited = env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin";
	const fallback = [
		inherited,
		"/opt/homebrew/bin",
		"/usr/local/bin",
		join(home, ".local", "bin"),
		join(home, ".nix-profile", "bin"),
	];
	let recovered;
	try {
		recovered = await loginPath(env, home, timeout);
	} catch {
		// A missing, broken or slow shell must not prevent the desktop opening.
	}
	return [
		...new Set(
			[recovered, ...fallback]
				.filter(Boolean)
				.flatMap((path) =>
					path.split(":").filter((directory) => isAbsolute(directory)),
				),
		),
	].join(":");
}
