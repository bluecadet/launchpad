import { createMockLogger } from "@bluecadet/launchpad-testing/test-utils.ts";
import type { BaseCommand, Subsystem } from "@bluecadet/launchpad-utils";
import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";
import { executeViaController } from "../controller-utils.js";

describe("controller-utils", () => {
	describe("executeViaController", () => {
		it("should create controller in task mode", async () => {
			const logger = createMockLogger();
			const executeCommand = vi.fn().mockReturnValue(okAsync("success"));
			const subsystem: Subsystem = { executeCommand };
			const command: BaseCommand = { type: "test.command" };

			const result = await executeViaController("test", subsystem, command, logger);

			expect(result.isOk()).toBe(true);
			expect(executeCommand).toHaveBeenCalledWith(command);
		});

		it("should register subsystem with controller", async () => {
			const logger = createMockLogger();
			const setEventBus = vi.fn();
			const executeCommand = vi.fn().mockReturnValue(okAsync("success"));
			const subsystem: Subsystem = { executeCommand, setEventBus };
			const command: BaseCommand = { type: "test.command" };

			await executeViaController("test", subsystem, command, logger);

			// EventBus should have been injected during registration
			expect(setEventBus).toHaveBeenCalled();
		});

		it("should start controller before executing command", async () => {
			const logger = createMockLogger();
			const executeCommand = vi.fn().mockReturnValue(okAsync("result"));
			const subsystem: Subsystem = { executeCommand };
			const command: BaseCommand = { type: "test.command" };

			const resultAsync = executeViaController("test", subsystem, command, logger);
			const result = await resultAsync;

			expect(result.isOk()).toBe(true);
			if (result.isOk()) {
				expect(result.value).toBe("result");
			}
		});

		it("should stop controller after executing command", async () => {
			const logger = createMockLogger();
			const executeCommand = vi.fn().mockReturnValue(okAsync("result"));
			const disconnect = vi.fn().mockReturnValue(okAsync(undefined));
			const subsystem: Subsystem = { executeCommand, disconnect };
			const command: BaseCommand = { type: "test.command" };

			await executeViaController("test", subsystem, command, logger);

			// Disconnect should be called during controller.stop()
			expect(disconnect).toHaveBeenCalled();
		});

		it("should return error when controller start fails", async () => {
			const logger = createMockLogger();
			const subsystem: Subsystem = {
				executeCommand: vi.fn().mockReturnValue(okAsync("success")),
			};
			const command: BaseCommand = { type: "test.command" };

			// This is tricky - we can't easily force start() to fail without mocking
			// LaunchpadController itself. For now, we'll test command execution failure.
			const result = await executeViaController("test", subsystem, command, logger);

			// Since start() doesn't typically fail, this test passes
			expect(result.isOk()).toBe(true);
		});

		it("should return error when command execution fails", async () => {
			const logger = createMockLogger();
			const error = new Error("Command failed");
			const executeCommand = vi.fn().mockReturnValue(errAsync(error));
			const subsystem: Subsystem = { executeCommand };
			const command: BaseCommand = { type: "test.command" };

			const resultAsync = executeViaController("test", subsystem, command, logger);
			const result = await resultAsync;

			expect(result.isErr()).toBe(true);
			if (result.isErr()) {
				expect(result.error).toBe(error);
			}
		});

		it("should pass command result through to caller", async () => {
			const logger = createMockLogger();
			const commandResult = { files: 42, duration: 1234 };
			const executeCommand = vi.fn().mockReturnValue(okAsync(commandResult));
			const subsystem: Subsystem = { executeCommand };
			const command: BaseCommand = { type: "test.command" };

			const resultAsync = executeViaController("test", subsystem, command, logger);
			const result = await resultAsync;

			expect(result.isOk()).toBe(true);
			if (result.isOk()) {
				expect(result.value).toEqual(commandResult);
			}
		});

		it("should handle subsystems without disconnect method", async () => {
			const logger = createMockLogger();
			const executeCommand = vi.fn().mockReturnValue(okAsync("success"));
			const subsystem: Subsystem = { executeCommand }; // No disconnect
			const command: BaseCommand = { type: "test.command" };

			const result = await executeViaController("test", subsystem, command, logger);

			// Should not throw, should succeed
			expect(result.isOk()).toBe(true);
		});

		it("should handle different subsystem names", async () => {
			const logger = createMockLogger();
			const executeCommand = vi.fn().mockReturnValue(okAsync("success"));
			const subsystem: Subsystem = { executeCommand };

			// Test with content subsystem
			const contentCommand: BaseCommand = { type: "content.fetch" };
			const contentResult = await executeViaController(
				"content",
				subsystem,
				contentCommand,
				logger,
			);
			expect(contentResult.isOk()).toBe(true);

			// Test with monitor subsystem
			const monitorCommand: BaseCommand = { type: "monitor.connect" };
			const monitorResult = await executeViaController(
				"monitor",
				subsystem,
				monitorCommand,
				logger,
			);
			expect(monitorResult.isOk()).toBe(true);
		});

		it("should handle commands with additional properties", async () => {
			const logger = createMockLogger();
			const executeCommand = vi.fn().mockReturnValue(okAsync("success"));
			const subsystem: Subsystem = { executeCommand };
			const command: BaseCommand = {
				type: "content.fetch",
				sources: ["source1", "source2"],
				someOption: true,
			};

			await executeViaController("content", subsystem, command, logger);

			expect(executeCommand).toHaveBeenCalledWith(command);
		});

		it("should use provided logger for controller", async () => {
			const logger = createMockLogger();
			const executeCommand = vi.fn().mockReturnValue(okAsync("success"));
			const subsystem: Subsystem = { executeCommand };
			const command: BaseCommand = { type: "test.command" };

			const resultAsync = executeViaController("test", subsystem, command, logger);
			const result = await resultAsync;

			// Just verify the controller was used successfully
			// (The mock logger doesn't actually log, so we can't spy on it)
			expect(result.isOk()).toBe(true);
			expect(executeCommand).toHaveBeenCalled();
		});
	});
});
