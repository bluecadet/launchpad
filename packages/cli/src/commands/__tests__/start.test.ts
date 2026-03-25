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
vi.mock("../../utils/detached-messaging.js", () => ({
	isDetached: false,
	isValidChildLogMessage: vi.fn().mockReturnValue(false),
	isValidReadyMessage: vi.fn((msg) => {
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
vi.mock("node:child_process", () => ({
	fork: vi.fn(),
}));

import { fork } from "node:child_process";
import { EventEmitter } from "node:events";
import type { LaunchpadController } from "@bluecadet/launchpad-controller";
import { controllerConfigSchema } from "@bluecadet/launchpad-controller/config";
import { createMockController } from "@bluecadet/launchpad-testing/test-utils.ts";
import { errAsync, okAsync } from "neverthrow";
import { resolveLaunchpadConfig } from "../../launchpad-config.js";
import { handleFatalError, loadConfigAndEnv } from "../../utils/command-utils.js";
import { withDaemonOrController } from "../../utils/controller-execution.js";
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
		it("daemon already running — process.exit(1) called", async () => {
			const exitSpy = vi.spyOn(process, "exit").mockImplementation((_code) => {
				throw new Error("process.exit");
			}) as unknown as ReturnType<typeof vi.spyOn>;

			// withDaemonOrController calls ifDaemon which calls process.exit(1) synchronously
			vi.mocked(withDaemonOrController).mockImplementation((_dir, _cfg, opts) => {
				// Calling ifDaemon will throw because of our process.exit mock
				try {
					return opts.ifDaemon({} as unknown as LaunchpadController, 999) as ReturnType<
						typeof withDaemonOrController
					>;
				} catch (e) {
					throw e;
				}
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

		it("no daemon, with plugins — registerPlugin called for each plugin and startup commands executed", async () => {
			const startupCmd = { type: "content.fetch" as const };
			const mockPlugin = {
				name: "content" as const,
				setup: vi.fn(),
				startupCommands: [startupCmd],
			};
			const configWithPlugin = resolveLaunchpadConfig({ plugins: [mockPlugin] });
			vi.mocked(loadConfigAndEnv).mockReturnValue(
				okAsync({ dir: "/test", config: configWithPlugin }),
			);

			const mockController = createMockController();
			// Return the ResultAsync directly (no async wrapper) so .orElse() works
			vi.mocked(withDaemonOrController).mockImplementation((_dir, _cfg, opts) =>
				opts.otherwise(mockController as unknown as LaunchpadController),
			);

			const result = await start({ detach: false });

			expect(result.isOk()).toBe(true);
			expect(vi.mocked(mockController.registerPlugin)).toHaveBeenCalledWith(mockPlugin);
			expect(vi.mocked(mockController.executeCommand)).toHaveBeenCalledWith(startupCmd);
		});
	});

	describe("detached mode", () => {
		beforeEach(() => {
			process.argv = ["node", "/path/to/cli.js", "start", "--detach"];
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
	});
});
