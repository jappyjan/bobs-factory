import assert from "node:assert/strict";

export const properties = (text) =>
	Object.fromEntries(
		text
			.trim()
			.split("\n")
			.map((line) => {
				const at = line.indexOf("=");
				return [line.slice(0, at), line.slice(at + 1)];
			}),
	);
export const terminal = (p) =>
	/^(inactive|failed)$/.test(p.ActiveState) &&
	/^(dead|failed)$/.test(p.SubState) &&
	p.MainPID === "0" &&
	p.ControlPID === "0" &&
	(p.Job === "" || p.Job === "0");

export function startLimitEvidence(unit, p, journal) {
	if (
		!terminal(p) ||
		p.StartLimitBurst !== "3" ||
		p.StartLimitIntervalUSec !== "2min" ||
		p.RestartUSec !== "10s" ||
		!/^\d+$/.test(p.NRestarts) ||
		Number(p.NRestarts) < 3
	)
		return false;
	return journal
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line))
		.some(
			(event) =>
				(event.USER_UNIT === unit || event._SYSTEMD_USER_UNIT === unit) &&
				/Start request repeated too quickly\./.test(event.MESSAGE),
		);
}

// Reject genuine manager errors. Only an explicit unloaded/stopped race may be
// tolerated, and only after independent terminal-state verification.
export async function stopOwnedUnit({
	unit,
	manager,
	verifyDefinition,
	until,
}) {
	const exists = verifyDefinition();
	const state = async () =>
		properties(
			await manager(
				"show",
				unit,
				"--property=ActiveState,SubState,MainPID,ControlPID,Job",
			),
		);
	const operation = async (...args) => {
		try {
			await manager(...args);
		} catch (error) {
			if (
				!/not loaded|not running|not found|does not exist/i.test(
					`${error.stderr}\n${error.message}`,
				) ||
				!terminal(await state())
			)
				throw error;
		}
	};
	if (exists) await manager("disable", unit);
	// stop also replaces queued start/restart jobs for this exact unit.
	if (!terminal(await state())) await operation("stop", "--no-block", unit);
	try {
		await until(
			async () => terminal(await state()),
			"owned unit terminal",
			2000,
		);
	} catch (error) {
		if (!/^Timed out:/.test(error.message)) throw error;
		verifyDefinition();
		await operation("kill", "--kill-whom=all", "--signal=SIGKILL", unit);
		await operation("stop", "--no-block", unit);
		await until(
			async () => terminal(await state()),
			"forced owned unit terminal",
			2000,
		);
	}
	assert(
		terminal(await state()),
		"Owned unit has a process or queued manager job",
	);
}
