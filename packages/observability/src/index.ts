import {
	type DisconnectReason,
	definePlugin,
	type PluginContext,
} from "@bluecadet/launchpad-utils/plugin-interfaces";
import type { LaunchpadState, Section } from "@bluecadet/launchpad-utils/types";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { Batcher } from "./core/batcher.js";
import { shouldIncludeEvent } from "./core/event-filter.js";
import { eventToLogEntry, type LogEntry } from "./core/log-entry.js";
import { RetryBuffer } from "./core/retry-buffer.js";
import {
	type ObservabilityCoreConfig,
	observabilityCoreConfigSchema,
} from "./observability-config.js";
import "./observability-events.js";
import { type ObservabilityCommand, observabilityCommandSchema } from "./observability-commands.js";
import { type ObservabilityState, ObservabilityStateManager } from "./observability-state.js";
import { buildObservabilitySection } from "./observability-summarize.js";

export type { LogEntry, LogLevel } from "./core/log-entry.js";
export type { ObservabilityTransport } from "./core/transport.js";
export type { ObservabilityCommand, ObservabilityFlushCommand } from "./observability-commands.js";
export type { ObservabilityCoreConfig } from "./observability-config.js";
export { observabilityCoreConfigSchema } from "./observability-config.js";
export type { ObservabilityEvents } from "./observability-events.js";
export type { ObservabilityState, TransportState, TransportStatus } from "./observability-state.js";
export { createLokiTransport } from "./transports/loki.js";

import type { ObservabilityTransport } from "./core/transport.js";

export type ObservabilityConfig = ObservabilityCoreConfig & {
	transports: ObservabilityTransport[];
};

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
			const coreConfigResult = observabilityCoreConfigSchema.safeParse(config);
			if (!coreConfigResult.success) {
				return errAsync(
					new Error("Invalid observability configuration", { cause: coreConfigResult.error }),
				);
			}

			const resolved = coreConfigResult.data;
			const { transports } = config;

			if (transports.length === 0) {
				ctx.logger.warn("observability plugin configured with no transports");
			}

			const stateManager = new ObservabilityStateManager(ctx.updateState);
			const retryBuffers = new Map<string, RetryBuffer>();

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
				const buffer = retryBuffers.get(transport.name)!;
				const start = Date.now();

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
						ctx.eventBus.emit("observability:push:error", {
							transport: transport.name,
							error,
							batchSize: batch.length,
							retriesLeft: resolved.buffer.maxRetries,
						});
						handleDropped(transport, dropped);
					},
				);
			}

			function processRetries(): void {
				for (const transport of transports) {
					const buffer = retryBuffers.get(transport.name);
					if (!buffer) continue;

					for (const pending of buffer.dequeueReady()) {
						const start = Date.now();
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
								stateManager.recordPushError(transport.name, error, buffer.size);
								ctx.eventBus.emit("observability:push:error", {
									transport: transport.name,
									error,
									batchSize: pending.entries.length,
									retriesLeft: pending.retriesLeft - 1,
								});
								handleDropped(transport, dropped);
							},
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
				if (!shouldIncludeEvent(event, resolved.include, resolved.exclude)) return;
				batcher.add(eventToLogEntry(event, data));
			};

			ctx.eventBus.onAny(eventHandler);
			batcher.start();

			return okAsync({
				executeCommand(command: ObservabilityCommand): ResultAsync<void, Error> {
					const parsed = observabilityCommandSchema.safeParse(command);
					if (!parsed.success) {
						return errAsync(new Error(`Invalid observability command: ${parsed.error.message}`));
					}

					switch (parsed.data.type) {
						case "observability.flush": {
							batcher.flush();
							return okAsync(undefined);
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

					// Drain any remaining retry batches so they don't vanish silently
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
						transports
							.filter((t) => typeof t.disconnect === "function")
							.map((t) => t.disconnect!()),
					).map(() => undefined);
				},
			});
		},
	});
}

export function defineObservabilityConfig(config: ObservabilityConfig): ObservabilityConfig {
	return config;
}
