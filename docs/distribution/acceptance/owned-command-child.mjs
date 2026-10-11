// A held group leader prevents PID/PGID reuse until its owner drains the group.
// No target code runs before the parent's durable registration handshake.
import { spawn } from "node:child_process";
import { writeSync } from "node:fs";
import { createInterface } from "node:readline";

const [program, ...args] = process.argv.slice(2);
const report = (event) => writeSync(3, `${JSON.stringify(event)}\n`);
let target;
let started = false;
process.on("SIGTERM", () => {});
process.on("SIGINT", () => {});
setInterval(() => {}, 1000);
createInterface({ input: process.stdin }).on("line", (line) => {
	if (line === "start" && !started) {
		started = true;
		target = spawn(program, args, { stdio: ["ignore", "inherit", "inherit"] });
		target.once("error", (error) => report({ error: error.message }));
		target.once("exit", (code, signal) => report({ code, signal }));
	} else if ((line === "terminate" || line.startsWith("signal:")) && target) {
		target.kill(line === "terminate" ? "SIGTERM" : line.slice(7));
	}
});
