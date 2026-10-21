import type { ForeachProgress } from "../Foreach";

export function ForeachRunProgress({
	progress,
}: {
	progress?: Record<string, ForeachProgress>;
}) {
	const iterations = Object.values(progress ?? {});
	if (!iterations.length) return null;
	return (
		<section className="foreach-run-progress" aria-label="For each progress">
			<h3>For each progress</h3>
			{iterations.map((iteration) => (
				<article key={iteration.key}>
					<div className="section-heading">
						<b>{iteration.key}</b>
						<span>
							{iteration.completed} of {iteration.total} completed
							{iteration.failed ? ` · ${iteration.failed} failed` : ""}
						</span>
					</div>
					<progress
						max={Math.max(1, iteration.total)}
						value={iteration.completed}
						aria-label={`${iteration.key} completed items`}
					/>
					<p className="muted">
						Visit {iteration.visit} · up to {iteration.concurrency} at once ·{" "}
						{iteration.failure === "keep-successful"
							? "Successful outputs retained; failures recorded as limitations"
							: "Every item must succeed"}
					</p>
					<ol className="foreach-items">
						{iteration.items.map((item) => (
							<li key={item.id} data-status={item.status}>
								<span>
									<b>{item.id}</b>
									<small>Index {item.index}</small>
								</span>
								<span className="chip">{item.status}</span>
								{item.error && <small>{item.error}</small>}
							</li>
						))}
					</ol>
				</article>
			))}
		</section>
	);
}
