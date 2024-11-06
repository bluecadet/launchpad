import { err, ok, ResultAsync } from "neverthrow";
import { ImportError } from "../errors.js";
import { handleFatalError, initializeLogger, loadConfigAndEnv } from "../utils/command-utils.js";
import type { LaunchpadArgv } from "../cli.js";

export function content(argv: LaunchpadArgv) {
	return loadConfigAndEnv(argv)
		.andThen(initializeLogger)
		.andThen(({ config, rootLogger }) => {
			return importLaunchpadContent()
				.andThen(({ LaunchpadContent }) => {
					if (!config.content) {
						return err(new Error("No content config found in your config file."));
					}

					const contentInstance = new LaunchpadContent(config.content, rootLogger);
					return contentInstance.download();
				})
				.orElse((error) => handleFatalError(error, rootLogger));
		});
}

export function importLaunchpadContent() {
	return ResultAsync.fromPromise(
		import("@bluecadet/launchpad-content"),
		() => new ImportError('Could not find module "@bluecadet/launchpad-content". Make sure you have installed it.'),
	);
}
