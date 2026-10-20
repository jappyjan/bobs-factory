import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import type {
	ImprovementState,
	IssueDestination,
	ItemChoice,
} from "../Improvement";
import { api, useAction } from "./client";
import { useFormState } from "./form-state";
import { Button, External, Markdown } from "./ui";

type View = Pick<
	ImprovementState,
	| "phase"
	| "revision"
	| "proposals"
	| "choices"
	| "comments"
	| "manifest"
	| "children"
	| "issues"
	| "limitations"
> & {
	acceptance?: { digest: string; actor: string; at: string };
	jobs: Record<
		string,
		{
			role: string;
			status: string;
			error?: string;
			settings?: { runner?: string; model?: string };
		}
	>;
};
export function ImprovementPanel({ run }: { run: any }) {
	const query = useQuery({
		queryKey: ["run", run.id, "improvements"],
		queryFn: ({ signal }) =>
			api<View>(`/api/runs/${run.id}/improvements`, { signal }),
	});
	return (
		<section
			className="improvement-panel"
			aria-label="Codebase improvement proposals"
		>
			<h2>Improve codebase</h2>
			{query.isLoading ? (
				<p role="status">Loading research…</p>
			) : query.error ? (
				<p role="alert">{query.error.message}</p>
			) : query.data ? (
				<ImprovementContent key={run.id} run={run} state={query.data} />
			) : null}
		</section>
	);
}
function ImprovementContent({ run, state }: { run: any; state: View }) {
	const proposal = state.proposals.at(-1),
		context = `${run.id}:${proposal?.digest ?? "research"}:${state.revision}`;
	const [choices, setChoices] = useFormState<Record<string, ItemChoice>>(
		context,
		() => structuredClone(state.choices),
	);
	const [questions, setQuestions] = useFormState<Record<string, string>>(
		context,
		{},
	);
	const [error, setError] = useState("");
	const [historical, setHistorical] = useState<number>();
	const action = useAction(`improvements/${run.id}`, context);
	const destinations = useQuery({
		queryKey: ["run", run.id, "improvement-destinations"],
		enabled:
			Object.values(choices).some((c) => c.action === "issue") &&
			!state.acceptance,
		queryFn: ({ signal }) =>
			api<{
				options: { name: string; destination: IssueDestination }[];
				limitations: string[];
			}>(`/api/runs/${run.id}/improvement-destinations`, { signal }),
	});
	const pending =
		run.status === "waiting" &&
		!state.acceptance &&
		["discussion", "ready"].includes(state.phase);
	const chosen = Object.values(choices),
		fixes = chosen.filter((c) => c.action === "fix").length,
		issues = chosen.filter((c) => c.action === "issue").length;
	const submit = async (kind: string, extra: Record<string, unknown> = {}) => {
		if (!proposal) return;
		setError("");
		try {
			await action.mutateAsync({
				path: `/api/runs/${run.id}/improvements`,
				body: {
					version: proposal.version,
					digest: proposal.digest,
					expectedRevision: state.revision,
					action: kind,
					...extra,
				},
			});
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	};
	const jobs = Object.entries(state.jobs),
		completed = jobs.filter(([, j]) => j.status === "completed").length;
	const visible =
			historical === undefined
				? proposal
				: state.proposals.find((p) => p.version === historical),
		current = visible === proposal;
	return (
		<>
			<p className="muted">
				Architectural opportunities and systemic improvements. Small
				imperfections do not need a fix.
			</p>
			{jobs.length > 0 && (
				<details>
					<summary>
						Research: {completed} of {jobs.length} assignments completed
					</summary>
					<ul>
						{jobs.map(([id, j]) => (
							<li key={id}>
								<strong>{id.replaceAll("-", " ")}</strong> · {j.status}
								{j.settings?.model ? ` · ${j.settings.model}` : ""}
								{j.error && <p className="error">{j.error}</p>}
							</li>
						))}
					</ul>
				</details>
			)}
			{visible && (
				<>
					<div className="improvement-heading">
						<h3>Proposal {visible.version}</h3>
						{state.proposals.length > 1 && (
							<label>
								Version{" "}
								<select
									aria-label="Proposal version"
									value={visible.version}
									onChange={(e) =>
										setHistorical(
											Number(e.target.value) === proposal?.version
												? undefined
												: Number(e.target.value),
										)
									}
								>
									{state.proposals.map((p) => (
										<option key={p.version} value={p.version}>
											{p.version}
											{p === proposal ? " · current" : " · historical"}
										</option>
									))}
								</select>
							</label>
						)}
					</div>
					<Markdown>{visible.summary}</Markdown>
					{!current && (
						<p role="status">
							Historical proposal. Return to the current version to change
							choices.
						</p>
					)}
					{visible.opportunities.length === 0 && (
						<p>No substantial improvements found in the inspected scope.</p>
					)}
					{visible.opportunities.map((item) => {
						const choice = choices[item.id];
						return (
							<article className="improvement-item" key={item.id}>
								<h3>{item.title}</h3>
								<p className="muted">
									{item.strength.replaceAll("-", " ")} · {item.effort}
								</p>
								<Markdown>{item.problem}</Markdown>
								<p>
									<strong>Why it matters:</strong> {item.consequence}
								</p>
								<div className="improvement-comparison">
									<div>
										<h4>Current design</h4>
										<Markdown>{item.before}</Markdown>
									</div>
									<div>
										<h4>Proposed design</h4>
										<Markdown>{item.after}</Markdown>
									</div>
								</div>
								<details>
									<summary>Evidence, plan and acceptance criteria</summary>
									<ul>
										{item.evidence.map((e, i) => (
											<li key={`${i}-${e}`}>
												<Markdown>{e}</Markdown>
											</li>
										))}
									</ul>
									<Markdown>{item.plan}</Markdown>
									<h4>Acceptance criteria</h4>
									<ul>
										{item.criteria.map((c) => (
											<li key={c}>{c}</li>
										))}
									</ul>
									{item.nonGoals.length > 0 && (
										<>
											<h4>Non-goals</h4>
											<ul>
												{item.nonGoals.map((n) => (
													<li key={n}>{n}</li>
												))}
											</ul>
										</>
									)}
									{item.risks.length > 0 && (
										<>
											<h4>Risks and tradeoffs</h4>
											<ul>
												{item.risks.map((r) => (
													<li key={r}>{r}</li>
												))}
											</ul>
										</>
									)}
									{item.paths.length > 0 && (
										<p>Expected footprint: {item.paths.join(", ")}</p>
									)}
									<p>
										Perspectives:{" "}
										{item.perspectives.join(", ") || "Consolidated research"}
									</p>
								</details>
								{item.dependencies.length > 0 && (
									<p>
										Requires:{" "}
										{item.dependencies
											.map(
												(id) =>
													visible.opportunities.find((i) => i.id === id)
														?.title ?? id,
											)
											.join(", ")}
									</p>
								)}
								{current && !state.acceptance && (
									<fieldset disabled={!pending || action.isPending}>
										<legend>What should Bob do with this?</legend>
										<div className="improvement-options">
											{(
												[
													["fix", "Fix"],
													["issue", "File issue"],
													["ignore", "Ignore"],
													["follow-up", "Ask follow-up"],
												] as const
											).map(([value, label]) => (
												<label key={value}>
													<input
														type="radio"
														name={`improvement-${item.id}`}
														value={value}
														checked={choice?.action === value}
														onChange={() =>
															setChoices((old) => ({
																...old,
																[item.id]: {
																	action: value,
																	comment: old[item.id]?.comment ?? "",
																	destination: old[item.id]?.destination,
																},
															}))
														}
													/>
													{label}
												</label>
											))}
										</div>
										{choice?.action === "issue" && (
											<label>
												Issue destination
												<select
													value={
														choice.destination
															? JSON.stringify(choice.destination)
															: ""
													}
													onChange={(e) =>
														setChoices((old) => ({
															...old,
															[item.id]: {
																...old[item.id]!,
																destination: e.target.value
																	? JSON.parse(e.target.value)
																	: undefined,
															},
														}))
													}
												>
													<option value="">
														Choose a tracker and project…
													</option>
													{destinations.data?.options.map((d) => (
														<option
															key={JSON.stringify(d.destination)}
															value={JSON.stringify(d.destination)}
														>
															{d.name}
														</option>
													))}
												</select>
												<span className="muted">
													The issue keeps the evidence and plan. It stays in the
													backlog and will not start a Factory run.
												</span>
											</label>
										)}
										{choice?.action === "ignore" && (
											<label>
												Reason (optional)
												<input
													value={choice.comment}
													onChange={(e) =>
														setChoices((old) => ({
															...old,
															[item.id]: {
																...old[item.id]!,
																comment: e.target.value,
															},
														}))
													}
												/>
											</label>
										)}
										<label>
											{choice?.action === "follow-up"
												? "Follow-up question"
												: "Comment or request a revision"}
											<textarea
												rows={2}
												value={questions[item.id] ?? ""}
												onChange={(e) =>
													setQuestions((old) => ({
														...old,
														[item.id]: e.target.value,
													}))
												}
											/>
										</label>
										<Button
											variant="secondary"
											disabled={!questions[item.id]?.trim()}
											onClick={() =>
												void submit("follow-up", {
													itemId: item.id,
													comment: questions[item.id],
													choices,
												})
											}
										>
											Ask Bob
										</Button>
									</fieldset>
								)}
								{state.acceptance && current && (
									<p>
										Chosen action:{" "}
										<strong>
											{state.choices[item.id]?.action ?? "Undecided"}
										</strong>
									</p>
								)}
							</article>
						);
					})}
					{current && !state.acceptance && (
						<div className="improvement-decision">
							<label>
								Comment on the overall proposal
								<textarea
									rows={2}
									value={questions.overall ?? ""}
									disabled={!pending || action.isPending}
									onChange={(e) =>
										setQuestions((old) => ({ ...old, overall: e.target.value }))
									}
								/>
							</label>
							<Button
								variant="secondary"
								disabled={
									!pending || !questions.overall?.trim() || action.isPending
								}
								onClick={() =>
									void submit("follow-up", {
										comment: questions.overall,
										choices,
									})
								}
							>
								Discuss with Bob
							</Button>
							<p>
								{fixes} improvement(s) to fix · {issues} issue(s) to file.
								Others remain unchanged.
							</p>
							<div className="actions">
								<Button
									requiresConnection
									busy={action.isPending}
									disabled={
										!pending ||
										chosen.some(
											(c) =>
												c.action === "follow-up" ||
												(c.action === "issue" && !c.destination),
										)
									}
									onClick={() => void submit("prepare", { choices })}
								>
									Prepare selected actions
								</Button>
								<Button
									requiresConnection
									variant="ghost"
									busy={action.isPending}
									disabled={!pending}
									onClick={() => void submit("choose", { choices })}
								>
									Save choices
								</Button>
								<Button
									requiresConnection
									variant="ghost"
									busy={action.isPending}
									disabled={!pending}
									onClick={() => void submit("finish")}
								>
									Finish without changes
								</Button>
							</div>
						</div>
					)}
				</>
			)}
			{destinations.error && <p role="alert">{destinations.error.message}</p>}
			{destinations.data?.limitations.map((l) => (
				<p className="muted" key={l}>
					{l}
				</p>
			))}
			{state.manifest && (
				<section className="improvement-manifest">
					<h3>Review the action batch</h3>
					{!state.acceptance &&
						JSON.stringify(choices) !==
							JSON.stringify(state.manifest.choices) && (
							<p role="status">
								Your choices changed. Prepare selected actions again before
								applying.
							</p>
						)}
					{state.manifest.packages.map((pkg) => (
						<details key={pkg.id}>
							<summary>
								{pkg.title}
								{pkg.dependencies.length
									? ` · waits for ${pkg.dependencies.join(", ")}`
									: " · ready to start"}
							</summary>
							<Markdown>{pkg.plan}</Markdown>
							<ul>
								{pkg.criteria.map((c) => (
									<li key={c}>{c}</li>
								))}
							</ul>
						</details>
					))}
					{Object.entries(state.manifest.choices)
						.filter(([, c]) => c.action === "issue")
						.map(([id, c]) => (
							<p key={id}>
								File issue:{" "}
								{proposal?.opportunities.find((i) => i.id === id)?.title} ·{" "}
								{destinations.data?.options.find(
									(d) =>
										JSON.stringify(d.destination) ===
										JSON.stringify(c.destination),
								)?.name ??
									(c.destination?.provider === "taskbot"
										? `Taskbot · ${c.destination.project}`
										: `Linear team ${c.destination?.teamId ?? ""}`)}
							</p>
						))}
					{!state.acceptance && (
						<Button
							requiresConnection
							busy={action.isPending}
							disabled={
								!pending ||
								JSON.stringify(choices) !==
									JSON.stringify(state.manifest.choices)
							}
							onClick={() =>
								void submit("apply", { manifestDigest: state.manifest?.digest })
							}
						>
							Apply choices · start {state.manifest.packages.length} run(s) and
							file{" "}
							{
								Object.values(state.manifest.choices).filter(
									(c) => c.action === "issue",
								).length
							}{" "}
							issue(s)
						</Button>
					)}
					{state.acceptance && (
						<p>Accepted {new Date(state.acceptance.at).toLocaleString()}.</p>
					)}
				</section>
			)}
			{Object.keys(state.children).length > 0 && (
				<section>
					<h3>Factory runs</h3>
					<ul>
						{Object.entries(state.children).map(([id, child]) => (
							<li key={id}>
								<Link to={`/runs/${child.runId}`}>
									{state.manifest?.packages.find((p) => p.id === id)?.title ??
										id}
								</Link>{" "}
								· {child.status ?? "Preparing"}
								{child.url && (
									<>
										{" "}
										· <External href={child.url}>PR</External>
									</>
								)}
							</li>
						))}
					</ul>
					{run.status !== "completed" && state.acceptance && (
						<Button
							requiresConnection
							variant="secondary"
							busy={action.isPending}
							onClick={() => void submit("stop-batch")}
						>
							Stop batch and active runs
						</Button>
					)}
					<p className="muted">
						Stopping only this parent pauses new dispatch; existing Factory runs
						continue.
					</p>
				</section>
			)}
			{Object.keys(state.issues).length > 0 && (
				<section>
					<h3>Filed issues</h3>
					<ul>
						{Object.entries(state.issues).map(([id, issue]) => (
							<li key={id}>
								{issue.url ? (
									<External href={issue.url}>{issue.title}</External>
								) : (
									issue.title
								)}{" "}
								· {issue.phase}
								{issue.error && <p role="alert">{issue.error}</p>}
							</li>
						))}
					</ul>
				</section>
			)}
			{state.comments.length > 0 && (
				<details>
					<summary>
						Discussion and plan feedback ({state.comments.length})
					</summary>
					{state.comments.map((c, i) => (
						<div key={`${c.at}-${i}`}>
							<p className="muted">
								{c.itemId ?? "Overall proposal"} · {c.actor}
							</p>
							<Markdown>{c.text}</Markdown>
						</div>
					))}
				</details>
			)}
			{[...state.limitations, ...(visible?.limitations ?? [])].length > 0 && (
				<details>
					<summary>Coverage and limitations</summary>
					<ul>
						{[
							...new Set([
								...state.limitations,
								...(visible?.limitations ?? []),
							]),
						].map((l) => (
							<li key={l}>{l}</li>
						))}
					</ul>
				</details>
			)}
			{error && (
				<p role="alert" className="error">
					{error}
				</p>
			)}
		</>
	);
}
