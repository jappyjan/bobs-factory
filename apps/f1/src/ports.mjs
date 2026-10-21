import { createServer } from "node:net";

/**
 * Reserve OS-selected ports for embedded workers that require their port before
 * startup. Hold every reservation through fixture setup; release immediately
 * before worker.start(). Never terminate another process's listener.
 * @param {number} count
 */
export async function reserveLoopbackPorts(count) {
	if (!Number.isInteger(count) || count < 1)
		throw new Error("Expected a positive port count");
	const servers = [];
	const ports = [];
	const listen = (server, host, port) =>
		new Promise((resolve, reject) => {
			server.once("error", reject);
			server.listen({ host, port, exclusive: true, ipv6Only: true }, () => {
				server.removeListener("error", reject);
				resolve();
			});
		});
	const close = (server) =>
		new Promise((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
	const release = async () => {
		await Promise.all(servers.splice(0).map(close));
	};
	try {
		for (let attempts = 0; ports.length < count; attempts++) {
			if (attempts >= count + 20)
				throw new Error("Unable to reserve loopback ports");
			const ipv4 = createServer();
			await listen(ipv4, "127.0.0.1", 0);
			servers.push(ipv4);
			const port = ipv4.address().port;
			const ipv6 = createServer();
			try {
				// Reserve both families explicitly; macOS IPv6 listeners do not reserve IPv4.
				await listen(ipv6, "::1", port);
				servers.push(ipv6);
			} catch (error) {
				if (error.code === "EADDRINUSE") {
					servers.pop();
					await close(ipv4);
					continue;
				}
				if (!["EAFNOSUPPORT", "EADDRNOTAVAIL"].includes(error.code))
					throw error;
			}
			ports.push(port);
		}
		return { ports, release };
	} catch (error) {
		await release();
		throw error;
	}
}
