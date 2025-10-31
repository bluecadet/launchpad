import type { BaseCommand, Subsystem } from "@bluecadet/launchpad-utils/controller-interfaces";
import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";
import { CommandDispatcher } from "../command-dispatcher.js";
import { EventBus } from "../event-bus.js";

describe("CommandDispatcher", () => {
	describe("dispatch", () => {
		it("should dispatch command to correct subsystem", async () => {
			const eventBus = new EventBus();
			const executeCommand = vi.fn().mockReturnValue(okAsync("success"));

			const contentSubsystem: Subsystem = { executeCommand };
			const subsystems = new Map<string, Subsystem>([["content", contentSubsystem]]);

			const dispatcher = new CommandDispatcher(eventBus, subsystems);
			const command: BaseCommand = { type: "content.fetch" };

			const result = await dispatcher.dispatch(command);

			expect(executeCommand).toHaveBeenCalledWith(command);
			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toBe("success");
		});

		it("should emit command:start event before execution", async () => {
			const eventBus = new EventBus();
			const emitSpy = vi.spyOn(eventBus, "emit");
			const executeCommand = vi.fn().mockReturnValue(okAsync(undefined));

			const subsystem: Subsystem = { executeCommand };
			const subsystems = new Map<string, Subsystem>([["content", subsystem]]);

			const dispatcher = new CommandDispatcher(eventBus, subsystems);
			const command: BaseCommand = { type: "content.fetch", sources: ["test"] };

			await dispatcher.dispatch(command);

			expect(emitSpy).toHaveBeenCalledWith("command:start", {
				commandType: "content.fetch",
				type: "content.fetch",
				sources: ["test"],
			});
		});

		it("should emit command:success event on successful execution", async () => {
			const eventBus = new EventBus();
			const emitSpy = vi.spyOn(eventBus, "emit");
			const executeCommand = vi.fn().mockReturnValue(okAsync({ files: 42 }));

			const subsystem: Subsystem = { executeCommand };
			const subsystems = new Map<string, Subsystem>([["content", subsystem]]);

			const dispatcher = new CommandDispatcher(eventBus, subsystems);
			const command: BaseCommand = { type: "content.fetch" };

			await dispatcher.dispatch(command);

			expect(emitSpy).toHaveBeenCalledWith("command:success", {
				commandType: "content.fetch",
				result: { files: 42 },
			});
		});

		it("should emit command:error event on failed execution", async () => {
			const eventBus = new EventBus();
			const emitSpy = vi.spyOn(eventBus, "emit");
			const error = new Error("Fetch failed");
			const executeCommand = vi.fn().mockReturnValue(errAsync(error));

			const subsystem: Subsystem = { executeCommand };
			const subsystems = new Map<string, Subsystem>([["content", subsystem]]);

			const dispatcher = new CommandDispatcher(eventBus, subsystems);
			const command: BaseCommand = { type: "content.fetch" };

			await dispatcher.dispatch(command);

			expect(emitSpy).toHaveBeenCalledWith(
				"command:error",
				expect.objectContaining({
					commandType: "content.fetch",
					error: expect.any(Error),
				}),
			);
		});

		it("should return error when subsystem not found", async () => {
			const eventBus = new EventBus();
			const emitSpy = vi.spyOn(eventBus, "emit");
			const subsystems = new Map<string, Subsystem>();

			const dispatcher = new CommandDispatcher(eventBus, subsystems);
			const command: BaseCommand = { type: "content.fetch" };

			const result = await dispatcher.dispatch(command);

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("Subsystem 'content' not available");
			expect(result._unsafeUnwrapErr().message).toContain(
				"Install @bluecadet/launchpad-content to use this command",
			);
			expect(emitSpy).toHaveBeenCalledWith(
				"command:error",
				expect.objectContaining({
					commandType: "content.fetch",
					error: expect.any(Error),
				}),
			);
		});

		it("should return error when subsystem does not implement CommandExecutor", async () => {
			const eventBus = new EventBus();
			const emitSpy = vi.spyOn(eventBus, "emit");

			// Subsystem without executeCommand method
			const subsystem: Subsystem = {};
			const subsystems = new Map<string, Subsystem>([["content", subsystem]]);

			const dispatcher = new CommandDispatcher(eventBus, subsystems);
			const command: BaseCommand = { type: "content.fetch" };

			const result = await dispatcher.dispatch(command);

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain(
				"Subsystem 'content' does not support command execution",
			);
			expect(result._unsafeUnwrapErr().message).toContain(
				"The subsystem must implement the CommandExecutor interface",
			);
			expect(emitSpy).toHaveBeenCalledWith(
				"command:error",
				expect.objectContaining({
					commandType: "content.fetch",
					error: expect.any(Error),
				}),
			);
		});

		it("should return error for invalid command type", async () => {
			const eventBus = new EventBus();
			const emitSpy = vi.spyOn(eventBus, "emit");
			const subsystems = new Map<string, Subsystem>();

			const dispatcher = new CommandDispatcher(eventBus, subsystems);
			const command: BaseCommand = { type: "" };

			const result = await dispatcher.dispatch(command);

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("Invalid command type");
			expect(emitSpy).toHaveBeenCalledWith(
				"command:error",
				expect.objectContaining({
					commandType: "",
					error: expect.any(Error),
				}),
			);
		});

		it("should handle command types without namespace separator", async () => {
			const eventBus = new EventBus();
			const emitSpy = vi.spyOn(eventBus, "emit");
			const subsystems = new Map<string, Subsystem>();

			const dispatcher = new CommandDispatcher(eventBus, subsystems);
			const command: BaseCommand = { type: "invalid-no-dot" };

			const result = await dispatcher.dispatch(command);

			// Should treat whole string as subsystem name
			expect(result.isErr()).toBe(true);
			expect(emitSpy).toHaveBeenCalledWith(
				"command:error",
				expect.objectContaining({
					error: expect.any(Error),
				}),
			);
		});

		it("should extract subsystem name from command type correctly", async () => {
			const eventBus = new EventBus();
			const executeCommand = vi.fn().mockReturnValue(okAsync(undefined));

			const subsystem: Subsystem = { executeCommand };
			const subsystems = new Map<string, Subsystem>([["monitor", subsystem]]);

			const dispatcher = new CommandDispatcher(eventBus, subsystems);

			// Test different command formats
			await dispatcher.dispatch({ type: "monitor.connect" });
			await dispatcher.dispatch({ type: "monitor.app.start" });
			await dispatcher.dispatch({ type: "monitor.app.window.foreground" });

			expect(executeCommand).toHaveBeenCalledTimes(3);
		});

		it("should pass through subsystem execution errors", async () => {
			const eventBus = new EventBus();
			const customError = new Error("Custom subsystem error");
			const executeCommand = vi.fn().mockReturnValue(errAsync(customError));

			const subsystem: Subsystem = { executeCommand };
			const subsystems = new Map<string, Subsystem>([["content", subsystem]]);

			const dispatcher = new CommandDispatcher(eventBus, subsystems);
			const command: BaseCommand = { type: "content.fetch" };

			const result = await dispatcher.dispatch(command);

			expect(result.isErr()).toBe(true);
			// Error is wrapped in CommandExecutionError with the original error as cause
			const error = result._unsafeUnwrapErr();
			expect(error.message).toContain("Subsystem command execution failed");
			expect(error.cause).toBe(customError);
		});

		it("should handle multiple subsystems correctly", async () => {
			const eventBus = new EventBus();
			const contentExecute = vi.fn().mockReturnValue(okAsync("content-result"));
			const monitorExecute = vi.fn().mockReturnValue(okAsync("monitor-result"));

			const contentSubsystem: Subsystem = { executeCommand: contentExecute };
			const monitorSubsystem: Subsystem = { executeCommand: monitorExecute };

			const subsystems = new Map<string, Subsystem>([
				["content", contentSubsystem],
				["monitor", monitorSubsystem],
			]);

			const dispatcher = new CommandDispatcher(eventBus, subsystems);

			await dispatcher.dispatch({ type: "content.fetch" });
			await dispatcher.dispatch({ type: "monitor.connect" });

			expect(contentExecute).toHaveBeenCalledTimes(1);
			expect(monitorExecute).toHaveBeenCalledTimes(1);
		});
	});
});
