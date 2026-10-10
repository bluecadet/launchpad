export function throwIfAborted(signal: AbortSignal): void {
	if (signal.aborted) throw signal.reason ?? new Error("Operation aborted");
}

export function awaitWithSignal<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const onAbort = () => reject(signal.reason ?? new Error("Operation aborted"));
		// Cancellation bounds the caller's wait, not the underlying operation.
		// Always observe its settlement, even when cancellation predates this call.
		if (signal.aborted) onAbort();
		else signal.addEventListener("abort", onAbort, { once: true });
		operation.then(
			(value) => {
				signal.removeEventListener("abort", onAbort);
				resolve(value);
			},
			(error: unknown) => {
				signal.removeEventListener("abort", onAbort);
				reject(error);
			},
		);
	});
}

export function safeDiagnostic(
	callback: ((message: string) => void) | undefined,
	message: string,
): void {
	try {
		callback?.(message);
	} catch {
		// Diagnostics must never feed back into logging or fail source operations.
	}
}

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * One FIFO owns every physical operation, including admission, barriers,
 * reader I/O, maintenance and final lease release. Cancellation only bounds
 * a caller's wait: the queued operation always settles before its successor.
 */
export class LogFileOperations {
	private tail: Promise<unknown> = Promise.resolve();

	enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.tail.then(operation);
		this.tail = result.catch(() => undefined);
		return result;
	}
}
