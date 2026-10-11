// Expose the complete-shell fixture's cross-process readers to unfinished writes.
const fs = require("node:fs");
const { syncBuiltinESMExports } = require("node:module");
const original = fs.writeFileSync;
fs.writeFileSync = function (file, ...args) {
	if (String(file).includes("fixture-ui.json")) {
		original.call(this, file, "", args[1]);
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
	}
	return original.call(this, file, ...args);
};
syncBuiltinESMExports();
