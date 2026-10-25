import { expect, it, vi } from "vitest";
import { GithubApi } from "../src/factory/GithubApi.js";
import { githubTicketIO } from "../src/factory/RepositoryTicketIO.js";

it("uses scoped GitHub issue endpoints and preserves labels while mapping status types", async () => {
	const issue = {
		number: 7,
		html_url: "https://github.com/test/repo/issues/7",
		title: "Original",
		body: "Body",
		state: "open",
		labels: [{ name: "existing" }],
	};
	const comments: { body: string }[] = [];
	const command = vi.fn(async (_exe: string, args: string[]) => {
		const request = JSON.parse(args[0]!);
		expect(request.project).toBe("test/repo");
		expect(request.path).toMatch(/^repos\/test\/repo\/issues/);
		if (request.method === "GET" && request.path.includes("/comments"))
			return JSON.stringify(comments);
		if (request.method === "GET" && request.path.includes("?state=all"))
			return JSON.stringify([issue]);
		if (request.method === "POST" && request.path.endsWith("/comments")) {
			comments.push(request.body);
			return "{}";
		}
		if (request.method === "POST") {
			Object.assign(issue, request.body);
			return JSON.stringify(issue);
		}
		if (request.method === "PATCH") {
			const { labels, ...fields } = request.body;
			Object.assign(issue, fields);
			if (labels) issue.labels = labels.map((name: string) => ({ name }));
		}
		return JSON.stringify(issue);
	});
	const api = new GithubApi(command, "https://github.com/test/repo");
	const adapter = githubTicketIO(api, 7);
	expect(await adapter.read()).toMatchObject({
		id: "7",
		description: "Body",
		state: { type: "unstarted" },
	});
	await adapter.comment("Message");
	await adapter.update({ title: "Updated", description: "Changed" });
	await adapter.setStatus("started");
	expect(issue.labels).toEqual([
		{ name: "existing" },
		{ name: "factory-status:started" },
	]);
	// An external close supersedes an old label; reconciliation must see actual native state.
	issue.state = "closed";
	expect((await adapter.read()).state).toEqual({ type: "completed" });
	await adapter.setStatus("canceled");
	expect((await adapter.read()).state).toEqual({ type: "canceled" });
	await adapter.link("https://example.test/resource");
	await adapter.link("https://example.test/resource");
	expect((await adapter.read()).attachments).toEqual([
		{ url: "https://example.test/resource" },
	]);
	const created = await adapter.create({ title: "New" }, "identity", false);
	const before = command.mock.calls.length;
	expect(await adapter.create({ title: "New" }, "identity", true)).toEqual(
		created,
	);
	expect(command.mock.calls.length).toBe(before + 1);
	expect(comments).toEqual([
		{ body: "Message" },
		{ body: "Factory link: https://example.test/resource" },
	]);
	await expect(adapter.update({ priority: 1 })).rejects.toThrow(
		"do not support",
	);
});
