import {
	type DisconnectReason,
	definePlugin,
	type PluginContext,
} from "@bluecadet/launchpad-utils/plugin-interfaces";
import type { LaunchpadState, Section } from "@bluecadet/launchpad-utils/types";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { Batcher } from "./core/batcher.js";
import { createDestinationRuntime } from "./core/destination-runtime.js";
import { makeEventFilter } from "./core/event-filter.js";
import { eventToLogEntry, type LogEntry } from "./core/log-entry.js";
import { RetryBuffer } from "./core/retry-buffer.js";
import {
	type DestinationObservabilityConfig,
	deliveryConfigSchema,
	deploymentConfigSchema,
	type ObservabilityCoreConfig,
	observabilityCoreConfigSchema,
	observationConfigSchema,
} from "./observability-config.js";
import "./observability-events.js";
import { type ObservabilityCommand, observabilityCommandSchema } from "./observability-commands.js";
import { type ObservabilityState, ObservabilityStateManager } from "./observability-state.js";
import { buildObservabilitySection } from "./observability-summarize.js";

export type { MetricObservation } from "@bluecadet/launchpad-utils/telemetry";
export type {
	DestinationContext,
	DestinationExporters,
	ExportContext,
	ExportFailure,
	ExportResult,
	LogExporter,
	MetricBatch,
	MetricExporter,
	ObservabilityDestination,
	ResourceAttributes,
} from "./core/destination.js";
export type { LogEntry, LogLevel } from "./core/log-entry.js";
export type { ObservabilityTransport } from "./core/transport.js";
export type {
	LokiDestinationAuth,
	LokiDestinationConfig,
	ResolvedLokiDestinationConfig,
} from "./destinations/loki.js";
export {
	createLokiDestination,
	lokiDestinationConfigSchema,
} from "./destinations/loki.js";
export type { OtlpDestinationConfig, OtlpSignal } from "./destinations/otlp.js";
export { createOtlpDestination } from "./destinations/otlp.js";
export type { ObservabilityCommand, ObservabilityFlushCommand } from "./observability-commands.js";
export type {
	DeliveryConfig,
	DeploymentConfig,
	DestinationObservabilityConfig,
	ObservabilityCoreConfig,
	ObservationConfig,
} from "./observability-config.js";
export {
	deliveryConfigSchema,
	deploymentConfigSchema,
	observabilityCoreConfigSchema,
	observationConfigSchema,
} from "./observability-config.js";
export type { ObservabilityEvents } from "./observability-events.js";
export type {
	DestinationSignal,
	DestinationSignalState,
	DestinationSignalStatus,
	DestinationState,
	ObservabilityState,
	TransportState,
	TransportStatus,
} from "./observability-state.js";
export { createLokiTransport } from "./transports/loki.js";

import type { ObservabilityTransport } from "./core/transport.js";

export type LegacyObservabilityConfig = ObservabilityCoreConfig & {
	readonly transports: ObservabilityTransport[];
	readonly deployment?: never;
	readonly destinations?: never;
	readonly metrics?: never;
	readonly delivery?: never;
};

export type ObservabilityConfig = LegacyObservabilityConfig | DestinationObservabilityConfig;

