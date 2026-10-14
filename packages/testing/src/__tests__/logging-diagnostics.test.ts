import { afterEach, expect, it, vi } from "vitest";
import { createLoggingDiagnosticCapture, expectLoggingDiagnostic } from "../logging-diagnostics.js";

function capture() {
	const warn = vi.fn();
	const error = vi.fn();
	const originalConsole = { ...console, warn, error };
	return { ...createLoggingDiagnosticCapture(originalConsole), originalConsole, warn, error };
}

it("captures declared messages with exact counts and repeatable regular expressions", () => {
	const diagnostics = capture();
	diagnostics.expect("directory is locked");
	diagnostics.expect(/^timeout$/g, 2);
	diagnostics.console.warn("[launchpad logging] directory is locked");
	diagnostics.console.warn("[launchpad logging] timeout");
	diagnostics.console.warn("[launchpad logging] timeout");
	expect(() => diagnostics.verify()).not.toThrow();
	expect(diagnostics.warn).not.toHaveBeenCalled();
});

it("forwards unexpected diagnostics with all arguments and fails verification", () => {
	const diagnostics = capture();
	const detail = new Error("I/O failed");
	diagnostics.console.warn("[launchpad logging] unexpected failure", detail);
	expect(diagnostics.warn).toHaveBeenCalledExactlyOnceWith(
		"[launchpad logging] unexpected failure",
		detail,
	);
	expect(() => diagnostics.verify()).toThrow(
		"Unexpected Launchpad logging diagnostic: unexpected failure",
	);
});

it("rejects extra diagnostics and missing declared diagnostics", () => {
	const diagnostics = capture();
	diagnostics.expect("timeout");
	diagnostics.expect("directory is locked", 2);
	diagnostics.console.warn("[launchpad logging] timeout");
	diagnostics.console.warn("[launchpad logging] timeout");
	expect(() => diagnostics.verify()).toThrow("Unexpected Launchpad logging diagnostic: timeout");
	expect(() => diagnostics.verify()).toThrow(
		"Missing 2 Launchpad logging diagnostic(s): directory is locked",
	);
});

it("leaves unrelated warnings and errors alone", () => {
	const diagnostics = capture();
	const detail = { code: "unrelated" };
	diagnostics.console.warn("other warning", detail);
	diagnostics.console.warn(detail);
	diagnostics.console.error("[launchpad logging] not a warning", detail);
	expect(diagnostics.warn.mock.calls).toEqual([["other warning", detail], [detail]]);
	expect(diagnostics.error).toHaveBeenCalledExactlyOnceWith(
		"[launchpad logging] not a warning",
		detail,
	);
	expect(() => diagnostics.verify()).not.toThrow();
});

it("keeps bound diagnostic callbacks working and forwards calls after verification", () => {
	const diagnostics = capture();
	const report = diagnostics.console.warn.bind(diagnostics.console);
	diagnostics.expect("timeout");
	Object.freeze(diagnostics.console);
	report("[launchpad logging] timeout");
	diagnostics.verify();
	report("[launchpad logging] late warning");
	expect(diagnostics.warn).toHaveBeenCalledExactlyOnceWith("[launchpad logging] late warning");
	expect(Object.isFrozen(diagnostics.originalConsole)).toBe(false);
});

it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
	"rejects invalid diagnostic count %s",
	(count) => {
		expect(() => capture().expect("timeout", count)).toThrow("positive safe integer");
	},
);

it("automatically installs capture, including during test-owned cleanup", () => {
	expectLoggingDiagnostic("deliberate failure");
	console.warn("[launchpad logging] deliberate failure");
});

afterEach(() => {
	// Verification must run after test-owned afterEach hooks.
	expectLoggingDiagnostic("cleanup diagnostic");
	console.warn("[launchpad logging] cleanup diagnostic");
});

it.fails("automatically fails a test with a missing expected diagnostic", () => {
	expectLoggingDiagnostic("never emitted");
});

const originalConsole = console;

it.fails("automatically fails a test with an undeclared diagnostic", () => {
	// Stub only the forwarding destination for this deliberately failing fixture
	// regression; production capture must still record and reject the diagnostic.
	const forwardedWarning = vi.spyOn(originalConsole, "warn").mockImplementation(() => {});
	try {
		console.warn("[launchpad logging] undeclared fixture diagnostic");
	} finally {
		forwardedWarning.mockRestore();
	}
});

it("restores the original console after a test freezes its console copy", () => {
	expect(console).not.toBe(originalConsole);
	Object.freeze(console);
});

it("starts the next test with a writable copy of the original console", () => {
	expect(console).not.toBe(originalConsole);
	expect(Object.isFrozen(console)).toBe(false);
	expect(console.info).toBe(originalConsole.info);
});
