// Actual Electron shell + native local runtime; local authority and remote denial, no provider.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readlinkSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app, BrowserWindow, dialog, Menu } from "electron";
import {
	assertLocalDashboard,
	assertRemoteDenied,
} from "./dashboard-access.mjs";
import { writeNativeReceipt } from "./native-receipt-output.mjs";

if (process.platform === "linux") app.disableHardwareAcceleration();
const root = mkdtempSync(join(tmpdir(), "factory-electron-smoke-"));
let preparedBin;
if (process.platform === "darwin") {
	preparedBin = join(root, "prepared tools");
	mkdirSync(preparedBin);
	writeFileSync(
		join(root, ".zshrc"),
		'printf "shell startup banner\\n"\nexport PATH="$ZDOTDIR/prepared tools:$PATH"\n',
	);
	process.env.ZDOTDIR = root;
	process.env.SHELL = "/bin/zsh";
	process.env.PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
}
process.env.BOBS_FACTORY_DESKTOP_HOME = join(root, "home");
process.env.BOBS_FACTORY_DESKTOP_PORT = "3973";
const publicOrigin = "https://factory-smoke.example.invalid";
process.env.BOBS_FACTORY_FACTORY_ORIGIN = publicOrigin;
if (!process.env.BOBS_FACTORY_DESKTOP_BINARY)
	throw new Error("Provide a matching native runtime binary");
