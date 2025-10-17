import { err, ResultAsync } from "neverthrow";
import type { LaunchpadArgv } from "../cli.js";
import { ConfigError, ImportError } from "../errors.js";
import { handleFatalError, initializeLogger, loadConfigAndEnv } from "../utils/command-utils.js";
import { executeViaController } from "../utils/controller-utils.js";

export function content(argv: LaunchpadArgv) {
	return loadConfigAndEnv(argv)
		.mapErr((error) => handleFatalError(error, console))
		.andThen(({ dir, config }) => {
			return initializeLogger(config, dir).asyncAndThen((rootLogger) => {
				return importLaunchpadContent()
					.andThen(({ default: LaunchpadContent }) => {
						if (!config.content) {
							return err(new ConfigError("No content config found in your config file."));
						}

						const contentInstance = new LaunchpadContent(config.content, rootLogger, dir);

						// Execute via controller in task mode
						return executeViaController(
							"content",
							contentInstance,
							{ type: "content.fetch" },
							rootLogger,
						);
					})
					.orElse((error) => handleFatalError(error, rootLogger));
			});
		});
}

export function importLaunchpadContent() {
	return ResultAsync.fromPromise(
		import("@bluecadet/launchpad-content"),
		(e) =>
			new ImportError(
				'Could not find module "@bluecadet/launchpad-content". Make sure you have installed it.',
				{ cause: e },
			),
	);
}
