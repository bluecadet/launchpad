import { fork } from "node:child_process";
import chalk from "chalk";
import { fromPromise, okAsync, type ResultAsync } from "neverthrow";
import type { GlobalLaunchpadArgs } from "../run.js";
import { cliLogger } from "../utils/cli-logger.js";
import { handleFatalError, type LoadedConfig } from "../utils/command-utils.js";
import { withDaemonOrController } from "../utils/controller-execution.js";
import {
	isDetached,
	isValidChildLogMessage,
	isValidReadyMessage,
	sendReadyMessage,
} from "../utils/detached-messaging.js";
import { onTerminate } from "../utils/on-terminate.js";

export function start(
	argv: GlobalLaunchpadArgs & { detach?: boolean },
	loaded: LoadedConfig,
): ResultAsync<void, Error> {
	if (argv.detach) {
		return startDetached(argv);
	}

	return startForeground(loaded);
}

function startDetached(_argv: GlobalLaunchpadArgs): ResultAsync<void, Error> {
	return fromPromise(
		new Promise<void>((resolve, reject) => {
			const filteredArgv = process.argv
				.slice(1) // Skip the first argument (node executable)
				.filter((arg) => arg !== "--detach" && arg !== "-d"); // Remove detach flags

			const [mod, ...args] = filteredArgv;

			cliLogger.info("Starting Launchpad in background...");

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

function startForeground({ dir, config }: LoadedConfig): ResultAsync<void, Error> {
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
			}

			onTerminate(() => {
				controller.stop().match(
					() => process.exit(0),
					() => process.exit(1),
				);
			});

			// Listen for shutdown events from IPC or plugins
			controller.getEventBus().on("system:shutdown", ({ code }) => {
				controller.stop().match(
					() => process.exit(code ?? 0),
					() => process.exit(1),
				);
			});

			const plugins = config.plugins ?? [];

			return plugins
				.reduce(
					(chain, plugin) => chain.andThen(() => controller.registerPlugin(plugin)),
					okAsync<void, Error>(undefined),
				)
				.andTee(() => {
					controller.setWorkflows(config.workflows ?? {});
				})
				.andThen(() =>
					// A failed workflow step is not fatal: log it and keep the
					// controller running so healthy plugins stay up.
					controller.runWorkflow("start").orElse((error) => {
						cliLogger.error(error);
						cliLogger.warn("Some 'start' workflow steps failed; launchpad will keep running.");
						return okAsync<void, Error>(undefined);
					}),
				)
				.andTee(() => {
					if (isDetached) {
						sendReadyMessage();
					}
					cliLogger.info("Launchpad started in persistent mode. Press Ctrl+C to stop.");
				});
		},
	}).orElse((error) => handleFatalError(error));
}
