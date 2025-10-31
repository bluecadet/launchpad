/**
 * Clean API for executing commands via controller or daemon.
 * Handles daemon detection and routing automatically.
 */

import path from "node:path";
import {
	type ControllerConfig,
	getDaemonPid,
	IPCClient,
	LaunchpadController,
} from "@bluecadet/launchpad-controller";
import type { Logger } from "@bluecadet/launchpad-utils/log-manager";
import { errAsync, type ResultAsync } from "neverthrow";
import { DaemonNotRunningError, IPCConnectionError } from "../errors.js";

export { DaemonNotRunningError, IPCConnectionError };

/**
 * Execute a function with a connected IPC client if daemon is running.
 * If daemon is not running, returns an error.
 * Use this for commands that REQUIRE a daemon (status, stop).
 */
export function withDaemon<T>(
	baseDir: string,
	controllerConfig: ControllerConfig,
	operation: (client: IPCClient, pid: number) => ResultAsync<T, IPCConnectionError>,
): ResultAsync<T, DaemonNotRunningError | IPCConnectionError> {
	const pidFile = path.resolve(baseDir, controllerConfig.pidFile);
	const socketPath = path.resolve(baseDir, controllerConfig.socketPath);

	// Check if daemon is running
	const daemonPidResult = getDaemonPid(pidFile);
	if (daemonPidResult.isErr() || daemonPidResult.value === null) {
		return errAsync(new DaemonNotRunningError());
	}

	const pid = daemonPidResult.value;
	const client = new IPCClient();

	// Connect and execute operation
	return client.connect(socketPath).andThen(() => {
		const result = operation(client, pid);
		return result.andTee(() => client.disconnect());
	});
}

/**
 * Execute commands either via daemon (if running) or local controller (if not).
 * Use this for commands that can work either way (content, monitor).
 */
export function withDaemonOrController<T>(
	baseDir: string,
	controllerConfig: ControllerConfig,
	logger: Logger,
	options: {
		mode: "task" | "persistent";
		ifDaemon: (client: IPCClient, pid: number) => ResultAsync<T, Error>;
		otherwise: (controller: LaunchpadController) => ResultAsync<T, Error>;
	},
): ResultAsync<T, Error> {
	const pidFile = path.resolve(baseDir, controllerConfig.pidFile);
	const socketPath = path.resolve(baseDir, controllerConfig.socketPath);

	// Check if daemon is running
	const daemonPidResult = getDaemonPid(pidFile);
	const isDaemonRunning = daemonPidResult.isOk() && daemonPidResult.value !== null;

	if (isDaemonRunning) {
		// Use daemon via IPC
		const pid = daemonPidResult.value;
		logger.info("Daemon is running, delegating to daemon via IPC");
		const client = new IPCClient();
		return client.connect(socketPath).andThen(() => {
			const result = options.ifDaemon(client, pid);
			return result.andTee(() => client.disconnect());
		});
	}

	// Create local controller
	logger.info(`Daemon is not running, starting controller in ${options.mode} mode`);
	const controller = new LaunchpadController(controllerConfig, logger, baseDir, options.mode);

	return controller.start().andThen(() => {
		const result = options.otherwise(controller);

		// Stop controller after commands complete (unless persistent mode)
		if (options.mode === "task") {
			return result.andTee(() => controller.stop());
		}

		return result;
	});
}
