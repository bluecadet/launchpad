import type { PluginContext } from "@bluecadet/launchpad-utils/plugin-interfaces";
import type { MetricObservation } from "@bluecadet/launchpad-utils/telemetry";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import type { ResolvedDestinationObservabilityConfig } from "../observability-config.js";
import {
	type DestinationSignal,
	type ObservabilityState,
	ObservabilityStateManager,
} from "../observability-state.js";
import { Batcher } from "./batcher.js";
import { DeliveryQueue } from "./delivery-queue.js";
import type {
	DestinationExporters,
	ExportFailure,
	ExportResult,
	MetricBatch,
} from "./destination.js";
import {
	type CreatedDestination,
	createExporters,
	shutdownDestinations,
} from "./destination-lifecycle.js";
import { makeEventFilter } from "./event-filter.js";
import { eventToLogEntry, type LogEntry } from "./log-entry.js";

const MAX_METRIC_ATTRIBUTES = 32;
const MAX_METRIC_NAME_LENGTH = 255;
const MAX_METRIC_ATTRIBUTE_KEY_LENGTH = 128;
const MAX_METRIC_ATTRIBUTE_STRING_LENGTH = 256;
const MAX_METRIC_DESCRIPTION_LENGTH = 1_024;
const METRIC_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]*$/;
const reservedMetricAttributeKeys = new Set<string>(["service.name", "service.instance.id"]);

function errorFromUnknown(value: unknown, message: string): Error {
	if (value instanceof Error) return value;
	return new Error(message, { cause: value });
}

function activeSignals(
	exporters: DestinationExporters,
	metricsEnabled: boolean,
): DestinationSignal[] {
	const signals: DestinationSignal[] = [];
	if (exporters.logs) signals.push("logs");
	if (metricsEnabled && exporters.metrics) signals.push("metrics");
	return signals;
}

function validateMetricObservation(observation: unknown): MetricObservation | null {
	try {
		if (typeof observation !== "object" || observation === null) return null;
		const candidate = observation as Record<string, unknown>;
		const name = candidate.name;
		const value = candidate.value;
		const unit = candidate.unit;
		const description = candidate.description;
		if (
			typeof name !== "string" ||
			!METRIC_NAME_PATTERN.test(name) ||
			name.length > MAX_METRIC_NAME_LENGTH ||
			typeof value !== "number" ||
			!Number.isFinite(value)
		) {
			return null;
		}
		if (
			(unit !== undefined &&
				(typeof unit !== "string" ||
					unit.length === 0 ||
					unit.length > MAX_METRIC_ATTRIBUTE_KEY_LENGTH)) ||
			(description !== undefined &&
				(typeof description !== "string" || description.length > MAX_METRIC_DESCRIPTION_LENGTH))
		) {
			return null;
		}

		const attributes = candidate.attributes;
		let validatedAttributes: Readonly<Record<string, string | number | boolean>> | undefined;
		if (attributes !== undefined) {
			if (typeof attributes !== "object" || attributes === null || Array.isArray(attributes)) {
				return null;
			}
			const entries = Object.entries(attributes);
			if (entries.length > MAX_METRIC_ATTRIBUTES) return null;
			const validated: Record<string, string | number | boolean> = {};
			for (const [key, attributeValue] of entries) {
				if (
					key.length === 0 ||
					key.length > MAX_METRIC_ATTRIBUTE_KEY_LENGTH ||
					reservedMetricAttributeKeys.has(key) ||
					!METRIC_NAME_PATTERN.test(key)
				) {
					return null;
				}
				if (typeof attributeValue === "number" && !Number.isFinite(attributeValue)) return null;
				if (
					typeof attributeValue === "string" &&
					attributeValue.length > MAX_METRIC_ATTRIBUTE_STRING_LENGTH
				) {
					return null;
				}
				if (
					typeof attributeValue !== "string" &&
					typeof attributeValue !== "number" &&
					typeof attributeValue !== "boolean"
				) {
					return null;
				}
				validated[key] = attributeValue;
			}
			validatedAttributes = Object.freeze(validated);
		}

		return Object.freeze({
			name,
			value,
			...(unit === undefined ? {} : { unit }),
			...(description === undefined ? {} : { description }),
			...(validatedAttributes === undefined ? {} : { attributes: validatedAttributes }),
		});
	} catch {
		return null;
	}
}

