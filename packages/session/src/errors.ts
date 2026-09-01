/**
 * Errors raised by the session broker. Every one supports `cause` for chaining.
 */

/** Base error class for the session package. */
export class SessionError extends Error {
	constructor(...args: ConstructorParameters<typeof Error>) {
		super(...args);
		this.name = "SessionError";
	}
}
