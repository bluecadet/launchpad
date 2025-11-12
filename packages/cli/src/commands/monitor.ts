import { errAsync, ResultAsync } from "neverthrow";
import type { GlobalLaunchpadArgs } from "../cli.js";
import { ConfigError, ImportError } from "../errors.js";
import { handleFatalError, loadConfigAndEnv } from "../utils/command-utils.js";
import { withDaemonOrController } from "../utils/controller-execution.js";

export function monitor(argv: GlobalLaunchpadArgs) {
	return loadConfigAndEnv(argv)
		.mapErr((error) => handleFatalError(error))
		.andThen(({ dir, config }) => {
			if (!config.monitor) {
				return errAsync(new ConfigError("No monitor config found in your config file."));
			}

			// saving a reference here for type safety
			// as config.monitor is possibly undefined later in the callbacks
			const configMonitor = config.monitor;

			return withDaemonOrController(dir, config.controller, console, {
				mode: "persistent",
				ifDaemon: (client) => {
					// Daemon is running - just send commands via IPC
					return client
						.executeCommand({ type: "monitor.connect" })
						.andThen(() => client.executeCommand({ type: "monitor.start" }));
				},
				otherwise: (controller) => {
					// No daemon - need to instantiate subsystem and register it
					return importLaunchpadMonitor().andThen(({ LaunchpadMonitor }) => {
						const monitorInstance = new LaunchpadMonitor(
							configMonitor,
							controller.getSubsystemCtx("monitor"),
						);
						controller.registerSubsystem("monitor", monitorInstance);

						return controller
							.executeCommand({ type: "monitor.connect" })
							.andThen(() => controller.executeCommand({ type: "monitor.start" }));
					});
				},
			}).orElse((error) => handleFatalError(error));
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
