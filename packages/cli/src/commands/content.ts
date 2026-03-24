import { errAsync } from "neverthrow";
import type { GlobalLaunchpadArgs } from "../cli.js";
import { ConfigError } from "../errors.js";
import { handleFatalError, loadConfigAndEnv } from "../utils/command-utils.js";
import { withDaemonOrController } from "../utils/controller-execution.js";

export function content(argv: GlobalLaunchpadArgs) {
	return loadConfigAndEnv(argv)
		.mapErr((error) => handleFatalError(error))
		.andThen(({ dir, config }) => {
			const contentSubsystem = config.subsystems?.find((s) => s.name === "content");
			if (!contentSubsystem) {
				return errAsync(new ConfigError("No content plugin found in your config file."));
			}

			return withDaemonOrController(dir, config.controller, {
				mode: "task",
				ifDaemon: (client) => {
					// Daemon is running - just send commands via IPC
					return client.executeCommand({ type: "content.fetch" });
				},
				otherwise: (controller) => {
					// No daemon - need to register subsystem and run command
					return controller
						.registerSubsystem(contentSubsystem)
						.andThen(() => controller.executeCommand({ type: "content.fetch" }));
				},
			}).orElse((error) => handleFatalError(error));
		});
}
