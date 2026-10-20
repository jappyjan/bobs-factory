import { createServer, type Server } from "node:net";
import { afterEach, expect, it } from "vitest";
import { reserveLoopbackPorts } from "./ports.mjs";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.reverse()) await cleanup();
	cleanups.length = 0;
});

async function listen(server: Server, port: number) {
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen({ host: "127.0.0.1", port }, () => {
			server.removeListener("error", reject);
			resolve();
		});
	});
}

it("reserves distinct ports across simultaneous fixtures without disturbing another listener", async () => {
	const unrelated = createServer();
	await listen(unrelated, 0);
	cleanups.push(
		() => new Promise((resolve) => unrelated.close(() => resolve())),
	);
	const address = unrelated.address();
	if (!address || typeof address === "string") throw new Error("No listener");
	const leases = await Promise.all([
		reserveLoopbackPorts(2),
		reserveLoopbackPorts(2),
	]);
	for (const lease of leases) cleanups.push(lease.release);
	const ports = leases.flatMap((lease) => lease.ports);
	expect(new Set(ports).size).toBe(4);
	expect(ports).not.toContain(address.port);
	for (const port of [...ports, address.port])
		await expect(listen(createServer(), port)).rejects.toMatchObject({
			code: "EADDRINUSE",
		});
	expect(unrelated.listening).toBe(true);
	await Promise.all(leases.map((lease) => lease.release()));
	for (const port of ports) {
		const worker = createServer();
		await listen(worker, port);
		await new Promise<void>((resolve) => worker.close(() => resolve()));
	}
	await Promise.all(leases.map((lease) => lease.release()));
	expect(unrelated.listening).toBe(true);
});

it("rejects invalid reservation counts", async () => {
	for (const count of [0, -1, 1.5, Number.NaN])
		await expect(reserveLoopbackPorts(count)).rejects.toThrow(
			"Expected a positive port count",
		);
});
