import { err, type Result, type ResultAsync } from "neverthrow";
import type { ExportFailure, ExportResult } from "./destination.js";
import { DestinationFailure } from "./export-failure.js";

/** A logical completion can precede physical settlement when cancellation is ignored. */
export interface AttemptOutcome<T> {
	readonly source: "delivery" | "timeout" | "aborted";
	readonly result: Result<T, ExportFailure>;
}

/** Convert unexpected plugin throws/rejections without losing Error metadata. */
export function errorFromUnknown(value: unknown, message: string): Error {
	return value instanceof Error ? value : new Error(message, { cause: value });
}

/**
 * Start one cancellable Result operation. Consumers may report `outcome` immediately,
 * but MUST await `settled` before reusing an exporter's physical slot. Late results
 * are observed and discarded; they never replace the logical deadline result.
 */
export function startAttempt<T>(options: {
	readonly call: (signal: AbortSignal) => ResultAsync<T, Error>;
	readonly controller: AbortController;
	readonly timeoutMs: number;
	readonly timeoutMessage: string;
}): { readonly outcome: Promise<AttemptOutcome<T>>; readonly settled: Promise<void> } {
	const { controller, timeoutMs } = options;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let removeAbortListener = () => {};
	const interrupted = new Promise<AttemptOutcome<T>>((resolve) => {
		const abort = () =>
			resolve({
				source: "aborted",
				result: err(new DestinationFailure("Destination delivery aborted", { retryable: false })),
			});
		controller.signal.addEventListener("abort", abort, { once: true });
		removeAbortListener = () => controller.signal.removeEventListener("abort", abort);
		const timeout = () => {
			resolve({
				source: "timeout",
				result: err(new DestinationFailure(options.timeoutMessage, { retryable: true })),
			});
			controller.abort();
		};
		if (controller.signal.aborted) abort();
		else if (timeoutMs <= 0) timeout();
		else {
			timer = setTimeout(timeout, timeoutMs);
			timer.unref?.();
		}
	});

	let delivery: Promise<Result<T, Error>>;
	try {
		delivery = Promise.resolve(options.call(controller.signal)).catch((error: unknown) =>
			err(errorFromUnknown(error, "Destination operation rejected")),
		);
	} catch (error) {
		delivery = Promise.resolve(err(errorFromUnknown(error, "Destination operation threw")));
	}
	const delivered = delivery.then((result): AttemptOutcome<T> => ({ source: "delivery", result }));
	return {
		outcome: Promise.race([interrupted, delivered]).finally(() => {
			if (timer !== undefined) clearTimeout(timer);
			removeAbortListener();
		}),
		settled: delivery.then(() => undefined),
	};
}

/** Validate terminal rejection counts before acknowledging or dropping any records. */
export function validExportResult(result: ExportResult, recordCount: number): boolean {
	return (
		Number.isInteger(result.rejectedRecords) &&
		result.rejectedRecords >= 0 &&
		result.rejectedRecords <= recordCount
	);
}

/** Shared exponential backoff; each delivery policy explicitly chooses its Retry-After cap. */
export function retryDelay(
	attempt: number,
	retryAfterMs: number | undefined,
	retryAfterCapMs: number,
): number {
	const exponentialDelay = Math.min(2 ** attempt * 1_000, 30_000);
	if (retryAfterMs === undefined || !Number.isFinite(retryAfterMs)) return exponentialDelay;
	return Math.min(Math.max(0, retryAfterMs), retryAfterCapMs);
}
