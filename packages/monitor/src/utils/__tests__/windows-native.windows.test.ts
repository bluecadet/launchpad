import { describe, expect, it, vi } from "vitest";
import {
	getWindowsNative,
	type WindowAction,
	type WindowIdentity,
	type WindowsNative,
} from "../windows-native.js";
import { startWindowsWindowFixture } from "./windows-window-fixture.js";

// This suite must exercise the real binary, never a shared test setup mock.
vi.unmock("../windows-native.js");
vi.unmock("node:module");

const supportedWindows =
	process.platform === "win32" && (process.arch === "x64" || process.arch === "arm64");
const missingWindow = { id: "18446744073709551615", processId: 1 };
const actions: WindowAction[] = ["hide", "minimize", "foreground"];
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

async function expectAction(native: WindowsNative, window: WindowIdentity, action: WindowAction) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const boundedAction = new Promise<void>((resolve, reject) => {
		timer = setTimeout(
			() => reject(new Error(`Timed out applying '${action}' to ${window.id}`)),
			5000,
		);
		timer.unref();
		// Keep rejection handled even if the timeout wins; finally disposes the target.
		native.applyWindowAction(window, action).then(resolve, reject);
	});
	try {
		await expect(boundedAction).resolves.toBeUndefined();
	} finally {
		clearTimeout(timer);
	}
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
	it("enumerates the real fixture, reads its exact title, and minimizes it without hiding it", async () => {
		const native = requireNative();
		const fixture = await startWindowsWindowFixture();
		try {
			const windows = native.listVisibleWindows();
			expect(windows).toContainEqual(fixture.identity);
			expect(native.getWindowTitle(fixture.identity)).toBe(fixture.title);
			for (const window of windows) {
				expect(window.id).toMatch(/^[1-9][0-9]*$/);
				expect(Number.isInteger(window.processId)).toBe(true);
				expect(window.processId).toBeGreaterThan(0);
			}
			await expectAction(native, fixture.identity, "minimize");
			await fixture.waitForState({ visible: true, minimized: true });
			expect(native.listVisibleWindows()).toContainEqual(fixture.identity);
			expect(native.getWindowTitle(fixture.identity)).toBe(fixture.title);
		} finally {
			await fixture.dispose();
		}
	}, 60000);

	it("hides a fresh fixture and removes it from visible enumeration", async () => {
		const native = requireNative();
		const fixture = await startWindowsWindowFixture();
		try {
			expect(native.listVisibleWindows()).toContainEqual(fixture.identity);
			await expectAction(native, fixture.identity, "hide");
			await fixture.waitForState({ visible: false, minimized: false });
			expect(native.listVisibleWindows()).not.toContainEqual(fixture.identity);
			expect(native.getWindowTitle(fixture.identity)).toBe(fixture.title);
		} finally {
			await fixture.dispose();
		}
	}, 60000);

	it("leaves the live fixture unchanged when the owner PID does not match", async () => {
		const native = requireNative();
		const fixture = await startWindowsWindowFixture();
		try {
			const mismatchedWindow = {
				id: fixture.identity.id,
				processId: fixture.identity.processId === 4294967295 ? 1 : fixture.identity.processId + 1,
			};
			expect(native.getWindowTitle(mismatchedWindow)).toBe("");
			for (const action of actions) {
				await expectAction(native, mismatchedWindow, action);
				await fixture.waitForState({ visible: true, minimized: false });
				expect(native.listVisibleWindows()).toContainEqual(fixture.identity);
				expect(native.getWindowTitle(fixture.identity)).toBe(fixture.title);
			}
		} finally {
			await fixture.dispose();
		}
	}, 60000);

	it("treats the real identity as stale after its process exits", async () => {
		const native = requireNative();
		const fixture = await startWindowsWindowFixture();
		try {
			expect(native.getWindowTitle(fixture.identity)).toBe(fixture.title);
			await fixture.dispose();
			expect(native.getWindowTitle(fixture.identity)).toBe("");
			for (const action of actions) {
				await expectAction(native, fixture.identity, action);
			}
		} finally {
			await fixture.dispose();
		}
	}, 60000);

	it("treats impossible window handles as benign no-ops", async () => {
		const native = requireNative();
		expect(native.getWindowTitle(missingWindow)).toBe("");
		for (const action of actions) {
			await expectAction(native, missingWindow, action);
		}
	}, 60000);

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
		await expectAction(native, window, "hide");
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