export function observability(config: ObservabilityConfig) {
	return definePlugin({
		name: "observability",

		manifest: {
			commands: [{ id: "observability.flush", parser: observabilityCommandSchema }],
			cli: [
				{
					name: "observability",
					description: "Observability commands",
					subcommands: [
						{
							name: "flush",
							description: "Force-flush all pending log batches to transports",
							mode: "task",
							commands: [{ type: "observability.flush" }],
						},
					],
				},
			],
		},

		summarize(state: LaunchpadState): Section | null {
			const obsState = state.plugins.observability;
			if (!obsState) return null;
			return buildObservabilitySection(obsState);
		},

		setup(ctx: PluginContext<ObservabilityState>) {
			const configuredTransports = config.transports;
			const configuredDestinations = config.destinations;
			if (configuredTransports !== undefined && configuredDestinations !== undefined) {
				return errAsync(
					new Error("Observability transports and destinations modes cannot be combined"),
				);
			}

			if (configuredDestinations !== undefined) {
				if (!Array.isArray(configuredDestinations) || configuredDestinations.length === 0) {
					return errAsync(new Error("Observability destinations must be a non-empty array"));
				}
				const names = new Set<string>();
				for (const destination of configuredDestinations) {
					if (typeof destination?.name !== "string" || destination.name.trim().length === 0) {
						return errAsync(new Error("Observability destination names must not be empty"));
					}
					const normalizedName = destination.name.trim();
					if (names.has(normalizedName)) {
						return errAsync(
							new Error(`Duplicate observability destination name: "${normalizedName}"`),
						);
					}
					names.add(normalizedName);
				}

				const coreConfigResult = observabilityCoreConfigSchema.safeParse(config);
				const deploymentResult = deploymentConfigSchema.safeParse(config.deployment);
				const metricsResult =
					config.metrics === false
						? { success: true as const, data: false as const }
						: observationConfigSchema.safeParse(config.metrics ?? {});
				const deliveryResult = deliveryConfigSchema.safeParse(config.delivery ?? {});
				if (
					!coreConfigResult.success ||
					!deploymentResult.success ||
					!metricsResult.success ||
					!deliveryResult.success
				) {
					return errAsync(new Error("Invalid destination observability configuration"));
				}

				return createDestinationRuntime(
					{
						...coreConfigResult.data,
						deployment: deploymentResult.data,
						destinations: configuredDestinations,
						metrics: metricsResult.data,
						delivery: deliveryResult.data,
					},
					ctx,
				).map((runtime) => {
					runtime.start();
					return {
						ready: () => runtime.ready(),
						executeCommand(command: ObservabilityCommand): ResultAsync<void, Error> {
							const parsed = observabilityCommandSchema.safeParse(command);
							if (!parsed.success) {
								return errAsync(
									new Error(`Invalid observability command: ${parsed.error.message}`),
								);
							}
							return runtime.flush();
						},
						disconnect(_reason: DisconnectReason): ResultAsync<void, Error> {
							return runtime.disconnect();
						},
					};
				});
			}

			if (!Array.isArray(configuredTransports)) {
				return errAsync(new Error("Observability transports must be an array"));
			}
			const coreConfigResult = observabilityCoreConfigSchema.safeParse(config);
			if (!coreConfigResult.success) {
				return errAsync(
					new Error("Invalid observability configuration", { cause: coreConfigResult.error }),
				);
			}

			const resolved = coreConfigResult.data;
			const eventFilter = makeEventFilter(resolved.include, resolved.exclude);
			const transports = configuredTransports;

			if (transports.length === 0) {
				ctx.logger.warn("observability plugin configured with no transports");
			}

			const stateManager = new ObservabilityStateManager(ctx.updateState);
			const retryBuffers = new Map<string, RetryBuffer>();
			const inFlightPushes = new Set<Promise<void>>();
			function trackPush(push: Promise<void>): void {
				inFlightPushes.add(push);
				void push.finally(() => inFlightPushes.delete(push));
			}
			function awaitInFlight(): ResultAsync<void, Error> {
				return ResultAsync.fromPromise(Promise.all([...inFlightPushes]), (e) => e as Error).map(
					() => undefined,
				);
			}

			for (const transport of transports) {
				stateManager.initTransport(transport.name);
				retryBuffers.set(transport.name, new RetryBuffer(resolved.buffer));
			}

			function handleDropped(
				transport: ObservabilityTransport,
				dropped: { entries: LogEntry[]; reason: "buffer-full" | "max-retries" } | null,
			): void {
				if (!dropped) return;
				stateManager.recordDropped(transport.name, dropped.entries.length);
				ctx.logger.error(
					`[observability] permanently dropped ${dropped.entries.length} log entries for transport "${transport.name}" (${dropped.reason})`,
				);
				ctx.eventBus.emit("observability:push:dropped", {
					transport: transport.name,
					batchSize: dropped.entries.length,
					reason: dropped.reason,
				});
				if (dropped.reason === "buffer-full") {
					ctx.eventBus.emit("observability:buffer:full", {
						transport: transport.name,
						droppedCount: dropped.entries.length,
					});
				}
			}

			function pushBatch(transport: ObservabilityTransport, batch: LogEntry[]): void {
				const buffer = retryBuffers.get(transport.name);
				if (!buffer) return;
				const start = Date.now();

				trackPush(
					transport.push(batch).match(
						() => {
							stateManager.recordPushSuccess(transport.name, batch.length);
							stateManager.updateBufferSize(transport.name, buffer.size);
							ctx.eventBus.emit("observability:push:success", {
								transport: transport.name,
								batchSize: batch.length,
								durationMs: Date.now() - start,
							});
						},
						(error) => {
							const dropped = buffer.enqueue(batch);
							stateManager.recordPushError(transport.name, error, buffer.size);
							ctx.logger.warn(
								`[observability] push to "${transport.name}" failed (${resolved.buffer.maxRetries} retries queued): ${error.message}`,
							);
							ctx.eventBus.emit("observability:push:error", {
								transport: transport.name,
								error,
								batchSize: batch.length,
								retriesLeft: resolved.buffer.maxRetries,
							});
							handleDropped(transport, dropped);
						},
					),
				);
			}

			function processRetries(): void {
				for (const transport of transports) {
					const buffer = retryBuffers.get(transport.name);
					if (!buffer) continue;

					for (const pending of buffer.dequeueReady()) {
						const start = Date.now();
						trackPush(
							transport.push(pending.entries).match(
								() => {
									stateManager.recordPushSuccess(transport.name, pending.entries.length);
									stateManager.updateBufferSize(transport.name, buffer.size);
									ctx.eventBus.emit("observability:push:success", {
										transport: transport.name,
										batchSize: pending.entries.length,
										durationMs: Date.now() - start,
									});
								},
								(error) => {
									const dropped = buffer.requeue(pending);
									const retriesLeft = dropped ? 0 : pending.retriesLeft - 1;
									stateManager.recordPushError(transport.name, error, buffer.size);
									ctx.eventBus.emit("observability:push:error", {
										transport: transport.name,
										error,
										batchSize: pending.entries.length,
										retriesLeft,
									});
									handleDropped(transport, dropped);
								},
							),
						);
					}
				}
			}

			const retryTimer = setInterval(
				processRetries,
				Math.max(1000, Math.min(resolved.batch.intervalMs, 5000)),
			);
			retryTimer.unref?.();

			const batcher = new Batcher(resolved.batch, (batch) => {
				for (const transport of transports) {
					pushBatch(transport, batch);
				}
			});

			const eventHandler = (event: string, data: unknown) => {
				if (event.startsWith("observability:")) return;
				if (!eventFilter(event)) return;
				// Skip log events emitted by this plugin itself to prevent a feedback loop
				// where push failure warnings get captured, batched, and pushed (also failing).
				const payload = data as { module?: string };
				if (typeof payload?.module === "string" && payload.module === "observability") return;
				batcher.add(eventToLogEntry(event, data));
			};

			ctx.eventBus.onAny(eventHandler);
			batcher.start();

			return okAsync({
				ready(): ResultAsync<void, Error> {
					return okAsync();
				},

				executeCommand(command: ObservabilityCommand): ResultAsync<void, Error> {
					const parsed = observabilityCommandSchema.safeParse(command);
					if (!parsed.success) {
						return errAsync(new Error(`Invalid observability command: ${parsed.error.message}`));
					}

					switch (parsed.data.type) {
						case "observability.flush": {
							batcher.flush();
							return awaitInFlight();
						}
						default: {
							return errAsync(new Error("Unknown observability command type"));
						}
					}
				},

				disconnect(_reason: DisconnectReason): ResultAsync<void, Error> {
					clearInterval(retryTimer);
					ctx.eventBus.offAny(eventHandler);
					batcher.stop();

					return awaitInFlight().andThen(() => {
						for (const transport of transports) {
							const buffer = retryBuffers.get(transport.name);
							if (!buffer) continue;
							const remaining = buffer.drain();
							if (remaining.length > 0) {
								const totalEntries = remaining.reduce((sum, b) => sum + b.length, 0);
								ctx.logger.warn(
									`observability: dropping ${totalEntries} buffered log entries for transport "${transport.name}" on shutdown`,
								);
								for (const batch of remaining) {
									stateManager.recordDropped(transport.name, batch.length);
									ctx.eventBus.emit("observability:push:dropped", {
										transport: transport.name,
										batchSize: batch.length,
										reason: "max-retries",
									});
								}
							}
						}

						return ResultAsync.combine(
							transports.flatMap((t) =>
								typeof t.disconnect === "function" ? [t.disconnect()] : [],
							),
						).map(() => undefined);
					});
				},
			});
		},
	});
}

export function defineObservabilityConfig(config: ObservabilityConfig): ObservabilityConfig {
	return config;
}
