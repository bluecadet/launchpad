import { fork } from "node:child_process";
import fs from "node:fs";
import type { BaseCommand } from "@bluecadet/launchpad-utils/controller-interfaces";
import { fromPromise, ok, okAsync, type ResultAsync } from "neverthrow";
import type { GlobalLaunchpadArgs } from "../cli.js";
import { handleFatalError, loadConfigAndEnv } from "../utils/command-utils.js";
import { withDaemonOrController } from "../utils/controller-execution.js";
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

			// Fork the CLI process to run the same command without --detach / -d flags
			const child = fork(mod as string, args, {
				detached: true,
				stdio: ["ignore", "pipe", "pipe", "ipc"], // Ignore stdin, pipe stdout/stderr, keep IPC channel
				env: {
					...process.env,
					LAUNCHPAD_IS_DETACHED: "1", // Indicate to the child process that it's detached
				},
			});

			// Pipe child's stdout and stderr to the parent process for logging.
			// This will be closed once the child signals it's ready.
			child.stdout?.pipe(process.stdout);
			child.stderr?.pipe(process.stderr);

			child.on("error", (error) => {
				reject(error);
			});

			child.on("message", (message) => {
				if (message === "ready") {
					// Child process is ready
					child.unref(); // Allow the parent to exit independently
					child.disconnect(); // Close IPC channel
					resolve();
				} else {
					console.log("Unknown message from detached process:", message);
				}
			});

			child.on("exit", (code) => {
				reject(new Error(`Detached process exited with code ${code}`));
			});
		}),
		(error) => error as Error,
	).andTee(() => {
		console.log("Launchpad started in background. Use 'launchpad stop' to stop it.");
	});
}

function startForeground(argv: GlobalLaunchpadArgs): ResultAsync<void, Error> {
	return loadConfigAndEnv(argv)
		.mapErr((error) => handleFatalError(error))
		.andThen(({ dir, config }) => {
			// Build startup commands based on config
			const startupCommands: Array<BaseCommand> = [];

			return withDaemonOrController(dir, config.controller, console, {
				mode: "persistent",
				ifDaemon: (_client, pid) => {
					// Daemon already running
					console.error(`Launchpad is already running (PID: ${pid})`);
					console.error("Stop it with: launchpad stop");
					process.exit(1);
				},
				otherwise: (controller) => {
					if (process.env.LAUNCHPAD_IS_DETACHED === "1") {
						// set to launchpad for easier identification in process lists
						process.title = "launchpad";
						// disconnect from parent process to fully detach
						process.send?.("ready");
						process.stdout.end();
						process.stderr.end();

						// TODO: figure out a less hacky way to do this

						// Redirect stdout and stderr to /dev/null to prevent any output
						// from causing errors due to closed streams
						const devNullStream = fs.createWriteStream("/dev/null");
						// @ts-ignore
						process.stdout.write = devNullStream.write.bind(devNullStream);
						// @ts-ignore
						process.stderr.write = devNullStream.write.bind(devNullStream);
					}

					return okAsync<void, Error>(undefined)
						.andThrough(() => {
							// Dynamically import and register content if configured
							if (config.content) {
								startupCommands.push({ type: "content.fetch" });

								const contentConfig = config.content;
								return importLaunchpadContent().andThen(({ LaunchpadContent }) => {
									const contentInstance = new LaunchpadContent(
										contentConfig,
										controller.getSubsystemCtx("content"),
									);
									controller.registerSubsystem("content", contentInstance);
									return contentInstance.loadSources();
								});
							}
							return ok();
						})
						.andThrough(() => {
							// Dynamically import and register monitor if configured
							if (config.monitor) {
								startupCommands.push({ type: "monitor.connect" }, { type: "monitor.start" });

								const monitorConfig = config.monitor;
								return importLaunchpadMonitor().andThen(({ LaunchpadMonitor }) => {
									const monitorInstance = new LaunchpadMonitor(
										monitorConfig,
										controller.getSubsystemCtx("monitor"),
									);
									controller.registerSubsystem("monitor", monitorInstance);
									return ok();
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
							console.log("Launchpad started in persistent mode. Press Ctrl+C to stop.");
						});
				},
			}).orElse((error) => handleFatalError(error));
		});
}
