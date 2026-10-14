import path from "node:path";
import { createMockLogger } from "@bluecadet/launchpad-testing/test-utils.ts";
import { okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WindowsApiError } from "../../errors.js";
import type { ResolvedMonitorConfig } from "../../monitor-config.js";
import sortWindows from "../../utils/sort-windows.js";
import { AppManager } from "../app-manager.js";
import { ProcessManager } from "../process-manager.js";

vi.mock("../../utils/sort-windows.js", () => ({ default: vi.fn(async () => undefined) }));

function setupTestAppManager(
	apps: ResolvedMonitorConfig["apps"] = [
		{
			pm2: {
				name: "test-app",
				script: "test.js",
				cwd: "app/cwd",
			},
			windows: {
				foreground: false,
				minimize: false,
				hide: false,
			},
			logging: {
				logToLaunchpadDir: true,
				mode: "bus",
				showStdout: true,
				showStderr: true,
			},
		},
	],
	cwd = process.cwd(),
) {
	const mockLogger = createMockLogger();
	const processManager = new ProcessManager(mockLogger);

	// Setup process manager spies
	vi.spyOn(processManager, "startProcess").mockImplementation(() => okAsync({}));
	vi.spyOn(processManager, "stopProcess").mockImplementation(() => okAsync({}));
	vi.spyOn(processManager, "getProcess").mockImplementation(() =>
		okAsync({
			pm2_env: { status: "online" },
			pid: 123,
		}),
	);
	vi.spyOn(processManager, "connect");
	vi.spyOn(processManager, "disconnect");
	vi.spyOn(processManager, "isDaemonRunning");
	vi.spyOn(processManager, "getProcesses");
	vi.spyOn(processManager, "deleteProcess");
	vi.spyOn(processManager, "deleteAllProcesses");

	const mockConfig = {
		apps,
		windowsApi: {
			debounceDelay: 3000,
		},
		deleteExistingBeforeConnect: false,
		plugins: [],
		shutdownOnExit: true,
	} as ResolvedMonitorConfig;

	const appManager = new AppManager(mockLogger, processManager, mockConfig, cwd);

	return {
		appManager,
		mockLogger,
		processManager,
		mockConfig,
	};
}

