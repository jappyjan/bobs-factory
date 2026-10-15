import { useAction } from "./client";
import { useFormState } from "./form-state";
import { revisionOf } from "./restoration";
import { Button, useToast } from "./ui";

export function GitSettings({ config }: { config: any }) {
	const settings = config.gitSettings;
	const context = revisionOf(settings);
	const [draft, setDraft] = useFormState<{ socket: string } | undefined>(
		context,
		undefined,
	);
	const socket = draft?.socket ?? settings?.socket ?? "";
	const selection = { socket: socket.trim() || null };
	const save = useAction("git-settings", context);
	const test = useAction("git-agent-test", `${context}/${socket}`);
	const [result, setResult] = useFormState<{ message: string } | undefined>(
		`${context}/${socket}`,
		undefined,
	);
	const toast = useToast();
	if (!settings) return null;
	return (
		<section className="recipe" aria-labelledby="git-settings-heading">
			<h2 id="git-settings-heading">Git SSH agent</h2>
			<p>
				Choose the SSH agent used by this Factory instance for Git
				authentication and commit signing. Keys stay in your password manager or
				SSH agent.
			</p>
			<p>
				Saved changes apply to subsequent commands, new agent sessions and
				resumed runs without restarting Factory. Identity profiles with explicit
				SSH agent bindings keep their selected agent.
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
							body: { ...selection, expectedRevision: settings.revision },
						});
						setDraft(undefined);
						toast({
							text: "Git SSH agent saved. You can now resume the failed run.",
						});
					} catch {}
				}}
			>
				<fieldset disabled={save.isPending}>
					<legend>Agent selection</legend>
					<label>
						SSH agent socket
						<input
							value={socket}
							placeholder="Use inherited SSH_AUTH_SOCK"
							onChange={(event) => setDraft({ socket: event.target.value })}
						/>
					</label>
					<small>
						Enter an absolute path or ~/ path on the Factory machine. Copy the
						socket path from your password manager’s SSH agent settings, or
						choose a detected socket below. Leave empty to use the inherited
						agent.
					</small>
					{settings.detected.length > 0 && (
						<label>
							Detected SSH agents
							<select
								value={settings.detected.includes(socket) ? socket : ""}
								onChange={(event) => setDraft({ socket: event.target.value })}
							>
								<option value="">Choose a detected socket…</option>
								{settings.detected.map((path: string) => (
									<option key={path} value={path}>
										{path}
									</option>
								))}
							</select>
						</label>
					)}
					<Button
						requiresConnection
						disabled={test.isPending}
						onClick={() =>
							void test
								.mutateAsync({
									path: "/api/git-settings/test",
									body: selection,
								})
								.then(setResult)
								.catch(() => {})
						}
					>
						Test agent
					</Button>
					<Button
						type="submit"
						requiresConnection
						disabled={!draft || test.isPending}
					>
						Save Git settings
					</Button>
					<Button
						disabled={!draft || test.isPending}
						onClick={() => {
							setDraft(undefined);
							test.reset();
							save.reset();
						}}
					>
						Discard changes
					</Button>
				</fieldset>
				{result && <p role="status">{result.message}</p>}
				{test.error && <p role="alert">{test.error.message}</p>}
				{save.error && <p role="alert">{save.error.message}</p>}
			</form>
		</section>
	);
}
