import { type ChildProcess, fork } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BaseCommand } from "@bluecadet/launchpad-utils";
import { fromPromise, ok, okAsync, type ResultAsync } from "neverthrow";
import type { LaunchpadArgv } from "../cli.js";
import { handleFatalError, initializeLogger, loadConfigAndEnv } from "../utils/command-utils.js";
import { withDaemonOrController } from "../utils/controller-execution.js";
import { importLaunchpadContent } from "./content.js";
import { importLaunchpadMonitor } from "./monitor.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function start(argv: LaunchpadArgv): ResultAsync<void, Error> {
	// If detach mode is requested, fork the process
	if (argv.detach) {
		return startDetached(argv);
	}

	// Otherwise, run in foreground
	return startForeground(argv);
}

function startDetached(_argv: LaunchpadArgv): ResultAsync<void, Error> {
	return fromPromise(
		new Promise<ChildProcess>((resolve, reject) => {
			// Fork the CLI process to run the start command without --detach
			const child = fork(join(__dirname, "../../dist/cli.js"), ["start"], {
				detached: true,
				stdio: "ignore",
			});

			let resolved = false;

			child.on("error", (error) => {
				if (!resolved) {
					resolved = true;
					reject(new Error(`Failed to start launchpad in background: ${error.message}`));
				}
			});

			child.on("exit", (code) => {
				if (!resolved) {
					resolved = true;
					if (code === 0) {
						console.log("Launchpad started in background. Use 'launchpad stop' to stop it.");
						resolve(child);
					} else {
						reject(new Error(`Failed to start launchpad in background (exit code: ${code})`));
					}
				}
			});
		}),
		(error) => error as Error,
	).andThen((childProcess) => {
		childProcess.unref(); // Allow the parent to exit independently
		return ok();
	});
}

function startForeground(argv: LaunchpadArgv): ResultAsync<void, Error> {
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
						return okAsync<void, Error>(undefined)
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

								return resultChain.map(() => undefined);
							})
							.andTee(() => {
								rootLogger.info("Launchpad started in persistent mode. Press Ctrl+C to stop.");
							});
					},
				}).orElse((error) => handleFatalError(error, rootLogger));
			});
		});
}
