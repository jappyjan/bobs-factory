import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	expect,
	it,
	vi,
} from "vitest";

const processes = vi.hoisted(() => ({ spawn: vi.fn(), execFile: vi.fn() }));
vi.mock("node:child_process", async (original) => ({
	...(await original<typeof import("node:child_process")>()),
	...processes,
}));

class Child extends EventEmitter {
	pid = 123;
	exitCode: number | null = null;
	stdout = new PassThrough();
	stderr = new PassThrough();
	stdin = new PassThrough();
	send = vi.spyOn(this.stdin, "end");
	kill = vi.fn(() => true);

	close(code = 0, signal: string | null = null) {
		this.exitCode = code;
		this.emit("exit", code, signal);
		this.emit("close", code, signal);
	}
}
let schema: typeof import("../src/factory/InlineSchema.js");
let children: Child[];
let samples: ((error: Error | null, output: string) => void)[];
const bun = Object.getOwnPropertyDescriptor(process.versions, "bun");
beforeAll(async () => {
	// Exercise the packaged Bun subprocess path without making the Node worker
	// tests pretend that worker_threads implements the same lifecycle.
	Object.defineProperty(process.versions, "bun", {
		value: "test",
		configurable: true,
	});
	vi.resetModules();
	schema = await import("../src/factory/InlineSchema.js");
});
afterAll(() => {
	if (bun) Object.defineProperty(process.versions, "bun", bun);
	else Reflect.deleteProperty(process.versions, "bun");
});
beforeEach(() => {
	vi.useFakeTimers();
	vi.spyOn(process, "kill").mockReturnValue(true);
	children = [];
	samples = [];
	processes.spawn.mockImplementation(() => {
		const child = new Child();
		children.push(child);
		return child;
	});
	processes.execFile.mockImplementation((_file, _args, _options, callback) => {
		samples.push(callback);
		return { kill: vi.fn() };
	});
});
afterEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();
	vi.restoreAllMocks();
});
function start(title: string) {
	const result = schema.compileInlineSchema({ type: "boolean", title });
	const child = children.at(-1)!;
	child.emit("spawn");
	return { child, result };
}
function respond(child: Child) {
	child.stdout.write(JSON.stringify({ schemaIssues: [], issues: [] }));
}

it("waits for observable startup RSS and reconciles a zero-RSS exit before returning the result", async () => {
	const { child, result } = start("startup and retirement");
	let settled = false;
	void result.then(() => (settled = true));
	samples.shift()!(null, "0\n");
	expect(child.send).not.toHaveBeenCalled();
	await vi.advanceTimersByTimeAsync(50);
	samples.shift()!(null, "32000\n");
	expect(child.send).toHaveBeenCalledExactlyOnceWith(
		JSON.stringify({
			schema: { type: "boolean", title: "startup and retirement" },
			validate: false,
		}),
	);
	await vi.advanceTimersByTimeAsync(50);
	samples.shift()!(null, "0\n");
	respond(child);
	child.emit("exit", 0, null);
	await vi.advanceTimersByTimeAsync(150);
	expect(child.kill).not.toHaveBeenCalled();
	expect(settled).toBe(false);
	child.emit("close", 0, null);
	await expect(result).resolves.toEqual([]);
});

it("fails closed before submitting work when the live child cannot be monitored", async () => {
	const { child, result } = start("unavailable initial watchdog");
	let settled = false;
	void result.then(() => (settled = true));
	samples.shift()!(new Error("ps unavailable"), "");
	await vi.advanceTimersByTimeAsync(100);
	expect(child.send).not.toHaveBeenCalled();
	expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
	expect(settled).toBe(false);
	child.close(0, "SIGKILL");
	await expect(result).resolves.toEqual([
		"Inline JSON Schema child memory watchdog unavailable; validation stopped",
	]);
});

