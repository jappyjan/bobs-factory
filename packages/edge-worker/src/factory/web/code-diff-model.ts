export type DiffLine = {
	kind: "hunk" | "context" | "add" | "remove" | "meta";
	text: string;
	old?: number;
	next?: number;
	note?: string;
};
export function parsePatch(patch: string): DiffLine[] {
	let old = 0,
		next = 0,
		inHunk = false;
	const lines: DiffLine[] = [];
	const raw = patch.split("\n");
	if (raw.at(-1) === "") raw.pop();
	for (const line of raw) {
		const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
		if (match) {
			old = Number(match[1]);
			next = Number(match[2]);
			inHunk = true;
			lines.push({ kind: "hunk", text: line });
		} else if (inHunk && line.startsWith("+"))
			lines.push({ kind: "add", text: line.slice(1), next: next++ });
		else if (inHunk && line.startsWith("-"))
			lines.push({ kind: "remove", text: line.slice(1), old: old++ });
		else if (inHunk && line.startsWith(" "))
			lines.push({
				kind: "context",
				text: line.slice(1),
				old: old++,
				next: next++,
			});
		else if (inHunk) {
			lines.push({ kind: "meta", text: line });
		}
	}
	return lines;
}
export type SplitRow = {
	kind: DiffLine["kind"];
	left?: DiffLine;
	right?: DiffLine;
};
export function splitPatch(lines: DiffLine[]): SplitRow[] {
	const rows: SplitRow[] = [];
	for (let i = 0; i < lines.length; ) {
		const line = lines[i]!;
		if (line.kind === "add" || line.kind === "remove") {
			const left: DiffLine[] = [],
				right: DiffLine[] = [];
			let last: DiffLine | undefined;
			while (i < lines.length) {
				const item = lines[i]!;
				if (item.kind === "add" || item.kind === "remove") {
					i++;
					last = { ...item };
					(item.kind === "remove" ? left : right).push(last);
				} else if (
					item.kind === "meta" &&
					item.text.startsWith("\\ No newline") &&
					last
				) {
					last.note = item.text;
					i++;
				} else break;
			}
			for (let j = 0; j < Math.max(left.length, right.length); j++)
				rows.push({ kind: "add", left: left[j], right: right[j] });
		} else {
			i++;
			rows.push({ kind: line.kind, left: line, right: line });
		}
	}
	return rows;
}
