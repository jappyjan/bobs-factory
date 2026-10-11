// Source-level F1 for the maintained native dashboard probes. No candidate build,
// native service, live agent, signed receipt or packaged runtime claim.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	assertLocalDashboard,
	assertRemoteDenied,
} from "../../../desktop/test/dashboard-access.mjs";

const source = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const port = Number(process.env.F1_NATIVE_DASHBOARD_PORT ?? 3641);
const publicOrigin = "https://factory-smoke.example.invalid";
const until = async (check) => {
	const deadline = Date.now() + 20000;
	while (!(await check())) {
		assert(Date.now() < deadline, "Native dashboard fixture wait timed out");
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
};
void (async () => {
	if (process.versions.electron) {
		const { app, BrowserWindow, ipcMain } = await import("electron");
		const root = process.env.F1_NATIVE_DASHBOARD_DIRECTORY;
		app.setPath("userData", join(root, "electron-profile"));
		let invoked = 0;
		ipcMain.handle("desktop-open-updates", () => {
			invoked++;
		});
		try {
			await app.whenReady();
			const dashboard = new BrowserWindow({
				show: false,
				webPreferences: {
					nodeIntegration: false,
					contextIsolation: true,
					sandbox: true,
					preload: join(source, "apps/desktop/src/dashboard-preload.cjs"),
				},
			});
			await dashboard.loadURL(`http://localhost:${port}`);
			// Reproduce the stale local ceremony assertion against the real rendered UI.
			const originalPrompt = await dashboard.webContents.executeJavaScript(
				"Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Create passkey'&&!b.disabled)",
			);
			assert.equal(originalPrompt, false);
			const { factoryRuntimeIdentity } = await import(
				"../../../../packages/core/dist/runtime-identity.js"
			);
			await assertLocalDashboard(dashboard, until, factoryRuntimeIdentity);
			await assertRemoteDenied(port, publicOrigin);
			await dashboard.webContents.executeJavaScript(
				"window.factoryDesktop.openAppUpdates()",
			);
			assert.equal(
				invoked,
				1,
				"Actual preload invokes the scoped fixture IPC handler",
			);
			const logout = await dashboard.webContents.executeJavaScript(
				"fetch('/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json','X-Factory-Request':'1'},body:'{}'}).then(async r=>({status:r.status,body:await r.json()}))",
			);
			assert.equal(logout.status, 200);
			assert.equal(logout.body.authenticated, true);
			await dashboard.loadURL(`http://localhost:${port}`);
			await assertLocalDashboard(dashboard, until, factoryRuntimeIdentity);
			writeFileSync(
				join(root, "electron.json"),
				`${JSON.stringify(
					{
						passed: true,
						electron: process.versions.electron,
						originalPrompt,
						runtime: factoryRuntimeIdentity,
						checks: [
							"actual onboarding UI and no-cookie local API/identity",
							"isolated preload bridge invokes controlled IPC",
							"public Host401 and foreign/cross-site/forwarded403",
							"logout/reload preserves local authority",
						],
						scope:
							"source FactoryServer + actual Electron; controlled IPC handler; no packaged worker/menu lifecycle",
					},
					null,
					2,
				)}\n`,
			);
			dashboard.destroy();
			app.exit(0);
		} catch (error) {
			console.error(error);
			app.exit(1);
		}
	} else {
		assert.equal(process.env.F1_AGENT_MODE, "mock");
		const root = mkdtempSync(join(tmpdir(), "f1-native-dashboard-validation-"));
		process.env.PATH = "/usr/bin:/bin";
		const { FactoryServer } = await import(
			"../../../../packages/edge-worker/dist/factory/FactoryServer.js"
		);
		const { WorkflowRuntime } = await import(
			"../../../../packages/edge-worker/dist/factory/WorkflowRuntime.js"
		);
		const { factoryAccess } = await import(
			"../../../../packages/edge-worker/dist/factory/FactoryAuth.js"
		);
		const { LocalOnboarding } = await import(
			"../../../../apps/cli/dist/src/onboarding.js"
		);
		const runtime = new WorkflowRuntime(root, {
			agent: async () => {
				throw Error("No agents authorized");
			},
			script: async () => ({}),
			tool: async () => ({}),
		});
		const onboarding = new LocalOnboarding(root, async () => {
			throw Error("No project mutation in probe fixture");
		});
		const server = new FactoryServer(
			runtime,
			{
				onboarding,
				repositories: () => [],
				sessions: () => [],
				entries: () => [],
				start: async () => {
					throw Error("No work starts in probe fixture");
				},
				stop: (id) => runtime.stop(id),
			},
			factoryAccess(port, publicOrigin),
		);
		const run = (exe, args) =>
			new Promise((resolveRun, reject) => {
				const env = {
					...process.env,
					HOME: root,
					F1_NATIVE_DASHBOARD_DIRECTORY: root,
				};
				delete env.ELECTRON_RUN_AS_NODE;
				const child = spawn(exe, args, {
					env,
					stdio: ["ignore", "pipe", "pipe"],
				});
				let stdout = "",
					stderr = "";
				child.stdout.on("data", (bytes) => {
					stdout += bytes;
				});
				child.stderr.on("data", (bytes) => {
					stderr += bytes;
				});
				const timer = setTimeout(() => child.kill("SIGKILL"), 45000);
				child.on("error", reject);
				child.on("close", (code) => {
					clearTimeout(timer);
					resolveRun({ code, stdout, stderr });
				});
			});
		try {
			await server.start(port);
			const original = await run("/bin/bash", [
				"-c",
				'status=$(curl -sS -o /dev/null -w "%{http_code}" "$1/api/config"); echo "Original native assertion: expected401, actual$status"; [[ "$status" == 401 ]]',
				"fixture",
				`http://localhost:${port}`,
			]);
			assert.equal(original.code, 1);
			writeFileSync(
				join(root, "original-binary-assertion.json"),
				`${JSON.stringify(original, null, 2)}\n`,
			);
			const shell = await run("/bin/bash", [
				"-c",
				'set -euo pipefail; source "$1"; check_dashboard_access "$2" "$3" "$4"',
				"fixture",
				join(source, "scripts/lib/smoke-dashboard-access.sh"),
				`http://localhost:${port}`,
				new URL(publicOrigin).host,
				root,
			]);
			assert.equal(shell.code, 0, shell.stderr || shell.stdout);
			writeFileSync(
				join(root, "shell-probes.json"),
				`${JSON.stringify(shell, null, 2)}\n`,
			);
			const electron = process.env.BOBS_FACTORY_TEST_ELECTRON;
			assert(
				electron,
				"Provide retained actual Electron executable; no auto-installer lookup",
			);
			const observed = await run(electron, [fileURLToPath(import.meta.url)]);
			writeFileSync(
				join(root, "electron-process.json"),
				`${JSON.stringify(observed, null, 2)}\n`,
			);
			assert.equal(observed.code, 0, observed.stderr || observed.stdout);
			console.log(
				JSON.stringify(
					{
						passed: true,
						fixture: root,
						original,
						electron: JSON.parse(readFileSync(join(root, "electron.json"))),
						checks: [
							"old401 assertion reproduced against real loopback200",
							"same maintained OS curl probes pass on real FactoryServer",
							"same maintained actual Electron dashboard assertions pass",
						],
						scope:
							"source assertion correction only; packaged startup/MCP/menu/service/native all4 remain next-candidate gates",
					},
					null,
					2,
				),
			);
		} finally {
			await server.stop();
			await runtime.shutdown();
		}
	}
})().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
