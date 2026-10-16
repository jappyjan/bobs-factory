import { useAction } from "./client";
import { useFormState } from "./form-state";
import { revisionOf } from "./restoration";
import { Button, useToast } from "./ui";

/** Shared by the host identity, signing profiles and repository SSH bindings. */
export function SshAgentField({
	socket = "",
	detected = [],
	purpose,
	scope,
	inherit = false,
	onChange,
}: {
	socket?: string;
	detected?: string[];
	purpose: string;
	scope: string;
	inherit?: boolean;
	onChange: (socket: string) => void;
}) {
	const context = `${scope}/${socket}`;
	const test = useAction(`ssh-agent-test/${scope}`, context);
	const [result, setResult] = useFormState<{ message: string } | undefined>(
		context,
		undefined,
	);
	return (
		<fieldset aria-label={`${purpose} SSH agent`}>
			<label>
				{purpose} SSH agent socket
				<input
					value={socket}
					placeholder={
						inherit ? "Use inherited SSH_AUTH_SOCK" : "Optional agent socket"
					}
					onChange={(event) => onChange(event.target.value)}
				/>
			</label>
			<small>
				Enter an absolute path or ~/ path on the Factory machine. Copy the
				socket path from your password manager’s SSH agent settings, or choose a
				detected socket below.{" "}
				{inherit
					? "Leave empty to use the inherited agent."
					: "Leave empty to use the declared key without an agent."}
			</small>
			{detected.length > 0 && (
				<label>
					{purpose} detected SSH agents
					<select
						value={detected.includes(socket) ? socket : ""}
						onChange={(event) => onChange(event.target.value)}
					>
						<option value="">Choose a detected socket…</option>
						{detected.map((path) => (
							<option key={path} value={path}>
								{path}
							</option>
						))}
					</select>
				</label>
			)}
			<Button
				requiresConnection
				disabled={test.isPending || (!inherit && !socket.trim())}
				onClick={() =>
					void test
						.mutateAsync({
							path: "/api/git-settings/test",
							body: { socket: socket.trim() || null },
						})
						.then(setResult)
						.catch(() => {})
				}
			>
				Test {purpose.toLowerCase()} SSH agent
			</Button>
			{result && <p role="status">{result.message}</p>}
			{test.error && <p role="alert">{test.error.message}</p>}
		</fieldset>
	);
}

export function HostGitIdentity({ config }: { config: any }) {
	const settings = config.gitSettings;
	const context = revisionOf(settings);
	const [draft, setDraft] = useFormState<{ socket: string } | undefined>(
		context,
		undefined,
	);
	const socket = draft?.socket ?? settings?.socket ?? "";
	const save = useAction("git-settings", context);
	const toast = useToast();
	if (!settings) return null;
	return (
		<section aria-labelledby="host-git-identity-heading">
			<h3 id="host-git-identity-heading">Host Git identity</h3>
			<p>
				Legacy runs use the host Git identity. Profiles with shared signing use
				this host agent too. Keys stay in your password manager or SSH agent;
				author, committer and signing policy stay in your existing Git
				configuration.
			</p>
			<p>
				Saving this agent applies to subsequent commands, new host sessions and
				retained-run retries without restarting Factory. Explicit profile SSH
				bindings keep their selected agent.
			</p>
			<p role="status">
				Current agent: {settings.effectiveSocket ?? "Not configured"}
				{settings.socket ? " (saved in Factory)" : " (inherited by Factory)"}.
				{!settings.available && " Socket is unavailable."}
			</p>
			<form
				onSubmit={async (event) => {
					event.preventDefault();
					if (save.isPending) return;
					try {
						await save.mutateAsync({
							path: "/api/git-settings",
							method: "PUT",
							body: {
								socket: socket.trim() || null,
								expectedRevision: settings.revision,
							},
						});
						setDraft(undefined);
						toast({
							text: "Host Git agent saved. Retry the failed step when ready.",
						});
					} catch {}
				}}
			>
				<fieldset disabled={save.isPending}>
					<legend>Host SSH agent</legend>
					<SshAgentField
						key={context}
						socket={socket}
						detected={settings.detected}
						purpose="Host"
						scope="host"
						inherit
						onChange={(socket) => setDraft({ socket })}
					/>
					<Button type="submit" requiresConnection disabled={!draft}>
						Save host Git agent
					</Button>
					<Button
						disabled={!draft}
						onClick={() => {
							setDraft(undefined);
							save.reset();
						}}
					>
						Discard host agent changes
					</Button>
				</fieldset>
				{save.error && <p role="alert">{save.error.message}</p>}
			</form>
		</section>
	);
}
