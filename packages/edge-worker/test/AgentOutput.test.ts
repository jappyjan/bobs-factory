import { describe, expect, it } from "vitest";
import { parseAgentOutput } from "../src/factory/AgentOutput.js";

const review = {
	approved: false,
	feedback: [
		"Not approved yet:\n- first point with 'quotes' and `code`\n\n(Refs: ARCH-07.)",
	],
};

describe("parseAgentOutput", () => {
	it("parses bare and fenced JSON", () => {
		expect(parseAgentOutput(JSON.stringify(review))).toEqual(review);
		expect(
			parseAgentOutput(
				`\`\`\`json\n${JSON.stringify(review, null, 2)}\n\`\`\``,
			),
		).toEqual(review);
	});

	it("extracts the JSON from a prose preamble followed by a fenced block", () => {
		const text = `I'm withholding approval. Three things should change.\n\n\`\`\`json\n${JSON.stringify(review, null, 2)}\n\`\`\``;
		expect(parseAgentOutput(text)).toEqual(review);
	});

	it("extracts unfenced JSON surrounded by prose", () => {
		expect(
			parseAgentOutput(`Result:\n${JSON.stringify(review)}\nDone.`),
		).toEqual(review);
	});

	it("reports the precise parse failure and the end of the message", () => {
		const text = `Here you go:\n\`\`\`json\n{"approved": false, "feedback": ["unterminated\n\`\`\``;
		expect(() => parseAgentOutput(text)).toThrow(
			/required JSON result \(\d+ characters; .*\)\. Reply with only the JSON object.*Message ends: .*unterminated/s,
		);
	});
});
