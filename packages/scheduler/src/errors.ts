/**
 * Custom error classes for the Launchpad Scheduler package.
 * All errors support the `cause` parameter for error chaining.
 */

/**
 * Base error class for all scheduler-related errors.
 * Extends Error to support the `cause` parameter for error chaining.
 */
export class SchedulerError extends Error {
	override readonly cause?: Error;

	constructor(message: string, options?: { cause?: Error }) {
		super(message);
		this.name = "SchedulerError";
		this.cause = options?.cause;
	}
}
