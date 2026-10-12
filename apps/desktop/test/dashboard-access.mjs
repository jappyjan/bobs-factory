import assert from "node:assert/strict";
import { request } from "node:http";

// Shared by the actual native workflow fixture and its source-level F1 drive.
export async function assertLocalDashboard(dashboard, until, identity) {
	await until(() =>
		dashboard.webContents.executeJavaScript(
			"document.querySelector('.onboarding-card h1')?.textContent === 'Choose your project'",
		),
	);
	const observed = await dashboard.webContents.executeJavaScript(`(async () => {
		const get = async path => { const r = await fetch(path); return {status:r.status, body:await r.json()}; };
		return {
			config:await get('/api/config'), access:await get('/api/auth/status'), version:await get('/api/version'),
			require:typeof require, launcher:typeof window.factoryLauncher,
			bridge:Object.keys(window.factoryDesktop ?? {}), openUpdates:typeof window.factoryDesktop?.openAppUpdates,
			passkeyPrompt:Array.from(document.querySelectorAll('button')).some(b=>/Create passkey|Sign in with passkey/.test(b.textContent)),
			hash:location.hash
		};
	})()`);
	assert.equal(observed.config.status, 200);
	assert.equal(observed.config.body.onboarding.required, true);
	assert.equal(observed.access.status, 200);
	assert.equal(observed.access.body.access, "local");
	assert.equal(observed.access.body.authenticated, true);
	assert.equal(observed.access.body.setupRequired, false);
	assert.equal(observed.version.status, 200);
	assert.equal(observed.version.body.protocol, 1);
	for (const field of [
		"version",
		"commit",
		"dirty",
		"target",
		"resourceDigest",
		"packaged",
	])
		assert.equal(
			observed.version.body.runtime[field],
			identity[field],
			`Runtime identity ${field}`,
		);
	assert.equal(observed.require, "undefined");
	assert.equal(observed.launcher, "undefined");
	assert.deepEqual(observed.bridge, ["openAppUpdates"]);
	assert.equal(observed.openUpdates, "function");
	assert.equal(observed.passkeyPrompt, false);
	assert(!observed.hash.startsWith("#setup="));
	const cookies = await dashboard.webContents.session.cookies.get({
		url: dashboard.webContents.getURL(),
	});
	assert(
		!cookies.some((cookie) =>
			["factory-local-session", "__Host-factory-session"].includes(cookie.name),
		),
		"Local dashboard must work without a browser auth cookie",
	);
	return observed;
}

export async function assertRemoteDenied(port, publicOrigin) {
	const local = `http://localhost:${port}`;
	for (const [headers, status, code] of [
		[
			{ Host: new URL(publicOrigin).host, Origin: publicOrigin },
			401,
			"FACTORY_AUTH_REQUIRED",
		],
		[
			{ Host: `localhost:${port}`, Origin: "https://foreign.example.invalid" },
			403,
		],
		[{ Host: `localhost:${port}`, "Sec-Fetch-Site": "cross-site" }, 403],
		[
			{
				Host: `localhost:${port}`,
				Origin: local,
				"X-Forwarded-For": "203.0.113.1",
			},
			403,
		],
	]) {
		const result = await new Promise((resolve, reject) => {
			const req = request(
				{ hostname: "localhost", port, path: "/api/config", headers },
				(res) => {
					let body = "";
					res.on("data", (bytes) => {
						body += bytes;
					});
					res.on("end", () => {
						try {
							resolve({ status: res.statusCode, body: JSON.parse(body) });
						} catch (error) {
							reject(error);
						}
					});
				},
			);
			req.setTimeout(5000, () =>
				req.destroy(Error("Access boundary request timed out")),
			);
			req.on("error", reject);
			req.end();
		});
		assert.equal(result.status, status, JSON.stringify(headers));
		if (code) assert.equal(result.body.code, code);
		else assert.equal(typeof result.body.error, "string");
	}
}