export class DestinationRuntime {
	private readonly logQueues: DeliveryQueue<readonly LogEntry[]>[] = [];
	private readonly metricQueues: DeliveryQueue<MetricBatch>[] = [];
	private readonly allQueues: Array<
		DeliveryQueue<readonly LogEntry[]> | DeliveryQueue<MetricBatch>
	> = [];
	private readonly eventFilter: (event: string) => boolean;
	private readonly batcher: Batcher | null;
	private metricsTimer: ReturnType<typeof setInterval> | null = null;
	private captureStarted = false;
	private readyStarted = false;
	private disconnected = false;
	private readonly bootTime = new Date();

	constructor(
		private readonly config: ResolvedDestinationObservabilityConfig,
		private readonly destinations: readonly CreatedDestination[],
		private readonly ctx: PluginContext<ObservabilityState>,
		private readonly stateManager: ObservabilityStateManager,
	) {
		this.eventFilter = makeEventFilter(config.include, config.exclude);
		const metricsEnabled = config.metrics !== false;
		for (const destination of destinations) {
			const signals = activeSignals(destination.exporters, metricsEnabled);
			this.stateManager.initDestination(destination.name, signals);
			const logExporter = destination.exporters.logs;
			if (logExporter) {
				this.logQueues.push(
					this.createQueue(
						destination.name,
						"logs",
						"retry",
						(records) => records.length,
						(records, signal) => logExporter.export(records, { signal }),
					),
				);
			}
			const metricExporter = destination.exporters.metrics;
			if (metricsEnabled && metricExporter) {
				this.metricQueues.push(
					this.createQueue(
						destination.name,
						"metrics",
						"coalesce",
						(batch) => batch.observations.length,
						(batch, signal) => metricExporter.export(batch, { signal }),
					),
				);
			}
		}
		this.allQueues.push(...this.logQueues, ...this.metricQueues);
		this.batcher =
			this.logQueues.length === 0
				? null
				: new Batcher(config.batch, (batch) => {
						for (const queue of this.logQueues) queue.enqueue(batch);
					});
	}

	start(): void {
		if (!this.batcher || this.captureStarted) return;
		this.captureStarted = true;
		this.ctx.eventBus.onAny(this.eventHandler);
		this.batcher.start();
	}

	ready(): ResultAsync<void, Error> {
		if (this.readyStarted || this.disconnected || this.metricQueues.length === 0) return okAsync();
		this.readyStarted = true;
		this.collectMetrics();
		if (this.ctx.mode === "persistent" && this.config.metrics !== false) {
			this.metricsTimer = setInterval(() => this.collectMetrics(), this.config.metrics.intervalMs);
			this.metricsTimer.unref?.();
		}
		return okAsync();
	}

	flush(): ResultAsync<void, Error> {
		if (this.disconnected) return errAsync(new Error("Observability runtime is disconnected"));
		this.batcher?.flush();
		return ResultAsync.fromPromise(
			Promise.all(
				this.allQueues.map((queue) => queue.flush(this.config.delivery.shutdownTimeoutMs)),
			).then(() => undefined),
			(error) => errorFromUnknown(error, "Observability flush failed"),
		);
	}

	disconnect(): ResultAsync<void, Error> {
		if (this.disconnected) return okAsync();
		this.disconnected = true;
		if (this.metricsTimer) {
			clearInterval(this.metricsTimer);
			this.metricsTimer = null;
		}
		if (this.captureStarted) {
			this.ctx.eventBus.offAny(this.eventHandler);
			this.captureStarted = false;
		}
		this.batcher?.stop();
		if (this.readyStarted && this.metricQueues.length > 0) this.collectMetrics(true);

		return this.finishDisconnect();
	}

