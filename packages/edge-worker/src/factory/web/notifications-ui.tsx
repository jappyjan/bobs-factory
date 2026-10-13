import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useCurrentForm, useFormState } from "./form-state";
import {
	disablePush,
	enablePush,
	type PushStatus,
	pushApi,
	pushPreference,
	pushRegistration,
	pushSupported,
	reconcilePush,
} from "./notifications";
import { usePwa } from "./pwa";
import { revisionOf } from "./restoration";
import { Button } from "./ui";

type NotificationState = {
	status?: PushStatus;
	enabled: boolean;
	registration?: ServiceWorkerRegistration;
	permission: NotificationPermission | "unsupported";
	supported: boolean;
	error: string;
	refresh: (fresh?: boolean) => Promise<void>;
};
const NotificationContext = createContext<NotificationState | undefined>(
	undefined,
);

/** Subscription maintenance continues on every authenticated dashboard route. */
export function NotificationsProvider({ children }: { children: ReactNode }) {
	const connection = usePwa();
	const [error, setError] = useState("");
	const [status, setStatus] = useState<PushStatus>(),
		[enabled, setEnabled] = useState(false);
	const [registration, setRegistration] = useState<ServiceWorkerRegistration>(),
		[permission, setPermission] = useState<
			NotificationPermission | "unsupported"
		>("unsupported");
	const supported = pushSupported();
	const lifecycle = useMemo(
		() => ({
			connection: connection.status,
			supported,
			active: true,
			pending: undefined as Promise<void> | undefined,
		}),
		[connection.status, supported],
	);
	const refresh = useCallback(
		function refresh(fresh = false): Promise<void> {
			if (connection.status !== "ready" || !lifecycle.active)
				return Promise.resolve();
			if (lifecycle.pending)
				return fresh
					? lifecycle.pending.then(
							() => refresh(true),
							() => refresh(true),
						)
					: lifecycle.pending;
			lifecycle.pending = (async () => {
				const worker = await pushRegistration();
				if (!lifecycle.active) return;
				const current = await reconcilePush(worker);
				if (!lifecycle.active) return;
				setPermission(supported ? Notification.permission : "unsupported");
				setRegistration(worker);
				setStatus(current.status);
				setEnabled(current.enabled);
				setError("");
			})().finally(() => {
				lifecycle.pending = undefined;
			});
			return lifecycle.pending;
		},
		[connection.status, supported, lifecycle],
	);
	// Actions from a departed form may still finish. Refresh the current controller,
	// while an unmounted provider's lifecycle continues to reject stale results.
	const latestRefresh = useRef(refresh);
	latestRefresh.current = refresh;
	const refreshCurrent = useCallback(
		(fresh = false) => latestRefresh.current(fresh),
		[],
	);
	useEffect(() => {
		lifecycle.active = true;
		if (
			lifecycle.connection !== "ready" &&
			lifecycle.connection !== "checking"
		) {
			setStatus(undefined);
			setEnabled(false);
			setRegistration(undefined);
			setError("");
		}
		setPermission(supported ? Notification.permission : "unsupported");
		const foreground = () => {
			if (!document.hidden)
				void refresh().catch((e) => {
					if (lifecycle.active) setError(e.message);
				});
		};
		foreground();
		window.addEventListener("online", foreground);
		window.addEventListener("storage", foreground);
		document.addEventListener("visibilitychange", foreground);
		return () => {
			lifecycle.active = false;
			window.removeEventListener("online", foreground);
			window.removeEventListener("storage", foreground);
			document.removeEventListener("visibilitychange", foreground);
		};
	}, [refresh, lifecycle, supported]);
	return (
		<NotificationContext.Provider
			value={{
				status,
				enabled,
				registration,
				permission,
				supported,
				error,
				refresh: refreshCurrent,
			}}
		>
			{children}
		</NotificationContext.Provider>
	);
}

