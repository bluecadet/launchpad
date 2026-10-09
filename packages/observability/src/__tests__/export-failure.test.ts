import { describe, expect, it } from "vitest";
import { DestinationFailure, exportFailureMessage } from "../core/export-failure.js";

describe("safe export failure diagnostics", () => {
	it("retains internal messages and retry policy", () => {
		const failure = new DestinationFailure("OTLP request failed with HTTP status 503", {
			retryable: true,
			retryAfterMs: 2_000,
		});
		expect(failure).toBeInstanceOf(Error);
		expect(failure).toMatchObject({ retryable: true, retryAfterMs: 2_000 });
		expect(exportFailureMessage(failure)).toBe("OTLP request failed with HTTP status 503");
	});

	it.each([
		new Error("OTLP request failed: secret"),
		new Error("Loki export failed: secret"),
		Object.assign(new Error("private message"), { name: "DestinationFailure", retryable: false }),
		Object.defineProperty(new Error("private message"), "name", {
			get() {
				throw new Error("private getter");
			},
		}),
		new Proxy(new Error("private message"), {
			getPrototypeOf() {
				throw new Error("private proxy");
			},
		}),
	])("does not trust custom error prefixes, names, retry policy, or reflection", (failure) => {
		expect(exportFailureMessage(failure)).toBe("Destination exporter failed (Error)");
	});
});
