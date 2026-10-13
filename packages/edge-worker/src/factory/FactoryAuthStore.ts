import { randomBytes } from "node:crypto";
import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const credential = z.object({
	id: z.string().min(1),
	origin: z.string(),
	publicKey: z.string().min(1),
	counter: z.number().int().nonnegative(),
	transports: z.array(z.string().max(30)).optional(),
	deviceType: z.enum(["singleDevice", "multiDevice"]),
	backedUp: z.boolean(),
	label: z.string().min(1).max(80),
	createdAt: z.number(),
	lastUsedAt: z.number(),
});
const legacySchema = z
	.object({
		version: z.literal(1),
		origins: z.array(z.string()),
		user: z.string().min(1),
		credentials: z.array(credential),
		sessions: z.array(
			z.object({
				hash: z.string(),
				credential: z.string(),
				origin: z.string(),
				expires: z.number(),
				verifiedAt: z.number(),
			}),
		),
	})
	.superRefine((state, ctx) => {
		if (
			new Set(state.credentials.map((c) => c.id)).size !==
			state.credentials.length
		)
			ctx.addIssue({ code: "custom", message: "Duplicate credential IDs" });
		if (
			state.credentials.some((c) => !state.origins.includes(c.origin)) ||
			state.sessions.some(
				(s) =>
					!state.credentials.some(
						(c) => c.id === s.credential && c.origin === s.origin,
					),
			)
		)
			ctx.addIssue({
				code: "custom",
				message: "Invalid authentication identity",
			});
	});
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const schema = z
	.object({
		version: z.literal(2),
		origins: z.array(z.string()),
		keys: z.array(
			z.object({
				id: z.string().min(1).max(100),
				label: z.string().min(1).max(80),
				digest,
				createdAt: z.number().finite(),
				rotatedAt: z.number().finite().optional(),
				lastUsedAt: z.number().finite().optional(),
			}),
		),
		sessions: z.array(
			z.object({
				hash: digest,
				credential: z.string().min(1),
				origin: z.string(),
				expires: z.number().finite(),
				verifiedAt: z.number().finite(),
			}),
		),
	})
	.strict()
	.superRefine((state, ctx) => {
		if (
			new Set(state.keys.map((k) => k.id)).size !== state.keys.length ||
			new Set(state.keys.map((k) => k.digest)).size !== state.keys.length ||
			new Set(state.sessions.map((s) => s.hash)).size !==
				state.sessions.length ||
			state.sessions.some(
				(s) =>
					!state.keys.some((k) => k.id === s.credential) ||
					!state.origins.includes(s.origin),
			)
		)
			ctx.addIssue({
				code: "custom",
				message: "Invalid authentication identity",
			});
	});
export type AuthState = z.infer<typeof schema>;
export type AuthKey = AuthState["keys"][number];
export function privateFile(path: string): string {
	const stat = lstatSync(path);
	if (
		!stat.isFile() ||
		stat.isSymbolicLink() ||
		(process.getuid && stat.uid !== process.getuid())
	)
		throw new Error("Authentication file must be owned by this operator");
	chmodSync(path, 0o600);
	return readFileSync(path, "utf8");
}
export function atomicPrivateFile(path: string, text: string) {
	const temporary = `${path}.${randomBytes(12).toString("hex")}.tmp`;
	try {
		writeFileSync(temporary, text, { mode: 0o600, flag: "wx" });
		renameSync(temporary, path);
	} finally {
		if (existsSync(temporary)) unlinkSync(temporary);
	}
}
export class FactoryAuthStore {
	readonly directory: string;
	readonly path: string;
	state: AuthState;
	constructor(factoryDirectory: string, origins: string[]) {
		this.directory = join(factoryDirectory, "auth");
		mkdirSync(this.directory, { recursive: true, mode: 0o700 });
		const stat = lstatSync(this.directory);
		if (
			!stat.isDirectory() ||
			stat.isSymbolicLink() ||
			(process.getuid && stat.uid !== process.getuid())
		)
			throw new Error(
				"Authentication directory must be owned by this operator",
			);
		chmodSync(this.directory, 0o700);
		this.path = join(this.directory, "state.json");
		if (lstatSync(this.path, { throwIfNoEntry: false })) {
			try {
				const stored = JSON.parse(privateFile(this.path));
				const legacy =
					stored.version === 1 ? legacySchema.parse(stored) : undefined;
				this.state = legacy
					? { version: 2, origins: legacy.origins, keys: [], sessions: [] }
					: schema.parse(stored);
				if (JSON.stringify(this.state.origins) !== JSON.stringify(origins))
					throw new Error(
						"Factory authentication origins changed. Restore the original configuration or deliberately recover authentication locally.",
					);
				if (legacy) atomicPrivateFile(this.path, JSON.stringify(this.state));
			} catch (error) {
				if (error instanceof Error && error.message.includes("origins changed"))
					throw error;
				throw new Error(
					"Factory authentication state is corrupt. Use the local factory-auth recovery command; remote access remains locked.",
				);
			}
		} else {
			this.state = {
				version: 2,
				origins,
				keys: [],
				sessions: [],
			};
			this.update(() => {});
		}
	}
	// Synchronous copy/write/replace serializes mutations and never reports a write that failed.
	update(change: (state: AuthState) => void) {
		const next = structuredClone(this.state);
		change(next);
		next.sessions = next.sessions.filter((s) => s.expires > Date.now());
		schema.parse(next);
		atomicPrivateFile(this.path, JSON.stringify(next));
		this.state = next;
	}
}
