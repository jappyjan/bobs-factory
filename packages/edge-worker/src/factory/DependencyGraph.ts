import { z } from "zod";

const identifier = z.string().min(1).max(80);

/** Parallel projections of a collection's IDs and prerequisite lists. */
export const DependencyGraphSchema = z
	.object({
		ids: z.array(identifier).max(1000),
		dependencies: z.array(z.array(identifier).max(1000)).max(1000),
	})
	.superRefine(({ ids, dependencies }, ctx) => {
		const issue = (message: string, path: (string | number)[] = []) =>
			ctx.addIssue({ code: "custom", message, path });
		if (ids.length !== dependencies.length)
			return issue("Each ID needs one dependency list");
		if (new Set(ids).size !== ids.length)
			return issue("Graph IDs must be unique", ["ids"]);
		const graph = new Map(ids.map((id, index) => [id, dependencies[index]!]));
		let invalid = false;
		for (const [index, list] of dependencies.entries()) {
			const seen = new Set<string>();
			for (const [edge, dependency] of list.entries()) {
				const message =
					dependency === ids[index]
						? "A node cannot depend on itself"
						: seen.has(dependency)
							? "Dependencies must be unique"
							: !graph.has(dependency)
								? `Unknown dependency: ${dependency}`
								: undefined;
				if (message) {
					invalid = true;
					issue(message, ["dependencies", index, edge]);
				}
				seen.add(dependency);
			}
		}
		if (invalid) return;
		// Iterative traversal keeps the bounded library format off the native stack.
		const done = new Set<string>();
		for (const start of ids) {
			const pending: { id: string; exit?: boolean }[] = [{ id: start }];
			const active = new Set<string>();
			while (pending.length) {
				const node = pending.pop()!;
				if (node.exit) {
					active.delete(node.id);
					done.add(node.id);
				} else if (active.has(node.id)) {
					return issue(`Dependency cycle through ${node.id}`, ["dependencies"]);
				} else if (!done.has(node.id)) {
					active.add(node.id);
					pending.push({ id: node.id, exit: true });
					for (const dependency of graph.get(node.id)!)
						pending.push({ id: dependency });
				}
			}
		}
	});
