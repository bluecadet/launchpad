import type { BaseCommand } from "@bluecadet/launchpad-utils";
import { okAsync, type ResultAsync } from "neverthrow";
import type { LaunchpadArgv } from "../cli.js";
import { handleFatalError, initializeLogger, loadConfigAndEnv } from "../utils/command-utils.js";
import { withDaemonOrController } from "../utils/controller-execution.js";
import { importLaunchpadContent } from "./content.js";
import { importLaunchpadMonitor } from "./monitor.js";

export function start(argv: LaunchpadArgv) {
	return loadConfigAndEnv(argv)
		.mapErr((error) => handleFatalError(error, console))
		.andThen(({ dir, config }) => {
			return initializeLogger(config, dir).asyncAndThen((rootLogger) => {
				// Build startup commands based on config
				const startupCommands: Array<BaseCommand> = [];

				return withDaemonOrController(dir, config.controller, rootLogger, {
					mode: "persistent",
					ifDaemon: (_client, pid) => {
						// Daemon already running
						console.error(`Launchpad is already running (PID: ${pid})`);
						console.error("Stop it with: launchpad stop");
						process.exit(1);
					},
					otherwise: (controller) => {
						return okAsync()
							.andTee(() => {
								// Dynamically import and register content if configured
								if (config.content) {
									startupCommands.push({ type: "content.fetch" });

									const contentConfig = config.content;
									return importLaunchpadContent().andTee(({ default: LaunchpadContent }) => {
										const contentInstance = new LaunchpadContent(contentConfig, rootLogger, dir);
										controller.registerSubsystem("content", contentInstance);
									});
								}
							})
							.andTee(() => {
								// Dynamically import and register monitor if configured
								if (config.monitor) {
									startupCommands.push({ type: "monitor.connect" }, { type: "monitor.start" });

									const monitorConfig = config.monitor;
									return importLaunchpadMonitor().andTee(({ default: LaunchpadMonitor }) => {
										const monitorInstance = new LaunchpadMonitor(monitorConfig, rootLogger, dir);
										controller.registerSubsystem("monitor", monitorInstance);
									});
								}
							})
							.andThen(() => {
								let resultChain: ResultAsync<unknown, Error> = okAsync(undefined);

								// Execute startup commands if any
								if (startupCommands.length > 0) {
									for (const command of startupCommands) {
										resultChain = resultChain.andThen(() => controller.executeCommand(command));
									}
								}

								return resultChain;
							})
							.andTee(() => {
								rootLogger.info("Launchpad started in persistent mode. Press Ctrl+C to stop.");
							});
					},
				}).orElse((error) => handleFatalError(error, rootLogger));
			});
		});
}
