import { fork } from "node:child_process";
import type { BaseCommand } from "@bluecadet/launchpad-utils/plugin-interfaces";
import chalk from "chalk";
import { fromPromise, okAsync, type ResultAsync } from "neverthrow";
import type { GlobalLaunchpadArgs } from "../cli.js";
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

					const plugins = config.plugins ?? [];

					// Register all plugins in sequence, collecting startup commands
					return plugins
						.reduce(
							(chain, plugin) =>
								chain.andThen(({ commands }) =>
									controller.registerPlugin(plugin).map(() => ({
										commands: [...commands, ...(plugin.startupCommands ?? [])],
									})),
								),
							okAsync<{ commands: BaseCommand[] }, Error>({ commands: [] }),
						)
						.andThen(({ commands }) => {
							// Execute all startup commands in sequence
							return commands
								.reduce(
									(chain: ResultAsync<unknown, Error>, command) =>
										chain.andThen(() => controller.executeCommand(command)),
									okAsync(undefined),
								)
								.map(() => undefined);
						})
						.andTee(() => {
							cliLogger.info("Launchpad started in persistent mode. Press Ctrl+C to stop.");
						});
				},
			}).orElse((error) => handleFatalError(error));
		});
}
