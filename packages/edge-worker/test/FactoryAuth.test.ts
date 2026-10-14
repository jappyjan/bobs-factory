import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { FactoryAuth } from "../src/factory/FactoryAuth.js";
import {
	requestFactoryAuthRecovery,
	requestFactoryTerminalSession,
} from "../src/factory/FactoryAuthOperator.js";
import { FactoryAuthStore } from "../src/factory/FactoryAuthStore.js";

const origin = "https://factory.example.test";
const homes: string[] = [],
	services: FactoryAuth[] = [];
function fixture() {
	const home = mkdtempSync(join(tmpdir(), "factory-auth-test-"));
	homes.push(home);
	const auth = new FactoryAuth(home, { origins: [origin] });
	services.push(auth);
	return {
		home,
		auth,
		create: () => auth.create(undefined, origin, "My laptop", true),
	};
}
afterEach(() => {
	vi.useRealTimers();
	for (const auth of services.splice(0)) auth.close();
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});
it("requires a session for remote management even with an empty store", () => {
	const f = fixture();
	expect(() => f.auth.create(undefined, origin, "Remote")).toThrow("Sign in");
	expect(() => f.auth.keys(undefined, origin)).toThrow("Sign in");
	expect(() => f.auth.login("wrong", origin)).toThrow("Invalid API key");
	expect(() =>
		f.auth.create(undefined, "https://evil.test", "Remote", true),
	).toThrow("origin");
});
it("persists only digests, keeps private permissions and origin-bound sessions across restart", () => {
	const f = fixture(),
		key = f.create(),
		login = f.auth.login(key.key, origin);
	expect(key.key).toMatch(/^[A-Za-z0-9_-]{43}$/);
	expect(f.auth.session(login.token, origin)).toBeDefined();
	expect(f.auth.session(key.key, origin)).toBeUndefined();
	expect(f.auth.session(login.token, "https://evil.test")).toBeUndefined();
	const disk = readFileSync(f.auth.store.path, "utf8");
	expect(disk).not.toContain(key.key);
	expect(disk).not.toContain(login.token);
	expect(f.auth.keys(login.token, origin)).toEqual([
		{
			id: key.id,
			label: "My laptop",
			createdAt: expect.any(Number),
			lastUsedAt: expect.any(Number),
			current: true,
		},
	]);
	expect(statSync(f.auth.store.path).mode & 0o777).toBe(0o600);
	expect(statSync(f.auth.store.directory).mode & 0o777).toBe(0o700);
	f.auth.close();
	const restored = new FactoryAuth(f.home, { origins: [origin] });
	services.push(restored);
	expect(restored.session(login.token, origin)).toBeDefined();
	const replacement = restored.login(key.key, origin, login.token);
	expect(restored.session(login.token, origin)).toBeUndefined();
	restored.logout(replacement.token, origin);
	expect(restored.session(replacement.token, origin)).toBeUndefined();
});
it("rotation and removal revoke every issuing-key session, preserve other keys and allow last-key removal", () => {
	const f = fixture(),
		first = f.create(),
		second = f.create();
	const a = f.auth.login(first.key, origin),
		b = f.auth.login(first.key, origin),
		other = f.auth.login(second.key, origin);
	const changed = vi.fn();
	f.auth.subscribe(changed);
	const rotated = f.auth.rotate(a.token, origin, first.id);
	expect(rotated.sessionRevoked).toBe(true);
	expect(changed).toHaveBeenCalledTimes(1);
	expect(f.auth.session(a.token, origin)).toBeUndefined();
	expect(f.auth.session(b.token, origin)).toBeUndefined();
	expect(f.auth.session(other.token, origin)).toBeDefined();
	expect(() => f.auth.login(first.key, origin)).toThrow("Invalid API key");
	const next = f.auth.login(rotated.key, origin);
	expect(f.auth.remove(other.token, origin, first.id).sessionRevoked).toBe(
		false,
	);
	expect(f.auth.session(next.token, origin)).toBeUndefined();
	expect(f.auth.remove(other.token, origin, second.id).sessionRevoked).toBe(
		true,
	);
	expect(f.auth.keys(undefined, origin, true)).toEqual([]);
	expect(() => f.auth.login(second.key, origin)).toThrow("Invalid API key");
	expect(f.create().key).toHaveLength(43);
});
it("expires sessions, bounds their growth and throttles globally", () => {
	const f = fixture(),
		key = f.create();
	for (let i = 0; i < 60; i++) f.auth.login(key.key, origin);
	expect(() => f.auth.login(key.key, origin)).toThrow("Too many");
	vi.useFakeTimers();
	vi.setSystemTime(Date.now() + 60001);
	const login = f.auth.login(key.key, origin);
	for (let w = 0; w < 4; w++) {
		vi.setSystemTime(Date.now() + 60001);
		for (let i = 0; i < 60; i++) f.auth.login(key.key, origin);
	}
	expect(f.auth.store.state.sessions).toHaveLength(200);
	vi.setSystemTime(Date.now() + 12 * 3600000);
	expect(f.auth.session(login.token, origin)).toBeUndefined();
	expect(() => f.auth.keys(login.token, origin)).toThrow("Sign in");
});
it("validates legacy state before atomic migration, revokes passkeys/sessions and retires grants", () => {
	const f = fixture();
	f.auth.close();
	const legacy = {
		version: 1,
		origins: [origin],
		user: "legacy",
		credentials: [
			{
				id: "old",
				origin,
				publicKey: "public",
				counter: 0,
				deviceType: "multiDevice",
				backedUp: true,
				label: "Old",
				createdAt: 1,
				lastUsedAt: 1,
			},
		],
		sessions: [
			{
				hash: "old-session",
				credential: "old",
				origin,
				expires: Date.now() + 3600000,
				verifiedAt: 1,
			},
		],
	};
	writeFileSync(f.auth.store.path, JSON.stringify(legacy));
	writeFileSync(join(f.auth.store.directory, "enroll.json"), "old grant");
	const migrated = new FactoryAuth(f.home, { origins: [origin] });
	services.push(migrated);
	expect(migrated.store.state).toEqual({
		version: 2,
		origins: [origin],
		keys: [],
		sessions: [],
	});
	expect(existsSync(join(f.auth.store.directory, "enroll.json"))).toBe(false);
	expect(new FactoryAuthStore(f.home, [origin]).state).toEqual(
		migrated.store.state,
	);
	writeFileSync(
		f.auth.store.path,
		JSON.stringify({
			...legacy,
			sessions: [{ ...legacy.sessions[0], credential: "unknown" }],
		}),
	);
	expect(() => new FactoryAuthStore(f.home, [origin])).toThrow("corrupt");
});
it("fails closed on corruption, unsupported versions and origin changes; failed writes publish no revocation", () => {
	const f = fixture(),
		key = f.create(),
		login = f.auth.login(key.key, origin);
	chmodSync(f.auth.store.path, 0o644);
	new FactoryAuthStore(f.home, [origin]);
	expect(statSync(f.auth.store.path).mode & 0o777).toBe(0o600);
	expect(() => new FactoryAuthStore(f.home, ["https://other.test"])).toThrow(
		"origins changed",
	);
	const original = structuredClone(f.auth.store.state),
		changed = vi.fn();
	f.auth.subscribe(changed);
	const path = f.auth.store.path;
	// A directory at the target prevents atomic replacement, regardless of root privileges.
	rmSync(path);
	mkdirSync(path);
	expect(() => f.auth.rotate(login.token, origin, key.id)).toThrow();
	expect(f.auth.store.state).toEqual(original);
	expect(changed).not.toHaveBeenCalled();
	expect(f.auth.session(login.token, origin)).toBeDefined();
	rmSync(path, { recursive: true });
	writeFileSync(path, "corrupt");
	expect(() => new FactoryAuthStore(f.home, [origin])).toThrow("corrupt");
	writeFileSync(path, JSON.stringify({ ...original, version: 99 }));
	expect(() => new FactoryAuthStore(f.home, [origin])).toThrow("corrupt");
});
it("recovers corrupt authentication locally without modifying run/native files", () => {
	const f = fixture(),
		home = join(f.home, "operator-home"),
		factory = join(home, "factory");
	mkdirSync(join(factory, "auth"), { recursive: true });
	writeFileSync(join(factory, "runs.json"), "preserved runs");
	writeFileSync(join(home, "native-credentials"), "preserved credentials");
	writeFileSync(join(factory, "auth", "state.json"), "corrupt");
	expect(() => requestFactoryAuthRecovery(home, undefined)).toThrow(
		"Recovery revokes",
	);
	requestFactoryAuthRecovery(home, "RESET FACTORY AUTHENTICATION");
	const restarted = new FactoryAuth(factory, { origins: [origin] });
	services.push(restarted);
	restarted.checkRecovery();
	expect(restarted.store.state.keys).toEqual([]);
	expect(restarted.store.state.sessions).toEqual([]);
	expect(readFileSync(join(factory, "runs.json"), "utf8")).toBe(
		"preserved runs",
	);
	expect(readFileSync(join(home, "native-credentials"), "utf8")).toBe(
		"preserved credentials",
	);
});
it("grants localhost-only terminal sessions from local operator requests that cannot manage keys", () => {
	const home = mkdtempSync(join(tmpdir(), "factory-terminal-test-"));
	homes.push(home);
	const factory = join(home, "factory"),
		local = "http://localhost:3457";
	mkdirSync(factory);
	const auth = new FactoryAuth(factory, { origins: [local, origin] });
	services.push(auth);
	const token = requestFactoryTerminalSession(home);
	const requests = () =>
		readdirSync(auth.store.directory).filter((name) =>
			name.startsWith("terminal-"),
		);
	expect(requests()).toHaveLength(1);
	// Only the token hash reaches disk.
	expect(
		readFileSync(join(auth.store.directory, requests()[0]!), "utf8"),
	).not.toContain(token);
	expect(auth.session(token, local)).toBeUndefined();
	auth.checkTerminalRequests();
	expect(requests()).toHaveLength(0);
	expect(auth.session(token, local)).toMatchObject({ credential: "terminal" });
	expect(auth.session(token, origin)).toBeUndefined();
	expect(() => auth.keys(token, local)).toThrow("Sign in");
	// Terminal sessions are memory-only and never persisted with key sessions.
	expect(auth.store.state.sessions).toHaveLength(0);
	auth.logout(token, local);
	expect(auth.session(token, local)).toBeUndefined();

	const expired = join(auth.store.directory, `terminal-${"a".repeat(32)}.json`);
	writeFileSync(
		expired,
		JSON.stringify({ hash: "b".repeat(64), expires: Date.now() - 1 }),
		{ mode: 0o600 },
	);
	auth.checkTerminalRequests();
	expect(existsSync(expired)).toBe(false);
	expect(auth.session("x".repeat(43), local)).toBeUndefined();

	const revoked = requestFactoryTerminalSession(home);
	auth.checkTerminalRequests();
	expect(auth.session(revoked, local)).toBeDefined();
	writeFileSync(
		join(auth.store.directory, "recover"),
		"RESET FACTORY AUTHENTICATION",
	);
	auth.checkRecovery();
	expect(auth.session(revoked, local)).toBeUndefined();
	// Malformed request paths cannot crash the server, and a restart revokes terminal access.
	mkdirSync(join(auth.store.directory, `terminal-${"c".repeat(32)}.json`));
	expect(() => auth.checkTerminalRequests()).not.toThrow();
	const beforeRestart = requestFactoryTerminalSession(home);
	auth.checkTerminalRequests();
	expect(auth.session(beforeRestart, local)).toBeDefined();
	auth.close();
	const restarted = new FactoryAuth(factory, { origins: [local, origin] });
	services.push(restarted);
	expect(restarted.session(beforeRestart, local)).toBeUndefined();
});
it("ignores terminal requests without a localhost origin", () => {
	const home = mkdtempSync(join(tmpdir(), "factory-terminal-test-"));
	homes.push(home);
	const factory = join(home, "factory");
	mkdirSync(factory);
	const auth = new FactoryAuth(factory, { origins: [origin] });
	services.push(auth);
	const token = requestFactoryTerminalSession(home);
	auth.checkTerminalRequests();
	expect(auth.session(token, origin)).toBeUndefined();
});

it("rejects dangling authentication-file symlinks instead of silently creating an empty store", () => {
	const f = fixture();
	f.auth.close();
	rmSync(f.auth.store.path);
	const target = join(f.home, "missing-state.json");
	symlinkSync(target, f.auth.store.path);
	expect(() => new FactoryAuthStore(f.home, [origin])).toThrow("corrupt");
	expect(existsSync(target)).toBe(false);
});
