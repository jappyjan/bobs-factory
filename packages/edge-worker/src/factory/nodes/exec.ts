import { realpathSync } from "node:fs";
import { spawnExecution as spawn } from "bobs-factory-core";
import { z } from "zod";
import type { ExecutionContext } from "../WorkflowRuntime.js";
import type { NodeDefinition } from "./NodeDefinition.js";
import { stepFields } from "./schema.js";

export const configuration = z.object({
	command: z.string().min(1),
	args: z.array(z.string()).default([]),
	access: z.enum(["read-only", "workspace"]).default("read-only"),
	timeout: z.number().int().min(1).max(3600000).default(120000),
	env: z
		.array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/))
		.default(["PATH", "LANG"]),
	json: z.boolean().default(false),
});
export const schema = z.object({
	...stepFields,
	type: z.literal("exec"),
	...configuration.shape,
});
export interface ExecResult {
	exitCode: number;
	stdout: string;
	stderr: string;
	json?: unknown;
}

/** OS-enforced write boundary, also for shell commands and their descendants. */
export function execInvocation(
	workspace: string,
	config: z.output<typeof configuration>,
) {
	const root = realpathSync(workspace);
	if (process.platform === "darwin") {
		const allow =
			config.access === "workspace"
				? `(allow file-write* (subpath ${JSON.stringify(root)}))`
				: "";
		return {
			command: "/usr/bin/sandbox-exec",
			args: [
				"-p",
				`(version 1)(allow default)(deny file-write*)${allow}(allow file-write* (literal "/dev/null"))`,
				config.command,
				...config.args,
			],
		};
	}
	if (process.platform === "linux")
		return {
			command: "bwrap",
			args: [
				"--die-with-parent",
				"--ro-bind",
				"/",
				"/",
				...(config.access === "workspace" ? ["--bind", root, root] : []),
				"--dev",
				"/dev",
				"--proc",
				"/proc",
				"--",
				config.command,
				...config.args,
			],
		};
	throw new Error(
		"exec access enforcement requires macOS sandbox-exec or Linux bubblewrap",
	);
}

export function executeExec(
	context: ExecutionContext,
	config: z.output<typeof configuration>,
	key?: string,
): Promise<ExecResult> {
	context.signal.throwIfAborted();
	const invocation = execInvocation(context.run.workspace, config);
	const source = context.execution?.environment ?? process.env;
	const env = Object.fromEntries(
		config.env
			.filter((name) => source[name] !== undefined)
			.map((name) => [name, source[name]]),
	);
	// Mutating scripts can use this identity to reconcile their own downstream writes.
	if (key) env.FACTORY_EFFECT_KEY = key;
	return new Promise((resolve, reject) => {
		const child = spawn(invocation.command, invocation.args, {
			cwd: context.run.workspace,
			env,
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "",
			stderr = "",
			timedOut = false;
		let killTimer: ReturnType<typeof setTimeout> | undefined;
		const kill = (signal: NodeJS.Signals) => {
			try {
				if (child.pid) process.kill(-child.pid, signal);
			} catch {
				/* already exited */
			}
		};
		const stop = () => {
			kill("SIGTERM");
			killTimer ??= setTimeout(() => kill("SIGKILL"), 1000);
		};
		const timer = setTimeout(() => {
			timedOut = true;
			stop();
		}, config.timeout);
		context.signal.addEventListener("abort", stop, { once: true });
		if (context.signal.aborted) stop();
		child.stdout.on("data", (chunk) => {
			stdout = (stdout + chunk).slice(-1000000);
		});
		child.stderr.on("data", (chunk) => {
			stderr = (stderr + chunk).slice(-1000000);
		});
		const cleanup = () => {
			clearTimeout(timer);
			if (killTimer) clearTimeout(killTimer);
			context.signal.removeEventListener("abort", stop);
		};
		child.on("error", (error) => {
			cleanup();
			reject(error);
		});
		child.on("close", (code) => {
			cleanup();
			if (context.signal.aborted)
				return reject(context.signal.reason ?? new Error("Run terminated"));
			if (timedOut)
				return reject(new Error(`Command timed out after ${config.timeout}ms`));
			if (context.execution) {
				stdout = context.execution.redact(stdout);
				stderr = context.execution.redact(stderr);
			}
			try {
				resolve({
					exitCode: code ?? 128,
					stdout,
					stderr,
					...(config.json ? { json: JSON.parse(stdout) } : {}),
				});
			} catch (error) {
				reject(error);
			}
		});
	});
}
export const definition = {
	type: "exec",
	schema,
	category: "io",
	effect: "effect",
	accessEffects: { "read-only": "read-only", workspace: "effect" },
	builder: {
		label: "Exec",
		icon: "›_",
		paletteGroup: "io",
		defaults: {
			command: "git",
			args: ["status", "--short"],
			access: "read-only",
			timeout: 120000,
			env: ["PATH", "LANG"],
			json: false,
		},
	},
	execute: async (ctx) =>
		ctx.step.access === "read-only"
			? executeExec(ctx, ctx.step)
			: ctx.effect("exec", ctx.step, async (key) => {
					const lease = await ctx.engine.hooks.capacity?.acquireLease(
						ctx.signal,
						ctx.capacity,
					);
					try {
						const run = () => executeExec(ctx, ctx.step, key);
						return lease ? await lease.run(run) : await run();
					} finally {
						await lease?.release();
					}
				}),
} satisfies NodeDefinition<typeof schema>;
