vi.mock("../../utils/command-utils.js");
vi.mock("../../utils/controller-execution.js");
vi.mock("../../utils/cli-logger.js", async () => ({
	cliLogger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		verbose: vi.fn(),
		fixed: vi.fn(),
		fromPayload: vi.fn(),
		setLevel: vi.fn(),
	},
}));
vi.mock("../../utils/on-terminate.js", () => ({
	onTerminate: vi.fn(),
}));
const detachedMock = vi.hoisted(() => ({
	isDetached: false,
	isValidChildLogMessage: vi.fn().mockReturnValue(false),
	isValidReadyMessage: vi.fn((msg: unknown) => {
		return (
			typeof msg === "object" &&
			msg !== null &&
			"type" in msg &&
			(msg as Record<string, unknown>).type === "ready"
		);
	}),
	sendReadyMessage: vi.fn(),
	forwardLog: vi.fn(),
}));
vi.mock("../../utils/detached-messaging.js", () => detachedMock);
vi.mock("node:child_process", () => ({
	fork: vi.fn(),
}));

import { fork } from "node:child_process";
import { EventEmitter } from "node:events";
import type { LaunchpadController } from "@bluecadet/launchpad-controller";
import { controllerConfigSchema } from "@bluecadet/launchpad-controller/config";
import type { IPCClient } from "@bluecadet/launchpad-controller/ipc-client";
import { createMockController } from "@bluecadet/launchpad-testing/test-utils.ts";
import { errAsync, okAsync } from "neverthrow";
import { ConfigError } from "../../errors.js";
import { resolveLaunchpadConfig } from "../../launchpad-config.js";
import { cliLogger } from "../../utils/cli-logger.js";
import { handleFatalError, loadConfigAndEnv } from "../../utils/command-utils.js";
import { withDaemonOrController } from "../../utils/controller-execution.js";
import { onTerminate } from "../../utils/on-terminate.js";
import { start } from "../start.js";

const mockControllerConfig = controllerConfigSchema.parse({});
const mockConfig = resolveLaunchpadConfig({ controller: mockControllerConfig });

type MockChild = EventEmitter & {
	pid: number;
	unref: ReturnType<typeof vi.fn>;
	disconnect: ReturnType<typeof vi.fn>;
};

const createMockChild = (): MockChild => {
	const child = new EventEmitter() as MockChild;
	child.pid = 999;
	child.unref = vi.fn();
	child.disconnect = vi.fn();
	return child;
};

