import { execFile, spawn } from "node:child_process";
import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	readlinkSync,
	realpathSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
	app,
	BrowserWindow,
	dialog,
	ipcMain,
	Menu,
	session,
	shell,
} from "electron";
import { appUpdates } from "./app-updates.mjs";
import {
	allowedNavigation,
	connectionOrigin,
	connectionPartition,
	externalLink,
} from "./contracts.mjs";
import { desktopPath } from "./desktop-path.mjs";
import { desktopExecutable, workerStartupFailure } from "./local-runtime.mjs";

const source = dirname(fileURLToPath(import.meta.url));
const launcherUrl = pathToFileURL(join(source, "launcher.html")).href;
let home =
	process.env.BOBS_FACTORY_DESKTOP_HOME ?? join(homedir(), ".bobs-factory");
const binary =
	process.env.BOBS_FACTORY_DESKTOP_BINARY ??
	join(process.resourcesPath, "runtime", "bobs-factory");
const port = Number(process.env.BOBS_FACTORY_DESKTOP_PORT ?? 3457);
let window,
	launcher,
	selected,
	quitting = false;
let runtimeBinary = binary;
let shellUpdates;
const runRuntime = promisify(execFile);
// One application process; the worker also independently locks its canonical home.
if (!app.requestSingleInstanceLock()) app.quit();
else {
	app.on("second-instance", () => show());
	app.on("window-all-closed", () => {});
	app.on("before-quit", () => {
		quitting = true;
	});
	app.on("activate", () => show());
	app
		.whenReady()
		.then(async () => {
			const path = await desktopPath();
			if (path !== undefined) process.env.PATH = path;
			if (
				process.platform === "darwin" &&
				process.env.BOBS_FACTORY_WEBAUTHN_ACCESS_GROUP
			)
				app.configureWebAuthn({
					touchID: {
						keychainAccessGroup: process.env.BOBS_FACTORY_WEBAUTHN_ACCESS_GROUP,
						promptReason: "sign in to $1",
					},
				});
			const identityFile = join(process.resourcesPath, "desktop-identity.json");
			if (app.isPackaged && existsSync(identityFile)) {
				mkdirSync(home, { recursive: true, mode: 0o700 });
				home = realpathSync(home);
				const identity = JSON.parse(readFileSync(identityFile, "utf8"));
				const installPath =
					process.platform === "darwin"
						? dirname(dirname(dirname(process.execPath)))
						: (process.env.APPIMAGE ?? process.execPath);
				const install = join(
					realpathSync(dirname(installPath)),
					basename(installPath),
				);
				shellUpdates = await appUpdates({
					home,
					install,
					target: `${process.platform}-${process.arch}`,
					identity,
					port,
					sourceDirectory: source,
					services: await import("./update-services.mjs"),
				});
				setInterval(() => {
					if (shellUpdates.quitRequested()) app.quit();
				}, 100);
				{
					const tick = () =>
						shellUpdates
							.tick()
							.catch((error) =>
								console.error("Desktop update:", error.message),
							);
					void tick();
					setInterval(tick, 60_000);
				}
			}
			installMenu();
			showLauncher();
		})
		.catch((error) =>
			dialog.showErrorBox("Factory launch failed", error.message),
		);
}
function owner() {
	const p = join(home, "runtime", "worker.lock");
	let value;
	try {
		value = readlinkSync(p);
	} catch (error) {
		if (error.code === "ENOENT") return null;
		throw error;
	}
	const o = JSON.parse(value);
	if (
		o.schema !== 1 ||
		o.home !== realpathSync(home) ||
		!Number.isInteger(o.pid) ||
		typeof o.nonce !== "string"
	)
		throw new Error(
			"Invalid local worker ownership; reconcile through the CLI",
		);
	return o;
}
function protect(win, origin) {
	win.webContents.setWindowOpenHandler(({ url }) => {
		if (externalLink(url)) void shell.openExternal(url);
		return { action: "deny" };
	});
	win.webContents.on("will-navigate", (event, url) => {
		if (!allowedNavigation(url, origin)) event.preventDefault();
	});
	win.webContents.on("will-redirect", (event, url) => {
		if (!allowedNavigation(url, origin)) event.preventDefault();
	});
	win.on("close", (event) => {
		if (!quitting) {
			event.preventDefault();
			win.hide();
		}
	});
}
function show() {
	if (window && !window.isDestroyed()) {
		window.show();
		window.focus();
	} else showLauncher();
}
function showLauncher() {
	if (launcher && !launcher.isDestroyed()) {
		launcher.show();
		launcher.focus();
		return;
	}
	launcher = new BrowserWindow({
		width: 760,
		height: 640,
		title: "Bob's Factory",
		webPreferences: {
			nodeIntegration: false,
			contextIsolation: true,
			sandbox: true,
			preload: join(source, "preload.cjs"),
			partition: "launcher",
		},
	});
	launcher.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
	launcher.webContents.on("will-navigate", (event, url) => {
		if (url !== launcherUrl) event.preventDefault();
	});
	void launcher.loadURL(launcherUrl).then(() => {
		if (process.env.BOBS_FACTORY_DESKTOP_HEALTH)
			shellUpdates?.health(process.env.BOBS_FACTORY_DESKTOP_HEALTH);
	});
}
ipcMain.handle("launcher-connect", async (event, remote) => {
	if (
		!launcher ||
		event.sender !== launcher.webContents ||
		event.senderFrame !== launcher.webContents.mainFrame ||
		event.senderFrame.url !== launcherUrl
	)
		throw new Error("Unauthorized launcher request");
	if (remote !== null && typeof remote !== "string")
		throw new Error("Invalid connection");
	const origin = remote === null ? await local() : connectionOrigin(remote);
	selected = { origin, local: remote === null };
	await openDashboard(origin);
	launcher.hide();
});
ipcMain.handle("launcher-updates", async (event, action, input, revision) => {
	if (
		!launcher ||
		event.sender !== launcher.webContents ||
		event.senderFrame !== launcher.webContents.mainFrame ||
		event.senderFrame.url !== launcherUrl
	)
		throw new Error("Unauthorized desktop settings request");
	if (!shellUpdates)
		return {
			unavailable:
				"App updates require an installed candidate; checkout UI is externally managed.",
		};
	return action === "status"
		? shellUpdates.status()
		: shellUpdates.action(action, input, revision);
});
async function local() {
	if (!Number.isInteger(port) || port < 1 || port >= 65535)
		throw new Error("Invalid local dashboard port");
	mkdirSync(home, { recursive: true, mode: 0o700 });
	const current = owner();
	if (current && current.dashboardPort !== port)
		throw new Error(
			`Existing Factory uses port ${current.dashboardPort}. Set the local desktop port to attach`,
		);
	if (!current) {
		if (existsSync(join(home, "runtime", "update-owner.json")))
			throw new Error(
				"This instance is in update maintenance. Reconnect after verified replacement/recovery",
			);
		if (existsSync(join(home, "runtime", "worker.lock")))
			throw new Error(
				"Interrupted worker ownership; use CLI reconciliation before starting",
			);
		if (existsSync(join(home, "runtime", "service.json")))
			throw new Error(
				"This home is service-owned. Start it through service controls and reconnect",
			);
		if (!existsSync(binary))
			throw new Error("Packaged Factory runtime is missing");
		const { compareReleaseVersions } = await import("./update-services.mjs");
		runtimeBinary = desktopExecutable(home, dirname(binary), {
			compareVersions: compareReleaseVersions,
		});
		await runRuntime(runtimeBinary, [
			"--home",
			home,
			"service",
			"allow-desktop-start",
		]);
		mkdirSync(join(home, "runtime"), { recursive: true, mode: 0o700 });
		const logFile = join(home, "runtime", "desktop-worker.log");
		const logOffset = existsSync(logFile) ? statSync(logFile).size : 0;
		const log = openSync(logFile, "a", 0o600);
		const child = spawn(
			runtimeBinary,
			["--home", home, "--port", String(port), "--no-open"],
			{
				detached: true,
				cwd: home,
				stdio: ["ignore", log, log],
				env: { ...process.env, BOBS_FACTORY_DESKTOP_OWNER: "1" },
			},
		);
		closeSync(log);
		child.unref();
		// A worker that dies while starting must fail the launch now, with its
		// own output, instead of surfacing as a generic connection timeout.
		const failed = new Promise((_, reject) => {
			child.once("error", reject);
			child.once("exit", (code, signal) =>
				reject(
					new Error(
						workerStartupFailure(
							logFile,
							logOffset,
							`Factory stopped while starting (${signal ?? `exit code ${code}`}).`,
						),
					),
				),
			);
		});
		await Promise.race([
			waitForFactory().catch((error) => {
				throw new Error(
					workerStartupFailure(logFile, logOffset, error.message),
				);
			}),
			failed,
		]);
	} else {
		if (existsSync(join(home, "runtime", "desktop-runtime.json")))
			runtimeBinary = JSON.parse(
				readFileSync(join(home, "runtime", "desktop-runtime.json"), "utf8"),
			).executable;
		await waitForFactory();
	}

	const log = openSync(
		join(home, "runtime", "desktop-updates.log"),
		"a",
		0o600,
	);
	const supervisor = spawn(
		runtimeBinary,
		[
			"--home",
			home,
			"--port",
			String(port),
			"--no-open",
			"service",
			"updates-run",
		],
		{
			detached: true,
			cwd: home,
			stdio: ["ignore", log, log],
			env: { ...process.env, BOBS_FACTORY_DESKTOP_OWNER: "1" },
		},
	);
	supervisor.on("error", (error) =>
		dialog.showErrorBox("Update supervisor failed", error.message),
	);
	supervisor.unref();
	closeSync(log);
	return `http://localhost:${port}`;
}
async function waitForFactory() {
	for (let attempt = 0; attempt < 100; attempt++) {
		try {
			const response = await fetch(`http://localhost:${port}/api/auth/status`, {
				signal: AbortSignal.timeout(500),
			});
			const value = await response.json();
			const current = owner();
			if (
				response.ok &&
				value.origin === `http://localhost:${port}` &&
				current
			) {
				process.kill(current.pid, 0);
				return;
			}
		} catch {}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	throw new Error(
		"Factory did not become ready. Inspect runtime/desktop-worker.log; existing services may use a different port",
	);
}
ipcMain.handle("desktop-open-updates", (event) => {
	if (
		!window ||
		event.sender !== window.webContents ||
		event.senderFrame !== window.webContents.mainFrame ||
		new URL(event.senderFrame.url).origin !== selected?.origin
	)
		throw Error("Unauthorized dashboard request");
	showLauncher();
});
async function openDashboard(origin) {
	if (window && !window.isDestroyed()) window.destroy();
	const partition = connectionPartition(origin);
	const isolated = session.fromPartition(partition);
	isolated.setPermissionRequestHandler((_wc, _permission, callback) =>
		callback(false),
	);
	isolated.setPermissionCheckHandler(() => false);
	window = new BrowserWindow({
		width: 1280,
		height: 850,
		minWidth: 640,
		title: "Bob's Factory",
		webPreferences: {
			partition,
			preload: join(source, "dashboard-preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			webSecurity: true,
			allowRunningInsecureContent: false,
		},
	});
	protect(window, origin);
	window.webContents.on("did-fail-load", (_event, code, description) => {
		if (code !== -3)
			dialog.showErrorBox(
				"Factory connection failed",
				`${description}\nUse Factory → Connect to retry.`,
			);
	});
	const versionResponse = await fetch(`${origin}/api/version`, {
		signal: AbortSignal.timeout(5000),
	});
	if (!versionResponse.ok)
		throw Error(
			"Factory version protocol is unavailable. Upgrade through that host's owner, then reconnect.",
		);
	const version = await versionResponse.json();
	if (version.protocol !== 1)
		throw Error(
			"This desktop cannot use that Factory dashboard protocol. Update the desktop app or the selected host explicitly.",
		);
	// The server supplies its own versioned dashboard, so same-protocol runtime and
	// shell versions may differ safely. Never swap its runtime to match this app.
	await window.loadURL(`${origin}/`);
}
async function stopLocal() {
	if (!selected?.local)
		throw new Error(
			"Select a local desktop-owned Factory. Remote and independent services are stopped by their owner",
		);
	if (existsSync(join(home, "runtime", "update-owner.json")))
		throw new Error(
			"An update owns maintenance; wait for completion or recovery before Stop",
		);
	const o = owner();
	if (
		!o ||
		o.owner !== "desktop" ||
		o.executable !== realpathSync(runtimeBinary)
	)
		throw new Error(
			"This worker is independently owned; use its service/foreground controls",
		);
	const { response } = await dialog.showMessageBox({
		type: "warning",
		buttons: ["Cancel", "Stop Factory"],
		defaultId: 0,
		cancelId: 0,
		message: "Stop the local Factory?",
		detail:
			"Running work is shut down through the normal worker lifecycle. Saved checkpoints remain in the same home. Closing the window keeps jobs running.",
	});
	if (response !== 1) return;
	await runRuntime(runtimeBinary, [
		"--home",
		home,
		"service",
		"stop-desktop",
		"--expected-nonce",
		o.nonce,
		"--executable",
		runtimeBinary,
	]);
	await dialog.showMessageBox({
		message: "Factory stopped. Open local Factory to start it again.",
	});
}
function installMenu() {
	Menu.setApplicationMenu(
		Menu.buildFromTemplate([
			{
				label: "Factory",
				submenu: [
					{ label: "Open Factory", click: show },
					{ label: "Connect…", click: showLauncher },
					{ label: "Desktop app updates…", click: showLauncher },
					{
						label: "Stop local Factory…",
						click: () =>
							stopLocal().catch((error) =>
								dialog.showErrorBox("Factory stop failed", error.message),
							),
					},
					{ type: "separator" },
					{ label: "Quit desktop UI", click: () => app.quit() },
				],
			},
			{ role: "editMenu" },
			{ role: "viewMenu" },
			{ role: "windowMenu" },
		]),
	);
}
