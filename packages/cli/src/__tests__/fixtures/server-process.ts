// This file is executed as a forked subprocess, never imported.
// It starts a real LaunchpadController on the socket path provided via env vars.
import path from "node:path";
import { LaunchpadController } from "@bluecadet/launchpad-controller";

const socketPath = process.env.LP_SOCKET_PATH;
const pidFile = process.env.LP_PID_FILE;

if (!socketPath || !pidFile) {
	process.stderr.write("LP_SOCKET_PATH and LP_PID_FILE must be set\n");
	process.exit(1);
}

// Use the directory containing the pid file as the base directory.
// This ensures the file logger writes logs to a writable location.
const baseDir = path.dirname(pidFile);

const controller = new LaunchpadController({ socketPath, pidFile }, baseDir, "persistent");

const startResult = await controller.start();

if (startResult.isErr()) {
	process.stderr.write(`Failed to start controller: ${startResult.error.message}\n`);
	process.exit(1);
}

process.on("SIGTERM", async () => {
	await controller.stop();
	process.exit(0);
});
