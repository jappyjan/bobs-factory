import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { getAllTools } from "bobs-factory-claude-runner";
import {
	type EdgeWorkerConfig,
	factoryRuntimeIdentity,
	type RunnerType,
	resolvePath,
} from "bobs-factory-core";
import {
	EdgeWorker,
	ensureStateFormat,
	pruneBackup,
} from "bobs-factory-edge-worker";
import open from "open";
import {
	installedCommand,
	LocalOnboarding,
	loadLocalConfig,
	localRepository,
	savePrivateJson,
} from "./onboarding.js";
import { runtimeAgentSettings } from "./runtime-settings.js";
import { acquireInstanceLock } from "./services/InstanceLock.js";
import {
	scheduleLegacyCleanup,
	scheduleSupervisorRetirement,
} from "./services/LegacyUpdateAdoption.js";
import { assertServiceLaunch } from "./services/ServiceLifecycle.js";

export async function launchFactory(values: {
	repo?: string;
	port: string;
	agent?: string;
	model?: string;
	home: string;
	origin?: string;
	sessionHours?: string;
	open?: boolean;
}) {
	const home = resolve(resolvePath(values.home));
	const port = Number(values.port);
	if (!Number.isInteger(port) || port < 1 || port >= 65535)
		throw new Error("Choose a UI port between 1 and 65534");
	if (
		values.agent &&
		!["claude", "codex", "gemini", "cursor", "opencode"].includes(values.agent)
	)
		throw new Error("Unknown agent");
	process.env.BOBS_FACTORY_FACTORY_PORT = String(port);
	assertServiceLaunch(home);
	const releaseOwnership = await acquireInstanceLock(home);
	// Before any state is opened: refuse unknown data, or migrate it with a backup.
	try {
		await ensureStateFormat(home);
	} catch (error) {
		releaseOwnership();
		throw error;
	}
	const config = loadLocalConfig(home);
	const repository = values.repo
		? localRepository(values.repo, home)
		: undefined;
	const selected = values.agent ?? config.defaultRunner;
	// The dashboard itself needs neither Git nor an agent. Select an installed agent in setup.
	const command = selected === "cursor" ? "agent" : selected;
	if (values.repo && selected && command && !installedCommand(command))
		throw new Error(
			`Install the selected ${selected} coding agent before launching this project, or run bobs-factory without --repo to use guided setup.`,
		);
	const configPath = join(home, "config.json");

	process.env.BOBS_FACTORY_FACTORY_PORT = String(port);
	process.env.BOBS_FACTORY_HOME = home;
	if (values.origin) process.env.BOBS_FACTORY_FACTORY_ORIGIN = values.origin;
	if (values.sessionHours !== undefined)
		process.env.BOBS_FACTORY_FACTORY_SESSION_HOURS = values.sessionHours;
	// Persist the effective launch settings so operator repair reloads use the same runner and model.
	const effective: EdgeWorkerConfig = {
		...config,
		factoryHome: home,
		serverPort: Number(process.env.BOBS_FACTORY_SERVER_PORT ?? port + 1),
		serverHost:
			process.env.BOBS_FACTORY_HOST_EXTERNAL?.toLowerCase().trim() === "true"
				? "0.0.0.0"
				: "127.0.0.1",
		...(selected ? { defaultRunner: selected as RunnerType } : {}),
		linearAllowedTools: config.linearAllowedTools ?? getAllTools(),
		...(values.agent || values.repo || values.model
			? {
					claudeDefaultModel: values.model,
					codexDefaultModel: values.model,
					geminiDefaultModel: values.model,
					cursorDefaultModel: values.model,
					opencodeDefaultModel: values.model,
				}
			: {}),
		// Preserve the original interpretation across the move to the persistent
		// home and later config reloads. Bare executable names still use PATH.
		repositories: config.repositories.map((repo) => ({
			...repo,
			repositoryPath: resolvePath(repo.repositoryPath),
			workspaceBaseDir: resolvePath(repo.workspaceBaseDir),
			mcpConfigPath: Array.isArray(repo.mcpConfigPath)
				? repo.mcpConfigPath.map(resolvePath)
				: repo.mcpConfigPath
					? resolvePath(repo.mcpConfigPath)
					: undefined,
			promptTemplatePath: repo.promptTemplatePath
				? resolvePath(repo.promptTemplatePath)
				: undefined,
			gitProvider:
				repo.gitProvider?.type === "custom" &&
				repo.gitProvider.command.includes("/")
					? {
							...repo.gitProvider,
							command: resolvePath(repo.gitProvider.command),
						}
					: repo.gitProvider,
		})),
		slackMcpConfigs: config.slackMcpConfigs?.map(resolvePath),
		zulipMcpConfigs: config.zulipMcpConfigs?.map(resolvePath),
		linearMcpConfigs: config.linearMcpConfigs?.map(resolvePath),
		githubMcpConfigs: config.githubMcpConfigs?.map(resolvePath),
	};
	// Zod parsing can reorder keys without changing settings. Keep the original
	// bytes so restarting an identical owned runtime preserves the update receipt.
	const unchanged =
		existsSync(configPath) &&
		isDeepStrictEqual(
			JSON.parse(readFileSync(configPath, "utf8")),
			JSON.parse(JSON.stringify(effective)),
		);
	if (!unchanged) {
		if (existsSync(join(home, "updates", "maintenance.json")))
			throw new Error(
				"Local startup would change configuration during update maintenance",
			);
		savePrivateJson(configPath, effective);
	}
	let worker: EdgeWorker;
	const onboarding = new LocalOnboarding(home, (repository, runner) =>
		worker.configureLocalRepository(repository, runner),
	);
	const runtimeConfig = {
		...effective,
		...runtimeAgentSettings(effective),
		...(values.agent ? { defaultRunner: values.agent as RunnerType } : {}),
		...(values.model
			? {
					claudeDefaultModel: values.model,
					codexDefaultModel: values.model,
					geminiDefaultModel: values.model,
					cursorDefaultModel: values.model,
					opencodeDefaultModel: values.model,
				}
			: {}),
	};
	worker = new EdgeWorker(runtimeConfig, onboarding);
	const originalStop = worker.stop?.bind(worker);
	worker.stop = async () => {
		if (originalStop) await originalStop();
		releaseOwnership();
	};
	worker.setConfigPath(configPath);
	await worker.start();
	// A migration backup is only needed until the next successful start.
	pruneBackup(home, {
		processStartedAt: new Date(Date.now() - process.uptime() * 1000),
	});
	scheduleLegacyCleanup(home);
	if (factoryRuntimeIdentity.packaged && process.env.BOBS_FACTORY_DESKTOP_OWNER)
		scheduleSupervisorRetirement(home, port);
	if (repository && selected)
		await onboarding.configure({
			repositoryPath: repository.repositoryPath,
			runner: selected as RunnerType,
		});
	// Resolve launch/config paths first, then leave the caller's disposable
	// checkout. The long-lived worker must survive that worktree being removed.
	process.chdir(home);
	const address = `http://localhost:${port}`;
	console.log(`Bob's Factory: ${address}\nState: ${home}`);
	if (values.open !== false) {
		try {
			await open(`${address}/`, {
				wait: false,
			});
		} catch {
			console.log(`Open ${address} in your browser to continue setup.`);
		}
	}
	let stopping = false;
	const stop = async () => {
		if (stopping) return;
		stopping = true;
		await worker.stop();
		process.exit(0);
	};
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);
	return worker;
}
