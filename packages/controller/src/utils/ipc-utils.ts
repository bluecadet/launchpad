const WINDOWS_PIPE_PREFIX = "\\\\?\\pipe\\";
const WINDOWS_DOT_PIPE_PREFIX = "\\\\.\\pipe\\";

/**
 * Whether a path is already a Windows named pipe.
 */
export function isWindowsNamedPipe(socketPath: string): boolean {
	return (
		socketPath.startsWith(WINDOWS_PIPE_PREFIX) || socketPath.startsWith(WINDOWS_DOT_PIPE_PREFIX)
	);
}

/**
 * Ensure path conforms with OS requirements (only relevant for windows ATM)
 * https://nodejs.org/api/net.html#identifying-paths-for-ipc-connections
 *
 * Windows named pipes must live in the `\\?\pipe\` (or `\\.\pipe\`) namespace, and
 * the pipe name segment itself may not contain backslashes. We sanitize the
 * resolved filesystem path into a single, collision-resistant pipe segment so the
 * default socket location is valid without any user configuration.
 */
export function getOSSocketPath(socketPath: string) {
	if (process.platform !== "win32") {
		return socketPath;
	}

	if (isWindowsNamedPipe(socketPath)) {
		// Already in the correct format
		return socketPath;
	}

	const pipeName = socketPath
		.replace(/^([a-zA-Z]):/, "$1") // drop the colon from the drive letter (C: -> C)
		.replace(/[\\/]+/g, "-") // collapse path separators into a single safe character
		.replace(/^-+/, ""); // trim any leading separator

	return `${WINDOWS_PIPE_PREFIX}${pipeName}`;
}
