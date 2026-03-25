import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("detached-messaging", () => {
	beforeEach(() => {
		vi.resetModules();
		delete process.env.LAUNCHPAD_IS_DETACHED;
		delete (process as NodeJS.Process & { send?: unknown }).send;
	});

	afterEach(() => {
		delete process.env.LAUNCHPAD_IS_DETACHED;
		delete (process as NodeJS.Process & { send?: unknown }).send;
	});

	describe("isDetached", () => {
		it("is false when LAUNCHPAD_IS_DETACHED is not set", async () => {
			const mod = await import("../detached-messaging.js");
			expect(mod.isDetached).toBe(false);
		});

		it("is true when LAUNCHPAD_IS_DETACHED is '1'", async () => {
			process.env.LAUNCHPAD_IS_DETACHED = "1";
			const mod = await import("../detached-messaging.js");
			expect(mod.isDetached).toBe(true);
		});
	});

	describe("forwardLog", () => {
		it("sends log message via process.send when detached and process.send is defined", async () => {
			process.env.LAUNCHPAD_IS_DETACHED = "1";
			process.send = vi.fn();
			const mod = await import("../detached-messaging.js");
			const payload = { args: ["test message"] };

			mod.forwardLog("info", payload);

			expect(process.send).toHaveBeenCalledWith({ type: "log", level: "info", payload });
		});

		it("is a no-op when not detached even if process.send is defined", async () => {
			process.send = vi.fn();
			const mod = await import("../detached-messaging.js");

			mod.forwardLog("info", { args: ["test"] });

			expect(process.send).not.toHaveBeenCalled();
		});

		it("is a no-op when process.send is undefined even if detached", async () => {
			process.env.LAUNCHPAD_IS_DETACHED = "1";
			const mod = await import("../detached-messaging.js");

			expect(() => mod.forwardLog("warn", { args: ["test"] })).not.toThrow();
		});

		it("stops sending after sendReadyMessage has been called", async () => {
			process.env.LAUNCHPAD_IS_DETACHED = "1";
			process.send = vi.fn();
			const mod = await import("../detached-messaging.js");

			mod.sendReadyMessage();
			vi.mocked(process.send).mockClear();

			mod.forwardLog("info", { args: ["after ready"] });

			expect(process.send).not.toHaveBeenCalled();
		});
	});

	describe("sendReadyMessage", () => {
		it("sends ready message via process.send when detached", async () => {
			process.env.LAUNCHPAD_IS_DETACHED = "1";
			process.send = vi.fn();
			const mod = await import("../detached-messaging.js");

			mod.sendReadyMessage();

			expect(process.send).toHaveBeenCalledWith({ type: "ready" });
		});

		it("is idempotent — calling twice only sends once", async () => {
			process.env.LAUNCHPAD_IS_DETACHED = "1";
			process.send = vi.fn();
			const mod = await import("../detached-messaging.js");

			mod.sendReadyMessage();
			mod.sendReadyMessage();

			expect(process.send).toHaveBeenCalledTimes(1);
		});

		it("does nothing when not detached", async () => {
			process.send = vi.fn();
			const mod = await import("../detached-messaging.js");

			mod.sendReadyMessage();

			expect(process.send).not.toHaveBeenCalled();
		});
	});

	describe("isValidChildLogMessage", () => {
		it.each([
			[{ type: "log", level: "info", payload: {} }, true],
			[{ type: "log" }, true],
			[{ type: "ready" }, false],
			[null, false],
			["string", false],
			[42, false],
			[undefined, false],
			[{}, false],
		])("returns %s for input %j", async (input, expected) => {
			const mod = await import("../detached-messaging.js");
			expect(mod.isValidChildLogMessage(input)).toBe(expected);
		});
	});

	describe("isValidReadyMessage", () => {
		it.each([
			[{ type: "ready" }, true],
			[{ type: "log", level: "info" }, false],
			[null, false],
			["string", false],
			[42, false],
			[undefined, false],
			[{}, false],
		])("returns %s for input %j", async (input, expected) => {
			const mod = await import("../detached-messaging.js");
			expect(mod.isValidReadyMessage(input)).toBe(expected);
		});
	});
});
