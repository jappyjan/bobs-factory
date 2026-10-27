#!/usr/bin/env node
// Runs one CI test shard: streams its output, keeps the complete log for an
// artifact and, when the shard fails, prints the failing test names with their
// assertion tails to the job log, as annotations and in the step summary.
import { spawn } from "node:child_process";
import { appendFileSync, createWriteStream, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";

const PREFIX = /^[\w./@-]+ test(?::run)?: /;
const MAX_FAILURES = 12;
const BLOCK_LINES = 16;

const clean = (line) => stripVTControlCharacters(line).replace(PREFIX, "");

/** Pull failing test headers and their assertion tails out of a vitest or node:test log. */
export function extractFailures(text) {
	const lines = text.split("\n").map(clean);
	const failures = [];
	const seen = new Set();
	const add = (header, from) => {
		if (seen.has(header) || failures.length >= MAX_FAILURES) return;
		seen.add(header);
		const body = [];
		for (
			let index = from;
			index < lines.length && body.length < BLOCK_LINES;
			index++
		) {
			// A new failure header or the end-of-run totals end the block.
			if (index > from && /^\s*(FAIL|✖|not ok)\s/.test(lines[index])) break;
			if (/^\s*(Test Files|Tests|ℹ tests)\s/.test(lines[index])) break;
			body.push(lines[index]);
		}
		failures.push({ header, body: body.join("\n").trimEnd() });
	};
	// node:test prints details only in its closing "failing tests:" section; the
	// inline "✖" lines carry no assertion text.
	const summaryStart = lines.findIndex((line) =>
		/^\s*(✖\s+)?failing tests:?\s*$/i.test(line),
	);
	for (let index = 0; index < lines.length; index++) {
		const vitest = /^\s*FAIL\s+(\S.*)$/.exec(lines[index]);
		if (vitest) {
			add(vitest[1].trim(), index + 1);
			continue;
		}
		if (summaryStart >= 0 && index <= summaryStart) continue;
		const nodeTest = /^\s*✖\s+(.+?)(?: \([\d.]+ms\))?$/.exec(lines[index]);
		if (nodeTest) add(nodeTest[1].trim(), index + 1);
	}
	return failures;
}

function escapeData(value) {
	return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

export function summarize(name, code, text) {
	const failures = extractFailures(text);
	const tail = text
		.split("\n")
		.map(clean)
		.filter((line) => line.trim())
		.slice(-40)
		.join("\n");
	const markdown = [
		`### ${name} failed (exit ${code})`,
		"",
		failures.length
			? failures
					.map(
						(item) =>
							`<details><summary><code>${item.header.replace(/</g, "&lt;")}</code></summary>\n\n\`\`\`\n${item.body}\n\`\`\`\n</details>`,
					)
					.join("\n\n")
			: `No failing test header was recognised; last output:\n\n\`\`\`\n${tail}\n\`\`\``,
		"",
	].join("\n");
	return { failures, tail, markdown };
}

async function main() {
	const argv = process.argv.slice(2);
	const separator = argv.indexOf("--");
	const options = argv.slice(0, separator);
	const command = argv.slice(separator + 1);
	const option = (flag) => options[options.indexOf(flag) + 1];
	const name = option("--name");
	const logPath = option("--log");
	if (separator < 0 || !command.length || !name || !logPath) {
		console.error(
			"Usage: run-shard.mjs --name <label> --log <file> -- <command> [args...]",
		);
		process.exit(2);
	}
	mkdirSync(dirname(logPath), { recursive: true });
	const log = createWriteStream(logPath);
	let captured = "";
	const child = spawn(command[0], command.slice(1), {
		stdio: ["ignore", "pipe", "pipe"],
		env: process.env,
	});
	const forward = (stream, target) =>
		stream.on("data", (chunk) => {
			target.write(chunk);
			log.write(chunk);
			captured += chunk;
			// Only the tail and failure blocks are needed; bound memory on huge logs.
			if (captured.length > 50_000_000) captured = captured.slice(-25_000_000);
		});
	forward(child.stdout, process.stdout);
	forward(child.stderr, process.stderr);
	const code = await new Promise((resolve) =>
		child.once("close", (exit, signal) => resolve(exit ?? (signal ? 1 : 0))),
	);
	await new Promise((resolve) => log.end(resolve));
	if (code === 0) return;
	const { failures, markdown } = summarize(name, code, captured);
	console.log(`\n::group::${name} failure summary`);
	if (failures.length)
		for (const item of failures)
			console.log(`FAIL ${item.header}\n${item.body}\n`);
	else console.log(markdown);
	console.log("::endgroup::");
	for (const item of failures)
		console.log(
			`::error title=${escapeData(`${name}: test failed`)}::${escapeData(`${item.header}\n${item.body}`.slice(0, 1800))}`,
		);
	if (!failures.length)
		console.log(
			`::error title=${escapeData(name)}::${escapeData(`${name} failed with exit code ${code}`)}`,
		);
	if (process.env.GITHUB_STEP_SUMMARY)
		appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
	process.exitCode = code;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
