import { createServer } from "node:net";

const listen = (port) =>
	new Promise((resolve, reject) => {
		const server = createServer();
		server.once("error", reject);
		server.listen(port, "127.0.0.1", () => resolve(server));
	});
const close = (server) => new Promise((resolve) => server.close(resolve));

/**
 * Ask the OS for a free port whose successor is also free (the trial launcher
 * reserves PORT and PORT+1). The probe is released before use, so callers that
 * must bind it use `retryWhileOccupied` for the remaining race.
 */
export async function freePortPair() {
	for (let attempt = 0; attempt < 50; attempt++) {
		const first = await listen(0);
		const port = first.address().port;
		try {
			if (port >= 1024 && port <= 65533) await close(await listen(port + 1));
			else throw new Error("outside launcher port range");
			await close(first);
			return port;
		} catch {
			await close(first);
		}
	}
	throw new Error("No free adjacent port pair");
}

/**
 * Run `attempt(port)` on a fresh free port pair, retrying only when the launcher
 * reports that another process took the probed port in the meantime.
 */
export async function retryWhileOccupied(attempt, isOccupied, tries = 3) {
	for (let index = 1; ; index++) {
		const port = await freePortPair();
		const result = await attempt(port);
		if (index >= tries || !isOccupied(result)) return { port, result };
	}
}
