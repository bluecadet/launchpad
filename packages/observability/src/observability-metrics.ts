import type { MetricObservation } from "@bluecadet/launchpad-utils/telemetry";
import type { ObservabilityState } from "./observability-state.js";

/** Project delivery gauges from the same state used by status and patch subscribers. */
export function projectObservabilityMetrics(
	state: ObservabilityState | undefined,
): readonly MetricObservation[] {
	const observations: MetricObservation[] = [];
	for (const [destination, signals] of Object.entries(state?.destinations ?? {})) {
		for (const [signal, health] of Object.entries(signals)) {
			const attributes = { destination, signal };
			observations.push(
				{
					name: "launchpad.observability.delivery.pushed_total",
					value: health.totalPushed,
					attributes,
				},
				{
					name: "launchpad.observability.delivery.dropped_total",
					value: health.totalDropped,
					attributes,
				},
				{
					name: "launchpad.observability.delivery.queue_batches",
					value: health.queueSize,
					attributes,
				},
			);
			if (signal === "logs" && health.sourceStatus !== undefined) {
				observations.push(
					{
						name: "launchpad.observability.source.records_lost_total",
						value: health.totalSourceRecordsLost ?? 0,
						attributes,
					},
					{
						name: "launchpad.observability.source.unknown_gaps_total",
						value: health.totalUnknownSourceGaps ?? 0,
						attributes,
					},
				);
			}
			if (health.lastSuccessAt) {
				observations.push({
					name: "launchpad.observability.delivery.last_success_timestamp",
					value: health.lastSuccessAt.getTime(),
					unit: "ms",
					attributes,
				});
			}
		}
	}
	return observations;
}
