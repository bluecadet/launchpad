import type { ExportFailure } from "./destination.js";

/** Internal failure whose message contains only safe, exporter-controlled diagnostics. */
export class DestinationFailure extends Error {
	readonly retryable?: boolean;
	readonly retryAfterMs?: number;

	constructor(message: string, options: { retryable?: boolean; retryAfterMs?: number } = {}) {
		super(message);
		this.name = "DestinationFailure";
		this.retryable = options.retryable;
		this.retryAfterMs = options.retryAfterMs;
	}
}

/** Never expose messages or names supplied by custom destination errors. */
export function exportFailureMessage(failure: ExportFailure): string {
	try {
		if (failure instanceof DestinationFailure) return failure.message;
	} catch {
		// Custom errors can be proxies with throwing reflection/property traps.
	}
	return "Destination exporter failed (Error)";
}
