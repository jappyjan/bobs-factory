import { expect, it, vi } from "vitest";
import {
	FileIssuesConfigurationSchema,
	LaunchRunsConfigurationSchema,
	SnapshotConfigurationSchema,
} from "../src/factory/ActionSteps.js";
import {
	fileLinearIssue,
	fileTaskbotIssue,
} from "../src/factory/FileIssueProviders.js";
import {
	type FileIssueBatch,
	type FileIssueIntent,
	fileIssueBatch,
	prepareFileIssues,
} from "../src/factory/FileIssues.js";

const destination = {
	provider: "taskbot" as const,
	server: "tracker",
	instance: "https://tickets.example",
	project: "configured",
};
const config = {
	items: {
		values: [
			{
				id: "one",
				title: "Deferred work",
				body: "Plan",
				labels: ["architecture"],
				status: "in_progress",
				assigneeId: "agent",
			},
		],
	},
	itemId: "/id",
	maxItems: 100,
	fields: { title: "/title", body: "/body", labels: "/labels" },
};
const controller = () => new AbortController();
it("rejects hostile action configuration before nested getters, prototypes or serialization hooks can execute", () => {
	let executed = 0;
	const getter = Object.defineProperty({}, "title", {
		enumerable: true,
		get: () => {
			executed++;
			return "/title";
		},
	});
	expect(
		FileIssuesConfigurationSchema.safeParse({ ...config, fields: getter })
			.success,
	).toBe(false);
	const hidden = {
		...config,
		fields: Object.create({ title: "/title", body: "/body" }),
	};
	expect(FileIssuesConfigurationSchema.safeParse(hidden).success).toBe(false);
	const symbol = { ...config, [Symbol("hidden")]: "unexpected" };
	expect(FileIssuesConfigurationSchema.safeParse(symbol).success).toBe(false);
	const launch = {
		items: config.items,
		inputMapping: Object.defineProperty({}, "prompt", {
			enumerable: true,
			get: () => {
				executed++;
				return "/body";
			},
		}),
	};
	expect(LaunchRunsConfigurationSchema.safeParse(launch).success).toBe(false);
	expect(
		SnapshotConfigurationSchema.safeParse({
			history: Object.defineProperty({}, "lookbackDays", {
				enumerable: true,
				get: () => {
					executed++;
					return 30;
				},
			}),
		}).success,
	).toBe(false);
	expect(executed).toBe(0);
	expect(
		FileIssuesConfigurationSchema.parse({ ...config, destination: undefined })
			.destination,
	).toBeUndefined();
	expect(() =>
		batch([
			{
				...config.items.values[0]!,
				labels: [`factory-file-issue-${"a".repeat(64)}`],
			},
		]),
	).toThrow("reserved Factory creation identities");
});
function batch(values = config.items.values) {
	return prepareFileIssues(
		"parent",
		"durable-action",
		{ ...config, items: { values } },
		{ outputs: {} },
		destination,
	);
}
function tracker() {
	const rows = new Map<number, Record<string, unknown>>();
	let lost = false;
	const call = vi.fn(async (tool: string, args: Record<string, unknown>) => {
		if (tool === "list_tickets")
			return [...rows]
				.filter(([, row]) =>
					(row.labels as string[]).includes(args.label as string),
				)
				.map(([id]) => ({ id }));
		if (tool === "create_ticket") {
			const id = rows.size + 1;
			rows.set(id, { ...args, id });
			if (lost) throw new Error("Response lost after provider create");
			return { id };
		}
		return rows.get(args.id as number);
	});
	return {
		rows,
		call,
		lose: (value: boolean) => {
			lost = value;
		},
	};
}
it("persists per-item intent and send barriers before creation; concurrent callers and JSON restart reconcile one backlog-only unassigned issue", async () => {
	let current = batch();
	const provider = tracker();
	provider.lose(true);
	let saved = "";
	const save = vi.fn(async () => {
		saved = JSON.stringify(current);
	});
	const send = (intent: FileIssueIntent, signal: AbortSignal) =>
		fileTaskbotIssue(
			intent,
			async (tool, args) => {
				if (tool === "create_ticket") {
					expect((JSON.parse(saved) as FileIssueBatch).items[0]!.phase).toBe(
						"sending",
					);
					expect(args).toEqual({
						project: "configured",
						title: "Deferred work",
						body: current.accepted[0]!.body,
						status: "backlog",
						labels: ["architecture", `factory-file-issue-${intent.key}`],
					});
				}
				return provider.call(tool, args);
			},
			save,
			signal,
		);
	const signal = controller().signal;
	const one = fileIssueBatch(current, send, save, signal);
	const duplicate = fileIssueBatch(current, send, save, signal);
	expect(one).toBe(duplicate);
	await expect(one).rejects.toThrow("Response lost");
	expect(current.items[0]!.phase).toBe("uncertain");
	current = JSON.parse(saved) as FileIssueBatch;
	provider.lose(false);
	const output = await fileIssueBatch(current, send, save, signal);
	expect(output).toEqual({
		tickets: {
			one: { id: "1", url: "https://tickets.example/p/configured/t/1" },
		},
		summary: { total: 1, confirmed: 1, uncertain: 0 },
	});
	await fileIssueBatch(current, send, save, signal);
	expect(
		provider.call.mock.calls.filter(([tool]) => tool === "create_ticket"),
	).toHaveLength(1);
	expect(current.accepted[0]).not.toHaveProperty("phase");
});
it("retains partial successes and original links across retries, and refuses changed accepted mappings", async () => {
	const current = batch([
		...config.items.values,
		{ ...config.items.values[0]!, id: "two", title: "Second" },
	]);
	const provider = tracker();
	let secondFailed = false;
	const send = async (intent: FileIssueIntent, signal: AbortSignal) => {
		if (intent.itemId === "two" && !secondFailed) {
			secondFailed = true;
			throw new Error("Preflight unavailable");
		}
		return fileTaskbotIssue(intent, provider.call, async () => {}, signal);
	};
	await expect(
		fileIssueBatch(current, send, async () => {}, controller().signal),
	).rejects.toThrow("Preflight unavailable");
	const original = structuredClone(current.items[0]!.receipt);
	expect(current.items.map((item) => item.phase)).toEqual([
		"confirmed",
		"pending",
	]);
	await fileIssueBatch(current, send, async () => {}, controller().signal);
	expect(current.items[0]!.receipt).toEqual(original);
	expect(provider.rows.size).toBe(2);
	current.items[1]!.title = "Catalogue changed";
	await expect(
		fileIssueBatch(current, send, async () => {}, controller().signal),
	).rejects.toThrow("mapping changed");
	expect(provider.rows.size).toBe(2);
});
it("retains uncertainty when markers are absent or ambiguous, and never accepts assigned or started provider defaults", async () => {
	for (const status of ["in_progress", "backlog"]) {
		const current = batch();
		const provider = tracker();
		const call = async (tool: string, args: Record<string, unknown>) => {
			const result = await provider.call(tool, args);
			if (tool === "get_ticket")
				return {
					...(result as object),
					status,
					assignee: status === "backlog" ? "agent" : null,
				};
			return result;
		};
		const send = (intent: FileIssueIntent, signal: AbortSignal) =>
			fileTaskbotIssue(intent, call, async () => {}, signal);
		await expect(
			fileIssueBatch(current, send, async () => {}, controller().signal),
		).rejects.toThrow("backlog-only and unassigned");
		expect(current.items[0]!.phase).toBe("uncertain");
		await expect(
			fileIssueBatch(current, send, async () => {}, controller().signal),
		).rejects.toThrow("backlog-only and unassigned");
		expect(provider.rows.size).toBe(1);
	}
	const issue = batch().items[0]!;
	issue.phase = "uncertain";
	const absent = vi.fn(async () => []);
	await expect(fileTaskbotIssue(issue, absent, async () => {})).rejects.toThrow(
		"No matching marker",
	);
	expect(absent).toHaveBeenCalledTimes(1);
	await expect(
		fileTaskbotIssue(
			issue,
			async () => [{ id: 1 }, { id: 2 }],
			async () => {},
		),
	).rejects.toThrow("Several issues");
	await expect(
		fileTaskbotIssue(
			issue,
			async () => ({ tickets: [], has_more: true }),
			async () => {},
		),
	).rejects.toThrow("lookup is incomplete");
	await expect(
		fileTaskbotIssue(
			issue,
			async (tool) =>
				tool === "list_tickets"
					? [{ id: 1 }]
					: {
							id: 1,
							body: "Wrong marker",
							project: "configured",
							status: "backlog",
						},
			async () => {},
		),
	).rejects.toThrow("marker does not match");
});
it("checks cancellation immediately after the durable send barrier and sends nothing", async () => {
	const issue = batch().items[0]!;
	const stop = controller();
	const call = vi.fn(async () => []);
	await expect(
		fileTaskbotIssue(
			issue,
			call,
			async () => {
				stop.abort(new Error("Stopped parent"));
			},
			stop.signal,
		),
	).rejects.toThrow("Stopped parent");
	expect(call.mock.calls.map(([tool]) => tool)).toEqual(["list_tickets"]);
});
it("uses one deterministic Linear UUID after a lost response and confirms project, labels, backlog and no assignment", async () => {
	const current = prepareFileIssues(
		"parent",
		"linear-action",
		config,
		{ outputs: {} },
		{
			provider: "linear",
			workspaceId: "workspace",
			teamId: "team",
			projectId: "project",
		},
	);
	let created: Record<string, unknown> | undefined;
	let savedPhase: string | undefined;
	const save = async () => {
		savedPhase = current.items[0]!.phase;
	};
	const createIssue = vi.fn(async (args: Record<string, unknown>) => {
		expect(savedPhase).toBe("sending");
		expect(args).toEqual({
			id: expect.any(String),
			teamId: "team",
			projectId: "project",
			title: "Deferred work",
			description: current.accepted[0]!.body,
			stateId: "backlog",
			assigneeId: null,
			delegateId: null,
			useDefaultTemplate: false,
			labelIds: ["label-id"],
		});
		created = {
			id: args.id,
			url: "https://linear.app/team/issue/TEAM-1",
			description: args.description,
			team: Promise.resolve({ id: "team" }),
			project: Promise.resolve({ id: "project" }),
			state: Promise.resolve({ type: "backlog" }),
			assignee: undefined,
			delegate: undefined,
			labels: async () => ({ nodes: [{ name: "architecture" }] }),
		};
		throw new Error("Response lost");
	});
	const client = {
		issues: async () => ({ nodes: created ? [created] : [] }),
		team: async () => ({
			states: async () => ({ nodes: [{ id: "backlog", type: "backlog" }] }),
		}),
		issueLabels: async () => ({
			nodes: [
				{
					id: "label-id",
					name: "architecture",
					team: Promise.resolve({ id: "team" }),
				},
			],
			pageInfo: { hasNextPage: false },
		}),
		createIssue,
	} as unknown as Parameters<typeof fileLinearIssue>[0];
	const send = (issue: FileIssueIntent, signal: AbortSignal) =>
		fileLinearIssue(client, issue, save, signal);
	await expect(
		fileIssueBatch(current, send, save, controller().signal),
	).rejects.toThrow("Response lost");
	const output = await fileIssueBatch(current, send, save, controller().signal);
	expect(output.tickets.one).toEqual({ id: created!.id, url: created!.url });
	expect(createIssue).toHaveBeenCalledTimes(1);
	created!.assignee = Promise.resolve({ id: "agent" });
	const uncertain = structuredClone(current.items[0]!);
	uncertain.phase = "uncertain";
	await expect(fileLinearIssue(client, uncertain, save)).rejects.toThrow(
		"backlog-only, unassigned",
	);
});
