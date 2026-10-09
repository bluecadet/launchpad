import type { PluginContext } from "@bluecadet/launchpad-utils/plugin-interfaces";
import type { MetricObservation } from "@bluecadet/launchpad-utils/telemetry";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import type {
	ResolvedDeliveryConfig,
	ResolvedObservabilityCoreConfig,
	ResolvedObservationConfig,
} from "../observability-config.js";
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
	ObservabilityDestination,
	ResourceAttributes,
} from "./destination.js";
import { makeEventFilter } from "./event-filter.js";
import { eventToLogEntry, type LogEntry } from "./log-entry.js";
import { createResourceAttributes } from "./resource.js";

export interface ResolvedDestinationRuntimeConfig extends ResolvedObservabilityCoreConfig {
	readonly resource: ResourceAttributes;
	readonly destinations: readonly ObservabilityDestination[];
	readonly metrics: false | ResolvedObservationConfig;
	readonly delivery: ResolvedDeliveryConfig;
}

type CreatedDestination = {
	readonly name: string;
	readonly exporters: DestinationExporters;
};

type DeliveryHealth = {
	pushed: number;
	dropped: number;
	queueSize: number;
	lastSuccessAt: Date | null;
};

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

function sanitizedExporterError(error: ExportFailure): string {
	if (error.message.startsWith("Destination delivery timed out")) return error.message;
	if (error.message === "Destination delivery aborted") return error.message;
	if (error.message === "Destination rejected all records") return error.message;
	const errorName = METRIC_NAME_PATTERN.test(error.name) ? error.name : "Error";
	return `Destination exporter failed (${errorName})`;
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

function withBoundedCall<T>(
	call: (signal: AbortSignal) => PromiseLike<T>,
	timeoutMs: number,
	timeoutMessage: string,
): Promise<T> {
	const controller = new AbortController();
	if (timeoutMs <= 0) {
		controller.abort();
		try {
			void Promise.resolve(call(controller.signal)).catch(() => undefined);
		} catch {
			// The deadline error remains the public shutdown result.
		}
		return Promise.reject(new Error(timeoutMessage));
	}
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<T>((_, reject) => {
		timer = setTimeout(() => {
			reject(new Error(timeoutMessage));
			controller.abort();
		}, timeoutMs);
		timer.unref?.();
	});

	let operation: Promise<T>;
	try {
		operation = Promise.resolve(call(controller.signal));
	} catch (error) {
		operation = Promise.reject(error);
	}
	return Promise.race([operation, timeout]).finally(() => {
		if (timer) clearTimeout(timer);
	});
}

async function shutdownDestinations(
	destinations: readonly CreatedDestination[],
	timeoutMs: number,
): Promise<Error[]> {
	const results = await Promise.allSettled(
		destinations.map(({ exporters }) => {
			if (!exporters.shutdown) return Promise.resolve();
			return withBoundedCall(
				(signal) => exporters.shutdown?.({ signal }) ?? okAsync(undefined),
				timeoutMs,
				`Destination shutdown timed out after ${timeoutMs}ms`,
			).then((result) => {
				if (result.isErr()) throw result.error;
			});
		}),
	);
	return results.flatMap((result) =>
		result.status === "rejected"
			? [errorFromUnknown(result.reason, "Destination shutdown failed")]
			: [],
	);
}

async function createExporters(
	config: ResolvedDestinationRuntimeConfig,
): Promise<CreatedDestination[]> {
	const resourceAttributes = createResourceAttributes(config.resource);
	const created: CreatedDestination[] = [];

	for (const destination of config.destinations) {
		let result: ReturnType<ObservabilityDestination["create"]>;
		try {
			result = destination.create({ resourceAttributes });
		} catch (error) {
			await shutdownDestinations(created, config.delivery.shutdownTimeoutMs);
			throw errorFromUnknown(error, `Destination "${destination.name}" factory threw`);
		}
		if (result.isErr()) {
			await shutdownDestinations(created, config.delivery.shutdownTimeoutMs);
			throw result.error;
		}
		if (!result.value.logs && !result.value.metrics) {
			const withEmptyDestination = [
				...created,
				{ name: destination.name, exporters: result.value },
			];
			await shutdownDestinations(withEmptyDestination, config.delivery.shutdownTimeoutMs);
			throw new Error(`Observability destination "${destination.name}" has no signal exporters`);
		}
		created.push({ name: destination.name, exporters: result.value });
	}

	return created;
}

export class DestinationRuntime {
	private readonly logQueues: DeliveryQueue<readonly LogEntry[]>[] = [];
	private readonly metricQueues: DeliveryQueue<MetricBatch>[] = [];
	private readonly allQueues: Array<
		DeliveryQueue<readonly LogEntry[]> | DeliveryQueue<MetricBatch>
	> = [];
	private readonly health = new Map<string, DeliveryHealth>();
	private readonly eventFilter: (event: string) => boolean;
	private readonly batcher: Batcher | null;
	private metricsTimer: ReturnType<typeof setInterval> | null = null;
	private captureStarted = false;
	private readyStarted = false;
	private disconnected = false;
	private readonly bootTime = new Date();

	constructor(
		private readonly config: ResolvedDestinationRuntimeConfig,
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

		return ResultAsync.fromPromise(this.finishDisconnect(), (error) =>
			errorFromUnknown(error, "Observability shutdown failed"),
		);
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
		const healthKey = `${destinationName}:${signal}`;
		this.health.set(healthKey, { pushed: 0, dropped: 0, queueSize: 0, lastSuccessAt: null });
		return new DeliveryQueue<T>({
			mode,
			maxQueuedBatches: this.config.delivery.maxQueuedBatches,
			maxRetries: signal === "logs" ? this.config.buffer.maxRetries : 0,
			deliveryTimeoutMs: this.config.delivery.deliveryTimeoutMs,
			countRecords,
			deliver,
			onSuccess: (accepted, rejected) => {
				if (accepted <= 0) return;
				const health = this.health.get(healthKey);
				if (health) {
					health.pushed += accepted;
					health.lastSuccessAt = new Date();
				}
				this.stateManager.recordDestinationSuccess(destinationName, signal, accepted, rejected);
			},
			onError: (error, queueSize) => {
				this.stateManager.recordDestinationError(
					destinationName,
					signal,
					sanitizedExporterError(error),
					queueSize,
				);
			},
			onDrop: (records) => {
				const health = this.health.get(healthKey);
				if (health) health.dropped += records;
				this.stateManager.recordDestinationDropped(destinationName, signal, records);
			},
			onQueueSize: (queueSize) => {
				const health = this.health.get(healthKey);
				if (health) health.queueSize = queueSize;
				this.stateManager.updateDestinationQueue(destinationName, signal, queueSize);
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
		for (const [key, health] of this.health) {
			const separator = key.lastIndexOf(":");
			const destination = key.slice(0, separator);
			const signal = key.slice(separator + 1);
			const attributes = { destination, signal };
			operational.push(
				{
					name: "launchpad.observability.delivery.pushed_total",
					value: health.pushed,
					attributes,
				},
				{
					name: "launchpad.observability.delivery.dropped_total",
					value: health.dropped,
					attributes,
				},
				{
					name: "launchpad.observability.delivery.queue_batches",
					value: health.queueSize,
					attributes,
				},
			);
			if (health.lastSuccessAt) {
				operational.push({
					name: "launchpad.observability.delivery.last_success_timestamp",
					value: health.lastSuccessAt.getTime(),
					unit: "ms",
					attributes,
				});
			}
		}
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

	private async finishDisconnect(): Promise<void> {
		const deadline = Date.now() + this.config.delivery.shutdownTimeoutMs;
		const remainingMs = () => Math.max(0, deadline - Date.now());
		await Promise.all(this.allQueues.map((queue) => queue.flush(remainingMs())));
		for (const queue of this.allQueues) queue.stop();
		const errors = await shutdownDestinations(this.destinations, remainingMs());
		if (errors[0]) throw errors[0];
	}
}

export function createDestinationRuntime(
	config: ResolvedDestinationRuntimeConfig,
	ctx: PluginContext<ObservabilityState>,
): ResultAsync<DestinationRuntime, Error> {
	return ResultAsync.fromPromise(createExporters(config), (error) =>
		errorFromUnknown(error, "Failed to create observability destinations"),
	).map((destinations) => {
		const stateManager = new ObservabilityStateManager(ctx.updateState);
		return new DestinationRuntime(config, destinations, ctx, stateManager);
	});
}
