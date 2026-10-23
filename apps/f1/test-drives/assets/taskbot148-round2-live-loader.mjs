// Source-only local fixture loader; Vite's middleware/watchers close after import.
import { createRequire } from "node:module";
import { resolve } from "node:path";
const require = createRequire(resolve("packages/edge-worker/node_modules/vitest/package.json"));
const { createServer } = await import(require.resolve("vite"));
const loader = await createServer({ configFile: resolve("apps/f1/test-drives/assets/taskbot148-diagnostics/vitest.config.ts"), server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom" });
try { await loader.ssrLoadModule(resolve("apps/f1/test-drives/assets/taskbot148-round2-live-timing.mts")); }
finally { await loader.close(); }
