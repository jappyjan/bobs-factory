import { useEffect, useRef, useState } from "react";
import { accessGeneration, useAccess } from "./auth-state";
import { useCurrentForm, useFormState } from "./form-state";
import { type PushStatus, pushApi } from "./notifications";
import { Button } from "./ui";

export function NotificationSettings({ onSaved }: { onSaved?: () => void }) {
	const access = useAccess();
	const epoch = accessGeneration();
	const [status, setStatus] = useState<PushStatus>();
	const [error, setError] = useState("");
	const [message, setMessage] = useState("");
	const [busy, setBusy] = useState(false);
	const busyRef = useRef(false);
	const refreshRequest = useRef(0);
	const context = `${epoch}:${status?.configuration}:${status?.subject}`;
	const [draft, setDraft] = useFormState<string | undefined>(
		context,
		undefined,
	);
	const current = useCurrentForm(context);
	useEffect(() => {
		const controller = new AbortController();
		refreshRequest.current++;
		busyRef.current = false;
		setBusy(false);
		setStatus(undefined);
		setError("");
		setMessage("");
		const refresh = () => {
			if (access.status !== "authenticated" || busyRef.current) return;
			const id = ++refreshRequest.current;
			void pushApi<PushStatus>("", { signal: controller.signal })
				.then((value) => {
					if (
						!controller.signal.aborted &&
						epoch === accessGeneration() &&
						id === refreshRequest.current &&
						!busyRef.current
					)
						setStatus(value);
				})
				.catch((e) => {
					if (
						!controller.signal.aborted &&
						epoch === accessGeneration() &&
						id === refreshRequest.current &&
						!busyRef.current
					)
						setError(e.message);
				});
		};
		const foreground = () => {
			if (!document.hidden) refresh();
		};
		refresh();
		window.addEventListener("focus", refresh);
		document.addEventListener("visibilitychange", foreground);
		return () => {
			controller.abort();
			window.removeEventListener("focus", refresh);
			document.removeEventListener("visibilitychange", foreground);
		};
	}, [epoch, access.status]);
	const blocked =
		!status ||
		status.configuration === "unavailable" ||
		status.configuration === "stopped";
	return (
		<section className="recipe" aria-labelledby="notification-settings">
			<h2 id="notification-settings">Push service contact</h2>
			<p>
				The contact identifies the operator to push services. Use{" "}
				<code>mailto:operator@example.org</code> or an HTTPS contact page such
				as <code>https://example.org/contact</code>.
			</p>
			<p>
				Saving configures the server. Each device must still explicitly enable
				notifications using the device controls below.
			</p>
			{status?.diagnostic && <p role="status">{status.diagnostic}</p>}
			{!status && !error && <p role="status">Loading notification settings…</p>}
			<form
				onSubmit={async (event) => {
					event.preventDefault();
					if (busyRef.current || blocked) return;
					busyRef.current = true;
					refreshRequest.current++;
					setBusy(true);
					setError("");
					setMessage("");
					try {
						await pushApi<PushStatus>("/config", {
							method: "PUT",
							body: JSON.stringify({ subject: draft ?? status.subject ?? "" }),
						});
						const saved = await pushApi<PushStatus>();
						if (!current() || epoch !== accessGeneration()) return;
						setDraft(undefined);
						busyRef.current = false;
						setBusy(false);
						setMessage("Push contact saved.");
						setStatus(saved);
						onSaved?.();
					} catch (e) {
						if (current() && epoch === accessGeneration()) {
							busyRef.current = false;
							setError((e as Error).message);
							setBusy(false);
						}
					}
				}}
			>
				<label>
					Push service contact
					<input
						required
						maxLength={2048}
						value={draft ?? status?.subject ?? ""}
						disabled={busy || blocked}
						onChange={(event) => {
							setDraft(event.target.value);
							setMessage("");
						}}
					/>
				</label>
				<Button
					type="submit"
					requiresConnection
					disabled={busy || blocked || draft === undefined}
				>
					{busy ? "Saving…" : "Save push contact"}
				</Button>
				{error && <p role="alert">{error}</p>}
				{message && <p role="status">{message}</p>}
			</form>
		</section>
	);
}
