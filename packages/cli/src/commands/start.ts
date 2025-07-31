import { err, ok, ResultAsync } from "neverthrow";
import type { LaunchpadArgv } from "../cli.js";
import { ConfigError, MonitorError } from "../errors.js";
import { handleFatalError, initializeLogger, loadConfigAndEnv } from "../utils/command-utils.js";
import { importLaunchpadContent } from "./content.js";
import { importLaunchpadMonitor } from "./monitor.js";

export async function start(argv: LaunchpadArgv) {
	return loadConfigAndEnv(argv)
		.mapErr((error) => handleFatalError(error, console))
		.andThen(({ dir, config }) => {
			return initializeLogger(config, dir).asyncAndThen((rootLogger) => {
				return importLaunchpadContent()
					.andThen(({ default: LaunchpadContent }) => {
						if (!config.content) {
							return err(new ConfigError("No content config found in your config file."));
						}

						const contentInstance = new LaunchpadContent(config.content, rootLogger);
						return contentInstance.start();
					})
					.andThen(() => importLaunchpadMonitor())
					.andThen(({ default: LaunchpadMonitor }) => {
						if (!config.monitor) {
							return err(new ConfigError("No monitor config found in your config file."));
						}

						const monitorInstance = new LaunchpadMonitor(config.monitor, rootLogger);
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
