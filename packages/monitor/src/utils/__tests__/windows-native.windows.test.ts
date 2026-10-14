import { describe, expect, it, vi } from "vitest";
import { getWindowsNative, type WindowAction } from "../windows-native.js";

// This suite must exercise the real binary, never a shared test setup mock.
vi.unmock("../windows-native.js");
vi.unmock("node:module");

const supportedWindows =
	process.platform === "win32" && (process.arch === "x64" || process.arch === "arm64");
const missingWindow = { id: "18446744073709551615", processId: 1 };
const malformedDescriptors: { name: string; createWindow: () => unknown }[] = [
	{ name: "null", createWindow: () => null },
	{ name: "array", createWindow: () => [] },
	{ name: "empty object", createWindow: () => ({}) },
	{ name: "string", createWindow: () => "window" },
	...[
		undefined,
		null,
		true,
		123,
		0n,
		"",
		"0",
		"01",
		"+1",
		"-1",
		" 1",
		"1 ",
		"1.0",
		"not-a-handle",
		"18446744073709551616",
	].map((id) => ({
		name: `invalid ${typeof id} ID '${String(id)}'`,
		createWindow: () => ({ id, processId: 1 }),
	})),
	...[
		undefined,
		null,
		"1",
		Number.NaN,
		Number.POSITIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
		-1,
		0,
		1.5,
		4294967296,
	].map((processId) => ({
		name: `invalid ${typeof processId} PID '${String(processId)}'`,
		createWindow: () => ({ id: missingWindow.id, processId }),
	})),
];

function requireNative() {
	const native = getWindowsNative();
	if (!native) {
		throw new Error("The Windows addon was not loaded");
	}
	return native;
}

function expectInvalidArgument(operation: () => unknown) {
	expect(operation).toThrow(TypeError);
	try {
		operation();
	} catch (error) {
		expect(error).toHaveProperty("code", "ERR_INVALID_ARG_VALUE");
	}
}

describe.skipIf(!supportedWindows)("bundled Windows Node-API addon", () => {
	it("loads and enumerates visible top-level windows with opaque decimal HWNDs", () => {
		const native = requireNative();
		for (const window of native.listVisibleWindows()) {
			expect(window.id).toMatch(/^[1-9][0-9]*$/);
			expect(Number.isInteger(window.processId)).toBe(true);
			expect(window.processId).toBeGreaterThan(0);
			expect(typeof native.getWindowTitle(window)).toBe("string");
		}
	});

	it("treats missing windows and mismatched owner PIDs as benign no-ops", async () => {
		const native = requireNative();
		expect(native.getWindowTitle(missingWindow)).toBe("");
		const actions: WindowAction[] = ["hide", "minimize", "foreground"];
		for (const action of actions) {
			await expect(native.applyWindowAction(missingWindow, action)).resolves.toBeUndefined();
		}
		const visibleWindow = native.listVisibleWindows()[0];
		if (visibleWindow) {
			const staleWindow = { ...visibleWindow, processId: visibleWindow.processId === 1 ? 2 : 1 };
			expect(native.getWindowTitle(staleWindow)).toBe("");
			for (const action of actions) {
				await expect(native.applyWindowAction(staleWindow, action)).resolves.toBeUndefined();
			}
		}
	});

	it.each(malformedDescriptors)(
		"rejects malformed descriptors synchronously: $name",
		({ createWindow }) => {
			const native = requireNative();
			const window = createWindow();
			// Reflect permits malformed runtime inputs without weakening the public TS types.
			expectInvalidArgument(() => Reflect.apply(native.getWindowTitle, native, [window]));
			expectInvalidArgument(() =>
				Reflect.apply(native.applyWindowAction, native, [window, "hide"]),
			);
		},
	);

	it.each([undefined, null, 1, {}, Object("hide"), "", "restore", "HIDE"])(
		"rejects malformed actions synchronously: %j",
		(action) => {
			const native = requireNative();
			expectInvalidArgument(() =>
				Reflect.apply(native.applyWindowAction, native, [missingWindow, action]),
			);
		},
	);

	it("accepts the largest valid PID without truncation", async () => {
		const native = requireNative();
		const window = { ...missingWindow, processId: 4294967295 };
		expect(native.getWindowTitle(window)).toBe("");
		await expect(native.applyWindowAction(window, "hide")).resolves.toBeUndefined();
	});

	it.each(["id", "processId"])("preserves exceptions thrown by the %s getter", (property) => {
		const native = requireNative();
		const cause = new Error("Getter failed");
		const window = Object.defineProperty({ ...missingWindow }, property, {
			get() {
				throw cause;
			},
		});
		expect(() => Reflect.apply(native.getWindowTitle, native, [window])).toThrow(cause);
		expect(() => Reflect.apply(native.applyWindowAction, native, [window, "hide"])).toThrow(cause);
	});
});
