// Focused source aliases avoid unrelated package/native builds for this mocked drive.
import { readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { mergeConfig } from "vitest/config";
import base from "../../../../../packages/edge-worker/vitest.config.ts";
const root = resolve(import.meta.dirname, "../../../../..");
const alias = Object.fromEntries(readdirSync(resolve(root, "packages")).filter(name => name !== "core" && existsSync(resolve(root, "packages", name, "src/index.ts"))).map(name => [`bobs-factory-${name}`, resolve(root, "packages", name, "src/index.ts")]));
export default mergeConfig(base, { root: resolve(root, "packages/edge-worker"), resolve: { alias }, test: { include: ["test/RunDiagnostics.test.ts", "test/DiagnosticsF1.test.ts", "test/FactoryRolePrompts.test.ts"] } });