describe("start", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(loadConfigAndEnv).mockReturnValue(okAsync({ dir: "/test", config: mockConfig }));
		vi.mocked(handleFatalError).mockImplementation(() => {
			throw new Error("fatal");
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("foreground mode", () => {
		beforeEach(() => {
			detachedMock.isDetached = false;
		});

		it("daemon already running — process.exit(1) called", async () => {
			const exitSpy = vi.spyOn(process, "exit").mockImplementation((_code) => {
				throw new Error("process.exit");
			}) as unknown as ReturnType<typeof vi.spyOn>;

			// withDaemonOrController calls ifDaemon which calls process.exit(1) synchronously
			vi.mocked(withDaemonOrController).mockImplementation((_dir, _cfg, opts) => {
				return opts.ifDaemon({} as unknown as IPCClient, 999) as ReturnType<
					typeof withDaemonOrController
				>;
			});

			await expect(start({ detach: false })).rejects.toThrow("process.exit");
			expect(exitSpy).toHaveBeenCalledWith(1);
		});

		it("no daemon, no plugins — resolves without error", async () => {
			const mockController = createMockController();
			// Return the ResultAsync directly (no async wrapper) so .orElse() works
			vi.mocked(withDaemonOrController).mockImplementation((_dir, _cfg, opts) =>
				opts.otherwise(mockController as unknown as LaunchpadController),
			);

			const result = await start({ detach: false });

			expect(result.isOk()).toBe(true);
		});

		it("no daemon, with plugins — registers plugins, sets workflows, and runs start workflow", async () => {
			const workflows = {
				start: ["content.fetch"],
			} as const;
			const mockPlugin = {
				name: "content" as const,
				setup: vi.fn(),
			};
			const configWithPlugin = resolveLaunchpadConfig({ plugins: [mockPlugin], workflows });
			vi.mocked(loadConfigAndEnv).mockReturnValue(
				okAsync({ dir: "/test", config: configWithPlugin }),
			);

			const mockController = createMockController();
			vi.mocked(withDaemonOrController).mockImplementation((_dir, _cfg, opts) =>
				opts.otherwise(mockController as unknown as LaunchpadController),
			);

			const result = await start({ detach: false });

			expect(result.isOk()).toBe(true);
			expect(vi.mocked(mockController.registerPlugin)).toHaveBeenCalledWith(mockPlugin);
			expect(vi.mocked(mockController.setWorkflows)).toHaveBeenCalledWith(workflows);
			expect(vi.mocked(mockController.runWorkflow)).toHaveBeenCalledWith("start");
		});

		it("running as detached child (isDetached=true) — sendReadyMessage called after startup workflow completes", async () => {
			detachedMock.isDetached = true;
			const callOrder: string[] = [];

			const mockController = createMockController({
				runWorkflow: vi.fn().mockImplementation(() => {
					callOrder.push("runWorkflow");
					return okAsync(undefined);
				}),
			});
			detachedMock.sendReadyMessage.mockImplementation(() => {
				callOrder.push("sendReadyMessage");
			});
			vi.mocked(withDaemonOrController).mockImplementation((_dir, _cfg, opts) =>
				opts.otherwise(mockController as unknown as LaunchpadController),
			);

			const result = await start({ detach: false });

			expect(result.isOk()).toBe(true);
			expect(detachedMock.sendReadyMessage).toHaveBeenCalled();
			expect(callOrder).toEqual(["runWorkflow", "sendReadyMessage"]);
		});

		it("SIGINT/SIGTERM registered callback calls controller.stop() and exits", async () => {
			const exitSpy = vi.spyOn(process, "exit").mockReturnValue(undefined as never);

			let terminateCallback: (() => void) | undefined;
			vi.mocked(onTerminate).mockImplementation((cb) => {
				terminateCallback = cb;
				return () => {};
			});

			const mockController = createMockController();
			vi.mocked(withDaemonOrController).mockImplementation((_dir, _cfg, opts) =>
				opts.otherwise(mockController as unknown as LaunchpadController),
			);

			await start({ detach: false });

			expect(terminateCallback).toBeDefined();
			terminateCallback!();
			expect(vi.mocked(mockController.stop)).toHaveBeenCalled();
			await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(0));
		});

		it("registerPlugin fails — handleFatalError called", async () => {
			const mockPlugin = { name: "content" as const, setup: vi.fn() };
			const configWithPlugin = resolveLaunchpadConfig({ plugins: [mockPlugin] });
			vi.mocked(loadConfigAndEnv).mockReturnValue(
				okAsync({ dir: "/test", config: configWithPlugin }),
			);

			const mockController = createMockController({
				registerPlugin: vi.fn().mockReturnValue(errAsync(new Error("Plugin failed"))),
			});
			vi.mocked(withDaemonOrController).mockImplementation((_dir, _cfg, opts) =>
				opts.otherwise(mockController as unknown as LaunchpadController),
			);

			await expect(start({ detach: false })).rejects.toThrow("fatal");
			expect(vi.mocked(handleFatalError)).toHaveBeenCalled();
		});

		it("start workflow fails — handleFatalError called", async () => {
			const mockPlugin = {
				name: "content" as const,
				setup: vi.fn(),
			};
			const configWithPlugin = resolveLaunchpadConfig({
				plugins: [mockPlugin],
				workflows: { start: ["content.fetch"] },
			});
			vi.mocked(loadConfigAndEnv).mockReturnValue(
				okAsync({ dir: "/test", config: configWithPlugin }),
			);

			const mockController = createMockController({
				runWorkflow: vi.fn().mockReturnValue(errAsync(new Error("Workflow failed"))),
			});
			vi.mocked(withDaemonOrController).mockImplementation((_dir, _cfg, opts) =>
				opts.otherwise(mockController as unknown as LaunchpadController),
			);

			await expect(start({ detach: false })).rejects.toThrow("fatal");
			expect(vi.mocked(handleFatalError)).toHaveBeenCalled();
		});

		it("loadConfigAndEnv fails — handleFatalError called", async () => {
			vi.mocked(loadConfigAndEnv).mockReturnValue(errAsync(new ConfigError("no config")));

			await expect(start({ detach: false })).rejects.toThrow("fatal");
			expect(vi.mocked(handleFatalError)).toHaveBeenCalled();
		});
	});

	describe("detached mode", () => {
		beforeEach(() => {
			process.argv = ["node", "/path/to/cli.js", "start", "--detach"];
			// Ensure this mock is reset to its default between tests — vi.clearAllMocks()
			// preserves mockReturnValue implementations, so an explicit reset is needed.
			detachedMock.isValidChildLogMessage.mockReturnValue(false);
		});

		it("child sends ready message — start resolves successfully", async () => {
			const child = createMockChild();
			vi.mocked(fork).mockReturnValue(child as unknown as ReturnType<typeof fork>);

			const resultPromise = start({ detach: true });

			// Simulate child sending ready message
			child.emit("message", { type: "ready" });

			const result = await resultPromise;
			expect(result.isOk()).toBe(true);
			expect(child.unref).toHaveBeenCalled();
			expect(child.disconnect).toHaveBeenCalled();
		});

		it("child exits with non-zero before sending ready — start rejects with error", async () => {
			const child = createMockChild();
			vi.mocked(fork).mockReturnValue(child as unknown as ReturnType<typeof fork>);

			const resultPromise = start({ detach: true });

			// Simulate child exiting with error before ready
			child.emit("exit", 1);

			const result = await resultPromise;
			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("exited with code 1");
		});

		it("child emits error event — start rejects with that error", async () => {
			const child = createMockChild();
			vi.mocked(fork).mockReturnValue(child as unknown as ReturnType<typeof fork>);

			const resultPromise = start({ detach: true });

			child.emit("error", new Error("spawn failed"));

			const result = await resultPromise;
			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().message).toContain("spawn failed");
		});

		it("child sends log message — cliLogger.fromPayload called with level and payload", async () => {
			// Only return true for the log message; fall back to false for the subsequent ready message
			detachedMock.isValidChildLogMessage.mockReturnValueOnce(true);
			const child = createMockChild();
			vi.mocked(fork).mockReturnValue(child as unknown as ReturnType<typeof fork>);

			const resultPromise = start({ detach: true });

			const logMsg = { type: "log", level: "info", payload: { args: ["hello"] } };
			child.emit("message", logMsg);
			// Also emit ready so it resolves
			child.emit("message", { type: "ready" });

			await resultPromise;
			expect(vi.mocked(cliLogger.fromPayload)).toHaveBeenCalledWith("info", {
				args: ["hello"],
			});
		});

		it("child sends unknown message — cliLogger.warn called", async () => {
			const child = createMockChild();
			vi.mocked(fork).mockReturnValue(child as unknown as ReturnType<typeof fork>);

			const resultPromise = start({ detach: true });

			child.emit("message", { type: "unknown-type" });
			// Also emit ready so it resolves
			child.emit("message", { type: "ready" });

			await resultPromise;
			expect(vi.mocked(cliLogger.warn)).toHaveBeenCalledWith(
				"Unknown message from detached process:",
				expect.anything(),
			);
		});
	});
});
