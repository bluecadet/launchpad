import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowsNative } from "../windows-native.js";

vi.mock("node:module", () => ({ createRequire: vi.fn() }));
vi.unmock("../windows-native.js");

const requireNative = vi.fn<(path: string) => unknown>();
const nonWindowsPlatforms: NodeJS.Platform[] = ["darwin", "linux"];
const supportedArchitectures: NodeJS.Architecture[] = ["x64", "arm64"];
const invalidExports: unknown[] = [
	null,
	{},
	{ listVisibleWindows: () => [] },
	{ listVisibleWindows: () => [], getWindowTitle: () => "", applyWindowAction: "hide" },
	{ listVisibleWindows: [], getWindowTitle: () => "", applyWindowAction: () => Promise.resolve() },
	{
		listVisibleWindows: () => [],
		getWindowTitle: null,
		applyWindowAction: () => Promise.resolve(),
	},
];

function mockNative(): WindowsNative {
	return {
		listVisibleWindows: vi.fn(() => []),
		getWindowTitle: vi.fn(() => ""),
		applyWindowAction: vi.fn(async () => undefined),
	};
}

async function loadWrapper() {
	return import("../windows-native.js");
}

describe("getWindowsNative", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.resetAllMocks();
		vi.spyOn(process, "platform", "get").mockReturnValue("win32");
		vi.spyOn(process, "arch", "get").mockReturnValue("x64");
		// The wrapper uses only the callable portion of NodeRequire.
		vi.mocked(createRequire).mockImplementation(() =>
			Object.assign(requireNative, {
				resolve: Object.assign(vi.fn(), { paths: vi.fn() }),
				cache: {},
				extensions: { ".js": vi.fn(), ".json": vi.fn(), ".node": vi.fn() },
				main: undefined,
			}),
		);
	});

	afterEach(() => vi.restoreAllMocks());

	it("does not load the addon on import", async () => {
		await loadWrapper();
		expect(createRequire).not.toHaveBeenCalled();
		expect(requireNative).not.toHaveBeenCalled();
	});

	it.each(nonWindowsPlatforms)("never loads native code on %s", async (platform) => {
		vi.spyOn(process, "platform", "get").mockReturnValue(platform);
		const { getWindowsNative } = await loadWrapper();
		expect(getWindowsNative()).toBeUndefined();
		expect(createRequire).not.toHaveBeenCalled();
		expect(requireNative).not.toHaveBeenCalled();
	});

	it.each(supportedArchitectures)("loads and caches the bundled %s addon", async (arch) => {
		vi.spyOn(process, "arch", "get").mockReturnValue(arch);
		const native = mockNative();
		requireNative.mockReturnValue(native);
		const { getWindowsNative } = await loadWrapper();
		expect(getWindowsNative()).toBe(native);
		expect(getWindowsNative()).toBe(native);
		expect(createRequire).toHaveBeenCalledTimes(1);
		expect(requireNative).toHaveBeenCalledTimes(1);
		expect(requireNative).toHaveBeenCalledWith(
			expect.stringMatching(
				new RegExp(`[/\\\\]prebuilds[/\\\\]win32-${arch}[/\\\\]windows\\.node$`),
			),
		);
	});

	it("throws a descriptive error on unsupported Windows architectures", async () => {
		vi.spyOn(process, "arch", "get").mockReturnValue("ia32");
		const { getWindowsNative } = await loadWrapper();
		expect(getWindowsNative).toThrow(/architecture 'ia32'.*x64, arm64/);
		expect(createRequire).not.toHaveBeenCalled();
	});

	it("reports a missing or incompatible binary and retries failed loads", async () => {
		const cause = new Error("Module did not self-register");
		requireNative.mockImplementationOnce(() => {
			throw cause;
		});
		const { getWindowsNative } = await loadWrapper();
		expect(getWindowsNative).toThrow(/Failed to load Windows controls.*win32-x64/);
		const native = mockNative();
		requireNative.mockReturnValue(native);
		expect(getWindowsNative()).toBe(native);
		expect(requireNative).toHaveBeenCalledTimes(2);
	});

	it.each(invalidExports)("rejects an invalid native export shape: %j", async (exports) => {
		requireNative.mockReturnValue(exports);
		const { getWindowsNative } = await loadWrapper();
		expect(getWindowsNative).toThrow(/Failed to load Windows controls/);
		try {
			getWindowsNative();
		} catch (error) {
			expect(error).toBeInstanceOf(Error);
			if (error instanceof Error) {
				expect(error.cause).toEqual(
					new Error("The native addon does not export the expected Windows controls API."),
				);
			}
		}
	});
});
