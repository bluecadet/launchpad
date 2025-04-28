import { ResultAsync, err, ok } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { debounceResultAsync } from "../debounce-results.js";

describe("debounceResultAsync", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should debounce function calls", async () => {
		const mockFn = vi
			.fn()
			.mockImplementation((value: number) =>
				ResultAsync.fromPromise(Promise.resolve(value * 2), (error) => error as Error),
			);

		const debounced = debounceResultAsync(mockFn, 1000);

		// Multiple calls in quick succession
		debounced(1);
		debounced(2);
		debounced(3);

		// Only the last one should be executed
		vi.advanceTimersByTime(1000);
		await vi.runAllTimersAsync();

		expect(mockFn).toHaveBeenCalledTimes(1);
		expect(mockFn).toHaveBeenCalledWith(3);
	});

	it("should return the same promise for calls during the wait time", async () => {
		const mockFn = vi
			.fn()
			.mockImplementation((value: number) =>
				ResultAsync.fromPromise(Promise.resolve(value * 2), (error) => error as Error),
			);

		const debounced = debounceResultAsync(mockFn, 1000);

		const promise1 = debounced(1);
		const promise2 = debounced(2);

		expect(promise1).toBe(promise2);
	});

	it("should return the correct result", async () => {
		const mockFn = vi
			.fn()
			.mockImplementation((value: number) =>
				ResultAsync.fromPromise(Promise.resolve(value * 2), (error) => error as Error),
			);

		const debounced = debounceResultAsync(mockFn, 1000);

		const resultPromise = debounced(5);
		vi.advanceTimersByTime(1000);
		await vi.runAllTimersAsync();

		const result = await resultPromise;
		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toBe(10);
	});

	it("should handle errors correctly", async () => {
		const testError = new Error("Test error");
		const mockFn = vi
			.fn()
			.mockImplementation(() =>
				ResultAsync.fromPromise(Promise.reject(testError), (error) => error as Error),
			);

		const debounced = debounceResultAsync(mockFn, 1000);

		const resultPromise = debounced();
		vi.advanceTimersByTime(1000);
		await vi.runAllTimersAsync();

		const result = await resultPromise;
		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toBe(testError);
	});

	it("should reset after a successful call and allow new calls", async () => {
		const mockFn = vi
			.fn()
			.mockImplementationOnce((value: number) =>
				ResultAsync.fromPromise(Promise.resolve(value * 2), (error) => error as Error),
			)
			.mockImplementationOnce((value: number) =>
				ResultAsync.fromPromise(Promise.resolve(value * 3), (error) => error as Error),
			);

		const debounced = debounceResultAsync(mockFn, 1000);

		// First call
		const resultPromise1 = debounced(5);
		vi.advanceTimersByTime(1000);
		await vi.runAllTimersAsync();

		const result1 = await resultPromise1;
		expect(result1._unsafeUnwrap()).toBe(10);

		// Second call should use a new promise
		const resultPromise2 = debounced(5);
		vi.advanceTimersByTime(1000);
		await vi.runAllTimersAsync();

		const result2 = await resultPromise2;
		expect(result2._unsafeUnwrap()).toBe(15);

		expect(mockFn).toHaveBeenCalledTimes(2);
	});

	it("should work with functions taking multiple arguments", async () => {
		const mockFn = vi
			.fn()
			.mockImplementation((a: number, b: string, c: boolean) =>
				ResultAsync.fromPromise(Promise.resolve(`${a}-${b}-${c}`), (error) => error as Error),
			);

		const debounced = debounceResultAsync(mockFn, 1000);

		const resultPromise = debounced(1, "test", true);
		vi.advanceTimersByTime(1000);
		await vi.runAllTimersAsync();

		const result = await resultPromise;
		expect(result._unsafeUnwrap()).toBe("1-test-true");
	});
});
