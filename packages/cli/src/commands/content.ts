import { errAsync } from "neverthrow";
import type { GlobalLaunchpadArgs } from "../cli.js";
import { ConfigError } from "../errors.js";
import { handleFatalError, loadConfigAndEnv } from "../utils/command-utils.js";
import { withDaemonOrController } from "../utils/controller-execution.js";

export function content(argv: GlobalLaunchpadArgs) {
	return loadConfigAndEnv(argv)
		.mapErr((error) => handleFatalError(error))
		.andThen(({ dir, config }) => {
			const contentPlugin = config.plugins?.find((s) => s.name === "content");
			if (!contentPlugin) {
				return errAsync(new ConfigError("No content plugin found in your config file."));
			}

			return withDaemonOrController(dir, config.controller, {
				mode: "task",
				ifDaemon: (client) => {
					// Daemon is running - just send commands via IPC
					return client.executeCommand({ type: "content.fetch" });
				},
				otherwise: (controller) => {
					// No daemon - need to register plugin and run command
					return controller
						.registerPlugin(contentPlugin)
						.andThen(() => controller.executeCommand({ type: "content.fetch" }));
				},
			}).orElse((error) => handleFatalError(error));
		});
}
