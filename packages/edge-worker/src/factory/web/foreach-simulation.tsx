import { useCallback, useState } from "react";
import {
	aggregateForeach,
	type ForeachItemState,
	type ForeachSnapshot,
	prepareForeach,
} from "../Foreach";
import { CheckJsonField } from "./check-step-settings";
import { bodyProblem } from "./foreach-step-settings";
import type { Step } from "./recipe-graph";
import { Button } from "./ui";

export function admitSimulatedItems(
	states: ForeachItemState[],
	concurrency: number,
): ForeachItemState[] {
	let available =
		concurrency - states.filter((state) => state.status === "running").length;
	return states.map((state) =>
		state.status === "pending" && available-- > 0
			? { ...state, status: "running" }
			: state,
	);
}
export function settleSimulatedItem(
	snapshot: ForeachSnapshot,
	states: ForeachItemState[],
	index: number,
	outcome: "completed" | "failed",
	result?: Record<string, unknown>,
	error?: string,
): ForeachItemState[] {
	if (states[index]?.status !== "running")
		throw new Error("Only a running item can finish.");
	const next: ForeachItemState[] = states.map((state, i) =>
		i === index ? { status: outcome, result, error } : state,
	);
	return outcome === "failed" && snapshot.failure === "all-must-succeed"
		? next.map((state) =>
				["pending", "running"].includes(state.status)
					? { status: "cancelled", error: "Stopped after a sibling failed" }
					: state,
			)
		: admitSimulatedItems(next, snapshot.concurrency);
}

export function ForeachSimulation({
	step,
	fallback,
	onContinue,
}: {
	step: Step;
	fallback: string;
	onContinue: (next: string) => void;
}) {
	const [scope, setScope] = useState<Record<string, any>>({
		outputs: {},
		inputs: {},
	});
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [failure, setFailure] = useState("");
	const [accepted, setAccepted] = useState<{
		snapshot: ForeachSnapshot;
		states: ForeachItemState[];
	}>();
	const reportError = useCallback(
		(field: string, error: string) =>
			setErrors((current) =>
				current[field] === error ? current : { ...current, [field]: error },
			),
		[],
	);
	const start = () => {
		try {
			const issue = bodyProblem(step.body);
			if (issue) throw new Error(issue);
			const snapshot = prepareForeach(step, {
				outputs: scope.outputs ?? {},
				inputs: scope.inputs,
				item: scope.item,
				index: scope.index,
			});
			setAccepted({
				snapshot,
				states: admitSimulatedItems(
					snapshot.items.map(() => ({ status: "pending" })),
					snapshot.concurrency,
				),
			});
			setFailure("");
		} catch (error) {
			setFailure(
				error instanceof Error ? error.message : "For each simulation failed.",
			);
		}
	};
	const settle = (
		index: number,
		outcome: "completed" | "failed",
		limit = false,
	) => {
		if (!accepted) return;
		const item = accepted.snapshot.items[index]!;
		const result = Object.fromEntries(
			(step.body ?? []).map((body) => [
				body.id,
				{ simulated: true, item: item.value, index: item.index },
			]),
		);
		setAccepted({
			...accepted,
			states: settleSimulatedItem(
				accepted.snapshot,
				accepted.states,
				index,
				outcome,
				outcome === "completed" ? result : undefined,
				limit
					? `“${step.body?.[0]?.name}” exhausted its per-item limit of ${step.body?.[0]?.maxVisits ?? 16} visits`
					: outcome === "failed"
						? "Synthetic item failure"
						: undefined,
			),
		});
	};
	const finished = accepted?.states.every((state) =>
		["completed", "failed", "cancelled"].includes(state.status),
	);
	const output =
		finished && accepted
			? aggregateForeach(accepted.snapshot, accepted.states)
			: undefined;
	const canContinue =
		output &&
		(accepted?.snapshot.failure === "keep-successful" ||
			!output.summary.failures.length);
	return (
		<div className="foreach-simulation">
			<p className="recipe-note">
				Uses the production item snapshot, key validation and aggregation.
				Choose the completion order below. Body outcomes are synthetic: this
				does not execute agents, nested bodies, called recipes or side effects.
				Each item has its own visit budget; a visit-limit failure follows the
				selected failure policy. Machine capacity can further reduce real
				execution concurrency.
			</p>
			{!accepted ? (
				<>
					<CheckJsonField
						label="For each scope fixture"
						value={scope}
						object
						rows={5}
						onError={reportError}
						onChange={(value) => {
							setScope(value);
							setFailure("");
						}}
						validate={(value) =>
							!value.outputs ||
							typeof value.outputs !== "object" ||
							Array.isArray(value.outputs)
								? "Supply outputs as an object; optional inputs, item and index use the current lexical frame."
								: undefined
						}
					/>
					<Button
						disabled={Object.values(errors).some(Boolean)}
						onClick={start}
					>
						Snapshot and start items
					</Button>
				</>
			) : (
				<>
					<p>
						<b>
							{
								accepted.states.filter((state) => state.status === "completed")
									.length
							}{" "}
							of {accepted.snapshot.items.length} completed
						</b>{" "}
						·{" "}
						{
							accepted.states.filter((state) => state.status === "running")
								.length
						}{" "}
						active · concurrency {accepted.snapshot.concurrency}
					</p>
					<ol className="foreach-items">
						{accepted.snapshot.items.map((item, index) => (
							<li key={item.id} data-status={accepted.states[index]!.status}>
								<span>
									<b>{item.id}</b>
									<small>
										Index {item.index} · {accepted.states[index]!.status}
									</small>
								</span>
								{accepted.states[index]!.status === "running" && (
									<div className="actions">
										<Button onClick={() => settle(index, "completed")}>
											Pass {item.id}
										</Button>
										<Button
											variant="secondary"
											onClick={() => settle(index, "failed")}
										>
											Fail
										</Button>
										<Button
											variant="secondary"
											onClick={() => settle(index, "failed", true)}
										>
											Visit limit
										</Button>
									</div>
								)}
								{accepted.states[index]!.error && (
									<small>{accepted.states[index]!.error}</small>
								)}
							</li>
						))}
					</ol>
					{output && (
						<div className="check-simulation-result" data-passed={canContinue}>
							<b>
								{canContinue ? "Iteration finished" : "Iteration stops the run"}
							</b>
							<pre>{JSON.stringify(output, null, 2)}</pre>
							{canContinue && (
								<Button
									onClick={() =>
										onContinue(
											step.branches.find((branch) => {
												const path = branch.when.path.split(".");
												let value: unknown = output;
												for (const part of path)
													value =
														value &&
														typeof value === "object" &&
														Object.hasOwn(value, part)
															? (value as Record<string, unknown>)[part]
															: undefined;
												return (
													JSON.stringify(value) ===
													JSON.stringify(branch.when.equals)
												);
											})?.next ?? fallback,
										)
									}
								>
									Continue
								</Button>
							)}
						</div>
					)}
					<button
						className="link"
						type="button"
						onClick={() => setAccepted(undefined)}
					>
						Reset item simulation
					</button>
				</>
			)}
			{failure && (
				<p className="error" role="alert">
					{failure}
				</p>
			)}
		</div>
	);
}
