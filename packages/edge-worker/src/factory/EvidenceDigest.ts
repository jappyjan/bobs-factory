import { createHash } from "node:crypto";
export function digest(value: unknown): string {
	const canonical = (v: unknown): unknown =>
		Array.isArray(v)
			? v.map(canonical)
			: v && typeof v === "object"
				? Object.fromEntries(
						Object.entries(v)
							.sort(([a], [b]) => a.localeCompare(b))
							.map(([k, x]) => [k, canonical(x)]),
					)
				: v;
	return createHash("sha256")
		.update(JSON.stringify(canonical(value)) ?? "null")
		.digest("hex");
}
