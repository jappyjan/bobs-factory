import type { FastifyRequest } from "fastify";

export function loopbackHost(hostname: string) {
	return ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
}

export function localFactoryOrigin(origin: string) {
	const url = new URL(origin);
	return url.protocol === "http:" && loopbackHost(url.hostname);
}

/** IPv6 is a local authority alias, not a new persisted passkey origin binding. */
export function factoryRequestOrigins(origins: string[]) {
	const result = new Set(origins);
	for (const origin of origins) {
		if (!localFactoryOrigin(origin)) continue;
		const url = new URL(origin);
		url.hostname = "[::1]";
		result.add(url.origin);
	}
	return [...result];
}

/** The socket is authority. Proxy headers never establish local access. */
export function directLocalFactoryRequest(request: FastifyRequest) {
	const peer = request.raw.socket.remoteAddress;
	if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(peer ?? ""))
		return false;
	if ("encrypted" in request.raw.socket && request.raw.socket.encrypted)
		return false;
	return !Object.keys(request.headers).some(
		(name) =>
			name === "forwarded" ||
			name === "via" ||
			name.startsWith("x-forwarded-") ||
			name === "x-real-ip",
	);
}

/** Block cross-site reads/navigation too: local access no longer relies on a Strict cookie. */
export function localFactoryBrowserRequest(
	request: FastifyRequest,
	origin: string,
) {
	const site = request.headers["sec-fetch-site"];
	if (site !== undefined && site !== "same-origin" && site !== "none")
		return false;
	const referer = request.headers.referer;
	if (referer !== undefined) {
		try {
			if (new URL(referer).origin !== origin) return false;
		} catch {
			return false;
		}
	}
	return true;
}
