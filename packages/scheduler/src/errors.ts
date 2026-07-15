/**
 * Custom error classes for the Launchpad Scheduler package.
 * All errors support the `cause` parameter for error chaining.
 */

/**
 * Base error class for all scheduler-related errors.
 */
export class SchedulerError extends Error {
	constructor(...args: ConstructorParameters<typeof Error>) {
		super(...args);
		this.name = "SchedulerError";
	}
}
