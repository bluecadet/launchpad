import { ensureError } from "@bluecadet/launchpad-utils/errors";
import { err, errAsync, ok, Result, ResultAsync } from "neverthrow";
import type { ResolvedDestinationObservabilityConfig } from "../observability-config.js";
import type { DestinationExporters } from "./destination.js";
import { DestinationFailure } from "./export-failure.js";
import { createResourceAttributes } from "./resource.js";

export type CreatedDestination = {
	readonly name: string;
	readonly exporters: DestinationExporters;
};

/** Contain custom hooks and bound them even when they ignore cancellation. */
function boundedShutdown(
	shutdown: NonNullable<DestinationExporters["shutdown"]>,
	timeoutMs: number,
): ResultAsync<void, Error> {
	const controller = new AbortController();
	const failure = new DestinationFailure(`Destination shutdown timed out after ${timeoutMs}ms`);
	if (timeoutMs <= 0) controller.abort();
	const operation = ResultAsync.fromThrowable(
		async () => await shutdown({ signal: controller.signal }),
		ensureError,
	)().andThen((result) => result);
	if (timeoutMs <= 0) return errAsync(failure);

	let timer: ReturnType<typeof setTimeout>;
	const timeout = new Promise<Result<void, Error>>((resolve) => {
		timer = setTimeout(() => {
			resolve(err(failure));
			controller.abort();
		}, timeoutMs);
		timer.unref?.();
	});
	return new ResultAsync(Promise.race([operation, timeout]).finally(() => clearTimeout(timer)));
}

/** Attempt every shutdown hook concurrently; no failure skips another destination. */
export function shutdownDestinations(
	destinations: readonly CreatedDestination[],
	timeoutMs: number,
): ResultAsync<void, Error> {
	return ResultAsync.combine(
		destinations.flatMap(({ exporters }) => {
			const shutdown = exporters.shutdown;
			return shutdown ? [boundedShutdown(shutdown.bind(exporters), timeoutMs)] : [];
		}),
	).map(() => undefined);
}

/** Build inert exporters, rolling back already-created bundles on setup failure. */
export function createExporters(
	config: ResolvedDestinationObservabilityConfig,
): ResultAsync<CreatedDestination[], Error> {
	return ResultAsync.fromPromise(
		(async (): Promise<Result<CreatedDestination[], Error>> => {
			const resourceAttributes = createResourceAttributes(config.resource);
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
				created.push({ name: destination.name, exporters: result.value });
				if (!result.value.logs && !result.value.metrics) {
					await shutdownDestinations(created, config.delivery.shutdownTimeoutMs);
					return err(
						new Error(`Observability destination "${destination.name}" has no signal exporters`),
					);
				}
			}
			return ok(created);
		})(),
		ensureError,
	).andThen((result) => result);
}
