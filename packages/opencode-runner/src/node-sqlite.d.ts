// Runtime API provided by required Node 24 and compiled Bun 1.4.2. This package
// still shares the repository's Node 20 declaration set; no SQLite dependency.
declare module "node:sqlite" {
	export class DatabaseSync {
		constructor(
			path: string | URL,
			options?: { readOnly?: boolean; allowExtension?: boolean },
		);
		prepare(sql: string): {
			all(...parameters: (string | number | null)[]): Record<string, unknown>[];
			get(
				...parameters: (string | number | null)[]
			): Record<string, unknown> | undefined;
			run(...parameters: (string | number | null)[]): unknown;
		};
		exec(sql: string): void;
		close(): void;
	}
}
