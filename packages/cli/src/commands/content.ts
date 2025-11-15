import { errAsync, ResultAsync } from "neverthrow";
import type { GlobalLaunchpadArgs } from "../cli.js";
import { ConfigError, ImportError } from "../errors.js";
import { handleFatalError, loadConfigAndEnv } from "../utils/command-utils.js";
import { withDaemonOrController } from "../utils/controller-execution.js";

export function content(argv: GlobalLaunchpadArgs) {
	return loadConfigAndEnv(argv)
		.mapErr((error) => handleFatalError(error))
		.andThen(({ dir, config }) => {
			if (!config.content) {
				return errAsync(new ConfigError("No content config found in your config file."));
			}

			// saving a reference here for type safety
			// as config.content is possibly undefined later in the callbacks
			const configContent = config.content;

			return withDaemonOrController(dir, config.controller, {
				mode: "task",
				ifDaemon: (client) => {
					// Daemon is running - just send commands via IPC
					return client.executeCommand({ type: "content.fetch" });
				},
				otherwise: (controller) => {
					// No daemon - need to instantiate subsystem and register it
					return importLaunchpadContent().andThen(({ LaunchpadContent }) => {
						const contentInstance = new LaunchpadContent(
							configContent,
							controller.getSubsystemCtx("content"),
						);
						controller.registerSubsystem("content", contentInstance);

						return contentInstance
							.loadSources()
							.andThen(() => controller.executeCommand({ type: "content.fetch" }));
					});
				},
			}).orElse((error) => handleFatalError(error));
		});
}

export function importLaunchpadContent(): ResultAsync<
	typeof import("@bluecadet/launchpad-content"),
	Error
> {
	return ResultAsync.fromPromise(
		import("@bluecadet/launchpad-content"),
		(e: unknown) =>
			new ImportError(
				'Could not find module "@bluecadet/launchpad-content". Make sure you have installed it.',
				{ cause: e instanceof Error ? e : new Error(String(e)) },
			),
	);
}
