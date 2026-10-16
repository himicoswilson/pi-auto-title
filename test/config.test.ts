import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configPath, loadPreferences, savePreferences } from "../src/config.ts";

describe("config file", () => {
	let dir: string;
	let savedEnv: string | undefined;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "pi-auto-title-"));
		savedEnv = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = dir;
	});

	afterEach(() => {
		if (savedEnv === undefined) {
			delete process.env.PI_CODING_AGENT_DIR;
		} else {
			process.env.PI_CODING_AGENT_DIR = savedEnv;
		}

		rmSync(dir, { recursive: true, force: true });
	});

	it("lives in the agent directory under its own name", () => {
		assert.equal(configPath(), join(dir, "pi-auto-title.json"));
	});

	it("reads a missing file as no preferences", () => {
		assert.deepEqual(loadPreferences(), { model: undefined, language: undefined });
	});

	it("round-trips what it saves", () => {
		savePreferences({ model: "mock/mock-1", language: "zh" });
		assert.deepEqual(loadPreferences(), { model: "mock/mock-1", language: "zh" });
		assert.deepEqual(JSON.parse(readFileSync(configPath(), "utf8")), {
			model: "mock/mock-1",
			language: "zh",
		});
	});

	it("keeps unpatched keys and removes cleared ones", () => {
		savePreferences({ model: "mock/mock-1", language: "zh" });
		savePreferences({ language: "en" });
		assert.deepEqual(loadPreferences(), { model: "mock/mock-1", language: "en" });

		savePreferences({ model: undefined });
		assert.deepEqual(loadPreferences(), { model: undefined, language: "en" });
	});

	it("reads a malformed file as no preferences", () => {
		writeFileSync(configPath(), "{ not json", "utf8");
		assert.deepEqual(loadPreferences(), { model: undefined, language: undefined });
	});
});
