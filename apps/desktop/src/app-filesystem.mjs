import fs from "node:fs";
import { createRequire } from "node:module";

// App integrity and replacement operate on the published physical filesystem,
// including the ASAR container itself. Electron's normal fs virtualizes ASAR
// paths, including stats and recursive copies. Keep that view for loading the
// running app's modules; never toggle process.noAsar while the UI is running.
const physical = process.versions.electron
	? createRequire(import.meta.url)("original-fs")
	: fs;

export const {
	accessSync,
	constants,
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	realpathSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} = physical;
