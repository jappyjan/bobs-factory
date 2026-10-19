import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { FactoryAuthStore, privateFile } from "./FactoryAuthStore.js";
import { factoryRequestOrigins, loopbackHost } from "./LocalFactoryAccess.js";

const secret = () => randomBytes(32).toString("base64url");
const hash = (value: string) =>
	createHash("sha256").update(value).digest("hex");
const terminalRequest = /^terminal-[a-f0-9]{32}\.json$/;
const terminalRequestSchema = z.object({
	hash: z.string().regex(/^[a-f0-9]{64}$/),
	expires: z.number(),
});
const maxTerminalSessions = 50;
export interface FactoryAccess {
	origins: string[];
	sessionHours?: number;
}
export function factoryAccess(
	port: number,
	remoteOrigin?: string,
	sessionHours = 12,
): FactoryAccess {
	const origins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
	if (remoteOrigin) {
		const url = new URL(remoteOrigin);
		if (
			url.protocol !== "https:" ||
			url.origin !== remoteOrigin ||
			url.username ||
			url.password ||
			url.hostname.includes("*") ||
			url.hostname === "localhost"
		)
			throw new Error("Factory public origin must be an exact HTTPS origin");
		origins.push(remoteOrigin);
	}
	return { origins, sessionHours };
}
export class FactoryAuth {
	readonly store: FactoryAuthStore;
	private listeners = new Set<() => void>();
	private attempts = 0;
	private window = Date.now();
	private recoveryTimer: ReturnType<typeof setInterval>;
	/** Terminal sessions are memory-only: a restart revokes them and the TUI re-requests one locally. */
	private terminal = new Map<string, { origin: string; expires: number }>();
	readonly sessionMs: number;
	constructor(
		directory: string,
		readonly access: FactoryAccess,
	) {
		const hours = access.sessionHours ?? 12;
		if (!Number.isFinite(hours) || hours < 1 || hours > 24)
			throw new Error(
				"Factory session lifetime must be between 1 and 24 hours",
			);
		for (const origin of access.origins) {
			const url = new URL(origin);
			if (
				url.origin !== origin ||
				url.username ||
				url.password ||
				url.hostname.includes("*") ||
				!(
					url.protocol === "https:" ||
					(url.protocol === "http:" && loopbackHost(url.hostname))
				)
			)
				throw new Error("Invalid Factory authentication origin");
		}
		if (
			!access.origins.length ||
			new Set(access.origins).size !== access.origins.length
		)
			throw new Error("Invalid Factory authentication origins");
		this.sessionMs = hours * 3600000;
		this.store = new FactoryAuthStore(directory, access.origins);
		// Retire all legacy enrollment grants; keys can only be created in Settings.
		const grant = join(this.store.directory, "enroll.json");
		if (existsSync(grant)) unlinkSync(grant);
		this.recoveryTimer = setInterval(() => {
			this.checkRecovery();
			this.checkTerminalRequests();
		}, 1000);
		this.recoveryTimer.unref();
	}
	checkRecovery() {
		const path = join(this.store.directory, "recover");
		if (!existsSync(path)) return;
		if (privateFile(path).trim() !== "RESET FACTORY AUTHENTICATION") return;
		this.store.update((state) => {
			state.keys = [];
			state.sessions = [];
		});
		unlinkSync(path);
		this.terminal.clear();
		this.changed();
	}
	/**
	 * Accept terminal-session requests written by the local operator (see
	 * requestFactoryTerminalSession). Like recovery, authority
	 * comes from the private auth directory. Sessions bind to the localhost origin only.
	 */
	checkTerminalRequests() {
		const origin = this.access.origins.find(
			(item) => new URL(item).hostname === "localhost",
		);
		let names: string[];
		try {
			names = readdirSync(this.store.directory).filter((name) =>
				terminalRequest.test(name),
			);
		} catch {
			return;
		}
		for (const name of names) {
			const path = join(this.store.directory, name);
			try {
				const request = terminalRequestSchema.parse(
					JSON.parse(privateFile(path)),
				);
				const now = Date.now();
				if (origin && request.expires > now && request.expires <= now + 60000)
					this.terminal.set(request.hash, {
						origin,
						expires: now + this.sessionMs,
					});
			} catch {
				/* Malformed or foreign requests are discarded without granting access. */
			} finally {
				try {
					unlinkSync(path);
				} catch {
					// An invalid directory or a request already removed by the operator grants nothing.
				}
			}
		}
		const now = Date.now();
		for (const [key, session] of this.terminal)
			if (session.expires <= now) this.terminal.delete(key);
		for (const key of [...this.terminal.keys()].slice(
			0,
			Math.max(0, this.terminal.size - maxTerminalSessions),
		))
			this.terminal.delete(key);
	}
	subscribe(listener: () => void) {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	private changed() {
		for (const listener of this.listeners) listener();
	}
	close() {
		clearInterval(this.recoveryTimer);
		this.terminal.clear();
		this.listeners.clear();
	}
	session(token: string | undefined, origin: string) {
		if (!token || token.length > 100) return undefined;
		const tokenHash = hash(token);
		const stored = this.store.state.sessions.find(
			(s) =>
				s.hash === tokenHash &&
				s.origin === origin &&
				(s.expires === null || s.expires > Date.now()),
		);
		if (stored && this.store.state.keys.some((k) => k.id === stored.credential))
			return stored;
		const terminal = this.terminal.get(tokenHash);
		if (
			!terminal ||
			terminal.origin !== origin ||
			terminal.expires <= Date.now()
		)
			return undefined;
		// Terminal sessions are confined to the local terminal, not key management.
		return {
			hash: tokenHash,
			credential: "terminal",
			origin,
			expires: terminal.expires,
			verifiedAt: 0,
		};
	}
	private authorize(token: string | undefined, origin: string, local: boolean) {
		if (!factoryRequestOrigins(this.access.origins).includes(origin))
			throw new Error("Invalid Factory origin");
		const session = this.session(token, origin);
		if (!local && (!session || session.credential === "terminal"))
			throw new Error("Sign in to manage API keys");
	}
	private limit() {
		const now = Date.now();
		if (now - this.window >= 60000) {
			this.window = now;
			this.attempts = 0;
		}
		if (++this.attempts > 60)
			throw new Error("Too many sign-in attempts. Try again in a minute.");
	}
	login(key: string, origin: string, previous?: string, staySignedIn = false) {
		this.limit();
		if (
			!this.access.origins.includes(origin) ||
			!origin.startsWith("https:") ||
			!/^[A-Za-z0-9_-]{43}$/.test(key)
		)
			throw new Error("Invalid API key");
		const digest = Buffer.from(hash(key), "hex");
		const found = this.store.state.keys.find((k) =>
			timingSafeEqual(Buffer.from(k.digest, "hex"), digest),
		);
		if (!found) throw new Error("Invalid API key");
		const token = secret(),
			now = Date.now(),
			expires = staySignedIn ? null : now + this.sessionMs;
		const old = this.session(previous, origin);
		this.store.update((state) => {
			state.keys.find((k) => k.id === found.id)!.lastUsedAt = now;
			state.sessions = state.sessions
				.filter((s) => s.hash !== old?.hash)
				.slice(-199);
			state.sessions.push({
				hash: hash(token),
				credential: found.id,
				origin,
				verifiedAt: now,
				expires,
			});
		});
		this.changed();
		return { token, expires };
	}
	keys(token: string | undefined, origin: string, local = false) {
		this.authorize(token, origin, local);
		const current = this.session(token, origin)?.credential;
		return this.store.state.keys.map(({ digest: _digest, ...key }) => ({
			...key,
			current: !local && key.id === current,
		}));
	}
	create(
		token: string | undefined,
		origin: string,
		label: string,
		local = false,
	) {
		this.authorize(token, origin, local);
		const name = label.trim();
		if (!name || name.length > 80)
			throw new Error("API key name must contain 1–80 characters");
		if (this.store.state.keys.length >= 100)
			throw new Error("Remove an API key before adding more (limit 100)");
		const key = secret(),
			id = secret();
		this.store.update((state) =>
			state.keys.push({
				id,
				label: name,
				digest: hash(key),
				createdAt: Date.now(),
			}),
		);
		this.changed();
		return { id, key };
	}
	rotate(token: string | undefined, origin: string, id: string, local = false) {
		this.authorize(token, origin, local);
		const sessionRevoked =
			!local && this.session(token, origin)?.credential === id;
		const key = secret();
		this.store.update((state) => {
			const record = state.keys.find((k) => k.id === id);
			if (!record) throw new Error("Unknown API key");
			record.digest = hash(key);
			record.rotatedAt = Date.now();
			state.sessions = state.sessions.filter((s) => s.credential !== id);
		});
		this.changed();
		return { id, key, sessionRevoked };
	}
	logout(token: string | undefined, origin: string) {
		const session = this.session(token, origin);
		if (session?.credential === "terminal") this.terminal.delete(session.hash);
		else if (session)
			this.store.update((state) => {
				state.sessions = state.sessions.filter((s) => s.hash !== session.hash);
			});
		this.changed();
	}
	remove(token: string | undefined, origin: string, id: string, local = false) {
		this.authorize(token, origin, local);
		const sessionRevoked =
			!local && this.session(token, origin)?.credential === id;
		this.store.update((state) => {
			if (!state.keys.some((k) => k.id === id))
				throw new Error("Unknown API key");
			state.keys = state.keys.filter((k) => k.id !== id);
			state.sessions = state.sessions.filter((s) => s.credential !== id);
		});
		this.changed();
		return { removed: true, sessionRevoked };
	}
}