	private readonly eventHandler = (event: string, data: unknown): void => {
		if (event.startsWith("observability:")) return;
		if (!this.eventFilter(event)) return;
		const payload = data as { module?: unknown } | null;
		if (payload && payload.module === "observability") return;
		this.batcher?.add(eventToLogEntry(event, data));
	};

	private createQueue<T>(
		destinationName: string,
		signal: DestinationSignal,
		mode: "retry" | "coalesce",
		countRecords: (batch: T) => number,
		deliver: (batch: T, signal: AbortSignal) => ResultAsync<ExportResult, ExportFailure>,
	): DeliveryQueue<T> {
		return new DeliveryQueue<T>({
			mode,
			maxQueuedBatches: this.config.delivery.maxQueuedBatches,
			maxRetries: signal === "logs" ? this.config.buffer.maxRetries : 0,
			deliveryTimeoutMs: this.config.delivery.deliveryTimeoutMs,
			countRecords,
			deliver,
			onTransition: (transition) => {
				this.stateManager.applyDestinationTransition(destinationName, signal, transition);
			},
		});
	}

	private collectMetrics(allowAfterDisconnect = false): void {
		if ((this.disconnected && !allowAfterDisconnect) || this.metricQueues.length === 0) return;
		const timestamp = new Date();
		const observations: MetricObservation[] = [];
		let collected: unknown;
		try {
			collected = this.ctx.collectMetrics?.() ?? [];
		} catch {
			collected = [];
		}
		if (Array.isArray(collected)) {
			for (let index = 0; index < collected.length; index += 1) {
				try {
					const validated = validateMetricObservation(collected[index]);
					if (validated) observations.push(validated);
				} catch {
					// A hostile getter in one observation cannot suppress later observations.
				}
			}
		}

		const startTime = this.controllerStartTime();
		const operational: MetricObservation[] = [
			{
				name: "launchpad.runtime.observation.timestamp",
				value: timestamp.getTime(),
				unit: "ms",
			},
			{
				name: "launchpad.runtime.start_time",
				value: startTime.getTime(),
				unit: "ms",
			},
			{
				name: "launchpad.runtime.uptime",
				value: Math.max(0, timestamp.getTime() - startTime.getTime()),
				unit: "ms",
			},
		];
		for (const observation of operational) {
			const validated = validateMetricObservation(observation);
			if (validated) observations.push(validated);
		}

		const batch: MetricBatch = Object.freeze({
			timestamp,
			observations: Object.freeze(observations),
		});
		for (const queue of this.metricQueues) queue.enqueue(batch);
	}

	private controllerStartTime(): Date {
		try {
			const startTime = this.ctx.getGlobalState().system.startTime;
			const normalized = startTime instanceof Date ? startTime : new Date(String(startTime));
			if (Number.isFinite(normalized.getTime())) return normalized;
		} catch {
			// The setup timestamp is a safe fallback when controller state is unavailable.
		}
		return this.bootTime;
	}

	private finishDisconnect(): ResultAsync<void, Error> {
		const deadline = Date.now() + this.config.delivery.shutdownTimeoutMs;
		const remainingMs = () => Math.max(0, deadline - Date.now());
		return ResultAsync.fromPromise(
			Promise.all(this.allQueues.map((queue) => queue.flush(remainingMs()))),
			(error) => errorFromUnknown(error, "Observability shutdown failed"),
		).andThen(() => {
			for (const queue of this.allQueues) queue.stop();
			return shutdownDestinations(this.destinations, remainingMs());
		});
	}
}

export function createDestinationRuntime(
	config: ResolvedDestinationObservabilityConfig,
	ctx: PluginContext<ObservabilityState>,
): ResultAsync<DestinationRuntime, Error> {
	return createExporters(config).map((destinations) => {
		const stateManager = new ObservabilityStateManager(ctx.updateState);
		return new DestinationRuntime(config, destinations, ctx, stateManager);
	});
}