describe("AppManager", () => {
	describe("startApp", () => {
		it("should start an app successfully", async () => {
			const { appManager, processManager, mockLogger } = setupTestAppManager();

			const result = await appManager.startApp("test-app");

			expect(processManager.startProcess).toHaveBeenCalledTimes(1);
			expect(processManager.getProcess).toHaveBeenCalledWith("test-app");
			expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("Starting app"));
			expect(result._unsafeUnwrap()).toEqual({
				pm2_env: { status: "online" },
				pid: 123,
			});
		});

		it.each([false, true])(
			"passes windowsHide=%s to PM2 without changing other flags",
			async (hide) => {
				const { appManager, processManager, mockConfig } = setupTestAppManager();
				const app = mockConfig.apps[0];
				if (!app) {
					throw new Error("Test app is missing");
				}
				app.windows.hide = hide;
				await appManager.startApp("test-app");
				expect(processManager.startProcess).toHaveBeenCalledWith(
					expect.objectContaining({ windowsHide: hide }),
				);
				expect(app.windows).toEqual({ foreground: false, minimize: false, hide });
			},
		);

		it("should handle non-existent app names", async () => {
			const { appManager } = setupTestAppManager();

			const result = await appManager.startApp("non-existent-app");

			expect(result).toBeErr();
			expect(result._unsafeUnwrapErr().message).toContain(
				"No app found with the name 'non-existent-app'",
			);
		});
	});

	describe("applyWindowSettings", () => {
		beforeEach(() => {
			vi.useFakeTimers();
			vi.mocked(sortWindows).mockReset().mockResolvedValue(undefined);
		});

		afterEach(() => vi.useRealTimers());

		it("serializes batches after debounce fires while an earlier native action is pending", async () => {
			const { appManager, processManager } = setupTestAppManager();
			let finishFirst: () => void = () => {
				throw new Error("First batch has not started");
			};
			vi.mocked(sortWindows).mockImplementationOnce(
				() =>
					new Promise<void>((resolve) => {
						finishFirst = resolve;
					}),
			);
			const first = appManager.applyWindowSettings(["test-app"]);
			await vi.advanceTimersByTimeAsync(3000);
			expect(sortWindows).toHaveBeenCalledTimes(1);
			const second = appManager.applyWindowSettings(["test-app"]);
			await vi.advanceTimersByTimeAsync(3000);
			expect(sortWindows).toHaveBeenCalledTimes(1);
			expect(processManager.getProcess).toHaveBeenCalledTimes(1);
			finishFirst();
			expect(await first).toBeOk();
			expect(await second).toBeOk();
			expect(sortWindows).toHaveBeenCalledTimes(2);
		});

		it("preserves WindowsApiError and recovers the queue after a failed native batch", async () => {
			const { appManager } = setupTestAppManager();
			const cause = new Error("Native action failed");
			let failFirst: (error: Error) => void = () => {
				throw new Error("First batch has not started");
			};
			vi.mocked(sortWindows).mockImplementationOnce(
				() =>
					new Promise<void>((_resolve, reject) => {
						failFirst = reject;
					}),
			);
			const first = appManager.applyWindowSettings(["test-app"]);
			await vi.advanceTimersByTimeAsync(3000);
			const second = appManager.applyWindowSettings(["test-app"]);
			await vi.advanceTimersByTimeAsync(3000);
			expect(sortWindows).toHaveBeenCalledTimes(1);
			failFirst(cause);
			const result = await first;
			expect(result).toBeErr();
			expect(result._unsafeUnwrapErr()).toBeInstanceOf(WindowsApiError);
			expect(result._unsafeUnwrapErr().cause).toBe(cause);
			expect(await second).toBeOk();
			expect(sortWindows).toHaveBeenCalledTimes(2);
		});

		it("keeps queues local to each AppManager", async () => {
			const firstManager = setupTestAppManager().appManager;
			const secondManager = setupTestAppManager().appManager;
			let finishFirst: () => void = () => undefined;
			vi.mocked(sortWindows).mockImplementationOnce(
				() =>
					new Promise<void>((resolve) => {
						finishFirst = resolve;
					}),
			);
			const first = firstManager.applyWindowSettings(["test-app"]);
			await vi.advanceTimersByTimeAsync(3000);
			const second = secondManager.applyWindowSettings(["test-app"]);
			await vi.advanceTimersByTimeAsync(3000);
			expect(sortWindows).toHaveBeenCalledTimes(2);
			expect(await second).toBeOk();
			finishFirst();
			expect(await first).toBeOk();
		});
	});

	describe("stopApp", () => {
		it("should stop an app successfully", async () => {
			const { appManager, processManager, mockLogger } = setupTestAppManager();

			await appManager.stopApp("test-app");

			expect(processManager.stopProcess).toHaveBeenCalledWith("test-app");
			expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("Stopping app"));
		});
	});

	describe("isAppRunning", () => {
		it("should check if app is running", async () => {
			const { appManager, processManager } = setupTestAppManager();

			const result = await appManager.isAppRunning("test-app");

			expect(processManager.getProcess).toHaveBeenCalledWith("test-app", true);
			expect(result._unsafeUnwrap()).toBe(true);
		});
	});

	describe("validateAppNames", () => {
		it("should return all app names when input is null", () => {
			const { appManager } = setupTestAppManager();
			const result = appManager.validateAppNames(null)._unsafeUnwrap();
			expect(result).toEqual(["test-app"]);
		});

		it("should handle single app name", () => {
			const { appManager } = setupTestAppManager();
			const result = appManager.validateAppNames("test-app")._unsafeUnwrap();
			expect(result).toEqual(["test-app"]);
		});

		it("should handle array of app names", () => {
			const { appManager } = setupTestAppManager();
			const result = appManager.validateAppNames(["test-app"])._unsafeUnwrap();
			expect(result).toEqual(["test-app"]);
		});

		it("should throw on invalid input", async () => {
			const { appManager } = setupTestAppManager();
			// @ts-expect-error Testing invalid input
			const result = await appManager.validateAppNames(123);
			expect(result).toBeErr();
			expect(result._unsafeUnwrapErr().message).toContain(
				"appNames must be null, undefined, a string or an iterable array/set of strings",
			);
		});
	});

	describe("getAppOptions", () => {
		it("should return app options for valid app name", async () => {
			const { appManager, mockConfig } = setupTestAppManager();
			const result = await appManager.getAppOptions("test-app");
			expect(result.isOk()).toBe(true);

			const resolvedCWD = path.resolve(process.cwd(), mockConfig.apps[0]?.pm2.cwd!);

			const expectedOptions = {
				...mockConfig.apps[0],
				pm2: {
					...mockConfig.apps[0]!.pm2,
					cwd: resolvedCWD,
				},
			};

			expect(result._unsafeUnwrap()).toEqual(expectedOptions);
		});

		it("should throw for invalid app name", async () => {
			const { appManager } = setupTestAppManager();
			const result = await appManager.getAppOptions("invalid-app");
			expect(result).toBeErr();
			expect(result._unsafeUnwrapErr().message).toContain(
				"No app found with the name 'invalid-app'",
			);
		});
	});

	describe("cwd handling", () => {
		it("should resolve pm2 cwd relative to the manager's cwd", () => {
			const { appManager } = setupTestAppManager(undefined, "/passed/cwd");
			const appOptions = appManager.getAppOptions("test-app")._unsafeUnwrap();
			expect(appOptions.pm2.cwd).toBeDefined();
			expect(appOptions.pm2.cwd).toEqual(path.resolve("/passed/cwd", "app/cwd"));
		});

		it("should use default cwd if not specified in config", () => {
			const { appManager } = setupTestAppManager();
			const appOptions = appManager.getAppOptions("test-app")._unsafeUnwrap();
			expect(appOptions.pm2.cwd).toBeDefined();
			expect(appOptions.pm2.cwd).toEqual(path.resolve(process.cwd(), "app/cwd"));
		});
	});
});
