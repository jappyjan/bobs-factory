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
import { assertWritable, uiBuild, usePwa, versionMismatch } from "./pwa";
import { ConnectionNotice } from "./pwa-ui";
import { Bob, Button } from "./ui";

async function authRequest(path: string, body: unknown = {}, method = "POST") {
	if (
		(path.startsWith("keys") || path.startsWith("pairing")) &&
		method !== "GET"
	)
		assertWritable();
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
	if (result?.code === "FACTORY_VERSION_MISMATCH") versionMismatch();
	if (!response.ok) throw new Error(result?.error ?? "API key request failed");
	return result;
}
// Only the mounted access boundary holds the one-time secret. Never persist it.
// Notify after clearing revoked access so self-rotation cannot retain private views.
const reveals = new Set<(key: string, signedOut: boolean) => void>();
async function keyAction(
	action: () => Promise<{ key?: string; sessionRevoked?: boolean }>,
) {
	assertWritable();
	await rotateSession(async () => {
		const result = await action();
		if (result.sessionRevoked) {
			accessRequired("Your API key changed. Sign in again.", true);
			// Removal can empty the store. Refresh recovery guidance immediately.
			if (!result.key) await checkAccess();
		}
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

type PairingRequest = {
	id: string;
	confirmation: string;
	expires: number;
	createdAt: number;
	approved: boolean;
};

export function AccessBoundary({ children }: { children: ReactNode }) {
	const access = useAccess(),
		pwa = usePwa();
	const [key, setKey] = useState("");
	const [mode, setMode] = useState<"key" | "code">("key");
	const [pairingAvailable, setPairingAvailable] = useState(false);
	const [pending, setPending] = useState<PairingRequest>();
	const pendingRef = useRef<PairingRequest | undefined>(undefined);
	const claiming = useRef<string | undefined>(undefined);
	const claimInFlight = useRef(false);
	const [staySignedIn, setStaySignedIn] = useState(false);
	const updatePending = useCallback((request: PairingRequest | undefined) => {
		pendingRef.current = request;
		if (!request) claiming.current = undefined;
		setPending(request);
	}, []);
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
			updatePending(undefined);
		};
		const unsubscribe = onAccessLost(clear);
		window.addEventListener("hashchange", clear);
		return () => {
			reveals.delete(show);
			unsubscribe();
			window.removeEventListener("hashchange", clear);
		};
	}, [updatePending]);
	useEffect(() => {
		if (location.protocol === "http:" && location.hostname === "127.0.0.1") {
			const canonical = new URL(location.href);
			canonical.hostname = "localhost";
			location.replace(canonical.href);
			return;
		}
		void checkAccess();
		const visible = () => {
			if (
				document.visibilityState === "visible" &&
				!revealing.current &&
				!claimInFlight.current
			)
				void checkAccess();
		};
		const page = () => {
			if (!revealing.current && !claimInFlight.current) void checkAccess();
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
			setMode("key");
			updatePending(undefined);
			setError(undefined);
		}
	}, [access.status, updatePending]);
	useEffect(() => {
		if (access.status !== "required" || busy) return;
		let active = true;
		const refresh = async () => {
			try {
				const status = await authRequest("status", undefined, "GET");
				if (active) {
					setPairingAvailable(Boolean(status.pairingAvailable));
					if (status.pairingRequest) updatePending(status.pairingRequest);
					else if (pendingRef.current) {
						updatePending(undefined);
						setError(
							"Pairing expired, was rejected, or was cancelled. Enable a new code on your trusted device.",
						);
					}
				}
			} catch {
				if (active) setPairingAvailable(false);
			}
		};
		void refresh();
		const timer = setInterval(() => void refresh(), 3000);
		return () => {
			active = false;
			clearInterval(timer);
		};
	}, [access.status, busy, updatePending]);
	const claim = useCallback(
		async (request: PairingRequest) => {
			if (claiming.current === request.id) return;
			claiming.current = request.id;
			claimInFlight.current = true;
			setBusy(true);
			setError(undefined);
			try {
				await rotateSession(async () => {
					const result = await authRequest("pairing/claim", { id: request.id });
					await authRequest("login", { key: result.key, staySignedIn });
					updatePending(undefined);
					await checkAccess();
				});
			} catch (error) {
				setError(
					error instanceof Error ? error.message : "Pairing failed. Try again.",
				);
			} finally {
				claimInFlight.current = false;
				setBusy(false);
			}
		},
		[staySignedIn, updatePending],
	);
	useEffect(() => {
		if (
			pending?.approved &&
			!busy &&
			access.status === "required" &&
			pwa.status === "ready"
		)
			void claim(pending);
	}, [pending, busy, access.status, pwa.status, claim]);
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
	const submit = async (submittedKey: string, remember: boolean) => {
		setBusy(true);
		setError(undefined);
		setStaySignedIn(remember);
		try {
			if (mode === "code")
				updatePending(
					await authRequest("pairing/request", { code: submittedKey.trim() }),
				);
			else
				await rotateSession(async () => {
					await authRequest("login", {
						key: submittedKey.trim(),
						staySignedIn: remember,
					});
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
						: access.setupRequired && mode === "key" && !pending
							? "Set up remote access locally"
							: "Sign in to Bob’s Factory"}
				</h1>
				<ConnectionNotice hasData={false} signedOut />
				{access.status !== "checking" && (
					<>
						<p>{access.error}</p>
						{pending ? (
							<section
								className="device-pairing"
								aria-label="Pending device approval"
							>
								<h2>Approve on your trusted device</h2>
								<p>
									In Settings → Access, approve only the request showing this
									same confirmation number. Keep this screen open.
								</p>
								<output
									className="pairing-code"
									aria-label="Pairing confirmation number"
								>
									{pending.confirmation.slice(0, 3)}{" "}
									{pending.confirmation.slice(3)}
								</output>
								<p role="status">
									{pending.approved
										? "Approved. Finishing sign-in…"
										: "Waiting for approval. No API key has been issued."}
								</p>
								<p>
									Expires at {new Date(pending.expires).toLocaleTimeString()}.
								</p>
								<label className="auth-remember">
									<input
										type="checkbox"
										checked={staySignedIn}
										disabled={busy}
										onChange={(event) => setStaySignedIn(event.target.checked)}
									/>
									Stay signed in (no session expiry)
								</label>
								{error && pending.approved && (
									<Button
										disabled={busy || updateRequired}
										onClick={() => {
											claiming.current = undefined;
											void claim(pending);
										}}
									>
										Retry sign-in
									</Button>
								)}
								<Button
									variant="secondary"
									disabled={busy || updateRequired}
									onClick={() => {
										setBusy(true);
										void authRequest("pairing/withdraw", { id: pending.id })
											.then(() => {
												updatePending(undefined);
												setError(undefined);
											})
											.catch((error) =>
												setError(
													error instanceof Error
														? error.message
														: "Could not cancel request",
												),
											)
											.finally(() => setBusy(false));
									}}
								>
									Cancel request
								</Button>
							</section>
						) : access.setupRequired && mode === "key" ? (
							<p>
								Open Bob’s Factory on localhost and create an API key in
								Settings → Access. Then return here to sign in.
							</p>
						) : (
							<form
								onSubmit={(event) => {
									event.preventDefault();
									void submit(
										String(
											new FormData(event.currentTarget).get("credential") ?? "",
										),
										new FormData(event.currentTarget).has("staySignedIn"),
									);
								}}
							>
								{mode === "code" ? (
									<p>
										Enter the code enabled on your trusted device in Settings →
										Access. Then compare the confirmation number on both devices
										and approve this device there.
									</p>
								) : (
									<p>
										By default, browser sessions expire. Your API key stays
										valid: use the same key to sign in again, and save it in
										your password manager for next time.
									</p>
								)}
								<label>
									{mode === "code" ? "6-digit code" : "API key"}
									<input
										key={mode}
										id={
											mode === "code"
												? "factory-sign-in-code"
												: "factory-api-key"
										}
										name="credential"
										type={mode === "code" ? "text" : "password"}
										inputMode={mode === "code" ? "numeric" : undefined}
										pattern={mode === "code" ? "[0-9]{6}" : undefined}
										autoComplete={
											mode === "code" ? "one-time-code" : "current-password"
										}
										autoCapitalize="none"
										autoCorrect="off"
										spellCheck={false}
										maxLength={mode === "code" ? 6 : 100}
										value={key}
										onChange={(e) =>
											setKey(
												mode === "code"
													? e.target.value.replace(/[^0-9]/g, "").slice(0, 6)
													: e.target.value.trim(),
											)
										}
										required
									/>
								</label>
								<label className="auth-remember">
									<input type="checkbox" name="staySignedIn" />
									Stay signed in (no session expiry)
								</label>
								<Button
									type="submit"
									disabled={
										busy ||
										updateRequired ||
										(mode === "code" && (!pairingAvailable || key.length !== 6))
									}
								>
									{busy ? "Signing in…" : "Sign in"}
								</Button>
							</form>
						)}
						{!pending && (
							<Button
								variant="secondary"
								disabled={busy || (mode === "key" && !pairingAvailable)}
								onClick={() => {
									setMode(mode === "key" ? "code" : "key");
									setKey("");
									setError(undefined);
								}}
							>
								{mode === "key" ? "Use a 6-digit code" : "Use an API key"}
							</Button>
						)}
						{!pairingAvailable && !pending && (
							<p>
								Code sign-in is off. On a trusted device, open Settings → Access
								→ Pair a device to enable a code.
							</p>
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
type Pairing = {
	id: string;
	label: string;
	expires: number;
	code?: string;
	requests: PairingRequest[];
};
function DevicePairing({ refreshKeys }: { refreshKeys: () => Promise<void> }) {
	const pwa = usePwa();
	const [pairing, setPairing] = useState<Pairing>();
	const [label, setLabel] = useState("Paired device");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string>();
	const [now, setNow] = useState(Date.now());
	const previous = useRef<string | undefined>(undefined);
	const paused = pwa.status !== "ready" || pwa.updating;
	useEffect(() => {
		if (busy) return;
		let active = true;
		const refresh = async () => {
			try {
				const result: Pairing | null = await authRequest(
					"pairing",
					undefined,
					"GET",
				);
				if (!active) return;
				setPairing((current) =>
					result
						? {
								...result,
								...(current?.id === result.id ? { code: current.code } : {}),
							}
						: undefined,
				);
				if (previous.current && !result) await refreshKeys();
				previous.current = result?.id;
			} catch (error) {
				if (active)
					setError(
						error instanceof Error
							? error.message
							: "Could not check device pairing",
					);
			}
		};
		void refresh();
		const timer = setInterval(() => void refresh(), 3000);
		return () => {
			active = false;
			clearInterval(timer);
		};
	}, [busy, refreshKeys]);
	useEffect(() => {
		const timer = setInterval(() => {
			const now = Date.now();
			setNow(now);
			setPairing((current) =>
				current && current.expires <= now ? undefined : current,
			);
		}, 1000);
		return () => clearInterval(timer);
	}, []);
	const run = async (action: () => Promise<void>) => {
		setBusy(true);
		setError(undefined);
		try {
			await action();
		} catch (error) {
			setError(
				error instanceof Error ? error.message : "Device pairing failed",
			);
		} finally {
			setBusy(false);
		}
	};
	const seconds = Math.max(
		0,
		Math.ceil(((pairing?.expires ?? now) - now) / 1000),
	);
	return (
		<section className="settings-card" aria-labelledby="pairing-heading">
			<h2 id="pairing-heading">Pair a device</h2>
			<p>
				Sign in on a device where typing an API key is difficult. Generate a
				code here, then enter it on that device’s login screen.
			</p>
			<p>
				Code sign-in is off until you enable it. Codes expire after five
				minutes. A device receives its key only after you approve its matching
				confirmation number. Wrong guesses are throttled.
			</p>
			<form
				className="api-key-add"
				onSubmit={(event) => {
					event.preventDefault();
					void run(async () => {
						const result: Pairing = await authRequest("pairing", { label });
						previous.current = result.id;
						setNow(Date.now());
						setPairing(result);
					});
				}}
			>
				<label>
					Device name
					<input
						required
						maxLength={80}
						value={label}
						onChange={(event) => setLabel(event.target.value)}
						placeholder="Living room tablet"
					/>
				</label>
				<Button type="submit" disabled={busy || paused || !label.trim()}>
					{pairing ? "Generate a new code" : "Enable code sign-in"}
				</Button>
			</form>
			{pairing && (
				<div className="device-pairing">
					{pairing.requests.some((request) => request.approved) ? (
						<p>Approved. Waiting for the selected device to collect its key.</p>
					) : pairing.code ? (
						<output className="pairing-code" aria-label="Device pairing code">
							{pairing.code.slice(0, 3)} {pairing.code.slice(3)}
						</output>
					) : (
						<p>
							A code was enabled in another tab. Generate a new code to display
							it here.
						</p>
					)}
					<p>
						For {pairing.label} · Expires in {Math.floor(seconds / 60)}:
						{String(seconds % 60).padStart(2, "0")}
					</p>
					{pairing.requests.map((request) => (
						<div className="pairing-request" key={request.id}>
							<h3>Check the device in your hands</h3>
							<p>
								Approve only if this confirmation number matches the one on that
								device. Reject requests you do not recognize.
							</p>
							<output
								className="pairing-code"
								aria-label="Pairing confirmation number"
							>
								{request.confirmation.slice(0, 3)}{" "}
								{request.confirmation.slice(3)}
							</output>
							{request.approved ? (
								<p>Approved</p>
							) : (
								<div className="settings-actions">
									{(["approve", "reject"] as const).map((action) => (
										<Button
											key={action}
											variant={action === "approve" ? "primary" : "secondary"}
											disabled={busy || paused}
											aria-label={`${action === "approve" ? "Approve" : "Reject"} device ${request.confirmation}`}
											onClick={() =>
												void run(async () => {
													await authRequest(
														`pairing/${encodeURIComponent(pairing.id)}/${action}`,
														{
															requestId: request.id,
															confirmation: request.confirmation,
														},
													);
													const result: Pairing | null = await authRequest(
														"pairing",
														undefined,
														"GET",
													);
													setPairing(
														result
															? {
																	...result,
																	...(result.id === pairing.id
																		? { code: pairing.code }
																		: {}),
																}
															: undefined,
													);
												})
											}
										>
											{action === "approve"
												? "Approve device"
												: "Reject request"}
										</Button>
									))}
								</div>
							)}
						</div>
					))}
					<Button
						variant="secondary"
						disabled={busy || paused}
						onClick={() =>
							void run(async () => {
								await authRequest(
									`pairing/${encodeURIComponent(pairing.id)}`,
									{},
									"DELETE",
								);
								setPairing(undefined);
							})
						}
					>
						Cancel code
					</Button>
				</div>
			)}
			{error && (
				<p className="settings-error" role="alert">
					{error}
				</p>
			)}
			<p className="settings-hint">
				Only share the code with your device. Pairing gives it a normal API key
				with full access. Remove that key below to revoke access. Generating a
				new code replaces the previous one.
			</p>
		</section>
	);
}
export function AccessSettings() {
	const access = useAccess();
	const pwa = usePwa();
	const mutationsPaused = pwa.status !== "ready" || pwa.updating;
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
			<DevicePairing refreshKeys={load} />
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
						disabled={busy || mutationsPaused}
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
							<Button
								type="submit"
								disabled={busy || mutationsPaused || !label.trim()}
							>
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
									disabled={busy || mutationsPaused}
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
									disabled={busy || mutationsPaused}
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
					{access.expires === null && (
						<p>
							This session has no expiry. Sign out or revoke its key to end
							access.
						</p>
					)}
					<p>
						Signing out discards unsent edits and review comments in every
						Factory tab.
					</p>
					<Button
						variant="secondary"
						disabled={busy || mutationsPaused}
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