export function NotificationsSettings() {
	const connection = usePwa();
	const state = useContext(NotificationContext)!;
	const { status, enabled, registration, supported, refresh } = state;
	const context = revisionOf([status?.available, status?.publicKey]);
	const isCurrent = useCurrentForm(context);
	const [label, setLabel] = useFormState(context, "This browser");
	const [busy, setBusy] = useFormState(context, false);
	const [error, setError] = useFormState(context, "");
	const [message, setMessage] = useFormState(context, "");
	const permission = supported ? Notification.permission : state.permission;
	useEffect(() => {
		void refresh().catch(() => {});
	}, [refresh]);
	const perform = async (action: () => Promise<unknown>) => {
		setBusy(true);
		setError("");
		setMessage("");
		try {
			const result = await action();
			if (isCurrent() && typeof result === "string") setMessage(result);
			await refresh(true);
		} catch (e) {
			if (!isCurrent()) return;
			setError((e as Error).message);
		} finally {
			if (isCurrent()) setBusy(false);
		}
	};
	const ownId = pushPreference().id;
	return (
		<section
			className="recipe notifications-settings"
			aria-labelledby="notifications-settings"
		>
			<h2 id="notifications-settings">Notifications</h2>
			<p>
				Receive new questions, reviews, runs needing help, and successful
				completions. Notifications contain only Factory’s name and event type.
			</p>
			<p>
				Browser support: {supported ? "available" : "unavailable"}. Permission:{" "}
				{permission}. This device: {enabled ? "Enabled" : "Disabled"}.
			</p>
			{!supported && (
				<p>
					Use a supported browser over HTTPS. On iPhone or iPad (16.4+), install
					this address to the Home Screen and open the app there. If Brave does
					not offer installation, use Safari.
				</p>
			)}
			{status?.diagnostic && <p role="status">{status.diagnostic}</p>}
			<label>
				Device label
				<input
					value={label}
					maxLength={80}
					onChange={(e) => setLabel(e.target.value)}
				/>
			</label>
			<div className="actions">
				<Button
					disabled={
						busy ||
						enabled ||
						!supported ||
						!registration ||
						!status?.available ||
						!label.trim() ||
						connection.status !== "ready"
					}
					onClick={() => {
						// Permission must start in this direct click, before any network/lock/worker await.
						const permissionRequest = Notification.requestPermission();
						void perform(() =>
							enablePush(
								permissionRequest,
								registration!,
								status!.publicKey!,
								label.trim(),
							),
						);
					}}
				>
					Enable this device
				</Button>
				<Button
					variant="ghost"
					disabled={busy || (!enabled && !ownId)}
					onClick={() => void perform(() => disablePush(registration))}
				>
					Disable this device
				</Button>
				<Button
					variant="ghost"
					disabled={busy || !enabled}
					onClick={() =>
						void perform(async () => {
							const result = await pushApi<{ message: string }>(
								`/devices/${ownId}/test`,
								{ method: "POST", body: "{}" },
							);
							return result.message;
						})
					}
				>
					Send test
				</Button>
			</div>
			<p>
				Tests use the real push service. Acceptance does not prove display.
				Check browser and OS notification settings; Brave desktop also needs its
				Google-services push setting.
			</p>
			{message && <p role="status">{message}</p>}
			{(error || state.error) && <p role="alert">{error || state.error}</p>}
			<ul>
				{status?.devices.map((device) => (
					<li key={device.id}>
						<strong>{device.label}</strong>
						{device.id === ownId ? " (this device)" : ""}:{" "}
						{device.enabled ? "Enabled" : "Disabled"}; delivery{" "}
						{device.health === "accepted"
							? "accepted by provider, receipt unconfirmed"
							: device.health}
						.
						<div className="actions">
							{device.enabled && (
								<Button
									variant="ghost"
									disabled={busy}
									onClick={() =>
										void perform(() =>
											device.id === ownId
												? disablePush(registration)
												: pushApi(`/devices/${device.id}`, {
														method: "PATCH",
														body: JSON.stringify({ enabled: false }),
													}),
										)
									}
								>
									Disable {device.label}
								</Button>
							)}
							<Button
								variant="ghost"
								disabled={busy}
								onClick={() =>
									void perform(async () => {
										if (device.id === ownId) await disablePush(registration);
										await pushApi(`/devices/${device.id}`, {
											method: "DELETE",
										});
									})
								}
							>
								Remove {device.label}
							</Button>
						</div>
					</li>
				))}
			</ul>
			<p>
				Each browser profile or installed app is a separate device. Enable other
				devices from that device. Events already pending, skipped during an
				outage, or created before enablement are never replayed. Unreachable
				devices may miss notifications.
			</p>
		</section>
	);
}
