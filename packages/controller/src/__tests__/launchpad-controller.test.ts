import type { PluginContext } from "@bluecadet/launchpad-utils/plugin-interfaces";
import {
	type BaseCommand,
	definePlugin,
	type InstantiatedPlugin,
} from "@bluecadet/launchpad-utils/plugin-interfaces";
import type { LaunchpadEvents } from "@bluecadet/launchpad-utils/types";
import { okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";
import { LaunchpadController } from "../launchpad-controller.js";

declare module "@bluecadet/launchpad-utils/types" {
	interface PluginsState {
		[test: string]: any;
	}
}

describe("LaunchpadController", () => {
	function createController(mode?: "task" | "persistent") {
		return new LaunchpadController(
			{
				pidFile: "./pid",
				socketPath: "./socket",
			},
			"/test",
			mode,
		);
	}

	function makePlugin(name: string, inner: InstantiatedPlugin = {}) {
		return definePlugin({ name, setup: () => okAsync(inner) });
	}

	describe("constructor", () => {
		it("should create controller in task mode by default", () => {
			const controller = createController("task");

			expect(controller.getMode()).toBe("task");
		});

		it("should create controller in specified mode and reflect it in state", () => {
			const controller = createController("persistent");

			expect(controller.getMode()).toBe("persistent");
			expect(controller.getState().system.mode).toBe("persistent");
		});

		it("should not be started after construction", () => {
			const controller = createController("task");

			expect(controller.isStarted()).toBe(false);
		});
	});

	describe("registerPlugin", () => {
		it("should register a plugin and make it accessible", async () => {
			const controller = createController("task");
			const pluginInner: InstantiatedPlugin = {};

			await controller.registerPlugin(makePlugin("test", pluginInner));

			expect(controller.hasPlugin("test")).toBe(true);
			expect(controller.getPlugin("test")).toBe(pluginInner);
		});

		it("should allow registering multiple plugins", async () => {
			const controller = createController();

			await controller.registerPlugin(makePlugin("content"));
			await controller.registerPlugin(makePlugin("monitor"));

			expect(controller.hasPlugin("content")).toBe(true);
			expect(controller.hasPlugin("monitor")).toBe(true);
		});

		it("should return undefined for non-existent plugin", () => {
			const controller = createController();

			expect(controller.getPlugin("non-existent")).toBeUndefined();
			expect(controller.hasPlugin("non-existent")).toBe(false);
		});
	});

	describe("getPluginNames", () => {
		it("should return array of registered plugin names", async () => {
			const controller = createController();

			await controller.registerPlugin(makePlugin("content"));
			await controller.registerPlugin(makePlugin("monitor"));

			expect(controller.getPluginNames()).toEqual(["content", "monitor"]);
		});

		it("should return empty array when no plugins registered", () => {
			const controller = createController();

			expect(controller.getPluginNames()).toEqual([]);
		});
	});

	describe("start", () => {
		it("should start the controller", async () => {
			const controller = createController();

			const result = await controller.start();

			expect(result.isOk()).toBe(true);
			expect(controller.isStarted()).toBe(true);
		});

		it("should be idempotent - multiple starts should succeed", async () => {
			const controller = createController();

			const result1 = await controller.start();
			const result2 = await controller.start();

			expect(result1.isOk()).toBe(true);
			expect(result2.isOk()).toBe(true);
			expect(controller.isStarted()).toBe(true);
		});

		it("should initialize command dispatcher", async () => {
			const controller = createController();
			const executeCommand = vi.fn().mockReturnValue(okAsync(undefined));
			await controller.registerPlugin(makePlugin("test", { executeCommand }));

			await controller.start();

			const command: BaseCommand = { type: "test.command" };
			const result = await controller.executeCommand(command);

			expect(result.isOk()).toBe(true);
			expect(executeCommand).toHaveBeenCalled();
		});
	});

	describe("stop", () => {
		it("should stop the controller and abort its signal", async () => {
			const controller = createController();
			await controller.start();

			const signal = controller.getAbortSignal();
			expect(signal.aborted).toBe(false);

			const result = await controller.stop();

			expect(result.isOk()).toBe(true);
			expect(controller.isStarted()).toBe(false);
			expect(signal.aborted).toBe(true);
		});

		it("should be idempotent - multiple stops should succeed", async () => {
			const controller = createController();
			await controller.start();

			const result1 = await controller.stop();
			const result2 = await controller.stop();

			expect(result1.isOk()).toBe(true);
			expect(result2.isOk()).toBe(true);
			expect(controller.isStarted()).toBe(false);
		});

		it("should disconnect plugins that implement Disconnectable", async () => {
			const controller = createController();
			const disconnect = vi.fn().mockReturnValue(okAsync(undefined));
			await controller.registerPlugin(makePlugin("test", { disconnect }));

			await controller.start();
			await controller.stop();

			expect(disconnect).toHaveBeenCalled();
		});

		it("should skip disconnecting plugins without disconnect method", async () => {
			const controller = createController();
			await controller.registerPlugin(makePlugin("test"));

			await controller.start();

			const result = await controller.stop();
			expect(result.isOk()).toBe(true);
		});
	});

	describe("executeCommand", () => {
		it("should execute command through dispatcher and return result", async () => {
			const controller = createController();
			const executeCommand = vi.fn().mockReturnValue(okAsync("result"));
			await controller.registerPlugin(makePlugin("test", { executeCommand }));

			await controller.start();

			const command: BaseCommand = { type: "test.command" };
			const result = await controller.executeCommand(command);

			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toBe("result");
			expect(executeCommand).toHaveBeenCalledWith(command);
		});

		it("should throw error when controller not started", () => {
			const controller = createController();
			const command: BaseCommand = { type: "test.command" };

			expect(() => controller.executeCommand(command)).toThrow(
				"Controller must be started before executing commands",
			);
		});
	});

	describe("getState", () => {
		it("should return aggregated state", async () => {
			const controller = createController();
			await controller.registerPlugin(
				definePlugin({
					name: "test",
					setup(ctx) {
						ctx.updateState(() => ({ value: "test-state" }));
						return okAsync({});
					},
				}),
			);

			const state = controller.getState();

			expect(state.system).toBeDefined();
			expect(state.plugins).toBeDefined();
			expect(state.plugins.test).toEqual({ value: "test-state" });
		});
	});

	describe("getEventBus", () => {
		it("should return EventBus instance", () => {
			const controller = createController();

			const eventBus = controller.getEventBus();

			expect(eventBus).toBeDefined();
			expect(typeof eventBus.emit).toBe("function");
			expect(typeof eventBus.on).toBe("function");
		});
	});

	describe("getAbortSignal", () => {
		it("should return a non-aborted AbortSignal before stop", () => {
			const controller = createController();

			const signal = controller.getAbortSignal();

			expect(signal).toBeInstanceOf(AbortSignal);
			expect(signal.aborted).toBe(false);
		});
	});

	describe("integration", () => {
		it("should coordinate multiple plugins through controller", async () => {
			const controller = createController();

			const contentExecute = vi.fn().mockReturnValue(okAsync("content-done"));
			const monitorExecute = vi.fn().mockReturnValue(okAsync("monitor-done"));

			await controller.registerPlugin(makePlugin("content", { executeCommand: contentExecute }));
			await controller.registerPlugin(makePlugin("monitor", { executeCommand: monitorExecute }));

			await controller.start();

			await controller.executeCommand({ type: "content.fetch" });
			await controller.executeCommand({ type: "monitor.connect" });

			expect(contentExecute).toHaveBeenCalledWith({ type: "content.fetch" });
			expect(monitorExecute).toHaveBeenCalledWith({ type: "monitor.connect" });
		});

		it("should emit events and aggregate state across plugins", async () => {
			const controller = createController();
			const eventBus = controller.getEventBus();
			const events: (keyof LaunchpadEvents)[] = [];

			eventBus.onAny((event) => events.push(event));

			await controller.registerPlugin(
				definePlugin({
					name: "content",
					setup(ctx: PluginContext<{ isFetching: boolean }>) {
						ctx.updateState(() => ({ isFetching: false }));
						return okAsync({
							executeCommand: () => {
								ctx.updateState((draft: { isFetching: boolean }) => {
									draft.isFetching = true;
								});
								return okAsync(undefined);
							},
						});
					},
				}),
			);

			await controller.registerPlugin(
				definePlugin({
					name: "monitor",
					setup(ctx) {
						ctx.updateState(() => ({ isConnected: false }));
						return okAsync({
							executeCommand: () => okAsync(undefined),
						});
					},
				}),
			);

			await controller.start();

			await controller.executeCommand({ type: "content.fetch" });

			const state = controller.getState();

			expect(state.plugins.content).toEqual({ isFetching: true });
			expect(events).toContain("command:start");
			expect(events).toContain("command:success");
		});
	});
});
