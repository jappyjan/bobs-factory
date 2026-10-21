import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bootstrap = vi.hoisted(() => ({ calls: [] as string[], packaged: true }));
vi.mock("bobs-factory-edge-worker/dist/factory/InlineSchemaChild.js", () => ({
	runInlineSchemaChild: async () => {
		bootstrap.calls.push("validator");
	},
}));
vi.mock("./github.js", () => ({
	gitCredential: async (operation: string) => {
		bootstrap.calls.push(`credential:${operation}`);
	},
}));

const argv = process.argv;
const executable = process.env.BOBS_FACTORY_INTERNAL_EXECUTABLE;
beforeEach(() => {
	vi.resetModules();
	vi.doMock("reflect-metadata", () => {
		bootstrap.calls.push("reflect");
		return {};
	});
	vi.doMock("bobs-factory-core", () => {
		bootstrap.calls.push("core");
		return { isPackagedExecutable: bootstrap.packaged };
	});
	bootstrap.calls.length = 0;
	bootstrap.packaged = true;
	process.env.BOBS_FACTORY_INTERNAL_EXECUTABLE = "inherited-parent";
});
afterEach(() => {
	process.argv = argv;
	if (executable === undefined)
		delete process.env.BOBS_FACTORY_INTERNAL_EXECUTABLE;
	else process.env.BOBS_FACTORY_INTERNAL_EXECUTABLE = executable;
});

describe("CLI bootstrap dispatch", () => {
	it("runs the isolated validator without initializing the application", async () => {
		process.argv = [process.execPath, "app.js", "internal-schema-validator"];
		await import("./app.js");
		expect(bootstrap.calls).toEqual(["validator"]);
		expect(process.env.BOBS_FACTORY_INTERNAL_EXECUTABLE).toBe(
			"inherited-parent",
		);
	});

	it.each([
		true,
		false,
	])("initializes normal helpers with executable ownership (packaged=%s)", async (packaged) => {
		bootstrap.packaged = packaged;
		process.argv = [process.execPath, "app.js", "git-credential", "store"];
		await import("./app.js");
		expect(bootstrap.calls).toEqual(["reflect", "core", "credential:store"]);
		expect(process.env.BOBS_FACTORY_INTERNAL_EXECUTABLE).toBe(
			packaged ? process.execPath : undefined,
		);
	});
});
