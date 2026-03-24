import { errAsync } from "neverthrow";
import type { GlobalLaunchpadArgs } from "../cli.js";
import { ConfigError } from "../errors.js";
import { handleFatalError, loadConfigAndEnv } from "../utils/command-utils.js";
import { withDaemonOrController } from "../utils/controller-execution.js";

export function monitor(argv: GlobalLaunchpadArgs) {
	return loadConfigAndEnv(argv)
		.mapErr((error) => handleFatalError(error))
		.andThen(({ dir, config }) => {
			const monitorSubsystem = config.subsystems?.find((s) => s.name === "monitor");
			if (!monitorSubsystem) {
				return errAsync(new ConfigError("No monitor plugin found in your config file."));
			}

			return withDaemonOrController(dir, config.controller, {
				mode: "persistent",
				ifDaemon: (client) => {
					// Daemon is running - just send commands via IPC
					return client
						.executeCommand({ type: "monitor.connect" })
						.andThen(() => client.executeCommand({ type: "monitor.start" }));
				},
				otherwise: (controller) => {
					// No daemon - need to register subsystem and run commands
					return controller
						.registerSubsystem(monitorSubsystem)
						.andThen(() => controller.executeCommand({ type: "monitor.connect" }))
						.andThen(() => controller.executeCommand({ type: "monitor.start" }));
				},
			}).orElse((error) => handleFatalError(error));
		});
}
