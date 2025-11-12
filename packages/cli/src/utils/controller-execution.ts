/**
 * Clean API for executing commands via controller or daemon.
 * Handles daemon detection and routing automatically.
 */

import path from "node:path";
import { LaunchpadController } from "@bluecadet/launchpad-controller";
import type { ResolvedControllerConfig } from "@bluecadet/launchpad-controller/config";
import { IPCClient } from "@bluecadet/launchpad-controller/ipc-client";
import { getDaemonPid } from "@bluecadet/launchpad-controller/pid-utils";
import type { Logger } from "@bluecadet/launchpad-utils/logger";
import type { LaunchpadEvents } from "@bluecadet/launchpad-utils/types";
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
	controllerConfig: ResolvedControllerConfig,
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

	addLogListeners(client);

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
	controllerConfig: ResolvedControllerConfig,
	logger: Logger | Console,
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

		addLogListeners(client);

		return client.connect(socketPath).andThen(() => {
			const result = options.ifDaemon(client, pid);
			return result.andTee(() => client.disconnect());
		});
	}

	// Create local controller
	logger.info(`Daemon is not running, starting controller in ${options.mode} mode`);
	const controller = new LaunchpadController(controllerConfig, baseDir, options.mode);

	addLogListeners(controller.getEventBus());

	return controller.start().andThen(() => {
		const result = options.otherwise(controller);

		// Stop controller after commands complete (unless persistent mode)
		if (options.mode === "task") {
			return result.andTee(() => controller.stop());
		}

		return result;
	});
}

// Both EventBus and IPCClient implement this interface
type LaunchpadEventEmitter = {
	on<K extends keyof LaunchpadEvents>(event: K, handler: (data: LaunchpadEvents[K]) => void): void;
};

// TODO: nicer log formatting
function addLogListeners(bus: LaunchpadEventEmitter): void {
	bus.on("log:debug", (payload) => {
		console.log(JSON.stringify(payload));
	});
	bus.on("log:info", (payload) => {
		console.log(JSON.stringify(payload));
	});
	bus.on("log:warn", (payload) => {
		console.warn(JSON.stringify(payload));
	});
	bus.on("log:error", (payload) => {
		console.error(JSON.stringify(payload));
	});
}
