type RunOutputView = {
	outputs?: Record<string, any>;
	outputRoles?: Record<string, string>;
	mergeReadiness?: unknown;
};

/** New views declare role bindings; older cached views retain their presentation aliases. */
export function roleOutputKey(
	run: RunOutputView,
	role: string,
): string | undefined {
	return Object.hasOwn(run, "outputRoles") ? run.outputRoles?.[role] : role;
}

export function roleOutput(run: RunOutputView, role: string): any {
	const key = roleOutputKey(run, role);
	return key ? run.outputs?.[key] : undefined;
}

/** Live polling owns readiness; configured receipts are compatibility fallbacks. */
export function mergeReadinessFor(run: RunOutputView): any {
	return (
		run.mergeReadiness ??
		roleOutput(run, "merge-readiness") ??
		roleOutput(run, "ci")
	);
}
