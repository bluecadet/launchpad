import { afterEach } from "node:test";
import { createMockLogger } from "@bluecadet/launchpad-testing/test-utils.ts";
import type { Logger } from "@bluecadet/launchpad-utils/logger";
import { type Window, windowManager } from "node-window-manager";
import semver from "semver";
import { beforeEach, describe, expect, it, vi } from "vitest";
import sortWindows, { MIN_NODE_VERSION } from "../sort-windows.js";

// Mock node-window-manager
vi.mock("node-window-manager", () => ({
	windowManager: {
		requestAccessibility: vi.fn(),
		getWindows: vi.fn().mockReturnValue([]),
	},
}));

// Mock semver
vi.mock("semver", () => ({
	default: {
		satisfies: vi.fn().mockReturnValue(true),
	},
}));

describe("sortWindows", () => {
	let mockLogger: Logger;
	let mockWindow: Window;

	beforeEach(() => {
		mockLogger = createMockLogger();
		// @ts-expect-error - only assigning properties required for tesiting
		mockWindow = {
			processId: 123,
			isVisible: vi.fn().mockReturnValue(true),
			getTitle: vi.fn().mockReturnValue("Test Window"),
			hide: vi.fn(),
			minimize: vi.fn(),
			bringToTop: vi.fn(),
		};

		vi.spyOn(windowManager, "getWindows").mockReturnValue([mockWindow]);
	});

	afterEach(() => {
		vi.resetAllMocks();
	});

	it("should check node version before proceeding", async () => {
		vi.spyOn(semver, "satisfies").mockReturnValueOnce(false);

		await expect(sortWindows([], mockLogger)).rejects.toThrow(/Can't sort windows/);
		expect(semver.satisfies).toHaveBeenCalledWith(process.version, MIN_NODE_VERSION);
	});

	it("should handle empty apps array", async () => {
		await sortWindows([], mockLogger);
		expect(mockLogger.verbose).toHaveBeenCalledWith("Applying window settings to 0 apps");
	});

	it("should warn about apps without PIDs", async () => {
		const apps = [
			{
				options: {
					pm2: { name: "test-app" },
					windows: {},
				},
				pid: null,
			},
		];

		// @ts-expect-error not full config
		await sortWindows(apps, mockLogger);
		expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("Can't sort windows"));
	});

	it("should warn about apps without visible windows", async () => {
		const apps = [
			{
				options: {
					pm2: { name: "test-app" },
					windows: {
						hide: true,
					},
				},
				pid: 456, // Different from mockWindow.processId
			},
		];

		// @ts-expect-error not full config
		await sortWindows(apps, mockLogger);
		expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("No window found"));
	});

	it("should apply window settings correctly", async () => {
		const apps = [
			{
				options: {
					pm2: { name: "test-app" },
					windows: {
						hide: true,
						minimize: true,
						foreground: true,
					},
				},
				pid: 123,
			},
		];

		// @ts-expect-error not full config
		await sortWindows(apps, mockLogger);

		expect(mockWindow.hide).toHaveBeenCalled();
		expect(mockWindow.minimize).toHaveBeenCalled();
		expect(mockWindow.bringToTop).toHaveBeenCalled();
		expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("Hiding"));
		expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("Minimizing"));
		expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("Foregrounding"));
	});

	it("should only apply specified window settings", async () => {
		const apps = [
			{
				options: {
					pm2: { name: "test-app" },
					windows: {
						minimize: true, // Only minimize
					},
				},
				pid: 123,
			},
		];

		// @ts-expect-error not full config
		await sortWindows(apps, mockLogger);

		expect(mockWindow.hide).not.toHaveBeenCalled();
		expect(mockWindow.minimize).toHaveBeenCalled();
		expect(mockWindow.bringToTop).not.toHaveBeenCalled();
	});
});
