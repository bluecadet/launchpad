import { ensureError } from "@bluecadet/launchpad-utils/errors";
import { err, ok, Result, ResultAsync } from "neverthrow";
import type { ResolvedDestinationObservabilityConfig } from "../observability-config.js";
import type { DestinationExporters, ResourceAttributes } from "./destination.js";
import { startAttempt } from "./exporter-attempt.js";
import { createResourceAttributes } from "./resource.js";

export type CreatedDestination = {
	readonly name: string;
	readonly checkpointKey?: string;
	readonly exporters: DestinationExporters;
};

/** Attempt every shutdown hook concurrently; no failure skips another destination. */
export function shutdownDestinations(
	destinations: readonly CreatedDestination[],
	timeoutMs: number,
): ResultAsync<void, Error> {
	return ResultAsync.combine(
		destinations.flatMap(({ exporters }) => {
			const shutdown = exporters.shutdown;
			if (!shutdown) return [];
			const attempt = startAttempt({
				call: (signal) => shutdown.call(exporters, { signal }),
				controller: new AbortController(),
				timeoutMs,
				timeoutMessage: `Destination shutdown timed out after ${timeoutMs}ms`,
			});
			return [new ResultAsync(attempt.outcome.then((outcome) => outcome.result))];
		}),
	).map(() => undefined);
}

/** Build inert exporters, rolling back already-created bundles on setup failure. */
export function createExporters(
	config: ResolvedDestinationObservabilityConfig,
	resourceAttributes: ResourceAttributes = createResourceAttributes(config.resource),
): ResultAsync<CreatedDestination[], Error> {
	return ResultAsync.fromPromise(
		(async (): Promise<Result<CreatedDestination[], Error>> => {
			const created: CreatedDestination[] = [];
			for (const destination of config.destinations) {
				const result = Result.fromThrowable(
					() => destination.create({ resourceAttributes }),
					ensureError,
				)().andThen((created) => created);
				if (result.isErr()) {
					await shutdownDestinations(created, config.delivery.shutdownTimeoutMs);
					return err(result.error);
				}
				created.push({
					name: destination.name,
					exporters: result.value,
					...(destination.checkpointKey === undefined
						? {}
						: { checkpointKey: destination.checkpointKey }),
				});
				if (!result.value.logs && !result.value.metrics) {
					await shutdownDestinations(created, config.delivery.shutdownTimeoutMs);
					return err(
						new Error(`Observability destination "${destination.name}" has no signal exporters`),
					);
				}
				if (
					config.logStorage.type === "file" &&
					result.value.logs &&
					(typeof result.value.logs.exportCanonical !== "function" ||
						typeof destination.checkpointKey !== "string" ||
						destination.checkpointKey.trim().length === 0)
				) {
					await shutdownDestinations(created, config.delivery.shutdownTimeoutMs);
					return err(
						new Error(
							`File-backed log delivery for destination "${destination.name}" requires exportCanonical and checkpointKey`,
						),
					);
				}
			}
			return ok(created);
		})(),
		ensureError,
	).andThen((result) => result);
}
