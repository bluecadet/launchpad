import {
	defineSubsystem,
	type InstantiatedSubsystem,
} from "@bluecadet/launchpad-utils/subsystem-interfaces";
import type { LaunchpadEvents } from "@bluecadet/launchpad-utils/types";
import { okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";
import { LaunchpadController } from "../launchpad-controller.js";

declare module "@bluecadet/launchpad-utils/types" {
	interface SubsystemsState {
		[test: string]: any;
	}
	interface LaunchpadCommands {
		[type: string]: Record<string, unknown>;
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

	describe("constructor", () => {
		it("should create controller in task mode by default", () => {
			const controller = createController("task");

			expect(controller.getMode()).toBe("task");
		});

		it("should create controller in specified mode", () => {
			const controller = createController("persistent");

			expect(controller.getMode()).toBe("persistent");
		});

		it("should initialize state with correct mode", () => {
			const controller = createController("persistent");
			const state = controller.getState();

			expect(state.system.mode).toBe("persistent");
		});

		it("should not be started after construction", () => {
			const controller = createController("task");

			expect(controller.isStarted()).toBe(false);
		});
	});

	describe("registerSubsystem", () => {
		it("should register a subsystem", async () => {
			const controller = createController("task");

			const subsystemInner: InstantiatedSubsystem = {};

			const subsystem = defineSubsystem({
				name: "test",
				setup: () => okAsync(subsystemInner),
			});

			const _result = await controller.registerSubsystem(subsystem);

			expect(controller.hasSubsystem("test")).toBe(true);
			expect(controller.getSubsystem("test")).toBe(subsystemInner);
		});

		it("should allow registering multiple subsystems", async () => {
			const controller = createController();

			const subsystem1 = defineSubsystem({
				name: "content",
				setup: () => okAsync({}),
			});
			const subsystem2 = defineSubsystem({
				name: "monitor",
				setup: () => okAsync({}),
			});

			await controller.registerSubsystem(subsystem1);
			await controller.registerSubsystem(subsystem2);

			expect(controller.hasSubsystem("content")).toBe(true);
			expect(controller.hasSubsystem("monitor")).toBe(true);
		});
	});

	describe("getSubsystem", () => {
		it("should return registered subsystem", async () => {
			const controller = createController();

			const subsystemInner: InstantiatedSubsystem = {};

			const subsystem = defineSubsystem({
				name: "test",
				setup: () => okAsync(subsystemInner),
			});

			await controller.registerSubsystem(subsystem);

			expect(controller.getSubsystem("test")).toBe(subsystemInner);
		});

		it("should return undefined for non-existent subsystem", () => {
			const controller = createController();

			expect(controller.getSubsystem("non-existent")).toBeUndefined();
		});
	});

	describe("hasSubsystem", () => {
		it("should return true for registered subsystem", async () => {
			const controller = createController();
			const subsystem = defineSubsystem({
				name: "test",
				setup: () => okAsync({}),
			});

			await controller.registerSubsystem(subsystem);

			expect(controller.hasSubsystem("test")).toBe(true);
		});

		it("should return false for non-existent subsystem", () => {
			const controller = createController();

			expect(controller.hasSubsystem("non-existent")).toBe(false);
		});
	});

	describe("getSubsystemNames", () => {
		it("should return array of subsystem names", async () => {
			const controller = createController();

			await controller.registerSubsystem(
				defineSubsystem({
					name: "content",
					setup: () => okAsync({}),
				}),
			);
			await controller.registerSubsystem(
				defineSubsystem({
					name: "monitor",
					setup: () => okAsync({}),
				}),
			);

			const names = controller.getSubsystemNames();

			expect(names).toEqual(["content", "monitor"]);
		});

		it("should return empty array when no subsystems registered", () => {
			const controller = createController();

			expect(controller.getSubsystemNames()).toEqual([]);
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
			await controller.registerSubsystem(
				defineSubsystem({
					name: "test",
					setup: () => okAsync({ executeCommand }),
				}),
			);

			await controller.start();

			// Should be able to execute commands after start
			const command = { type: "test.command" };
			const result = await controller.executeCommand(command);

			expect(result.isOk()).toBe(true);
			expect(executeCommand).toHaveBeenCalled();
		});
	});

	describe("stop", () => {
		it("should stop the controller", async () => {
			const controller = createController();
			await controller.start();

			const result = await controller.stop();

			expect(result.isOk()).toBe(true);
			expect(controller.isStarted()).toBe(false);
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

		it("should disconnect subsystems that implement Disconnectable", async () => {
			const controller = createController();
			const disconnect = vi.fn().mockReturnValue(okAsync(undefined));
			await controller.registerSubsystem(
				defineSubsystem({
					name: "test",
					setup: () => okAsync({ disconnect }),
				}),
			);

			await controller.start();
			await controller.stop();

			expect(disconnect).toHaveBeenCalled();
		});

		it("should skip disconnecting subsystems without disconnect method", async () => {
			const controller = createController();
			await controller.registerSubsystem(
				defineSubsystem({
					name: "test",
					setup: () => okAsync({}),
				}),
			);

			await controller.start();

			// Should not throw
			const result = await controller.stop();
			expect(result.isOk()).toBe(true);
		});

		it("should abort pending operations", async () => {
			const controller = createController();
			await controller.start();

			const signal = controller.getAbortSignal();
			expect(signal.aborted).toBe(false);

			await controller.stop();

			expect(signal.aborted).toBe(true);
		});
	});

	describe("executeCommand", () => {
		it("should execute command through dispatcher", async () => {
			const controller = createController();
			const executeCommand = vi.fn().mockReturnValue(okAsync("result"));
			await controller.registerSubsystem(
				defineSubsystem({
					name: "test",
					setup: () => okAsync({ executeCommand }),
				}),
			);

			await controller.start();

			const command = { type: "test.command" };
			const result = await controller.executeCommand(command);

			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toBe("result");
			expect(executeCommand).toHaveBeenCalledWith(command);
		});

		it("should throw error when controller not started", () => {
			const controller = createController();

			const command = { type: "test.command" };

			expect(() => controller.executeCommand(command)).toThrow(
				"Controller must be started before executing commands",
			);
		});

		it("should pass through command execution errors", async () => {
			const controller = createController();
			const _error = new Error("Command failed");
			const executeCommand = vi.fn().mockReturnValue(okAsync(undefined));
			await controller.registerSubsystem(
				defineSubsystem({
					name: "test",
					setup: () => okAsync({ executeCommand }),
				}),
			);

			await controller.start();

			const command = { type: "test.command" };
			await controller.executeCommand(command);

			expect(executeCommand).toHaveBeenCalled();
		});
	});

	describe("getMode", () => {
		it("should return current mode", () => {
			const controller1 = createController("task");
			const controller2 = createController("persistent");

			expect(controller1.getMode()).toBe("task");
			expect(controller2.getMode()).toBe("persistent");
		});
	});

	describe("getState", () => {
		it("should return aggregated state", async () => {
			const controller = createController();
			const subsystem: InstantiatedSubsystem = {
				getState: () => ({ value: "test-state" }),
			};
			await controller.registerSubsystem(
				defineSubsystem({
					name: "test",
					setup: () => okAsync(subsystem),
				}),
			);

			const state = controller.getState();

			expect(state.system).toBeDefined();
			expect(state.subsystems).toBeDefined();
			expect(state.subsystems.test).toEqual({ value: "test-state" });
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
		it("should return AbortSignal for controller lifecycle", () => {
			const controller = createController();

			const signal = controller.getAbortSignal();

			expect(signal).toBeInstanceOf(AbortSignal);
			expect(signal.aborted).toBe(false);
		});

		it("should abort signal when controller stops", async () => {
			const controller = createController();
			const signal = controller.getAbortSignal();

			await controller.start();
			await controller.stop();

			expect(signal.aborted).toBe(true);
		});
	});

	describe("integration", () => {
		it("should coordinate multiple subsystems through controller", async () => {
			const controller = createController();

			// Setup subsystems
			const contentExecute = vi.fn().mockReturnValue(okAsync("content-done"));
			const monitorExecute = vi.fn().mockReturnValue(okAsync("monitor-done"));

			const contentSubsystem = defineSubsystem({
				name: "content",
				setup: () => okAsync({ executeCommand: contentExecute }),
			});
			const monitorSubsystem = defineSubsystem({
				name: "monitor",
				setup: () => okAsync({ executeCommand: monitorExecute }),
			});

			await controller.registerSubsystem(contentSubsystem);
			await controller.registerSubsystem(monitorSubsystem);

			await controller.start();

			// Execute commands
			await controller.executeCommand({ type: "content.fetch" });
			await controller.executeCommand({ type: "monitor.connect" });

			expect(contentExecute).toHaveBeenCalledWith({ type: "content.fetch" });
			expect(monitorExecute).toHaveBeenCalledWith({ type: "monitor.connect" });
		});

		it("should emit events and aggregate state across subsystems", async () => {
			const controller = createController();
			const eventBus = controller.getEventBus();
			const events: (keyof LaunchpadEvents)[] = [];

			eventBus.onAny((event) => events.push(event));

			const contentState = { isFetching: false };
			const monitorState = { isConnected: false };

			const contentSubsystem = defineSubsystem({
				name: "content",
				setup: () =>
					okAsync({
						executeCommand: () => {
							contentState.isFetching = true;
							return okAsync(undefined);
						},
						getState: () => contentState,
					}),
			});

			const monitorSubsystem = defineSubsystem({
				name: "monitor",
				setup: () =>
					okAsync({
						executeCommand: () => {
							monitorState.isConnected = true;
							return okAsync(undefined);
						},
						getState: () => monitorState,
					}),
			});

			await controller.registerSubsystem(contentSubsystem);
			await controller.registerSubsystem(monitorSubsystem);

			await controller.start();

			await controller.executeCommand({ type: "content.fetch" });

			const state = controller.getState();

			expect(state.subsystems.content).toEqual({ isFetching: true });
			expect(events).toContain("command:start");
			expect(events).toContain("command:success");
		});
	});
});
