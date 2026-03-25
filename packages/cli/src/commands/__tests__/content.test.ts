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

import type { LaunchpadController } from "@bluecadet/launchpad-controller";
import { controllerConfigSchema } from "@bluecadet/launchpad-controller/config";
import type { IPCClient } from "@bluecadet/launchpad-controller/ipc-client";
import {
	createMockController,
	createMockIPCClient,
} from "@bluecadet/launchpad-testing/test-utils.ts";
import { errAsync, okAsync } from "neverthrow";
import { ConfigError } from "../../errors.js";
import { resolveLaunchpadConfig } from "../../launchpad-config.js";
import { handleFatalError, loadConfigAndEnv } from "../../utils/command-utils.js";
import { withDaemonOrController } from "../../utils/controller-execution.js";
import { content } from "../content.js";

const mockControllerConfig = controllerConfigSchema.parse({});
const mockConfig = resolveLaunchpadConfig({ controller: mockControllerConfig });

describe("content", () => {
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

	it("no content plugin in config — result is Err with ConfigError", async () => {
		const result = await content({});

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toBeInstanceOf(ConfigError);
	});

	it("daemon running (ifDaemon) — client.executeCommand({ type: 'content.fetch' }) called", async () => {
		const mockContentPlugin = { name: "content" as const, setup: vi.fn() };
		const configWithContent = resolveLaunchpadConfig({ plugins: [mockContentPlugin] });
		vi.mocked(loadConfigAndEnv).mockReturnValue(
			okAsync({ dir: "/test", config: configWithContent }),
		);

		const mockClient = createMockIPCClient();
		// Return the ResultAsync directly (no async wrapper) so .orElse() works
		vi.mocked(withDaemonOrController).mockImplementation((_dir, _cfg, opts) =>
			opts.ifDaemon(mockClient as unknown as IPCClient, 999),
		);

		const result = await content({});

		expect(result.isOk()).toBe(true);
		expect(vi.mocked(mockClient.executeCommand)).toHaveBeenCalledWith({ type: "content.fetch" });
	});

	it("no daemon (otherwise) — controller.registerPlugin() then controller.executeCommand() called", async () => {
		const mockContentPlugin = { name: "content" as const, setup: vi.fn() };
		const configWithContent = resolveLaunchpadConfig({ plugins: [mockContentPlugin] });
		vi.mocked(loadConfigAndEnv).mockReturnValue(
			okAsync({ dir: "/test", config: configWithContent }),
		);

		const mockController = createMockController();
		// Return the ResultAsync directly (no async wrapper) so .orElse() works
		vi.mocked(withDaemonOrController).mockImplementation((_dir, _cfg, opts) =>
			opts.otherwise(mockController as unknown as LaunchpadController),
		);

		const result = await content({});

		expect(result.isOk()).toBe(true);
		expect(vi.mocked(mockController.registerPlugin)).toHaveBeenCalledWith(mockContentPlugin);
		expect(vi.mocked(mockController.executeCommand)).toHaveBeenCalledWith({
			type: "content.fetch",
		});
	});

	it("calls handleFatalError when loadConfigAndEnv fails", async () => {
		vi.mocked(loadConfigAndEnv).mockReturnValue(errAsync(new ConfigError("no config")));
		vi.mocked(handleFatalError).mockImplementation(() => {
			throw new Error("fatal");
		});
		await expect(content({})).rejects.toThrow("fatal");
	});
});
