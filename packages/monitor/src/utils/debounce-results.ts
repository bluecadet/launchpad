import { ResultAsync } from "neverthrow";

/**
 * Creates a debounced version of a function that returns ResultAsync.
 *
 * @param fn The function to debounce which returns ResultAsync
 * @param wait The number of milliseconds to delay
 * @returns A debounced function that returns ResultAsync with the same types as the input function
 */

// biome-ignore lint/suspicious/noExplicitAny: any required for generic type handling
export function debounceResultAsync<T extends any[], E, R>(
	fn: (...args: T) => ResultAsync<R, E>,
	wait: number,
): (...args: T) => ResultAsync<R, E> {
	let timeout: NodeJS.Timeout | null = null;
	let pendingPromise: ResultAsync<R, E> | null = null;
	let latestArgs: T | null = null;

	return (...args: T): ResultAsync<R, E> => {
		// Always update the latest args
		latestArgs = args;

		// If there's already a pending promise, return it
		if (pendingPromise) {
			return pendingPromise;
		}

		// Create a new ResultAsync that will resolve when the debounced function is called
		pendingPromise = ResultAsync.fromPromise(
			new Promise<R>((resolve, reject) => {
				// Clear any existing timeout
				if (timeout) {
					clearTimeout(timeout);
				}

				// Set a new timeout
				timeout = setTimeout(() => {
					// Safely capture the latest args, falling back to the original args if null
					const currentArgs = latestArgs || args;

					// Reset state
					timeout = null;
					pendingPromise = null;
					latestArgs = null;

					// Call the original function with the captured args
					const result = fn(...currentArgs);

					// Ensure result is defined and has a match method
					if (result && typeof result.match === "function") {
						result.match(
							(value) => resolve(value),
							(error) => reject(error),
						);
					} else {
						// Handle the edge case where result is not as expected
						reject(new Error("Invalid ResultAsync returned from debounced function"));
					}
				}, wait);
			}),
			(error) => error as E,
		);

		return pendingPromise;
	};
}
