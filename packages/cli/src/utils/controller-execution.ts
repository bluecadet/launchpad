/**
 * Clean API for executing commands via controller or daemon.
 * Handles daemon detection and routing automatically.
 */

import path from "node:path";
import { LaunchpadController } from "@bluecadet/launchpad-controller";
import type { ResolvedControllerConfig } from "@bluecadet/launchpad-controller/config";
import { IPCClient } from "@bluecadet/launchpad-controller/ipc-client";
import { getDaemonPid } from "@bluecadet/launchpad-controller/pid-utils";
import type { LaunchpadEvents } from "@bluecadet/launchpad-utils/types";
import { errAsync, type Result, type ResultAsync } from "neverthrow";
import { DaemonNotRunningError, IPCConnectionError } from "../errors.js";
import { cliLogger } from "./cli-logger.js";

export { DaemonNotRunningError, IPCConnectionError };

type WithDaemonDeps = {
	resolvePid?: (pidFile: string) => Result<number | null, Error>;
};

/**
 * Execute a function with a connected IPC client if daemon is running.
 * If daemon is not running, returns an error.
 * Use this for commands that REQUIRE a daemon (status, stop).
 */
export function withDaemon<T>(
	baseDir: string,
	controllerConfig: ResolvedControllerConfig,
	relayLogs: boolean,
	operation: (client: IPCClient, pid: number) => ResultAsync<T, IPCConnectionError>,
	deps?: WithDaemonDeps,
): ResultAsync<T, DaemonNotRunningError | IPCConnectionError> {
	const pidFile = path.resolve(baseDir, controllerConfig.pidFile);
	const socketPath = path.resolve(baseDir, controllerConfig.socketPath);

	// Check if daemon is running
	const daemonPidResult = (deps?.resolvePid ?? getDaemonPid)(pidFile);
	if (daemonPidResult.isErr() || daemonPidResult.value === null) {
		return errAsync(new DaemonNotRunningError());
	}

	const pid = daemonPidResult.value;
	const client = new IPCClient();

	if (relayLogs) {
		addLogListeners(client);
	}

	// Connect and execute operation, disconnecting on both success and error
	return client.connect(socketPath).andThen(() => {
		return operation(client, pid)
			.andTee(() => client.disconnect())
			.orElse((e) => {
				client.disconnect();
				return errAsync(e);
			});
	});
}

/**
 * Execute commands either via daemon (if running) or local controller (if not).
 * Use this for commands that can work either way (content, monitor).
 */
export function withDaemonOrController<T>(
	baseDir: string,
	controllerConfig: ResolvedControllerConfig,
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
		cliLogger.info("Daemon is running, delegating to daemon via IPC");
		const client = new IPCClient();

		addLogListeners(client);

		return client.connect(socketPath).andThen(() => {
			const result = options.ifDaemon(client, pid);
			return result.andTee(() => client.disconnect());
		});
	}

	// Create local controller
	cliLogger.info(`Daemon is not running, starting controller in ${options.mode} mode`);
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
	bus.on("log:error", cliLogger.fromPayload.bind(null, "error"));
	bus.on("log:warn", cliLogger.fromPayload.bind(null, "warn"));
	bus.on("log:info", cliLogger.fromPayload.bind(null, "info"));
	bus.on("log:debug", cliLogger.fromPayload.bind(null, "debug"));
	bus.on("log:verbose", cliLogger.fromPayload.bind(null, "verbose"));
	bus.on("log:tty", (data) => cliLogger.fixed(data.message));
	bus.on("log:tty:close", () => cliLogger.fixed(null));
}
