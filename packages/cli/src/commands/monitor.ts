import { LaunchpadController } from "@bluecadet/launchpad-controller";
import { err, ResultAsync } from "neverthrow";
import type { LaunchpadArgv } from "../cli.js";
import { ConfigError, ImportError } from "../errors.js";
import { handleFatalError, initializeLogger, loadConfigAndEnv } from "../utils/command-utils.js";

export function monitor(argv: LaunchpadArgv) {
	return loadConfigAndEnv(argv)
		.mapErr((error) => handleFatalError(error, console))
		.andThen(({ dir, config }) => {
			return initializeLogger(config, dir).asyncAndThen((rootLogger) => {
				return importLaunchpadMonitor()
					.andThen(({ default: LaunchpadMonitor }) => {
						if (!config.monitor) {
							return err(new ConfigError("No monitor config found in your config file."));
						}

						const monitorInstance = new LaunchpadMonitor(config.monitor, rootLogger, dir);

						// Create controller in task mode
						const controller = new LaunchpadController({}, rootLogger, "task");
						controller.registerSubsystem("monitor", monitorInstance);

						// Start controller and execute commands
						return ResultAsync.fromPromise(controller.start(), (e) => e as Error)
							.andThen(() =>
								ResultAsync.fromPromise(
									controller.executeCommand({ type: "monitor.connect" }),
									(e) => e as Error,
								),
							)
							.andThen(() =>
								ResultAsync.fromPromise(
									controller.executeCommand({ type: "monitor.start" }),
									(e) => e as Error,
								),
							);
						// Note: Controller is not stopped for monitor since apps need to keep running
					})
					.orElse((error) => handleFatalError(error, rootLogger));
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
