import chalk from "chalk";
import { okAsync, ResultAsync } from "neverthrow";
import type { GlobalLaunchpadArgs } from "../cli.js";
import { cliLogger } from "../utils/cli-logger.js";
import { handleFatalError, loadConfigAndEnv } from "../utils/command-utils.js";
import { withDaemon } from "../utils/controller-execution.js";
import { onTerminate } from "../utils/on-terminate.js";
import { formatSnapshot } from "./format-snapshot.js";

const watchMessage = chalk.dim("Watching for status changes... (press Ctrl+C to exit)");

export function status(argv: GlobalLaunchpadArgs & { watch?: boolean }) {
	return loadConfigAndEnv(argv)
		.andThen(({ dir, config }) =>
			withDaemon(dir, config.controller, false, (client) =>
				client.queryStatusSnapshot().andThen((snapshot) => {
					if (!argv.watch) {
						cliLogger.fixed(formatSnapshot(snapshot));
						return okAsync(snapshot);
					}

					cliLogger.fixed(`${formatSnapshot(snapshot)}\n${watchMessage}`);

					client.onStatusSnapshotChange((newSnapshot) => {
						cliLogger.fixed(`${formatSnapshot(newSnapshot)}\n${watchMessage}`);
					});

					return ResultAsync.fromSafePromise(
						new Promise<void>((resolve) => {
							onTerminate(() => resolve());
						}),
					);
				}),
			),
		)
		.orElse((error) => handleFatalError(error));
}
