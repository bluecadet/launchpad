import { beforeEach, describe, expect, it, vi } from "vitest";
import { _reset, onExit } from "../on-exit.js";

describe("onExit", () => {
	beforeEach(() => {
		_reset();
	});

	it("should register callbacks for exit events", async () => {
		const callback = vi.fn();
		onExit(callback, false);

		// Simulate exit events
		await Promise.all([
			process.emit("beforeExit", 0),
			process.emit("SIGTERM", "SIGTERM"),
			process.emit("SIGINT", "SIGINT"),
		]);

		// Should be called once per event
		expect(callback).toHaveBeenCalledTimes(3);
	});

	it("should only call once when once=true", async () => {
		const callback = vi.fn();
		onExit(callback, true);

		// Simulate multiple exit events
		await Promise.all([
			process.emit("SIGTERM", "SIGTERM"),
			process.emit("SIGTERM", "SIGTERM"),
			process.emit("SIGTERM", "SIGTERM"),
		]);

		expect(callback).toHaveBeenCalledTimes(1);
	});

	it("should call multiple times when once=false", async () => {
		const callback = vi.fn();
		onExit(callback, false);

		// Simulate multiple exit events
		await Promise.all([
			process.emit("SIGTERM", "SIGTERM"),
			process.emit("SIGTERM", "SIGTERM"),
			process.emit("SIGTERM", "SIGTERM"),
		]);

		expect(callback).toHaveBeenCalledTimes(3);
	});

	it("should handle uncaught exceptions when includeUncaught=true", async () => {
		const callback = vi.fn();
		onExit(callback, false, true);

		// Simulate uncaught exception
		// @ts-ignore
		await process.emit("uncaughtException", "uncaughtException");
		// @ts-ignore
		await process.emit("unhandledRejection", "unhandledRejection");

		expect(callback).toHaveBeenCalledTimes(2);
	});

	it("should not handle uncaught exceptions when includeUncaught=false", async () => {
		const callback = vi.fn();
		onExit(callback, false, false);

		// Simulate uncaught exception
		// @ts-ignore
		await process.emit("uncaughtException", "uncaughtException");
		// @ts-ignore
		await process.emit("unhandledRejection", "unhandledRejection");

		expect(callback).not.toHaveBeenCalled();
	});

	it("should handle async callbacks", async () => {
		let flag = false;
		const asyncCallback = async () => {
			await new Promise((resolve) => setTimeout(resolve, 10));
			flag = true;
		};

		onExit(asyncCallback);

		await process.emit("SIGTERM", "SIGTERM");

		await vi.waitFor(() => expect(flag).toBe(true));
	});
});
