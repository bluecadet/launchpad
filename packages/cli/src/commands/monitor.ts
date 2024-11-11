import { ResultAsync, err, ok } from "neverthrow";
import type { LaunchpadArgv } from "../cli.js";
import { ImportError, MonitorError } from "../errors.js";
import { handleFatalError, initializeLogger, loadConfigAndEnv } from "../utils/command-utils.js";

export function monitor(argv: LaunchpadArgv) {
	return loadConfigAndEnv(argv)
		.andThen(initializeLogger)
		.andThen(({ config, rootLogger }) => {
			return importLaunchpadMonitor()
				.andThen(({ default: LaunchpadMonitor }) => {
					if (!config.monitor) {
						return err(new Error("No monitor config found in your config file."));
					}

					const monitorInstance = new LaunchpadMonitor(config.monitor, rootLogger);
					return ok(monitorInstance);
				})
				.andThrough((monitorInstance) => {
					return ResultAsync.fromPromise(
						monitorInstance.connect(),
						() => new MonitorError("Failed to connect to monitor"),
					);
				})
				.andThrough((monitorInstance) => {
					return ResultAsync.fromPromise(
						monitorInstance.start(),
						() => new MonitorError("Failed to start monitor"),
					);
				})
				.orElse((error) => handleFatalError(error, rootLogger));
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
