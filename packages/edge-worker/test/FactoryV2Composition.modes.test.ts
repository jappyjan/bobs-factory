import { expect, it } from "vitest";
import { drive, fixture } from "./fixtures/factory-v2-composition.js";

it.each([
	"repository",
	"external",
	"mixed",
	"deferred",
])("runs the full Factory %s composition with scripted agents and provider", async (mode) => {
	const f = fixture(mode);
	await drive(f, { restart: mode === "mixed" });
	expect(f.run.status, f.run.error).toBe("completed");
	if (mode === "repository" || mode === "mixed") {
		expect(f.provider.merge).toHaveBeenCalledOnce();
		expect(f.visits).toContain(
			"review/specialist-review/5/requirements-review",
		);
	} else expect(f.provider.merge).not.toHaveBeenCalled();
	if (mode === "external" || mode === "mixed")
		expect((await f.ticket.read()).title).toBe("Applied");
	expect((await f.ticket.read()).state?.type).toBe(
		mode === "deferred" ? "started" : "completed",
	);
	expect(f.setStatus).toHaveBeenCalledTimes(mode === "deferred" ? 0 : 1);
}, 180000);
