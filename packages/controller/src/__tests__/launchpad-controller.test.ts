import type { PluginContext } from "@bluecadet/launchpad-utils/plugin-interfaces";
import {
	type BaseCommand,
	definePlugin,
	type InstantiatedPlugin,
} from "@bluecadet/launchpad-utils/plugin-interfaces";
import type { LaunchpadEvents } from "@bluecadet/launchpad-utils/types";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";
import { controllerConfigSchema } from "../controller-config.js";
import { LaunchpadController } from "../launchpad-controller.js";

describe("LaunchpadController", () => {
	const config = controllerConfigSchema.parse({ pidFile: "./pid", socketPath: "./socket" });

	function createController(mode?: "task" | "persistent") {
		return new LaunchpadController(config, "/test", mode);
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

		it("should reject duplicate plugin names", async () => {
			const controller = createController();

			const firstResult = await controller.registerPlugin(makePlugin("content"));
			const secondResult = await controller.registerPlugin(makePlugin("content"));

			expect(firstResult.isOk()).toBe(true);
			expect(secondResult.isErr()).toBe(true);
			expect(secondResult._unsafeUnwrapErr().message).toContain("already registered");
		});

		it("should reject duplicate explicit command registrations", async () => {
			const controller = createController();

			const firstResult = await controller.registerPlugin(
				definePlugin({
					name: "first",
					manifest: {
						commands: [{ id: "shared.run" }],
					},
					setup: () => okAsync({ executeCommand: vi.fn().mockReturnValue(okAsync(undefined)) }),
				}),
			);
			const secondResult = await controller.registerPlugin(
				definePlugin({
					name: "second",
					manifest: {
						commands: [{ id: "shared.run" }],
					},
					setup: () => okAsync({ executeCommand: vi.fn().mockReturnValue(okAsync(undefined)) }),
				}),
			);

			expect(firstResult.isOk()).toBe(true);
			expect(secondResult.isErr()).toBe(true);
			expect(secondResult._unsafeUnwrapErr().message).toContain("already registered");
		});

		it("should reject plugins that declare manifest commands without executeCommand", async () => {
			const controller = createController();

			const result = await controller.registerPlugin(
				definePlugin({
					name: "broken",
					manifest: {
						commands: [{ id: "broken.run" }],
					},
					setup: () => okAsync({}),
				}),
			);

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("does not implement executeCommand");
		});
	});

	describe("plugin fault containment", () => {
		it("contains a plugin setup that throws synchronously", async () => {
			const controller = createController();

			const result = await controller.registerPlugin(
				definePlugin({
					name: "explosive",
					setup: () => {
						throw new Error("setup exploded");
					},
				}),
			);

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toBe("setup exploded");
			expect(controller.hasPlugin("explosive")).toBe(false);
		});

		it("keeps the workflow and controller running when a plugin command throws", async () => {
			const controller = createController("task");
			const healthyExecute = vi.fn().mockReturnValue(okAsync(undefined));

			await controller.registerPlugin(
				definePlugin({
					name: "explosive",
					manifest: { commands: [{ id: "explosive.run" }] },
					setup: () =>
						okAsync({
							executeCommand: () => {
								throw new Error("command exploded");
							},
						}),
				}),
			);
			await controller.registerPlugin(
				definePlugin({
					name: "healthy",
					manifest: { commands: [{ id: "healthy.run" }] },
					setup: () => okAsync({ executeCommand: healthyExecute }),
				}),
			);

			await controller.start();
			controller.setWorkflows({ start: ["explosive.run", "healthy.run"] });

			const workflowResult = await controller.runWorkflow("start");

			// The workflow reports the failure, but the throwing plugin didn't
			// unwind the runner: the next step still executed…
			expect(workflowResult.isErr()).toBe(true);
			expect(healthyExecute).toHaveBeenCalledWith({ type: "healthy.run" });

			// …and the controller is still alive and dispatching commands.
			expect(controller.isStarted()).toBe(true);
			const followUp = await controller.executeCommand({ type: "healthy.run" });
			expect(followUp.isOk()).toBe(true);

			const stopResult = await controller.stop();
			expect(stopResult.isOk()).toBe(true);
		});

		it("keeps the workflow running when a plugin command rejects its underlying promise", async () => {
			const controller = createController("task");
			const healthyExecute = vi.fn().mockReturnValue(okAsync(undefined));

			await controller.registerPlugin(
				definePlugin({
					name: "rejecting",
					manifest: { commands: [{ id: "rejecting.run" }] },
					setup: () =>
						okAsync({
							executeCommand: () =>
								ResultAsync.fromSafePromise(Promise.reject(new Error("promise rejected"))),
						}),
				}),
			);
			await controller.registerPlugin(
				definePlugin({
					name: "healthy",
					manifest: { commands: [{ id: "healthy.run" }] },
					setup: () => okAsync({ executeCommand: healthyExecute }),
				}),
			);

			await controller.start();
			controller.setWorkflows({ start: ["rejecting.run", "healthy.run"] });

			const workflowResult = await controller.runWorkflow("start");

			expect(workflowResult.isErr()).toBe(true);
			expect(healthyExecute).toHaveBeenCalledWith({ type: "healthy.run" });
			expect(controller.isStarted()).toBe(true);
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
			await controller.registerPlugin(
				definePlugin({
					name: "test",
					manifest: { commands: [{ id: "test.command" }] },
					setup: () => okAsync({ executeCommand }),
				}),
			);

			await controller.start();
			const result = await controller.executeCommand({ type: "test.command" });

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
	});

	describe("executeCommand", () => {
		it("should execute command through dispatcher and return result", async () => {
			const controller = createController();
			const executeCommand = vi.fn().mockReturnValue(okAsync("result"));
			await controller.registerPlugin(
				definePlugin({
					name: "test",
					manifest: { commands: [{ id: "test.command" }] },
					setup: () => okAsync({ executeCommand }),
				}),
			);

			await controller.start();
			const command: BaseCommand = { type: "test.command" };
			const result = await controller.executeCommand(command);

			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toBe("result");
			expect(executeCommand).toHaveBeenCalledWith(command);
		});

		it("should return error when controller not started", async () => {
			const controller = createController();
			const command: BaseCommand = { type: "test.command" };
			const result = await controller.executeCommand(command);

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toBe(
				"Controller must be started before executing commands",
			);
		});

		it("should return error when command is not registered", async () => {
			const controller = createController();
			await controller.registerPlugin(
				definePlugin({
					name: "test",
					manifest: { commands: [{ id: "test.command" }] },
					setup: () => okAsync({ executeCommand: vi.fn().mockReturnValue(okAsync(undefined)) }),
				}),
			);

			await controller.start();
			const result = await controller.executeCommand({ type: "test.other" });

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("is not registered");
		});
	});

	describe("getState", () => {
		it("should return aggregated state", async () => {
			const controller = createController();
			await controller.registerPlugin(
				definePlugin({
					name: "test",
					setup(ctx: PluginContext<{ value: string }>) {
						ctx.updateState(() => ({ value: "test-state" }));
						return okAsync({});
					},
				}),
			);

			const state = controller.getState();
			const pluginStates = state.plugins as Record<string, unknown>;
			const testState = pluginStates.test as { value: string } | undefined;

			expect(state.system).toBeDefined();
			expect(state.plugins).toBeDefined();
			expect(testState).toEqual({ value: "test-state" });
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

	describe("explicit registration and workflows", () => {
		it("should expose registered command ids for explicit manifests", async () => {
			const controller = createController();
			await controller.registerPlugin(
				definePlugin({
					name: "test",
					manifest: {
						commands: [{ id: "test.command" }, { id: "test.aliasable", aliases: ["test.old"] }],
					},
					setup: () => okAsync({ executeCommand: vi.fn().mockReturnValue(okAsync(undefined)) }),
				}),
			);

			expect(controller.getRegisteredCommandIds()).toEqual(["test.command", "test.aliasable"]);
		});

		it("should run configured workflows through the controller", async () => {
			const controller = createController();
			const executeCommand = vi.fn().mockReturnValue(okAsync(undefined));
			await controller.registerPlugin(
				definePlugin({
					name: "content",
					manifest: {
						commands: [{ id: "content.fetch" }, { id: "content.clear" }],
					},
					setup: () => okAsync({ executeCommand }),
				}),
			);
			await controller.start();
			controller.setWorkflows({
				refresh: ["content.fetch", { type: "content.clear" }],
			});

			const result = await controller.runWorkflow("refresh");

			expect(result.isOk()).toBe(true);
			expect(executeCommand).toHaveBeenNthCalledWith(1, { type: "content.fetch" });
			expect(executeCommand).toHaveBeenNthCalledWith(2, { type: "content.clear" });
		});

		it("should run stop workflow before plugin disconnects", async () => {
			const controller = createController();
			const calls: string[] = [];
			await controller.registerPlugin(
				definePlugin({
					name: "monitor",
					manifest: {
						commands: [{ id: "monitor.stop" }],
					},
					setup: () =>
						okAsync({
							executeCommand: vi.fn().mockImplementation(() => {
								calls.push("execute");
								return okAsync(undefined);
							}),
							disconnect: vi.fn().mockImplementation(() => {
								calls.push("disconnect");
								return okAsync(undefined);
							}),
						}),
				}),
			);
			await controller.start();
			controller.setWorkflows({ stop: ["monitor.stop"] });

			const result = await controller.stop();

			expect(result.isOk()).toBe(true);
			expect(calls).toEqual(["execute", "disconnect"]);
		});

		it("should disconnect plugins even when no stop workflow is configured", async () => {
			const controller = createController();
			const disconnect = vi.fn().mockReturnValue(okAsync(undefined));
			await controller.registerPlugin(makePlugin("monitor", { disconnect }));
			await controller.start();

			const result = await controller.stop();

			expect(result.isOk()).toBe(true);
			expect(disconnect).toHaveBeenCalledTimes(1);
		});

		it("should still disconnect plugins when the stop workflow fails", async () => {
			const controller = createController();
			const calls: string[] = [];
			await controller.registerPlugin(
				definePlugin({
					name: "monitor",
					manifest: {
						commands: [{ id: "monitor.stop" }],
					},
					setup: () =>
						okAsync({
							executeCommand: vi.fn().mockImplementation(() => {
								calls.push("execute");
								return okAsync(undefined);
							}),
							disconnect: vi.fn().mockImplementation(() => {
								calls.push("disconnect");
								return okAsync(undefined);
							}),
						}),
				}),
			);
			await controller.registerPlugin(
				definePlugin({
					name: "failing",
					manifest: {
						commands: [{ id: "failing.stop" }],
					},
					setup: () =>
						okAsync({
							executeCommand: vi.fn().mockImplementation(() => errAsync(new Error("stop failed"))),
						}),
				}),
			);
			await controller.start();
			controller.setWorkflows({ stop: ["monitor.stop", "failing.stop"] });

			const result = await controller.stop();

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("Plugin command execution failed");
			expect(calls).toEqual(["execute", "disconnect"]);
		});
	});

	describe("integration", () => {
		it("should coordinate multiple plugins through controller", async () => {
			const controller = createController();
			const contentExecute = vi.fn().mockReturnValue(okAsync("content-done"));
			const monitorExecute = vi.fn().mockReturnValue(okAsync("monitor-done"));

			await controller.registerPlugin(
				definePlugin({
					name: "content",
					manifest: { commands: [{ id: "content.fetch" }] },
					setup: () => okAsync({ executeCommand: contentExecute }),
				}),
			);
			await controller.registerPlugin(
				definePlugin({
					name: "monitor",
					manifest: { commands: [{ id: "monitor.connect" }] },
					setup: () => okAsync({ executeCommand: monitorExecute }),
				}),
			);

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
					manifest: { commands: [{ id: "content.fetch" }] },
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
					manifest: { commands: [{ id: "monitor.connect" }] },
					setup(ctx) {
						ctx.updateState(() => ({ isConnected: false }));
						return okAsync({ executeCommand: () => okAsync(undefined) });
					},
				}),
			);

			await controller.start();
			await controller.executeCommand({ type: "content.fetch" });

			const state = controller.getState();
			const pluginStates = state.plugins as Record<string, unknown>;
			const contentState = pluginStates.content as { isFetching: boolean } | undefined;

			expect(contentState).toEqual({ isFetching: true });
			expect(events).toContain("command:start");
			expect(events).toContain("command:success");
		});
	});
});
