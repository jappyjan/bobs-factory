import { expect, it } from "vitest";
import type { ReviewFile } from "../src/factory/ReviewFiles.js";
import {
	diffBlocks,
	fileKind,
	findLine,
	lineBreakdown,
	tourOwner,
} from "../src/factory/web/review-dive-model.js";
import { parsePatch } from "../src/factory/web/review-model.js";

const patch = `@@ -1,8 +1,13 @@
 import { a } from "a";
-const { data: page, isPending: loading } =
-  useList({ limit: 10 });
+const {
+  data: page,
+  isPending: loading,
+} = useList({ limit: 10 });
 const keep = 1;
-const enabled = isReady;
+const enabled = isReady && !isLoggingOut;
+const currentUser = isLoggingOut ? null : fetchedUser;
@@ -40,3 +45,3 @@ function Row() {
-  <Chip>
-    {count}
-  </Chip>
+  <Chip>{count}</Chip>
`;

it("folds reformatting away and keeps real changes line by line", () => {
	const blocks = diffBlocks(parsePatch(patch));
	expect(blocks.map((b) => b.kind)).toEqual([
		"hunk",
		"line",
		"reformat",
		"line",
		"line",
		"line",
		"line",
		"hunk",
		"reformat",
	]);
	expect(blocks[2]).toMatchObject({ kind: "reformat", count: 4 });
	// A hunk that only rewraps collapses as a whole.
	expect(blocks[8]).toMatchObject({ kind: "reformat", count: 3 });
});

it("anchors notes on added lines before removed and unchanged ones", () => {
	const lines = parsePatch(patch);
	expect(findLine(lines, "const enabled")).toMatchObject({
		kind: "add",
		next: 7,
	});
	expect(findLine(lines, "= isReady;")).toMatchObject({ kind: "remove" });
	expect(findLine(lines, "const keep")).toMatchObject({ kind: "context" });
	expect(findLine(lines, "missing")).toBeUndefined();
});

it("splits added lines into code, tests and text and finds a file's tour entry", () => {
	const file = (path: string, additions: number | null) =>
		({ path, additions }) as ReviewFile;
	expect(
		lineBreakdown([
			file("src/a.ts", 10),
			file("src/a.test.ts", 30),
			file("src/en.json", 4),
			file("pnpm-lock.yaml", 200),
			file("logo.png", null),
		]),
	).toEqual({ code: 10, tests: 30, text: 204 });
	expect(fileKind("docs/guide.md")).toBe("text");
	const tour = [
		{ file: "src/a.ts", say: "Rule", related: ["src/a.test.ts"] },
		{ file: "src/b.tsx", say: "Screen", same: ["src/c.tsx"] },
	];
	expect(tourOwner(tour, "src/a.test.ts")?.file).toBe("src/a.ts");
	expect(tourOwner(tour, "src/c.tsx")?.file).toBe("src/b.tsx");
	expect(tourOwner(tour, "src/d.tsx")).toBeUndefined();
});
