import type { Result } from "neverthrow";

/** Preserve rejecting thenables without widening their success type to unknown. */
export function fail(error: unknown): never {
	throw error;
}

/** Assert a Result succeeded while preserving its original error on test failure. */
export function unwrap<T>(result: Result<T, Error>): T {
	if (result.isErr()) throw result.error;
	return result.value;
}
