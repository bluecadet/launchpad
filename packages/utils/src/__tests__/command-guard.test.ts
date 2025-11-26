import { errAsync, ok, okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandInProgressError, SingleCommandGuard } from "../command-guard.js";

describe("CommandInProgressError", () => {
	it("should create an error with the correct message", () => {
		const error = new CommandInProgressError();
		expect(error.message).toBe("A command is already in progress.");
		expect(error.name).toBe("CommandInProgressError");
	});

	it("should be an instance of Error", () => {
		const error = new CommandInProgressError();
		expect(error).toBeInstanceOf(Error);
	});
});

describe("SingleCommandGuard", () => {
	let guard: SingleCommandGuard;

	beforeEach(() => {
		guard = new SingleCommandGuard();
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("basic execution", () => {
		it("should execute a function successfully", async () => {
			const fn = vi.fn(() => okAsync(42));
			const result = await guard.run(fn);

			expect(result).toBeOk();
			expect(result._unsafeUnwrap()).toBe(42);
			expect(fn).toHaveBeenCalledOnce();
		});

		it("should unlock after successful execution", async () => {
			const fn1 = vi.fn(() => okAsync(1));
			const fn2 = vi.fn(() => okAsync(2));

			const result1 = await guard.run(fn1);
			expect(result1).toBeOk();

			const result2 = await guard.run(fn2);
			expect(result2).toBeOk();

			expect(fn1).toHaveBeenCalledOnce();
			expect(fn2).toHaveBeenCalledOnce();
		});

		it("should return the function's result", async () => {
			const testData = { id: 1, name: "test" };
			const fn = vi.fn(() => okAsync(testData));
			const result = await guard.run(fn);

			expect(result).toBeOk();
			expect(result._unsafeUnwrap()).toEqual(testData);
		});
	});

	describe("concurrent execution prevention", () => {
		it("should prevent concurrent execution", async () => {
			const fn = vi.fn(() => okAsync(42));

			const result1Promise = guard.run(fn);
			const result2Promise = guard.run(fn);

			const result1 = await result1Promise;
			const result2 = await result2Promise;

			expect(result1).toBeOk();
			expect(result2).toBeErr();
			expect(result2._unsafeUnwrapErr()).toBeInstanceOf(CommandInProgressError);
			expect(fn).toHaveBeenCalledOnce();

			const error = result2._unsafeUnwrapErr();
			expect(error).toBeInstanceOf(CommandInProgressError);
			expect(error.message).toBe("A command is already in progress.");
		});

		it("should allow execution after lock is released", async () => {
			const fn = vi.fn(() => okAsync(42));

			const result1 = await guard.run(fn);
			expect(result1).toBeOk();

			const result2 = await guard.run(fn);
			expect(result2).toBeOk();
			expect(fn).toHaveBeenCalledTimes(2);
		});
	});

	describe("error handling", () => {
		it("should unlock after function returns an error", async () => {
			const customError = new Error("Custom error");
			const fn1 = vi.fn(() => errAsync(customError));
			const fn2 = vi.fn(() => okAsync(42));

			const result1 = await guard.run(fn1);
			expect(result1).toBeErr();
			expect(result1._unsafeUnwrapErr()).toBe(customError);

			const result2 = await guard.run(fn2);
			expect(result2).toBeOk();

			expect(fn1).toHaveBeenCalledOnce();
			expect(fn2).toHaveBeenCalledOnce();
		});

		it("should preserve error type from function", async () => {
			const customError = { code: "CUSTOM_ERROR", message: "Something went wrong" };
			const fn = vi.fn(() => errAsync(customError));

			const result = await guard.run(fn);
			expect(result).toBeErr();
			expect(result._unsafeUnwrapErr()).toEqual(customError);
		});

		it("should handle different error types", async () => {
			const stringError = "string error";
			const fn = vi.fn(() => errAsync(stringError));

			const result = await guard.run(fn);
			expect(result).toBeErr();
			expect(result._unsafeUnwrapErr()).toBe(stringError);
		});

		it("should not execute concurrent function if first one errors", async () => {
			const fn1 = vi.fn(() => errAsync(new Error("Error")));
			const fn2 = vi.fn(() => okAsync(42));

			const result1Promise = guard.run(fn1);
			const result2Promise = guard.run(fn2);

			const result1 = await result1Promise;
			const result2 = await result2Promise;

			expect(result1).toBeErr();
			expect(result2).toBeErr();
			expect(result2._unsafeUnwrapErr()).toBeInstanceOf(CommandInProgressError);
			expect(fn1).toHaveBeenCalledOnce();
			// fn2 is not called because the guard prevents concurrent execution
			expect(fn2).not.toHaveBeenCalled();
		});
	});

	describe("multiple guard instances", () => {
		it("should have independent locks", async () => {
			const guard1 = new SingleCommandGuard();
			const guard2 = new SingleCommandGuard();

			const fn1 = vi.fn(() => okAsync(1));
			const fn2 = vi.fn(() => okAsync(2));

			const result1Promise = guard1.run(fn1);
			const result2Promise = guard2.run(fn2);

			const result1 = await result1Promise;
			const result2 = await result2Promise;

			expect(result1).toBeOk();
			expect(result2).toBeOk();
			expect(fn1).toHaveBeenCalledOnce();
			expect(fn2).toHaveBeenCalledOnce();
		});

		it("should not interfere with each other during concurrent execution", async () => {
			const guard1 = new SingleCommandGuard();
			const guard2 = new SingleCommandGuard();

			const fn1a = vi.fn(() => okAsync("guard1-first"));
			const fn1b = vi.fn(() => okAsync("guard1-second"));
			const fn2 = vi.fn(() => okAsync("guard2"));

			const result1aPromise = guard1.run(fn1a);
			const result1bPromise = guard1.run(fn1b);
			const result2Promise = guard2.run(fn2);

			const result1a = await result1aPromise;
			const result1b = await result1bPromise;
			const result2 = await result2Promise;

			expect(result1a).toBeOk();
			expect(result1b).toBeErr();
			expect(result2).toBeOk();
		});
	});
});
