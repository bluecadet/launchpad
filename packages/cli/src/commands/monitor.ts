import { errAsync, ResultAsync } from "neverthrow";
import type { GlobalLaunchpadArgs } from "../cli.js";
import { ConfigError, ImportError } from "../errors.js";
import { handleFatalError, initializeLogger, loadConfigAndEnv } from "../utils/command-utils.js";
import { withDaemonOrController } from "../utils/controller-execution.js";

export function monitor(argv: GlobalLaunchpadArgs) {
	return loadConfigAndEnv(argv)
		.mapErr((error) => handleFatalError(error, console))
		.andThen(({ dir, config }) => {
			return initializeLogger(config, dir).asyncAndThen((rootLogger) => {
				if (!config.monitor) {
					return errAsync(new ConfigError("No monitor config found in your config file."));
				}

				// saving a reference here for type safety
				// as config.monitor is possibly undefined later in the callbacks
				const configMonitor = config.monitor;

				return withDaemonOrController(dir, config.controller, rootLogger, {
					mode: "persistent",
					ifDaemon: (client) => {
						// Daemon is running - just send commands via IPC
						return client
							.executeCommand({ type: "monitor.connect" })
							.andThen(() => client.executeCommand({ type: "monitor.start" }));
					},
					otherwise: (controller) => {
						// No daemon - need to instantiate subsystem and register it
						return importLaunchpadMonitor().andThen(({ default: LaunchpadMonitor }) => {
							const monitorInstance = new LaunchpadMonitor(configMonitor, rootLogger, dir);
							controller.registerSubsystem("monitor", monitorInstance);

							return controller
								.executeCommand({ type: "monitor.connect" })
								.andThen(() => controller.executeCommand({ type: "monitor.start" }));
						});
					},
				}).orElse((error) => handleFatalError(error, rootLogger));
			});
		});
}

export function importLaunchpadMonitor() {
	return ResultAsync.fromPromise(
		import("@bluecadet/launchpad-monitor"),
		() =>
			new ImportError(
				'Could not find module "@bluecadet/launchpad-monitor". Make sure you have installed it.',
			),
	);
}