app.setPath("userData", join(root, "profile"));
dialog.showErrorBox = (title, message) => {
	throw new Error(`${title}: ${message}`);
};
dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
let workerPid;
let reportedError;
let screenshotUnavailable;
dialog.showErrorBox = (title, message) => {
	reportedError = `${title}: ${message}`;
};
const until = async (check) => {
	const deadline = Date.now() + 15000;
	while (!(await check())) {
		assert.ok(Date.now() < deadline, "Native fixture wait timed out");
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
};
void (async () => {
	try {
		await import("../src/main.mjs");
		await app.whenReady();
		await until(() => BrowserWindow.getAllWindows().length === 1);
		const launcher = BrowserWindow.getAllWindows()[0];
		await until(() => !launcher.webContents.isLoading());
		await launcher.webContents.executeJavaScript(
			"window.factoryLauncher.connect(null)",
		);
		const dashboard = BrowserWindow.getAllWindows().find((w) => w !== launcher);
		assert.ok(dashboard);
		const getOwner = () =>
			JSON.parse(
				readlinkSync(
					join(process.env.BOBS_FACTORY_DESKTOP_HOME, "runtime", "worker.lock"),
				),
			);
		workerPid = getOwner().pid;
		assert.equal(getOwner().owner, "desktop");
		assert.equal(
			await dashboard.webContents.executeJavaScript("typeof require"),
			"undefined",
		);
		assert.equal(
			await dashboard.webContents.executeJavaScript(
				"typeof window.factoryLauncher",
			),
			"undefined",
		);
		const identity = JSON.parse(
			readFileSync(
				join(process.env.BOBS_FACTORY_DESKTOP_BINARY, "..", "build.json"),
				"utf8",
			),
		);
		await assertLocalDashboard(dashboard, until, {
			...identity,
			packaged: true,
		});
		await assertRemoteDenied(
			Number(process.env.BOBS_FACTORY_DESKTOP_PORT),
			publicOrigin,
		);
		await dashboard.webContents.executeJavaScript(
			"window.factoryDesktop.openAppUpdates()",
		);
		assert.equal(launcher.isVisible(), true);
		launcher.hide();
		try {
			const screenshot = await dashboard.webContents.capturePage();
			writeFileSync(join(root, "onboarding.png"), screenshot.toPNG());
		} catch (error) {
			if (process.platform !== "linux" || error.message !== "UnknownVizError")
				throw error;
			screenshotUnavailable =
				"Xvfb compositor UnknownVizError; local-authority DOM and native menu checks continue";
		}
		dashboard.close();
		assert.equal(dashboard.isDestroyed(), false);
		assert.equal(dashboard.isVisible(), false);
		process.kill(workerPid, 0);
		const menu = Menu.getApplicationMenu();
		menu.items[0].submenu.items.find((i) => i.label === "Open Factory").click();
		assert.equal(dashboard.isVisible(), true);
		assert.equal(getOwner().pid, workerPid);
		const logout = await dashboard.webContents.executeJavaScript(
			"fetch('/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json','X-Factory-Request':'1'},body:'{}'}).then(async r=>({status:r.status,body:await r.json()}))",
		);
		assert.equal(logout.status, 200);
		assert.equal(logout.body.authenticated, true);
		await dashboard.webContents.executeJavaScript("location.reload()");
		await until(() => !dashboard.webContents.isLoading());
		await assertLocalDashboard(dashboard, until, {
			...identity,
			packaged: true,
		});
		await assertRemoteDenied(
			Number(process.env.BOBS_FACTORY_DESKTOP_PORT),
			publicOrigin,
		);
		// Hold the real menu confirmation while the external owner admits maintenance.
		const { OwnedUpdateLifecycle } = await import(
			"../../cli/dist/src/services/OwnedUpdateLifecycle.js"
		);
		const { UpdateManager } = await import(
			"../../../packages/edge-worker/dist/updates/UpdateManager.js"
		);
		class ConfirmationLifecycle extends OwnedUpdateLifecycle {
			// prepare() now verifies the candidate before maintenance. This fixture's
			// candidate is synthetic and is never activated, so skip its identity proof
			// and reach the maintenance admission this menu race is about.
			async prepare() {
				return { migration: null };
			}
			async isIdle() {
				await super.isIdle();
				confirm({ response: 1 });
				await until(() => reportedError);
				// Busy observations now retain admission closed until work drains.
				// Cancel this controlled candidate after proving the menu race;
				// returning false alone would deliberately wait forever.
				manager.configure({ paused: true }, manager.status().revision);
				return false; // No native replacement in this menu fixture.
			}
		}
		const lifecycle = new ConfirmationLifecycle(
			process.env.BOBS_FACTORY_DESKTOP_HOME,
			Number(process.env.BOBS_FACTORY_DESKTOP_PORT),
		);
		// Own only this fixture's exact external supervisor while a controlled source is selected.
		const supervisorLock = join(
			lifecycle.home,
			"runtime",
			"update-supervisor.lock",
		);
		const supervisorRecord = () => {
			try {
				return JSON.parse(readlinkSync(supervisorLock));
			} catch (error) {
				if (error.code === "ENOENT") return;
				throw error;
			}
		};
		await until(() => supervisorRecord());
		const supervisorOwner = supervisorRecord();
		const { ownerAlive, workerOwner } = await import(
			"../../cli/dist/src/services/InstanceLock.js"
		);
		assert.equal(supervisorOwner.home, lifecycle.home);
		assert.equal(
			supervisorOwner.executable,
			realpathSync(lifecycle.runtimeLink),
		);
		assert.equal(supervisorOwner.owner, "desktop");
		assert(ownerAlive(supervisorOwner));
		if (preparedBin) {
			for (const pid of [workerPid, supervisorOwner.pid]) {
				const command = execFileSync(
					"/bin/ps",
					["eww", "-p", String(pid), "-o", "command="],
					{ encoding: "utf8" },
				);
				assert.ok(command.includes(` PATH=${process.env.PATH} `));
			}
			assert.equal(process.env.PATH.split(":")[0], preparedBin);
		}
		process.kill(supervisorOwner.pid, "SIGTERM");
		await until(() => !supervisorRecord());
		const candidate = {
			...identity,
			version: "9.0.0-nightly.20261010.1",
			channel: "nightly",
			manifestSha256: "a".repeat(64),
			publishedAt: new Date().toISOString(),
		};
		const manager = new UpdateManager(
			process.env.BOBS_FACTORY_DESKTOP_HOME,
			{
				discover: async () => candidate,
				stage: async () => ({
					candidate,
					executable: realpathSync(process.env.BOBS_FACTORY_DESKTOP_BINARY),
					previousExecutable: realpathSync(
						process.env.BOBS_FACTORY_DESKTOP_BINARY,
					),
				}),
			},
			lifecycle,
			identity,
		);
		manager.configure(
			{ channel: "nightly", policy: "idle-auto" },
			manager.status().revision,
		);
		await manager.check();
		await manager.stage();
		let confirm, entered;
		const shown = new Promise((resolve) => {
			entered = resolve;
		});
		dialog.showMessageBox = async (options) => {
			if (!options.buttons) return { response: 0 };
			entered();
			return new Promise((resolve) => {
				confirm = resolve;
			});
		};
		menu.items[0].submenu.items
			.find((i) => i.label === "Stop local Factory…")
			.click();
		await shown;
		const postponed = await manager.reconcile();
		assert.equal(postponed.transaction.phase, "cancelled");
		assert.match(reportedError, /maintenance/);
		assert.equal(getOwner().pid, workerPid);
		assert.equal(
			existsSync(
				join(
					process.env.BOBS_FACTORY_DESKTOP_HOME,
					"runtime",
					"desktop-stopped.json",
				),
			),
			false,
		);

		reportedError = undefined;
		let stopReported = false;
		dialog.showMessageBox = async (options) => {
			if (
				options.message ===
				"Factory stopped. Open local Factory to start it again."
			)
				stopReported = true;
			return { response: 1 };
		};
		// Native menu confirms explicit Stop; UI close never did.
		menu.items[0].submenu.items
			.find((i) => i.label === "Stop local Factory…")
			.click();
		await until(() => {
			try {
				getOwner();
				return false;
			} catch (error) {
				return error.code === "ENOENT";
			}
		});
		await until(() => stopReported);
		workerPid = undefined;
		await assert.rejects(lifecycle.start(), /Deliberate Stop/);
		await lifecycle.restartCrashedDesktop();
		execFileSync(
			lifecycle.runtimeLink,
			[
				"--home",
				lifecycle.home,
				"--port",
				process.env.BOBS_FACTORY_DESKTOP_PORT,
				"service",
				"updates-run",
				"--once",
			],
			{ encoding: "utf8", timeout: 15000 },
		);
		assert.equal(workerOwner(lifecycle.home), undefined);
		writeNativeReceipt(
			{
				passed: true,
				platform: process.platform,
				arch: process.arch,
				electron: process.versions.electron,
				fixture: root,
				access:
					"direct localhost without cookies/passkeys; public Host401 and foreign Origin/cross-site/forwarded local403",
				localLogoutRetainsAuthority: true,
				dashboardBridgeIsolated: true,
				closedWindowKeepsWorker: true,
				reopenSamePid: true,
				preparedToolPathInherited: preparedBin ? true : "macOS only",
				explicitStop: true,
				confirmationMaintenanceRaceRejected: true,
				stopSuppressesAutomaticRestart: true,
				nativeCredentials: "not tested",
				screenshotUnavailable,
			},
			process.env.BOBS_FACTORY_NATIVE_ELECTRON_RECEIPT,
		);
		app.exit(0);
	} catch (error) {
		if (workerPid)
			try {
				process.kill(workerPid, "SIGTERM");
			} catch {}
		console.error(error);
		app.exit(1);
	}
})();
