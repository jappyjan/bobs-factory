import { expect, it } from "vitest";
import { byteRange } from "../src/factory/Video.js";

it("rejects invalid ranges at numeric boundaries", () => {
	expect(() => byteRange("bytes=9007199254740992-", 20)).toThrow();
	expect(byteRange("bytes=-100", 20)).toEqual({ start: 0, end: 19 });
});
