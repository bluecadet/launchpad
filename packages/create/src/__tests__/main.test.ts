import * as p from "@clack/prompts";
import { vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../main.js";

vi.mock("@clack/prompts", async (importOriginal) => {
	const prompts = await importOriginal<typeof import("@clack/prompts")>();
	return {
		...prompts,
		intro: vi.fn(),
		text: vi.fn(),
		multiselect: vi.fn(),
		confirm: vi.fn(),
		cancel: vi.fn(),
		note: vi.fn(),
		outro: vi.fn(),
		spinner: vi.fn(() => ({ start: vi.fn(), message: vi.fn(), stop: vi.fn() })),
	};
});

const exitSignal = new Error("process.exit");

beforeEach(() => {
	vi.spyOn(process, "exit").mockImplementation(() => {
		throw exitSignal;
	});
	vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected registry request"));
});

afterEach(() => {
	vol.reset();
	vi.restoreAllMocks();
	vi.resetAllMocks();
});

describe("main", () => {
	it("preserves false confirmations as answers instead of cancellation", async () => {
		vi.mocked(p.text).mockResolvedValueOnce("/project").mockResolvedValueOnce("my-installation");
		vi.mocked(p.multiselect).mockResolvedValueOnce(["monitor"]);
		vi.mocked(p.confirm).mockResolvedValue(false);
		vi.mocked(fetch).mockImplementation(async () => Response.json({ version: "1.0.0" }));

		await expect(main()).resolves.toBeUndefined();

		expect(p.cancel).not.toHaveBeenCalled();
		expect(process.exit).not.toHaveBeenCalled();
		expect(vol.existsSync("/project/package.json")).toBe(true);
		expect(vol.existsSync("/project/launchpad.config.ts")).toBe(true);
		expect(vol.existsSync("/project/.gitignore")).toBe(false);
		expect(vol.readFileSync("/project/launchpad.config.ts", "utf-8")).toContain("apps: []");
	});

	it.each([
		["target directory", 1],
		["package name", 2],
		["plugins", 3],
		["content sources", 4],
		["content transforms", 5],
		["configure monitor app", 6],
		["monitor app name", 7],
		["monitor app script", 8],
		["monitor app working directory", 9],
		["add another monitor app", 10],
		["gitignore", 11],
	])("exits cleanly when cancelling %s", async (_prompt, cancelAt) => {
		let promptCount = 0;
		vi.mocked(p.text).mockImplementation(async (options) => {
			if (++promptCount === cancelAt) return p.CANCEL_SYMBOL;
			return options.initialValue === "." ? "/project" : (options.initialValue ?? "./app.exe");
		});
		vi.mocked(p.multiselect).mockImplementation(async (options) => {
			if (++promptCount === cancelAt) return p.CANCEL_SYMBOL;
			return options.options.map((option) => option.value);
		});
		vi.mocked(p.confirm).mockImplementation(async (options) => {
			if (++promptCount === cancelAt) return p.CANCEL_SYMBOL;
			return options.initialValue ?? false;
		});

		await expect(main()).rejects.toBe(exitSignal);

		expect(promptCount).toBe(cancelAt);
		expect(p.cancel).toHaveBeenCalledExactlyOnceWith("Setup cancelled.");
		expect(process.exit).toHaveBeenCalledExactlyOnceWith(0);
		expect(fetch).not.toHaveBeenCalled();
		expect(vol.existsSync("/project/package.json")).toBe(false);
		expect(vol.existsSync("/project/launchpad.config.ts")).toBe(false);
	});
});