it("reconciles confirmed ESRCH before Bun delivers exit without releasing the child early", async () => {
	const { child, result } = start("OS confirmed retirement");
	let settled = false;
	void result.then(() => (settled = true));
	samples.shift()!(null, "32000\n");
	await vi.advanceTimersByTimeAsync(50);
	samples.shift()!(null, "0\n");
	respond(child);
	vi.mocked(process.kill).mockImplementation(() => {
		throw Object.assign(new Error("Process already gone"), { code: "ESRCH" });
	});
	await vi.advanceTimersByTimeAsync(250);
	expect(process.kill).toHaveBeenCalledExactlyOnceWith(child.pid, 0);
	expect(child.exitCode).toBe(null);
	expect(child.kill).not.toHaveBeenCalled();
	expect(settled).toBe(false);
	child.close();
	await expect(result).resolves.toEqual([]);
});

it("fails closed when liveness inspection cannot prove the child was reclaimed", async () => {
	const { child, result } = start("Liveness permission failure");
	samples.shift()!(null, "");
	vi.mocked(process.kill).mockImplementation(() => {
		throw Object.assign(new Error("Cannot inspect this process"), {
			code: "EPERM",
		});
	});
	await vi.advanceTimersByTimeAsync(100);
	expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
	expect(child.send).not.toHaveBeenCalled();
	child.close(0, "SIGKILL");
	await expect(result).resolves.toEqual([
		"Inline JSON Schema child memory watchdog unavailable; validation stopped",
	]);
});

it("still stops a live validation when its working RSS watchdog becomes unavailable", async () => {
	const { child, result } = start("lost live watchdog");
	samples.shift()!(null, "32000\n");
	await vi.advanceTimersByTimeAsync(50);
	samples.shift()!(null, "");
	await vi.advanceTimersByTimeAsync(100);
	expect(child.send).toHaveBeenCalledOnce();
	expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
	child.close(0, "SIGKILL");
	await expect(result).resolves.toEqual([
		"Inline JSON Schema child memory watchdog unavailable; validation stopped",
	]);
});

it("keeps the RSS cap independent of result and lifecycle handling", async () => {
	const { child, result } = start("RSS cap");
	samples.shift()!(null, "262145\n");
	expect(child.send).not.toHaveBeenCalled();
	expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
	child.close(0, "SIGKILL");
	await expect(result).resolves.toEqual([
		"Inline JSON Schema child exceeded the 256 MiB RSS limit",
	]);
});

it("keeps the independent wall deadline and waits for confirmed child reclamation", async () => {
	const { child, result } = start("wall limit");
	let settled = false;
	void result.then(() => (settled = true));
	samples.shift()!(null, "32000\n");
	await vi.advanceTimersByTimeAsync(2000);
	expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
	expect(settled).toBe(false);
	child.close(0, "SIGKILL");
	await expect(result).resolves.toEqual([
		"Inline JSON Schema worker exceeded the 2000 ms wall limit",
	]);
});

it("reclaims a cancelled child before rejecting and permits the next ordinary job", async () => {
	const controller = new AbortController();
	const result = schema.validateInlineSchema(
		{ type: "boolean" },
		true,
		controller.signal,
	);
	const child = children.at(-1)!;
	child.emit("spawn");
	samples.shift()!(null, "32000\n");
	let settled = false;
	void result.catch(() => (settled = true));
	controller.abort(new DOMException("Run stopped", "AbortError"));
	expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
	await vi.advanceTimersByTimeAsync(100);
	expect(settled).toBe(false);
	child.close(0, "SIGKILL");
	await expect(result).rejects.toMatchObject({
		name: "AbortError",
		message: "Run stopped",
	});
	const next = start("after cancellation");
	samples.at(-1)!(null, "32000\n");
	respond(next.child);
	next.child.close();
	await expect(next.result).resolves.toEqual([]);
});

it("does not trust a result from an unsuccessful child exit", async () => {
	const { child, result } = start("failed exit");
	samples.shift()!(null, "32000\n");
	respond(child);
	child.close(1);
	await expect(result).resolves.toEqual([
		"Inline JSON Schema child exited without a successful result",
	]);
});
