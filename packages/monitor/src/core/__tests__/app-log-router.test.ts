import { createMockLogger } from "@bluecadet/launchpad-testing/test-utils.ts";
import type { Logger } from "@bluecadet/launchpad-utils";
import type { SubEmitterSocket } from "axon";
import { describe, expect, it, vi } from "vitest";
import { LogModes, type ResolvedAppConfig } from "../../monitor-config.js";
import AppLogRouter from "../app-log-router.js";
import { createMockSubEmitterSocket } from "./core.test-utils.js";

vi.mock("@bluecadet/launchpad-utils", async () => {
	return {
		LogManager: {
			getInstance: vi.fn(() => ({
				getFilePath: vi.fn((name) => `/logs/${name}.log`),
			})),
			/**
			 * @param {string} name
			 * @param {import('@bluecadet/launchpad-utils').Logger} parent
			 * @returns {import('@bluecadet/launchpad-utils').Logger}
			 */
			getLogger: (name: string, parent: Logger) => {
				return parent.child({ module: name });
			},
		},
	};
});

type DeepPartial<T> = {
	[P in keyof T]?: DeepPartial<T[P]>;
};

function buildTestAppLogRouter(configOverrides: DeepPartial<ResolvedAppConfig> = {}) {
	const rootLogger = createMockLogger();

	const mockAppConfig = {
		pm2: {
			name: "test-app",
			script: "test.js",
			...configOverrides.pm2,
		},
		windows: {
			foreground: false,
			minimize: false,
			hide: false,
			...configOverrides.windows,
		},
		logging: {
			logToLaunchpadDir: true,
			mode: LogModes.LogBusEvents,
			showStdout: true,
			showStderr: true,
			...configOverrides.logging,
		},
	} as ResolvedAppConfig;

	const appLogRouter = new AppLogRouter(rootLogger);
	appLogRouter.initAppOptions(mockAppConfig);
	const appLogger = rootLogger.children.get("test-app")!;
	return { appLogRouter, appLogger, rootLogger, mockAppConfig };
}

describe("AppLogRouter", () => {
	describe("initAppOptions", () => {
		it("should initialize bus logging relay when mode is bus", () => {
			const { mockAppConfig } = buildTestAppLogRouter();

			expect(mockAppConfig.pm2.output).toBe("/dev/null");
			expect(mockAppConfig.pm2.error).toBe("/dev/null");
		});

		it("should initialize file logging relay when mode is file", () => {
			const { mockAppConfig } = buildTestAppLogRouter({
				logging: {
					mode: LogModes.TailLogFile,
				},
			});

			expect(mockAppConfig.pm2.output).toBe("/logs/test-app-stdout.log");
			expect(mockAppConfig.pm2.error).toBe("/logs/test-app-stderr.log");
		});
	});

	describe("event handling", () => {
		it("should route events to correct log relay", () => {
			const { appLogRouter, appLogger } = buildTestAppLogRouter();
			const { mockSubEmitterSocket, emit } = createMockSubEmitterSocket();

			appLogRouter.connectToBus(mockSubEmitterSocket);
			expect(mockSubEmitterSocket.on).toHaveBeenCalledWith("*", expect.any(Function));

			emit("log:out", {
				process: { name: "test-app" },
				data: "test log message\n",
			});

			expect(appLogger.info).toHaveBeenCalledWith("test log message");

			emit("log:err", {
				process: { name: "test-app" },
				data: "test err message\n",
			});

			expect(appLogger.error).toHaveBeenCalledWith("test err message");
		});

		it("should handle disconnection", () => {
			const { appLogRouter } = buildTestAppLogRouter();

			const { mockSubEmitterSocket } = createMockSubEmitterSocket();

			appLogRouter.connectToBus(mockSubEmitterSocket);
			appLogRouter.disconnectFromBus(mockSubEmitterSocket);

			expect(mockSubEmitterSocket.off).toHaveBeenCalledWith("*");
		});
	});
});
