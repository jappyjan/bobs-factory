import {
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import {
	accessGeneration,
	accessRequired,
	accessSignal,
	checkAccess,
	onAccessLost,
	rotateSession,
	useAccess,
} from "./auth-state";
import { uiBuild, usePwa, versionMismatch } from "./pwa";
import { ConnectionNotice } from "./pwa-ui";
import { Bob, Button } from "./ui";

async function authRequest(path: string, body: unknown = {}, method = "POST") {
	const epoch = accessGeneration();
	const response = await fetch(`/api/auth/${path}`, {
		signal: accessSignal(),
		method,
		cache: "no-store",
		headers: {
			"Content-Type": "application/json",
			"X-Factory-Request": "1",
			"X-Factory-Build": uiBuild,
		},
		...(method !== "GET" ? { body: JSON.stringify(body) } : {}),
	});
	if (epoch !== accessGeneration()) throw new Error("Session changed");
	if (response.status === 401)
		accessRequired("Your session expired. Sign in again.");
	const result = await response.json();
	if (epoch !== accessGeneration()) throw new Error("Session changed");
	if (result.code === "FACTORY_VERSION_MISMATCH") versionMismatch();
	if (!response.ok) throw new Error(result.error ?? "API key request failed");
	return result;
}
// Only the mounted access boundary holds the one-time secret. Never persist it.
// Notify after clearing revoked access so self-rotation cannot retain private views.
const reveals = new Set<(key: string, signedOut: boolean) => void>();
async function keyAction(
	action: () => Promise<{ key?: string; sessionRevoked?: boolean }>,
) {
	await rotateSession(async () => {
		const result = await action();
		if (result.sessionRevoked)
			accessRequired("Your API key changed. Sign in again.", true);
		if (result.key)
			for (const reveal of reveals)
				reveal(result.key, Boolean(result.sessionRevoked));
	});
}

function KeyReveal({
	secret,
	signedOut,
	dismiss,
}: {
	secret: string;
	signedOut: boolean;
	dismiss: () => void;
}) {
	const [error, setError] = useState<string>();
	return (
		<main className="auth-screen">
			<section className="auth-card">
				<h1>Save your API key</h1>
				<p>
					This key is shown once. Save it somewhere private before continuing.
				</p>
				{signedOut && (
					<p>
						Your previous key and its sessions were revoked. Use this
						replacement key to sign in again.
					</p>
				)}
				<label>
					New API key
					<input
						aria-label="New API key"
						readOnly
						value={secret}
						autoComplete="off"
						onFocus={(e) => e.currentTarget.select()}
					/>
				</label>
				{error && <p role="alert">{error}</p>}
				<div className="settings-actions">
					<Button
						onClick={() => {
							void (async () => {
								try {
									if (!navigator.clipboard)
										throw new Error("Clipboard unavailable");
									await navigator.clipboard.writeText(secret);
									setError(undefined);
								} catch {
									setError(
										"Copy failed. Select the key above and copy it manually.",
									);
								}
							})();
						}}
					>
						Copy key
					</Button>
					<Button variant="secondary" onClick={dismiss}>
						I saved the key
					</Button>
				</div>
			</section>
		</main>
	);
}

export function AccessBoundary({ children }: { children: ReactNode }) {
	const access = useAccess(),
		pwa = usePwa();
	const [key, setKey] = useState("");
	const [reveal, setReveal] = useState<{ key: string; signedOut: boolean }>();
	const revealing = useRef(false);
	const [busy, setBusy] = useState(false),
		[error, setError] = useState<string>();
	const updateRequired =
		pwa.status === "mismatch" || pwa.status === "offline" || pwa.updating;
	useEffect(() => {
		const show = (key: string, signedOut: boolean) => {
			revealing.current = true;
			setReveal({ key, signedOut });
		};
		reveals.add(show);
		const clear = () => {
			revealing.current = false;
			setKey("");
			setReveal(undefined);
		};
		const unsubscribe = onAccessLost(clear);
		window.addEventListener("hashchange", clear);
		return () => {
			reveals.delete(show);
			unsubscribe();
			window.removeEventListener("hashchange", clear);
		};
	}, []);
	useEffect(() => {
		if (location.protocol === "http:" && location.hostname === "127.0.0.1") {
			const canonical = new URL(location.href);
			canonical.hostname = "localhost";
			location.replace(canonical.href);
			return;
		}
		void checkAccess();
		const visible = () => {
			if (document.visibilityState === "visible" && !revealing.current)
				void checkAccess();
		};
		const page = () => {
			if (!revealing.current) void checkAccess();
		};
		const offline = () =>
			accessRequired("Factory is offline. Reconnect to sign in.");
		window.addEventListener("pageshow", page);
		document.addEventListener("visibilitychange", visible);
		window.addEventListener("online", page);
		window.addEventListener("offline", offline);
		return () => {
			window.removeEventListener("pageshow", page);
			document.removeEventListener("visibilitychange", visible);
			window.removeEventListener("online", page);
			window.removeEventListener("offline", offline);
		};
	}, []);
	useEffect(() => {
		if (access.status === "authenticated") {
			setKey("");
			setError(undefined);
		}
	}, [access.status]);
	if (reveal)
		return (
			<KeyReveal
				secret={reveal.key}
				signedOut={reveal.signedOut}
				dismiss={() => {
					revealing.current = false;
					setReveal(undefined);
					void checkAccess();
				}}
			/>
		);
	if (access.status === "authenticated") return <>{children}</>;
	const submit = async () => {
		setBusy(true);
		setError(undefined);
		try {
			await rotateSession(async () => {
				await authRequest("login", { key });
				await checkAccess();
			});
		} catch (error) {
			setError(
				error instanceof Error ? error.message : "Sign-in failed. Try again.",
			);
		} finally {
			setKey("");
			setBusy(false);
		}
	};
	return (
		<main className="auth-screen">
			<section className="auth-card">
				<Bob mood="busy" size={90} />
				<h1>
					{access.status === "checking"
						? "Checking Factory access…"
						: access.setupRequired
							? "Set up remote access locally"
							: "Sign in to Bob’s Factory"}
				</h1>
				<ConnectionNotice hasData={false} signedOut />
				{access.status !== "checking" && (
					<>
						<p>{access.error}</p>
						{access.setupRequired ? (
							<p>
								Open Bob’s Factory on localhost and create an API key in
								Settings → Access. Then return here to sign in.
							</p>
						) : (
							<form
								onSubmit={(event) => {
									event.preventDefault();
									void submit();
								}}
							>
								<p>Enter your API key to start a browser session.</p>
								<label>
									API key
									<input
										type="password"
										autoComplete="off"
										maxLength={100}
										value={key}
										onChange={(e) => setKey(e.target.value.trim())}
										required
									/>
								</label>
								<Button type="submit" disabled={busy || updateRequired || !key}>
									{busy ? "Signing in…" : "Sign in"}
								</Button>
							</form>
						)}
						{error && <p role="alert">{error}</p>}
					</>
				)}
			</section>
		</main>
	);
}

type ApiKey = {
	id: string;
	label: string;
	createdAt: number;
	rotatedAt?: number;
	lastUsedAt?: number;
	current: boolean;
};
export function AccessSettings() {
	const access = useAccess();
	const [keys, setKeys] = useState<ApiKey[]>(),
		[error, setError] = useState<string>(),
		[busy, setBusy] = useState(false),
		[adding, setAdding] = useState(false),
		[label, setLabel] = useState("");
	const run = useCallback(async (action: () => Promise<void>) => {
		setBusy(true);
		setError(undefined);
		try {
			await action();
		} catch (e) {
			setError(e instanceof Error ? e.message : "API key action failed");
		} finally {
			setBusy(false);
		}
	}, []);
	const load = useCallback(
		async () => setKeys(await authRequest("keys", undefined, "GET")),
		[],
	);
	useEffect(() => {
		void run(load);
	}, [run, load]);
	return (
		<div className="access-settings">
			<h2>Access</h2>
			<p className="intro">
				{access.access === "local"
					? "Local Factory opens without sign-in."
					: "Manage access to your Factory."}
			</p>
			<section className="settings-card" aria-labelledby="keys-heading">
				<div className="settings-heading">
					<div>
						<h2 id="keys-heading">API keys</h2>
						<p>
							Keys sign into the remote dashboard. Every signed-in user can
							manage keys. Keys do not authorize direct API requests.
						</p>
					</div>
					<Button
						variant="secondary"
						disabled={busy}
						onClick={() => {
							setAdding(!adding);
							setLabel("");
							setError(undefined);
						}}
						aria-expanded={adding}
					>
						Add API key
					</Button>
				</div>
				{error && (
					<p className="settings-error" role="alert">
						{error}
					</p>
				)}
				{!keys && (
					<Button
						variant="secondary"
						disabled={busy}
						onClick={() => void run(load)}
					>
						{busy ? "Loading keys…" : "Retry"}
					</Button>
				)}
				{adding && (
					<form
						className="api-key-add"
						onSubmit={(event) => {
							event.preventDefault();
							void run(async () => {
								await keyAction(() => authRequest("keys", { label }));
							});
						}}
					>
						<label>
							Key name
							<input
								maxLength={80}
								required
								value={label}
								onChange={(e) => setLabel(e.target.value)}
								placeholder="My laptop"
							/>
						</label>
						<div className="settings-actions">
							<Button type="submit" disabled={busy || !label.trim()}>
								Create key
							</Button>
							<Button
								variant="secondary"
								disabled={busy}
								onClick={() => {
									setAdding(false);
									setLabel("");
								}}
							>
								Cancel
							</Button>
						</div>
					</form>
				)}
				<ul className="api-key-list">
					{keys?.map((key) => (
						<li key={key.id}>
							<div>
								<strong>
									{key.label}
									{key.current ? " (this session)" : ""}
								</strong>
								<span>
									Added {new Date(key.createdAt).toLocaleDateString()}
								</span>
								{key.rotatedAt && (
									<span>
										Rotated {new Date(key.rotatedAt).toLocaleDateString()}
									</span>
								)}
								<span>
									{key.lastUsedAt
										? `Last used ${new Date(key.lastUsedAt).toLocaleString()}`
										: "Never used"}
								</span>
							</div>
							<div className="settings-actions">
								<Button
									variant="secondary"
									disabled={busy}
									aria-label={`Rotate ${key.label}`}
									onClick={() => {
										if (
											!window.confirm(
												`Rotate ${key.label}? Its old key and all its sessions will stop working.${key.current ? " You will be signed out after saving the replacement key." : ""}`,
											)
										)
											return;
										void run(async () => {
											await keyAction(() =>
												authRequest(
													`keys/${encodeURIComponent(key.id)}/rotate`,
												),
											);
										});
									}}
								>
									Rotate
								</Button>
								<Button
									variant="secondary"
									disabled={busy}
									aria-label={`Remove ${key.label}`}
									onClick={() => {
										if (
											!window.confirm(
												`Remove ${key.label} and revoke its sessions?${keys.length === 1 ? " This is the last key. Remote sign-in will be unavailable until a new key is created in localhost Settings." : ""}${key.current ? " You will be signed out." : ""}`,
											)
										)
											return;
										void run(async () => {
											await keyAction(() =>
												authRequest(
													`keys/${encodeURIComponent(key.id)}`,
													{},
													"DELETE",
												),
											);
											if (!key.current) await load();
										});
									}}
								>
									Remove
								</Button>
							</div>
						</li>
					))}
				</ul>
				{keys?.length === 0 && (
					<p>No API keys. Create one here to enable remote sign-in.</p>
				)}
				<p className="settings-hint">
					New and rotated keys are shown once. Localhost Settings can restore
					access even after the last key is removed.
				</p>
			</section>
			{access.access !== "local" && (
				<section className="settings-card" aria-labelledby="session-heading">
					<h2 id="session-heading">This session</h2>
					<p>
						Signing out discards unsent edits and review comments in every
						Factory tab.
					</p>
					<Button
						variant="secondary"
						disabled={busy}
						onClick={() => {
							if (
								!window.confirm(
									"Sign out? Unsent edits and review comments will be discarded in every Factory tab.",
								)
							)
								return;
							void run(async () => {
								await authRequest("logout");
								accessRequired("Signed out", true);
							});
						}}
					>
						Sign out
					</Button>
				</section>
			)}
		</div>
	);
}
