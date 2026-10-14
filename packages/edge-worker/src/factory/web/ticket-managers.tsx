import { useQuery } from "@tanstack/react-query";
import type { TicketManagers } from "../TicketManagers.js";
import { api, useAction } from "./client";
import { useFormState } from "./form-state";
import { Button, useToast } from "./ui";

type Status = ReturnType<TicketManagers["status"]>;
type Manager = Status["managers"][number];

export function TicketManagerSettings() {
	const query = useQuery({
		queryKey: ["ticket-managers"],
		queryFn: ({ signal }) => api<Status>("/api/ticket-managers", { signal }),
	});
	if (query.error) return <p role="alert">{query.error.message}</p>;
	if (!query.data) return <p>Loading ticket managers…</p>;
	return (
		<>
			<h2>Ticket managers</h2>
			<p>
				Connect the services you use to track work. Changes apply immediately to
				this instance.
			</p>
			<p>
				Disabling a connection pauses ticket intake and synchronization.
				Existing work and credentials are retained; pending ticket updates can
				resume when enabled.
			</p>
			{query.data.managers.map((manager) => (
				<ManagerConnection
					key={manager.id}
					manager={manager}
					status={query.data}
				/>
			))}
		</>
	);
}
function ManagerConnection({
	manager,
	status,
}: {
	manager: Manager;
	status: Status;
}) {
	const action = useAction(`ticket-manager-${manager.id}`, status.revision);
	const toast = useToast();
	const [draft, setDraft] = useFormState<
		{ fields: Record<string, string> } | undefined
	>(status.revision, undefined);
	const [tokens, setTokens] = useFormState(`${status.revision}:${manager.id}`, {
		accessToken: "",
		refreshToken: "",
	});
	const enabled = manager.enabled;
	const [authorization, setAuthorization] = useFormState<string | undefined>(
		status.revision,
		undefined,
	);
	return (
		<section
			className="recipe ticket-manager"
			aria-labelledby={`ticket-manager-${manager.id}`}
		>
			<h3 id={`ticket-manager-${manager.id}`}>{manager.name}</h3>
			<p>{manager.description}</p>
			<p role="status">
				{manager.status === "disabled"
					? "Disabled"
					: manager.status === "configured"
						? "Configured"
						: "Needs configuration"}
				{manager.diagnostic ? ` · ${manager.diagnostic}` : ""}
			</p>
			{"lastAcceptedAt" in manager && manager.lastAcceptedAt && (
				<p>
					Last verified webhook:{" "}
					{new Date(manager.lastAcceptedAt).toLocaleString()}
				</p>
			)}
			<label className="ticket-manager-enable">
				<input
					type="checkbox"
					checked={enabled}
					disabled={action.isPending}
					onChange={(event) =>
						void action
							.mutateAsync({
								path: `/api/ticket-managers/${manager.id}`,
								method: "PUT",
								body: {
									expectedRevision: status.revision,
									enabled: event.target.checked,
								},
							})
							.catch(() => {})
					}
				/>{" "}
				Enable {manager.name}
			</label>
			<details>
				<summary>Configure connection</summary>

				<form
					onSubmit={async (event) => {
						event.preventDefault();
						try {
							const fields = Object.fromEntries(
								Object.entries(draft?.fields ?? {})
									.filter(
										([key, value]) =>
											value ||
											manager.fields.find((f) => f.id === key)?.type !==
												"password",
									)
									.map(([key, value]) => [key, value || null]),
							);
							await action.mutateAsync({
								path: `/api/ticket-managers/${manager.id}`,
								method: "PUT",
								body: { expectedRevision: status.revision, enabled, ...fields },
							});
							setDraft(undefined);
							toast({ text: `${manager.name} settings saved` });
						} catch {}
					}}
				>
					{manager.fields.map((field) => (
						<label key={field.id}>
							{field.label}
							<input
								type={field.type}
								autoComplete={
									field.type === "password" ? "new-password" : "off"
								}
								disabled={action.isPending}
								value={
									draft?.fields[field.id] ??
									("value" in field ? String(field.value) : "")
								}
								placeholder={
									"configured" in field && field.configured
										? "Saved · leave blank to keep"
										: undefined
								}
								onChange={(event) =>
									setDraft({
										...draft,
										fields: {
											...draft?.fields,
											[field.id]: event.target.value,
										},
									})
								}
							/>
						</label>
					))}
					<Button
						type="submit"
						requiresConnection
						disabled={!draft || action.isPending}
					>
						Save {manager.name} settings
					</Button>
				</form>
			</details>
			{"webhookUrl" in manager && manager.webhookUrl && (
				<p>
					Webhook URL: <code>{manager.webhookUrl}</code>
				</p>
			)}
			{manager.id === "linear" && "workspaces" in manager && (
				<>
					<h4>Workspaces</h4>
					<p>
						Save your application details, then authorize this Factory in
						Linear. Register the callback URL shown below in your Linear
						application.
					</p>
					{"webhookUrl" in manager && manager.webhookUrl && (
						<p>
							Callback URL:{" "}
							<code>
								{manager.webhookUrl.replace(/\/linear-webhook$/, "/callback")}
							</code>
						</p>
					)}
					<Button
						requiresConnection
						disabled={
							action.isPending ||
							!("canAuthorize" in manager && manager.canAuthorize)
						}
						onClick={() =>
							void action
								.mutateAsync({
									path: "/api/ticket-managers/linear/authorize",
									body: { expectedRevision: status.revision },
								})
								.then((result) => setAuthorization(result.url))
								.catch(() => {})
						}
					>
						Connect Linear workspace
					</Button>
					{authorization && (
						<p>
							<a href={authorization} target="_blank" rel="noopener noreferrer">
								Continue to Linear →
							</a>
						</p>
					)}
					{manager.workspaces?.map((workspace) => (
						<p key={workspace.id}>{workspace.name} · Connected</p>
					))}
					<details>
						<summary>Connect using an existing application token</summary>

						<p>
							Connect using a Linear application access token. Add its refresh
							token and OAuth client details above for automatic renewal.
						</p>
						<form
							onSubmit={async (event) => {
								event.preventDefault();
								try {
									await action.mutateAsync({
										path: "/api/ticket-managers/linear/workspaces",
										body: {
											expectedRevision: status.revision,
											accessToken: tokens.accessToken,
											...(tokens.refreshToken
												? { refreshToken: tokens.refreshToken }
												: {}),
										},
									});
									setTokens({ accessToken: "", refreshToken: "" });
									toast({ text: "Linear workspace verified and connected" });
								} catch {}
							}}
						>
							<label>
								Application access token
								<input
									type="password"
									autoComplete="new-password"
									required
									value={tokens.accessToken}
									disabled={action.isPending}
									onChange={(event) =>
										setTokens({ ...tokens, accessToken: event.target.value })
									}
								/>
							</label>
							<label>
								Refresh token (optional)
								<input
									type="password"
									autoComplete="new-password"
									value={tokens.refreshToken}
									disabled={action.isPending}
									onChange={(event) =>
										setTokens({ ...tokens, refreshToken: event.target.value })
									}
								/>
							</label>
							<Button
								type="submit"
								requiresConnection
								disabled={!tokens.accessToken || action.isPending}
							>
								Verify and connect workspace
							</Button>
						</form>
					</details>
					{!!manager.workspaces?.length && (
						<>
							<h4>Project routing</h4>
							{status.repositories.map((repo) => (
								<label key={repo.id}>
									{repo.name}
									<select
										value={
											manager.workspaces?.some(
												(ws) => ws.id === repo.workspaceId,
											)
												? repo.workspaceId
												: ""
										}
										disabled={action.isPending}
										onChange={(event) =>
											void action
												.mutateAsync({
													path: "/api/ticket-managers/linear/projects",
													method: "PUT",
													body: {
														expectedRevision: status.revision,
														repositoryId: repo.id,
														workspaceId: event.target.value,
													},
												})
												.catch(() => {})
										}
									>
										<option value="" disabled>
											Choose workspace
										</option>
										{manager.workspaces?.map((workspace) => (
											<option key={workspace.id} value={workspace.id}>
												{workspace.name}
											</option>
										))}
									</select>
								</label>
							))}
						</>
					)}
				</>
			)}
			{action.error && <p role="alert">{action.error.message}</p>}
		</section>
	);
}
