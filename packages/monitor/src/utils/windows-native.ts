import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/** An opaque decimal HWND and the process that owned it when enumerated. */
export type WindowIdentity = {
	id: string;
	processId: number;
};

export type WindowAction = "hide" | "minimize" | "foreground";

export interface WindowsNative {
	listVisibleWindows(): WindowIdentity[];
	getWindowTitle(window: WindowIdentity): string;
	applyWindowAction(window: WindowIdentity, action: WindowAction): Promise<void>;
}

let cachedNative: WindowsNative | undefined;

function isWindowsNative(value: unknown): value is WindowsNative {
	return (
		typeof value === "object" &&
		value !== null &&
		"listVisibleWindows" in value &&
		typeof value.listVisibleWindows === "function" &&
		"getWindowTitle" in value &&
		typeof value.getWindowTitle === "function" &&
		"applyWindowAction" in value &&
		typeof value.applyWindowAction === "function"
	);
}

/** Load the bundled Node-API addon only when Windows controls are needed. */
export function getWindowsNative(): WindowsNative | undefined {
	if (process.platform !== "win32") {
		return undefined;
	}
	if (process.arch !== "x64" && process.arch !== "arm64") {
		throw new Error(
			`Windows controls are not supported on architecture '${process.arch}'. Supported architectures: x64, arm64.`,
		);
	}
	if (cachedNative) {
		return cachedNative;
	}

	const binaryPath = fileURLToPath(
		new URL(`../../prebuilds/win32-${process.arch}/windows.node`, import.meta.url),
	);
	try {
		const require = createRequire(import.meta.url);
		const native: unknown = require(binaryPath);
		if (!isWindowsNative(native)) {
			throw new Error("The native addon does not export the expected Windows controls API.");
		}
		cachedNative = native;
		return native;
	} catch (cause) {
		throw new Error(
			`Failed to load Windows controls from '${binaryPath}'. Ensure the bundled win32-${process.arch} Node-API addon is installed and compatible with this Node.js runtime.`,
			{ cause },
		);
	}
}
