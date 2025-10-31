import path from "node:path";

/**
 * Ensure path conforms with OS requirements (only relevant for windows ATM)
 * https://nodejs.org/api/net.html#identifying-paths-for-ipc-connections
 */
export function getOSSocketPath(socketPath: string) {
  if (process.platform === "win32") {
    // On Windows, we need to use a named pipe

    if (socketPath.includes("\\\\?\\pipe") || socketPath.includes("\\\\.\\pipe")) {
      // Already in correct format
      return socketPath;
    }
    return path.join(
      '\\\\?\\pipe',
      socketPath
    )
  }
  return socketPath;
}