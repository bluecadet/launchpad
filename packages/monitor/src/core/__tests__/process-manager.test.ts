import { createMockLogger } from "@bluecadet/launchpad-testing/test-utils.ts";
import type { Logger } from "@bluecadet/launchpad-utils";
import pm2 from "pm2";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProcessManager } from "../process-manager.js";

vi.mock("cross-spawn");

describe("ProcessManager", () => {
	let processManager: ProcessManager;
	let mockLogger: Logger;

	beforeEach(() => {
		mockLogger = createMockLogger();
		processManager = new ProcessManager(mockLogger);

		// Setup PM2 mock implementations
		pm2.connect = vi.fn().mockImplementation((_force, cb) => cb(null));
		pm2.disconnect = vi.fn();
		pm2.list = vi.fn().mockImplementation((cb) => cb(null, []));
		pm2.start = vi.fn().mockImplementation((_options, cb) => cb(null, {}));
		pm2.stop = vi.fn().mockImplementation((_name, cb) => cb(null, {}));
		pm2.delete = vi.fn().mockImplementation((_name, cb) => cb(null, {}));
		// @ts-ignore - this is a private api, so throws a type error
		pm2.Client = {
			// eslint-disable-next-line n/no-callback-literal
			pingDaemon: vi.fn().mockImplementation((cb) => cb(true)),
		};
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe("connect", () => {
		it("should connect to PM2 successfully", async () => {
			const result = await processManager.connect();

			expect(pm2.connect).toHaveBeenCalledWith(true, expect.any(Function));
			expect(result.isOk()).toBe(true);
		});

		it("should handle connection errors", async () => {
			const testError = new Error("Connection failed");
			pm2.connect = vi.fn().mockImplementation((_force, callback) => callback(testError));

			const result = await processManager.connect();

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("Failed to connect to PM2");
		});
	});

	describe("getProcess", () => {
		it("should get process by name", async () => {
			const mockProcess = { name: "test-app", pm2_env: {} };
			pm2.list = vi.fn().mockImplementation((callback) => callback(null, [mockProcess]));

			const result = await processManager.getProcess("test-app");

			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toEqual(mockProcess);
		});

		it("should handle non-existent process", async () => {
			pm2.list = vi.fn().mockImplementation((callback) => callback(null, []));

			const result = await processManager.getProcess("non-existent");

			expect(result.isErr()).toBe(true);
			expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("non-existent"));
		});
	});

	describe("startProcess", () => {
		it("should start process successfully", async () => {
			const options = { name: "test-app", script: "./app.js" };
			const result = await processManager.startProcess(options);

			expect(pm2.start).toHaveBeenCalledWith(options, expect.any(Function));
			expect(result.isOk()).toBe(true);
		});
	});

	describe("stopProcess", () => {
		it("should stop process successfully", async () => {
			const result = await processManager.stopProcess("test-app");

			expect(pm2.stop).toHaveBeenCalledWith("test-app", expect.any(Function));
			expect(result.isOk()).toBe(true);
		});
	});

	describe("deleteProcess", () => {
		it("should delete process successfully", async () => {
			const result = await processManager.deleteProcess("test-app");

			expect(pm2.delete).toHaveBeenCalledWith("test-app", expect.any(Function));
			expect(result.isOk()).toBe(true);
		});
	});
});
