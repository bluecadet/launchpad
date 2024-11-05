import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { LogManager } from "../log-manager.js";
import path from "node:path";
import moment from "moment";
import winston from "winston";

// we don't want to actually log anything to the console during tests
const consoleLogSpy = vi.spyOn(winston.transports.Console.prototype, "log").mockImplementation((info, cb) => {
	if (cb && typeof cb === "function") cb();
});

describe("LogManager", () => {
	beforeEach(() => {
		// Reset the singleton instance before each test
		LogManager._instance = null;
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe("configureRootLogger", () => {
		it("should create a singleton instance", () => {
			const logger = LogManager.configureRootLogger();
			expect(LogManager._instance).toBeDefined();
			expect(logger).toBeDefined();
		});

		it("should warn when configuring multiple times", () => {
			const firstLogger = LogManager.configureRootLogger();
			vi.spyOn(firstLogger, "warn");

			LogManager.configureRootLogger();
			expect(firstLogger.warn).toHaveBeenCalledWith("Root logger already configured. Ignoring.");
		});

		it("should create transports with correct levels", () => {
			const logger = LogManager.configureRootLogger();
			const transports = logger.transports;

			expect(transports).toHaveLength(4); // Console + 3 file transports
			expect(transports[0].level).toBe("info"); // Console
			expect(transports[1].level).toBe("info"); // Info file
			expect(transports[2].level).toBe("debug"); // Debug file
			expect(transports[3].level).toBe("error"); // Error file
		});
	});

	describe("getLogger", () => {
		it("should throw if getInstance called before configuration", () => {
			expect(() => LogManager.getInstance()).toThrow("Root logger not configured");
		});

		it("should create child loggers with module names", () => {
			const logger = LogManager.configureRootLogger();
			const childLogger = LogManager.getLogger("test-module");

			expect(childLogger).toBeDefined();

			childLogger.info("test");

			expect(consoleLogSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					module: "test-module",
					[Symbol.for("message")]: "test",
					[Symbol.for("level")]: "info",
				}),
				expect.any(Function), // winston bound log function
			);
		});

		it("should create nested child loggers", () => {
			const logger = LogManager.configureRootLogger();
			const parentLogger = LogManager.getLogger("parent");
			const childLogger = LogManager.getLogger("child", parentLogger);

			expect(childLogger).toBeDefined();

			logger.info("info message");
			parentLogger.warn("warn message");
			childLogger.error("error message");

			expect(consoleLogSpy).toHaveBeenCalledTimes(3);

			expect(consoleLogSpy).toHaveBeenNthCalledWith(
				1,
				expect.objectContaining({
					[Symbol.for("message")]: "info message",
					[Symbol.for("level")]: "info",
				}),
				expect.any(Function),
			);

			expect(consoleLogSpy).toHaveBeenNthCalledWith(
				2,
				expect.objectContaining({
					module: "parent",
					[Symbol.for("message")]: "warn message",
					[Symbol.for("level")]: "warn",
				}),
				expect.any(Function),
			);

			expect(consoleLogSpy).toHaveBeenNthCalledWith(
				3,
				expect.objectContaining({
					module: "child",
					[Symbol.for("message")]: "error message",
					[Symbol.for("level")]: "error",
				}),
				expect.any(Function),
			);
		});
	});

	describe("getFilePath", () => {
		it("should generate correct file paths", () => {
			const manager = new LogManager({
				fileOptions: {
					dirname: "test-logs",
					extension: ".log",
				},
			});

			const dateStr = moment().format("YYYY-MM-DD");
			const filePath = manager.getFilePath("test-type");

			expect(filePath).toBe(path.join("test-logs", `${dateStr}-test-type.log`));
		});

		it("should return templated paths when requested", () => {
			const manager = new LogManager();
			const filePath = manager.getFilePath("test-type", false);

			expect(filePath).toContain("%DATE%");
		});
	});

	describe("console override", () => {
		beforeEach(() => {
			// Make sure we don't pollute other tests when freezing console
			const consoleMock = {
				log: vi.fn(),
				error: vi.fn(),
				warn: vi.fn(),
				info: vi.fn(),
				debug: vi.fn(),
			};

			vi.stubGlobal("console", consoleMock);
		});

		afterAll(() => {
			vi.unstubAllGlobals();
		});

		it("should override console methods when enabled", () => {
			const originalLog = console.log;
			const originalError = console.error;

			LogManager.configureRootLogger({ overrideConsole: true });

			expect(console.log).not.toBe(originalLog);
			expect(console.error).not.toBe(originalError);
		});

		it("should not override console methods when disabled", () => {
			const originalLog = console.log;
			const originalError = console.error;

			LogManager.configureRootLogger({ overrideConsole: false });

			expect(console.log).toBe(originalLog);
			expect(console.error).toBe(originalError);
		});

		it("should freeze console object when overriding", () => {
			LogManager.configureRootLogger({ overrideConsole: true });

			expect(() => {
				// @ts-expect-error testing immutability
				console.newMethod = () => {};
			}).toThrow();
		});
	});
});
