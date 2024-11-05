import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BusManager } from "../bus-manager.js";
import pm2 from "pm2";
import { createMockLogger } from "@bluecadet/launchpad-testing/test-utils.ts";
import { createMockSubEmitterSocket } from "./core.test-utils.js";

function buildTestBusManager() {
	const mockLogger = createMockLogger();

	const { mockSubEmitterSocket, emit } = createMockSubEmitterSocket();

	const busManager = new BusManager(mockLogger);

	// @ts-ignore
	vi.spyOn(pm2, "launchBus").mockImplementation((cb) => cb(null, mockSubEmitterSocket));

	return { busManager, mockLogger, mockSubEmitterSocket, emit };
}

describe("BusManager", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	describe("connect", () => {
		it("should connect to PM2 bus successfully", async () => {
			const { busManager, mockSubEmitterSocket, emit } = buildTestBusManager();

			const result = await busManager.connect();

			expect(pm2.launchBus).toHaveBeenCalled();
			expect(mockSubEmitterSocket.on).toHaveBeenCalledWith("*", expect.any(Function));
			expect(result.isOk()).toBe(true);
		});

		it("should handle connection errors", async () => {
			const { busManager } = buildTestBusManager();

			const testError = new Error("Bus connection failed");
			vi.spyOn(pm2, "launchBus").mockImplementation((cb) => cb(testError, null));

			const result = await busManager.connect();

			expect(result).toBeErr();
			expect(result._unsafeUnwrapErr().message).toContain("Bus connection failed");
		});
	});

	describe("disconnect", () => {
		it("should disconnect from PM2 bus successfully", async () => {
			const { busManager, mockSubEmitterSocket, emit } = buildTestBusManager();

			await busManager.connect();
			const result = await busManager.disconnect();

			expect(mockSubEmitterSocket.off).toHaveBeenCalledWith("*");
			expect(result.isOk()).toBe(true);
		});
	});
});
