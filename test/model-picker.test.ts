import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildModelItems, SESSION_MODEL_VALUE } from "../src/model-picker.ts";

const models = [
	{ provider: "openrouter", id: "deepseek/deepseek-chat", contextWindow: 128_000 },
	{ provider: "mock", id: "mock-1", contextWindow: 1_000_000, reasoning: true },
	{ provider: "mock", id: "mock-2" },
];

describe("buildModelItems", () => {
	it("leads with the session model and sorts the rest by provider and id", () => {
		const items = buildModelItems(models, undefined);
		assert.deepEqual(
			items.map((item) => item.value),
			[SESSION_MODEL_VALUE, "mock/mock-1", "mock/mock-2", "openrouter/deepseek/deepseek-chat"],
		);
	});

	it("marks the session model current while no override is in effect", () => {
		const items = buildModelItems(models, undefined);
		assert.match(items[0].description ?? "", /current/);
		assert.doesNotMatch(items[1].description ?? "", /current/);
	});

	it("marks the override current instead, with its context and reasoning", () => {
		const items = buildModelItems(models, "mock/mock-1");
		assert.doesNotMatch(items[0].description ?? "", /current/);
		assert.equal(items[1].description, "1M context · reasoning · current");
	});

	it("formats smaller contexts in k and leaves bare models undescribed", () => {
		const items = buildModelItems(models, undefined);
		assert.equal(items[3].description, "128k context");
		assert.equal(items[2].description, undefined);
	});
});
