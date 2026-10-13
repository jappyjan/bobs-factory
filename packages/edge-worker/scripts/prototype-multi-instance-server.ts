// PROTOTYPE — throwaway fixture server for Taskbot bobs-factory#84 (multi instance).
// Serves the built Factory UI and mirrors READ-ONLY data from a real Factory
// (default http://127.0.0.1:3457), splitting its runs across three simulated
// instances. Every write is answered with a stub; nothing reaches the source.
//   bun packages/edge-worker/scripts/prototype-multi-instance-server.ts [--port 3557] [--source http://127.0.0.1:3457]
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { parseArgs } from "node:util";

const { values } = parseArgs({
	options: {
		port: { type: "string", default: "3557" },
		source: { type: "string", default: "http://127.0.0.1:3457" },
	},
});
const root = new URL("../dist/factory/web/", import.meta.url);
const { directory } = JSON.parse(
	readFileSync(new URL("current.json", root), "utf8"),
);
const buildRoot = new URL(`${directory}/`, root);
const shell = JSON.parse(
	readFileSync(new URL("shell.json", buildRoot), "utf8"),
);
const assets = new Map<string, { type: string; bytes: Buffer }>(
	shell.resources.map((r: any) => [
		r.path,
		{ type: r.type, bytes: readFileSync(new URL(r.file, buildRoot)) },
	]),
);

// Repository name → simulated instance. Unknown repos stay on this machine.
const instanceByRepo: Record<string, string> = {
	"Bob's Factory": "local",
	Attraccess: "homelab",
	"attraccess-homepage": "homelab",
	"service-worker-buster": "ci-box",
};
let repoInstance: Record<string, string> = {};
const minutesAgo = (n: number) =>
	new Date(Date.now() - n * 60000).toISOString();

// Fake "running" runs so Humming along is populated (source has none running).
const runningOverrides = new Map<string, any>();
// Two unsettled stuck runs live on the offline instance so its state is visible.
const offlineRuns = new Set<string>();
function patchRun(run: any) {
	const out = {
		...run,
		instanceId: offlineRuns.has(run.id)
			? "ci-box"
			: (repoInstance[run.repositoryId] ?? "local"),
	};
	const override = runningOverrides.get(run.id);
	return override ? { ...out, ...override } : out;
}

async function source(path: string) {
	const response = await fetch(new URL(path, values.source), {
		headers: { "X-Factory-Request": "1" },
	});
	return { response, body: Buffer.from(await response.arrayBuffer()) };
}
function send(
	res: any,
	status: number,
	type: string,
	body: Buffer | string,
	extra = {},
) {
	res.writeHead(status, {
		"Content-Type": type,
		"Cache-Control": "no-store",
		"X-Factory-Build": shell.build,
		...extra,
	});
	res.end(body);
}
const json = (res: any, data: unknown, status = 200) =>
	send(res, status, "application/json", JSON.stringify(data));

createServer(async (req, res) => {
	const url = new URL(req.url ?? "/", "http://x");
	try {
		if (!url.pathname.startsWith("/api/")) {
			const asset = assets.get(url.pathname);
			if (!asset) return send(res, 404, "text/plain", "Not found");
			return send(res, 200, asset.type, asset.bytes);
		}
		if (url.pathname === "/api/version")
			return json(res, { build: shell.build, protocol: shell.protocol });
		if (url.pathname === "/api/events") {
			res.writeHead(200, {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-store",
				"X-Factory-Build": shell.build,
				Connection: "keep-alive",
			});
			res.write("event: ready\ndata: {}\n\n");
			const beat = setInterval(() => res.write(": heartbeat\n\n"), 15000);
			req.on("close", () => clearInterval(beat));
			return;
		}
		if (req.method !== "GET" && req.method !== "HEAD") {
			// Writes are stubbed. Starting a run "returns" the first fake running run.
			if (url.pathname === "/api/runs")
				return json(res, {
					id: [...runningOverrides.keys()][0] ?? "prototype-run",
				});
			return json(res, { ok: true });
		}
		const { response, body } = await source(url.pathname + url.search);
		const type =
			response.headers.get("content-type") ?? "application/octet-stream";
		if (url.pathname === "/api/config" && response.ok) {
			const config = JSON.parse(body.toString());
			repoInstance = Object.fromEntries(
				config.repositories.map((r: any) => [
					r.id,
					instanceByRepo[r.name] ?? "local",
				]),
			);
			config.repositories = config.repositories.map((r: any) => ({
				...r,
				instanceId: repoInstance[r.id],
			}));
			return json(res, config);
		}
		if (url.pathname === "/api/runs" && response.ok) {
			if (!Object.keys(repoInstance).length)
				await source("/api/config").then(({ body }) => {
					const config = JSON.parse(body.toString());
					repoInstance = Object.fromEntries(
						config.repositories.map((r: any) => [
							r.id,
							instanceByRepo[r.name] ?? "local",
						]),
					);
				});
			const runs = JSON.parse(body.toString());
			if (!runningOverrides.size) {
				// Pin one example of every attention state, spread across instances,
				// so the prototype shows them regardless of the source's live state.
				const used = new Set<string>();
				const pick = (instance: string, ok: (r: any) => boolean) => {
					const run = runs.find(
						(r: any) =>
							!used.has(r.id) &&
							(repoInstance[r.repositoryId] ?? "local") === instance &&
							r.history?.length > 1 &&
							ok(r),
					);
					if (run) used.add(run.id);
					return run;
				};
				const notWaiting = (r: any) => r.status !== "waiting";
				const question = pick("homelab", notWaiting);
				if (question)
					runningOverrides.set(question.id, {
						status: "waiting",
						reviewGate: undefined,
						viewState: {},
						updatedAt: minutesAgo(6),
						questions: [
							"Should the date format follow the **browser locale** or a **per-user setting** stored on the account?",
							"Keep the existing `DD.MM.YYYY` default for German users, or switch everyone to ISO dates?",
						],
					});
				const review = pick("homelab", notWaiting);
				if (review)
					runningOverrides.set(review.id, {
						status: "completed",
						reviewGate: undefined,
						viewState: {},
						hasGuide: false,
						updatedAt: minutesAgo(38),
					});
				for (const [n, ok] of [
					(r: any) => ["failed", "error", "stopped"].includes(r.status),
					notWaiting,
				].entries()) {
					const run = pick("local", ok);
					if (!run) continue;
					offlineRuns.add(run.id);
					runningOverrides.set(
						run.id,
						n === 0
							? {
									status: "failed",
									viewState: {},
									updatedAt: minutesAgo(140),
									error:
										"The CI runner lost its Docker socket during `pnpm test`. No changes were lost.",
								}
							: {
									status: "running",
									viewState: {},
									updatedAt: minutesAgo(136),
									capacityLeaves: { [run.step]: { phase: "executing" } },
								},
					);
				}
			}
			return json(res, runs.map(patchRun));
		}
		const single = /^\/api\/runs\/([^/]+)$/.exec(url.pathname);
		if (single && response.ok)
			return json(res, patchRun(JSON.parse(body.toString())));
		return send(res, response.status, type, body);
	} catch (error) {
		json(res, { error: (error as Error).message }, 502);
	}
}).listen(Number(values.port), "127.0.0.1", () =>
	console.log(
		`PROTOTYPE multi-instance Factory: http://127.0.0.1:${values.port}/?prototype#/ (data from ${values.source}, writes stubbed)`,
	),
);
