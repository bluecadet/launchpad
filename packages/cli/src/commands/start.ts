import { fork } from "node:child_process";
import type { BaseCommand } from "@bluecadet/launchpad-utils/subsystem-interfaces";
import chalk from "chalk";
import { fromPromise, ok, okAsync, ResultAsync } from "neverthrow";
import type { GlobalLaunchpadArgs } from "../cli.js";
import { ImportError } from "../errors.js";
import { cliLogger } from "../utils/cli-logger.js";
import { handleFatalError, loadConfigAndEnv } from "../utils/command-utils.js";
import { withDaemonOrController } from "../utils/controller-execution.js";
import {
	isDetached,
	isValidChildLogMessage,
	isValidReadyMessage,
	sendReadyMessage,
} from "../utils/detached-messaging.js";
import { onTerminate } from "../utils/on-terminate.js";
import { importLaunchpadContent } from "./content.js";
import { importLaunchpadMonitor } from "./monitor.js";

export function start(argv: GlobalLaunchpadArgs & { detach?: boolean }): ResultAsync<void, Error> {
	// If detach mode is requested, fork the process
	if (argv.detach) {
		return startDetached(argv);
	}

	// Otherwise, run in foreground
	return startForeground(argv);
}

function startDetached(_argv: GlobalLaunchpadArgs): ResultAsync<void, Error> {
	return fromPromise(
		new Promise<void>((resolve, reject) => {
			const filteredArgv = process.argv
				.slice(1) // Skip the first argument (node executable)
				.filter((arg) => arg !== "--detach" && arg !== "-d"); // Remove detach flags

			const [mod, ...args] = filteredArgv;

			cliLogger.info("Starting Launchpad in background...");

			// Fork the CLI process to run the same command without --detach / -d flags
			const child = fork(mod as string, args, {
				detached: true,
				stdio: "ignore", // Ignore stdin, pipe stdout/stderr, keep IPC channel
				env: {
					...process.env,
					LAUNCHPAD_IS_DETACHED: "1", // Indicate to the child process that it's detached
				},
			});

			cliLogger.verbose(`Launched detached process with PID: ${child.pid}`);

			child.on("error", (error) => {
				reject(error);
			});

			child.on("message", (message) => {
				if (isValidChildLogMessage(message)) {
					const { level, payload } = message;
					cliLogger.fromPayload(level, payload);
				} else if (isValidReadyMessage(message)) {
					cliLogger.info("Launchpad started successfully in background.");
					child.unref(); // Allow the parent to exit independently
					child.disconnect(); // Close IPC channel
					resolve();
				} else {
					cliLogger.warn("Unknown message from detached process:", message);
				}
			});

			child.on("exit", (code) => {
				reject(new Error(`Detached process exited with code ${code}`));
			});
		}),
		(error) => error as Error,
	).andTee(() => {
		cliLogger.info(
			`Launchpad started in background. Use '${chalk.cyan("launchpad stop")}' to stop it.`,
		);
	});
}

function startForeground(argv: GlobalLaunchpadArgs): ResultAsync<void, Error> {
	return loadConfigAndEnv(argv)
		.mapErr((error) => handleFatalError(error))
		.andThen(({ dir, config }) => {
			// Build startup commands based on config
			const startupCommands: Array<BaseCommand> = [];

			return withDaemonOrController(dir, config.controller, {
				mode: "persistent",
				ifDaemon: (_client, pid) => {
					// Daemon already running
					cliLogger.error(`Launchpad is already running (PID: ${pid})`);
					cliLogger.error("Stop it with: launchpad stop");
					process.exit(1);
				},
				otherwise: (controller) => {
					if (isDetached) {
						process.title = "launchpad";
						sendReadyMessage();
					}

					onTerminate(() => {
						controller.stop();
					});

					return okAsync<void, Error>(undefined)
						.andThrough(() => {
							// Dynamically import and register content if configured
							if (config.content) {
								startupCommands.push({ type: "content.fetch" });

								const contentConfig = config.content;
								return importLaunchpadContent().andThen(({ createLaunchpadContent }) => {
									return controller.registerSubsystem(createLaunchpadContent(contentConfig));
								});
							}
							return ok();
						})
						.andThrough(() => {
							// Dynamically import and register monitor if configured
							if (config.monitor) {
								startupCommands.push({ type: "monitor.connect" }, { type: "monitor.start" });

								const monitorConfig = config.monitor;
								return importLaunchpadMonitor().andThen(({ createLaunchpadMonitor }) => {
									return controller.registerSubsystem(createLaunchpadMonitor(monitorConfig));
								});
							}
							return ok();
						})
						.andThrough(() => {
							// Dynamically import and register dashboard if configured
							if (config.dashboard) {
								const dashboardConfig = config.dashboard;
								return importLaunchpadDashboard()
									.andThen(({ createLaunchpadDashboard }) => {
										return controller.registerSubsystem(createLaunchpadDashboard(dashboardConfig));
									})
									.andTee((dashboardSubsystem) => {
										// after registering the dashboard subsystem, we need to
										// get its registry and pass it to the other subsystems.
										//
										// TODO: maybe we should come up with a better way for subsystems
										// to call each other during setup? I don't love that this HAS to be
										// registered last.

										const registry = dashboardSubsystem.getRegistry();

										for (const [_name, subsystem] of controller.getSubsystems()) {
											if (subsystem.buildDashboard) {
												subsystem.buildDashboard(registry);
											}
										}
									});
							}
							return ok();
						})
						.andThen(() => {
							let resultChain: ResultAsync<unknown, Error> = okAsync(undefined);

							// Execute startup commands if any
							if (startupCommands.length > 0) {
								for (const command of startupCommands) {
									resultChain = resultChain.andThen(() => controller.executeCommand(command));
								}
							}

							return resultChain.map(() => undefined);
						})
						.andTee(() => {
							cliLogger.info("Launchpad started in persistent mode. Press Ctrl+C to stop.");
						});
				},
			}).orElse((error) => handleFatalError(error));
		});
}

export function importLaunchpadDashboard() {
	return ResultAsync.fromPromise(
		import("@bluecadet/launchpad-dashboard"),
		() =>
			new ImportError(
				'Could not find module "@bluecadet/launchpad-dashboard". Make sure you have installed it.',
			),
	);
}
