import path from "node:path";
import { deletePidFile, isProcessRunning } from "@bluecadet/launchpad-controller/pid-utils";
import { err, ok, type Result, ResultAsync } from "neverthrow";
import type { GlobalLaunchpadArgs } from "../cli.js";
import { cliLogger } from "../utils/cli-logger.js";
import { handleFatalError, loadConfigAndEnv } from "../utils/command-utils.js";
import {
	DaemonNotRunningError,
	IPCConnectionError,
	withDaemon,
} from "../utils/controller-execution.js";

/**
 * Stop command - Gracefully stop the persistent controller via IPC,
 * with SIGTERM and SIGKILL fallbacks if IPC fails.
 */
export function stop(argv: GlobalLaunchpadArgs) {
	return loadConfigAndEnv(argv)
		.andThen(({ dir, config }) => {
			const pidFile = path.resolve(dir, config.controller.pidFile);

			return withDaemon(dir, config.controller, true, (client, pid) => {
				cliLogger.info("Stopping Launchpad gracefully...");
				return client
					.shutdown()
					.andThen(() => wait(5000))
					.andThen(() => {
						// Verify it stopped
						if (!isProcessRunning(pid)) {
							deletePidFile(pidFile);
							cliLogger.info("Launchpad stopped");
							return ok();
						}

						// IPC shutdown didn't work - fall back to SIGTERM
						cliLogger.info("Process still running, sending SIGTERM...");
						return safeKill(pid, "SIGTERM")
							.mapErr(
								(e) => new IPCConnectionError("Failed to stop process via signal", { cause: e }),
							)
							.asyncAndThen(() => wait(2000))
							.andThen(() => {
								if (!isProcessRunning(pid)) {
									deletePidFile(pidFile);
									cliLogger.info("Launchpad stopped");
									return ok();
								}

								// Still running - force kill
								cliLogger.info("Process did not stop gracefully, sending SIGKILL...");
								return safeKill(pid, "SIGKILL")
									.mapErr(
										(e) => new IPCConnectionError("Failed to force kill process", { cause: e }),
									)
									.map(() => {
										deletePidFile(pidFile);
										cliLogger.warn("Launchpad force stopped");
									});
							});
					});
			}).orElse((e) => {
				if (e instanceof DaemonNotRunningError && config.monitor !== undefined) {
					// try to just stop the monitor process if possible
					// This is for compatibility with older versions of launchpad, where the 'stop' command only managed the pm2 process
					// TODO: in a future major version, we can probably remove this fallback or move it to a separate command
					cliLogger.info("Launchpad is not running.");
					cliLogger.info("Found monitor configuration, attempting to kill monitor process...");

					return ResultAsync.fromPromise(
						import("@bluecadet/launchpad-monitor/launchpad-monitor"),
						() => new Error('Could not import "@bluecadet/launchpad-monitor"'),
					).andThen((module) => {
						const killPM2 = module.killPM2;
						return killPM2(cliLogger);
					});
				}

				return err(e);
			});
		})
		.orElse((error) => handleFatalError(error));
}

// wait helper wrapped in ResultAsync
export function wait(ms: number): ResultAsync<void, never> {
	return ResultAsync.fromSafePromise(new Promise((resolve) => setTimeout(resolve, ms)));
}

// kill fn wrapped in Result
function safeKill(pid: number, signal: NodeJS.Signals): Result<void, Error> {
	try {
		process.kill(pid, signal);
		return ok();
	} catch (e) {
		const cause = e instanceof Error ? e : new Error(String(e));
		return err(new Error(`Failed to send ${signal} to process ${pid}`, { cause }));
	}
}
