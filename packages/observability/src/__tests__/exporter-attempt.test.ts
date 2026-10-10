import { errAsync, ok, okAsync, ResultAsync } from "neverthrow";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExportResult } from "../core/destination.js";
import { DestinationFailure, exportFailureMessage } from "../core/export-failure.js";
import {
	errorFromUnknown,
	retryDelay,
	startAttempt,
	validExportResult,
} from "../core/exporter-attempt.js";

function attempt(call: (signal: AbortSignal) => ResultAsync<ExportResult, Error>, timeoutMs = 100) {
	const controller = new AbortController();
	return {
		controller,
		...startAttempt({ call, controller, timeoutMs, timeoutMessage: "deadline" }),
	};
}

afterEach(() => vi.useRealTimers());

describe("exporter attempt", () => {
	it("preserves success and clears cancellation hooks after physical completion", async () => {
		vi.useFakeTimers();
		const controller = new AbortController();
		const removeListener = vi.spyOn(controller.signal, "removeEventListener");
		const result = ok({ rejectedRecords: 1 });
		const started = startAttempt({
			call: () => new ResultAsync(Promise.resolve(result)),
			controller,
			timeoutMs: 100,
			timeoutMessage: "deadline",
		});
		expect(await started.outcome).toEqual({ source: "delivery", result });
		await started.settled;
		expect(removeListener).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
		expect(controller.signal.aborted).toBe(false);
	});

	it("preserves typed failure identity and retry metadata", async () => {
		const failure = Object.assign(new Error("busy"), { retryable: false, retryAfterMs: 45_000 });
		const started = attempt(() => errAsync(failure));
		expect((await started.outcome).result._unsafeUnwrapErr()).toBe(failure);
		await started.settled;
	});

	it.each(["throw", "reject"])(
		"converts unexpected plugin %s without an unhandled rejection",
		async (mode) => {
			const cause = { detail: "not an Error" };
			const started = attempt(() => {
				if (mode === "throw") throw cause;
				// A broken plugin may reject despite promising a ResultAsync contract.
				return new ResultAsync(Promise.reject(cause));
			});
			const outcome = await started.outcome;
			expect(outcome.source).toBe("delivery");
			expect(outcome.result._unsafeUnwrapErr().cause).toBe(cause);
			await started.settled;
		},
	);

	it.each(["success", "reject"])(
		"quarantines an ignored timeout until late %s settles",
		async (late) => {
			vi.useFakeTimers();
			let resolve = (_value: ExportResult) => {};
			let reject = (_error: Error) => {};
			const physical = new Promise<ExportResult>((done, fail) => {
				resolve = done;
				reject = fail;
			});
			const started = attempt(() => ResultAsync.fromSafePromise(physical));
			const settled = vi.fn();
			void started.settled.then(settled);
			await vi.advanceTimersByTimeAsync(100);
			const outcome = await started.outcome;
			expect(outcome.source).toBe("timeout");
			expect(outcome.result._unsafeUnwrapErr()).toBeInstanceOf(DestinationFailure);
			expect(exportFailureMessage(outcome.result._unsafeUnwrapErr())).toBe("deadline");
			expect(outcome.result._unsafeUnwrapErr()).toMatchObject({
				message: "deadline",
				retryable: true,
			});
			expect(started.controller.signal.aborted).toBe(true);
			expect(settled).not.toHaveBeenCalled();
			expect(vi.getTimerCount()).toBe(0);
			if (late === "success") resolve({ rejectedRecords: 0 });
			else reject(new Error("late rejection"));
			await started.settled;
			expect(await started.outcome).toBe(outcome);
			expect(settled).toHaveBeenCalledOnce();
		},
	);

	it("lets the deadline win over a cooperative abort response", async () => {
		vi.useFakeTimers();
		const started = attempt((signal) =>
			ResultAsync.fromSafePromise(
				new Promise<ExportResult>((resolve) => {
					signal.addEventListener("abort", () => resolve({ rejectedRecords: 0 }), { once: true });
				}),
			),
		);
		await vi.advanceTimersByTimeAsync(100);
		expect((await started.outcome).source).toBe("timeout");
		await started.settled;
	});

	it("reports explicit abort immediately but retains the physical settlement fence", async () => {
		vi.useFakeTimers();
		let finish = () => {};
		const physical = new Promise<void>((resolve) => {
			finish = resolve;
		});
		const started = attempt(() =>
			ResultAsync.fromSafePromise(physical).map(() => ({ rejectedRecords: 0 })),
		);
		const settled = vi.fn();
		void started.settled.then(settled);
		started.controller.abort();
		const outcome = await started.outcome;
		expect(outcome.source).toBe("aborted");
		expect(outcome.result._unsafeUnwrapErr()).toBeInstanceOf(DestinationFailure);
		expect(outcome.result._unsafeUnwrapErr().retryable).toBe(false);
		expect(exportFailureMessage(outcome.result._unsafeUnwrapErr())).toBe(
			"Destination delivery aborted",
		);
		expect(settled).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
		finish();
		await started.settled;
	});

	it("passes an already aborted signal to cleanup calls with no remaining budget", async () => {
		const call = vi.fn((signal: AbortSignal) => {
			expect(signal.aborted).toBe(true);
			return okAsync({ rejectedRecords: 0 });
		});
		const started = attempt(call, 0);
		expect((await started.outcome).source).toBe("timeout");
		await started.settled;
		expect(call).toHaveBeenCalledOnce();
	});

	it("does not promote a custom timeout-like error to a trusted internal failure", async () => {
		const error = new Error("Destination delivery timed out: secret-token");
		const started = attempt(() => errAsync(error));
		const outcome = await started.outcome;
		expect(outcome.source).toBe("delivery");
		expect(outcome.result._unsafeUnwrapErr()).toBe(error);
		expect(exportFailureMessage(outcome.result._unsafeUnwrapErr())).toBe(
			"Destination exporter failed (Error)",
		);
		await started.settled;
	});

	it("preserves Error instances at plugin boundaries", () => {
		const error = new Error("original");
		expect(errorFromUnknown(error, "fallback")).toBe(error);
	});
});

describe("shared export policies", () => {
	it.each([-1, 0.5, 3, Number.NaN, Number.POSITIVE_INFINITY])(
		"rejects invalid rejection count %s",
		(rejectedRecords) => {
			expect(validExportResult({ rejectedRecords }, 2)).toBe(false);
		},
	);

	it.each([0, 1, 2])("accepts terminal rejection count %s", (rejectedRecords) => {
		expect(validExportResult({ rejectedRecords }, 2)).toBe(true);
	});

	it("shares capped exponential backoff while keeping Retry-After policies explicit", () => {
		expect([0, 1, 5, 100].map((n) => retryDelay(n, undefined, Number.POSITIVE_INFINITY))).toEqual([
			1000, 2000, 30_000, 30_000,
		]);
		expect(retryDelay(0, 45_000, 30_000)).toBe(30_000);
		expect(retryDelay(0, 45_000, Number.POSITIVE_INFINITY)).toBe(45_000);
		expect(retryDelay(0, -10, Number.POSITIVE_INFINITY)).toBe(0);
		expect(retryDelay(0, Number.NaN, Number.POSITIVE_INFINITY)).toBe(1000);
		expect(retryDelay(0, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)).toBe(1000);
	});
});
