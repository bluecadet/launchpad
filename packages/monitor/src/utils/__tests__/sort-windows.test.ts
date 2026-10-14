import { createMockLogger } from "@bluecadet/launchpad-testing/test-utils.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedAppConfig } from "../../monitor-config.js";
import sortWindows from "../sort-windows.js";
import { getWindowsNative, type WindowAction, type WindowsNative } from "../windows-native.js";

vi.mock("../windows-native.js", () => ({ getWindowsNative: vi.fn() }));

function createApp(
	windows: Partial<ResolvedAppConfig["windows"]> = {},
	pid: number | undefined = 123,
	name = "test-app",
): { options: ResolvedAppConfig; pid?: number } {
	const options: ResolvedAppConfig = {
		pm2: { name },
		windows: { hide: false, minimize: false, foreground: false, ...windows },
		logging: {
			logToLaunchpadDir: true,
			mode: "bus",
			showStdout: true,
			showStderr: true,
		},
	};
	return { options, pid };
}

function setup() {
	const logger = createMockLogger();
	const window = { id: "12345678901234567890", processId: 123 };
	const native: WindowsNative = {
		listVisibleWindows: vi.fn(() => [window]),
		getWindowTitle: vi.fn(() => "Test Window"),
		applyWindowAction: vi.fn(async () => undefined),
	};
	vi.mocked(getWindowsNative).mockReturnValue(native);
	return { logger, window, native };
}

