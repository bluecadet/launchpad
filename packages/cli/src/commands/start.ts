import { ResultAsync, err, ok } from "neverthrow";
import type { LaunchpadArgv } from "../cli.js";
import { MonitorError } from "../errors.js";
import { handleFatalError, initializeLogger, loadConfigAndEnv } from "../utils/command-utils.js";
import { importLaunchpadContent } from "./content.js";
import { importLaunchpadMonitor } from "./monitor.js";

export async function start(argv: LaunchpadArgv) {
	return loadConfigAndEnv(argv)
		.andThen(initializeLogger)
		.andThen(({ config, rootLogger }) => {
			return importLaunchpadContent()
				.andThen(({ default: LaunchpadContent }) => {
					if (!config.content) {
						return err(new Error("No content config found in your config file."));
					}

					const contentInstance = new LaunchpadContent(config.content, rootLogger);
					return contentInstance.start();
				})
				.andThen(() => importLaunchpadMonitor())
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
