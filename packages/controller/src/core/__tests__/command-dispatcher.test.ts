import { createMockEventBus } from "@bluecadet/launchpad-testing/test-utils.ts";
import type { BaseCommand, InstantiatedPlugin } from "@bluecadet/launchpad-utils/plugin-interfaces";
import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";
import { CommandDispatcher } from "../command-dispatcher.js";

describe("CommandDispatcher", () => {
	describe("dispatch", () => {
		it("should dispatch command to correct plugin", async () => {
			const eventBus = createMockEventBus();
			const executeCommand = vi.fn().mockReturnValue(okAsync("success"));

			const contentPlugin: InstantiatedPlugin = { executeCommand };
			const plugins = new Map<string, InstantiatedPlugin>([["content", contentPlugin]]);

			const dispatcher = new CommandDispatcher(eventBus, plugins);
			const command: BaseCommand = { type: "content.fetch" };

			const result = await dispatcher.dispatch(command);

			expect(executeCommand).toHaveBeenCalledWith(command);
			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toBe("success");
		});

		it("should emit command:start event before execution", async () => {
			const eventBus = createMockEventBus();
			const emitSpy = vi.spyOn(eventBus, "emit");
			const executeCommand = vi.fn().mockReturnValue(okAsync(undefined));

			const plugin: InstantiatedPlugin = { executeCommand };
			const plugins = new Map<string, InstantiatedPlugin>([["content", plugin]]);

			const dispatcher = new CommandDispatcher(eventBus, plugins);
			const command: BaseCommand = { type: "content.fetch", sources: ["test"] };

			await dispatcher.dispatch(command);

			expect(emitSpy).toHaveBeenCalledWith("command:start", {
				commandType: "content.fetch",
				type: "content.fetch",
				sources: ["test"],
			});
		});

		it("should emit command:success event on successful execution", async () => {
			const eventBus = createMockEventBus();
			const emitSpy = vi.spyOn(eventBus, "emit");
			const executeCommand = vi.fn().mockReturnValue(okAsync({ files: 42 }));

			const plugin: InstantiatedPlugin = { executeCommand };
			const plugins = new Map<string, InstantiatedPlugin>([["content", plugin]]);

			const dispatcher = new CommandDispatcher(eventBus, plugins);
			const command: BaseCommand = { type: "content.fetch" };

			await dispatcher.dispatch(command);

			expect(emitSpy).toHaveBeenCalledWith("command:success", {
				commandType: "content.fetch",
				result: { files: 42 },
			});
		});

		it("should emit command:error event on failed execution", async () => {
			const eventBus = createMockEventBus();
			const emitSpy = vi.spyOn(eventBus, "emit");
			const error = new Error("Fetch failed");
			const executeCommand = vi.fn().mockReturnValue(errAsync(error));

			const plugin: InstantiatedPlugin = { executeCommand };
			const plugins = new Map<string, InstantiatedPlugin>([["content", plugin]]);

			const dispatcher = new CommandDispatcher(eventBus, plugins);
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

		it("should return error when plugin not found", async () => {
			const eventBus = createMockEventBus();
			const emitSpy = vi.spyOn(eventBus, "emit");
			const plugins = new Map<string, InstantiatedPlugin>();

			const dispatcher = new CommandDispatcher(eventBus, plugins);
			const command: BaseCommand = { type: "content.fetch" };

			const result = await dispatcher.dispatch(command);

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("Plugin 'content' not available");
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

		it("should return error when plugin does not implement CommandExecutor", async () => {
			const eventBus = createMockEventBus();
			const emitSpy = vi.spyOn(eventBus, "emit");

			// Plugin without executeCommand method
			const plugin: InstantiatedPlugin = {};
			const plugins = new Map<string, InstantiatedPlugin>([["content", plugin]]);

			const dispatcher = new CommandDispatcher(eventBus, plugins);
			const command: BaseCommand = { type: "content.fetch" };

			const result = await dispatcher.dispatch(command);

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain(
				"Plugin 'content' does not support command execution",
			);
			expect(result._unsafeUnwrapErr().message).toContain(
				"The plugin must implement the CommandExecutor interface",
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
			const eventBus = createMockEventBus();
			const emitSpy = vi.spyOn(eventBus, "emit");
			const plugins = new Map<string, InstantiatedPlugin>();

			const dispatcher = new CommandDispatcher(eventBus, plugins);
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
			const eventBus = createMockEventBus();
			const emitSpy = vi.spyOn(eventBus, "emit");
			const plugins = new Map<string, InstantiatedPlugin>();

			const dispatcher = new CommandDispatcher(eventBus, plugins);
			const command: BaseCommand = { type: "invalid-no-dot" };

			const result = await dispatcher.dispatch(command);

			// Should treat whole string as plugin name
			expect(result.isErr()).toBe(true);
			expect(emitSpy).toHaveBeenCalledWith(
				"command:error",
				expect.objectContaining({
					error: expect.any(Error),
				}),
			);
		});

		it("should extract plugin name from command type correctly", async () => {
			const eventBus = createMockEventBus();
			const executeCommand = vi.fn().mockReturnValue(okAsync(undefined));

			const plugin: InstantiatedPlugin = { executeCommand };
			const plugins = new Map<string, InstantiatedPlugin>([["monitor", plugin]]);

			const dispatcher = new CommandDispatcher(eventBus, plugins);

			// Test different command formats
			await dispatcher.dispatch({ type: "monitor.connect" });
			await dispatcher.dispatch({ type: "monitor.app.start" });
			await dispatcher.dispatch({ type: "monitor.app.window.foreground" });

			expect(executeCommand).toHaveBeenCalledTimes(3);
		});

		it("should pass through plugin execution errors", async () => {
			const eventBus = createMockEventBus();
			const customError = new Error("Custom plugin error");
			const executeCommand = vi.fn().mockReturnValue(errAsync(customError));

			const plugin: InstantiatedPlugin = { executeCommand };
			const plugins = new Map<string, InstantiatedPlugin>([["content", plugin]]);

			const dispatcher = new CommandDispatcher(eventBus, plugins);
			const command: BaseCommand = { type: "content.fetch" };

			const result = await dispatcher.dispatch(command);

			expect(result.isErr()).toBe(true);
			// Error is wrapped in CommandExecutionError with the original error as cause
			const error = result._unsafeUnwrapErr();
			expect(error.message).toContain("Plugin command execution failed");
			expect(error.cause).toBe(customError);
		});

		it("should handle multiple plugins correctly", async () => {
			const eventBus = createMockEventBus();
			const contentExecute = vi.fn().mockReturnValue(okAsync("content-result"));
			const monitorExecute = vi.fn().mockReturnValue(okAsync("monitor-result"));

			const contentPlugin: InstantiatedPlugin = { executeCommand: contentExecute };
			const monitorPlugin: InstantiatedPlugin = { executeCommand: monitorExecute };

			const plugins = new Map<string, InstantiatedPlugin>([
				["content", contentPlugin],
				["monitor", monitorPlugin],
			]);

			const dispatcher = new CommandDispatcher(eventBus, plugins);

			await dispatcher.dispatch({ type: "content.fetch" });
			await dispatcher.dispatch({ type: "monitor.connect" });

			expect(contentExecute).toHaveBeenCalledTimes(1);
			expect(monitorExecute).toHaveBeenCalledTimes(1);
		});
	});
});
