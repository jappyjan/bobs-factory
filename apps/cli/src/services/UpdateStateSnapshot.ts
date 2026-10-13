import {
	cpSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readlinkSync,
	symlinkSync,
} from "node:fs";
import { join } from "node:path";

/** Copy owned state without importing credentials or following retained tooling links. */
export function copyUpdateState(
	home: string,
	destination: string,
	purpose: "preflight" | "snapshot",
) {
	mkdirSync(destination, { recursive: true, mode: 0o700 });
	const copy = (source: string, target: string, relative: string) => {
		if (relative === "factory/auth" || relative.startsWith("factory/auth/"))
			return;
		const stat = lstatSync(source);
		if (stat.isSymbolicLink() && relative.startsWith("factory/evidence/")) {
			// Evidence may retain absolute, external or expired test-tool links.
			// Backups retain the exact link record without reading its target. The
			// candidate's separate preflight home omits it to prevent external reads.
			if (purpose === "snapshot") symlinkSync(readlinkSync(source), target);
			return;
		}
		if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()))
			throw new Error(
				`Snapshot refuses external/special owned state: ${relative}`,
			);
		if (stat.isDirectory()) {
			mkdirSync(target, { recursive: true, mode: 0o700 });
			for (const name of readdirSync(source))
				copy(join(source, name), join(target, name), `${relative}/${name}`);
		} else cpSync(source, target);
	};
	for (const name of ["config.json", "state", "factory"]) {
		const source = join(home, name);
		try {
			lstatSync(source);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
			throw error;
		}
		copy(source, join(destination, name), name);
	}
}
