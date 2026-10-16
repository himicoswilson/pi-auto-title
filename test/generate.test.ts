import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { titleSystemPrompt } from "../src/generate.ts";

describe("titleSystemPrompt", () => {
	it("follows the conversation when no language is named", () => {
		const prompt = titleSystemPrompt(null);
		assert.match(prompt, /same language as the user's message/);
	});

	it("pins the language when one is named", () => {
		const prompt = titleSystemPrompt("Japanese");
		assert.match(prompt, /Write the title in Japanese\./);
		assert.doesNotMatch(prompt, /same language/);
	});
});