describe("sortWindows", () => {
	beforeEach(() => vi.resetAllMocks());

	it.each([{ apps: [] }, { apps: [createApp()] }])(
		"avoids loading or enumerating for an unflagged batch",
		async ({ apps }) => {
			const { logger, native } = setup();
			await sortWindows(apps, logger);
			expect(getWindowsNative).not.toHaveBeenCalled();
			expect(native.listVisibleWindows).not.toHaveBeenCalled();
			expect(logger.verbose).toHaveBeenCalledWith(
				`Applying window settings to ${apps.length} ${apps.length === 1 ? "app" : "apps"}`,
			);
			expect(logger.verbose).toHaveBeenLastCalledWith("Done applying window settings.");
		},
	);

	it("warns about missing PIDs even when no flags are selected", async () => {
		const { logger } = setup();
		const app = createApp();
		app.pid = undefined;
		await sortWindows([app], logger);
		expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("because it has no pid"));
		expect(getWindowsNative).not.toHaveBeenCalled();
	});

	it("warns only about flagged apps without matching visible windows", async () => {
		const { logger, native } = setup();
		await sortWindows([createApp({ hide: true }, 456), createApp({}, 789)], logger);
		expect(logger.warn).toHaveBeenCalledTimes(1);
		expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("No window found"));
		expect(native.applyWindowAction).not.toHaveBeenCalled();
	});

	const combinations: WindowAction[][] = [
		["hide"],
		["minimize"],
		["foreground"],
		["hide", "minimize"],
		["hide", "foreground"],
		["minimize", "foreground"],
		["hide", "minimize", "foreground"],
	];
	it.each(combinations.map((actions) => ({ actions })))(
		"applies selected flags in order: $actions",
		async ({ actions }) => {
			const { logger, native, window } = setup();
			const flags = {
				hide: actions.includes("hide"),
				minimize: actions.includes("minimize"),
				foreground: actions.includes("foreground"),
			};
			await sortWindows([createApp(flags)], logger);
			expect(vi.mocked(native.applyWindowAction).mock.calls).toEqual(
				actions.map((action) => [window, action]),
			);
			expect(native.getWindowTitle).toHaveBeenCalledTimes(actions.length);
			expect(logger.info).toHaveBeenCalledTimes(actions.length);
			expect(native.listVisibleWindows).toHaveBeenCalledTimes(1);
		},
	);

	it("unions flags per PID and applies them to every matching window from one snapshot", async () => {
		const { logger, native, window } = setup();
		const secondWindow = { id: "2", processId: 123 };
		const unrelatedWindow = { id: "3", processId: 456 };
		vi.mocked(native.listVisibleWindows).mockReturnValue([window, unrelatedWindow, secondWindow]);
		await sortWindows(
			[
				createApp({ foreground: true }),
				createApp({ minimize: true }),
				createApp({ hide: true }),
				createApp({ hide: true }),
			],
			logger,
		);
		expect(vi.mocked(native.applyWindowAction).mock.calls).toEqual([
			[window, "hide"],
			[window, "minimize"],
			[window, "foreground"],
			[secondWindow, "hide"],
			[secondWindow, "minimize"],
			[secondWindow, "foreground"],
		]);
		expect(native.listVisibleWindows).toHaveBeenCalledTimes(1);
	});

	it("awaits each action and reads the title and logs before starting it", async () => {
		const { logger, native, window } = setup();
		const events: string[] = [];
		let finishHide: () => void = () => {
			throw new Error("Hide has not started");
		};
		vi.mocked(native.getWindowTitle).mockImplementation(() => {
			events.push("title");
			return "Test Window";
		});
		vi.mocked(logger.info).mockImplementation(() => {
			events.push("log");
			return logger;
		});
		vi.mocked(native.applyWindowAction).mockImplementation((_window, action) => {
			events.push(action);
			return action === "hide"
				? new Promise<void>((resolve) => {
						finishHide = resolve;
					})
				: Promise.resolve();
		});
		const operation = sortWindows(
			[createApp({ hide: true, minimize: true, foreground: true })],
			logger,
		);
		await Promise.resolve();
		expect(events).toEqual(["title", "log", "hide"]);
		expect(native.applyWindowAction).toHaveBeenCalledWith(window, "hide");
		expect(logger.verbose).not.toHaveBeenCalledWith("Done applying window settings.");
		finishHide();
		await operation;
		expect(events).toEqual([
			"title",
			"log",
			"hide",
			"title",
			"log",
			"minimize",
			"title",
			"log",
			"foreground",
		]);
	});

	it("skips native work on unsupported platforms", async () => {
		const { logger, native } = setup();
		vi.mocked(getWindowsNative).mockReturnValue(undefined);
		await sortWindows([createApp({ foreground: true })], logger);
		expect(native.listVisibleWindows).not.toHaveBeenCalled();
		expect(logger.warn).not.toHaveBeenCalled();
		expect(logger.verbose).toHaveBeenLastCalledWith("Done applying window settings.");
	});

	it("propagates addon load failures", async () => {
		const { logger } = setup();
		const error = new Error("Missing binary");
		vi.mocked(getWindowsNative).mockImplementation(() => {
			throw error;
		});
		await expect(sortWindows([createApp({ hide: true })], logger)).rejects.toBe(error);
	});

	it.each(["listVisibleWindows", "getWindowTitle"])(
		"propagates synchronous errors from %s before applying actions",
		async (method) => {
			const { logger, native } = setup();
			const error = new Error("Windows API failed");
			if (method === "listVisibleWindows") {
				vi.mocked(native.listVisibleWindows).mockImplementation(() => {
					throw error;
				});
			} else {
				vi.mocked(native.getWindowTitle).mockImplementation(() => {
					throw error;
				});
			}
			await expect(sortWindows([createApp({ hide: true })], logger)).rejects.toBe(error);
			expect(native.applyWindowAction).not.toHaveBeenCalled();
		},
	);

	it("propagates asynchronous native errors without starting subsequent actions", async () => {
		const { logger, native } = setup();
		const error = new Error("Windows API failed");
		vi.mocked(native.applyWindowAction).mockRejectedValueOnce(error);
		await expect(sortWindows([createApp({ hide: true, minimize: true })], logger)).rejects.toBe(
			error,
		);
		expect(native.applyWindowAction).toHaveBeenCalledTimes(1);
		expect(logger.verbose).not.toHaveBeenCalledWith("Done applying window settings.");
	});
});
