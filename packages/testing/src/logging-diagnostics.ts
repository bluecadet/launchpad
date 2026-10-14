const DIAGNOSTIC_PREFIX = "[launchpad logging] ";

type ExpectedDiagnostic = {
	message: string | RegExp;
	remaining: number;
};

/** A test-local capture; unrelated console output always passes through. */
export function createLoggingDiagnosticCapture(originalConsole: typeof console) {
	const expected: ExpectedDiagnostic[] = [];
	const unexpected: string[] = [];
	let finished = false;
	const scopedConsole: typeof console = {
		...originalConsole,
		warn(...args: unknown[]): void {
			const first = args[0];
			if (finished || typeof first !== "string" || !first.startsWith(DIAGNOSTIC_PREFIX)) {
				originalConsole.warn(...args);
				return;
			}

			const message = first.slice(DIAGNOSTIC_PREFIX.length);
			const expectation = expected.find((entry) => {
				if (entry.remaining === 0) return false;
				if (typeof entry.message === "string") return entry.message === message;
				// Global/sticky expressions must match independently on each call.
				entry.message.lastIndex = 0;
				return entry.message.test(message);
			});
			if (expectation) {
				expectation.remaining--;
				return;
			}

			unexpected.push(message);
			originalConsole.warn(...args);
		},
	};

	return {
		console: scopedConsole,
		expect(message: string | RegExp, count = 1): void {
			if (finished) throw new Error("Logging diagnostic capture has already finished");
			if (!Number.isSafeInteger(count) || count < 1) {
				throw new Error("Expected diagnostic count must be a positive safe integer");
			}
			expected.push({ message, remaining: count });
		},
		verify(): void {
			finished = true;
			const failures = [
				...unexpected.map((message) => `Unexpected Launchpad logging diagnostic: ${message}`),
				...expected
					.filter((entry) => entry.remaining > 0)
					.map(
						(entry) =>
							`Missing ${entry.remaining} Launchpad logging diagnostic(s): ${entry.message}`,
					),
			];
			if (failures.length > 0) throw new Error(failures.join("\n"));
		},
	};
}

let activeCapture: ReturnType<typeof createLoggingDiagnosticCapture> | undefined;

/** Install on a fresh console copy so a logger freezing console cannot prevent restoration. */
export function installLoggingDiagnosticCapture(): () => void {
	if (activeCapture) throw new Error("Logging diagnostic capture is already installed");
	const originalConsole = globalThis.console;
	const capture = createLoggingDiagnosticCapture(originalConsole);
	activeCapture = capture;
	globalThis.console = capture.console;
	return () => {
		globalThis.console = originalConsole;
		activeCapture = undefined;
		capture.verify();
	};
}

/** Declare a diagnostic before triggering it; shared setup verifies exact counts at test finish. */
export function expectLoggingDiagnostic(message: string | RegExp, count = 1): void {
	if (!activeCapture) throw new Error("Launchpad test setup has not installed diagnostic capture");
	activeCapture.expect(message, count);
}
