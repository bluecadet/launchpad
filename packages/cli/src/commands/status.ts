import chalk from "chalk";
import { okAsync, ResultAsync } from "neverthrow";
import { cliLogger } from "../utils/cli-logger.js";
import { handleFatalError, type LoadedConfig } from "../utils/command-utils.js";
import { withDaemon } from "../utils/controller-execution.js";
import { onTerminate } from "../utils/on-terminate.js";
import { formatSnapshot } from "./format-snapshot.js";

const watchMessage = chalk.dim("Watching for status changes... (press Ctrl+C to exit)");

export function status({ watch }: { watch?: boolean }, { dir, config }: LoadedConfig) {
	return withDaemon(dir, config.controller, false, (client) =>
		client.queryStatusSnapshot().andThen((snapshot) => {
			if (!watch) {
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
	).orElse((error) => handleFatalError(error));
}
