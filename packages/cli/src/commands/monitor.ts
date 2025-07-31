import { err, ok, ResultAsync } from "neverthrow";
import type { LaunchpadArgv } from "../cli.js";
import { ConfigError, ImportError, MonitorError } from "../errors.js";
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
						return ok(monitorInstance);
					})
					.andThrough((monitorInstance) => {
						return ResultAsync.fromPromise(
							monitorInstance.connect(),
							(e) => new MonitorError("Failed to connect to monitor", { cause: e }),
						);
					})
					.andThrough((monitorInstance) => {
						return ResultAsync.fromPromise(
							monitorInstance.start(),
							(e) => new MonitorError("Failed to start monitor", { cause: e }),
						);
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
