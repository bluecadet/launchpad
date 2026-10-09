import type { MetricObservation } from "@bluecadet/launchpad-utils/telemetry";
import type { ContentState, SourceFetchState } from "./content-state.js";

const SOURCE_STATES: readonly SourceFetchState["state"][] = [
	"pending",
	"fetching",
	"success",
	"error",
];

function toUnixSeconds(date: Date | null | undefined): number | undefined {
	if (!(date instanceof Date)) return undefined;
	const milliseconds = date.getTime();
	return Number.isFinite(milliseconds) ? milliseconds / 1_000 : undefined;
}

function projectSourceMetrics(
	source: string,
	state: SourceFetchState,
	lastSuccessAt: Date | undefined,
): readonly MetricObservation[] {
	const observations: MetricObservation[] = SOURCE_STATES.map((observedState) => ({
		name: "launchpad_content_source_state",
		value: state.state === observedState ? 1 : 0,
		description: "Whether the content source is currently in the named observed state.",
		attributes: { source, state: observedState },
	}));

	const lastSuccessSeconds = toUnixSeconds(lastSuccessAt);
	if (lastSuccessSeconds === undefined) return observations;

	observations.push({
		name: "launchpad_content_source_last_success_seconds",
		value: lastSuccessSeconds,
		unit: "s",
		description: "UNIX time when the content source's latest successful fetch finished.",
		attributes: { source },
	});
	return observations;
}

/** Projects safe gauge observations from the content plugin's current state. */
export function projectContentMetrics(
	state: ContentState | null | undefined,
	configuredSourceIds: ReadonlySet<string>,
): readonly MetricObservation[] {
	if (!state) return [];

	const observations: MetricObservation[] = [];
	for (const source of configuredSourceIds) {
		const sourceState = state.sources[source];
		if (!sourceState) continue;
		observations.push(
			...projectSourceMetrics(source, sourceState, state.sourceLastSuccessAt?.[source]),
		);
	}

	if (!state.retention) return observations;

	const promotedAt = toUnixSeconds(state.retention.promotedAt);
	if (promotedAt !== undefined) {
		observations.push({
			name: "launchpad_content_active_version_promoted_seconds",
			value: promotedAt,
			unit: "s",
			description: "UNIX time when the retained active content version was promoted.",
		});
	}

	observations.push(
		{
			name: "launchpad_content_retained_versions",
			value: state.retention.retainedCount,
			description: "Number of content versions retained by the latest retention sweep.",
		},
		{
			name: "launchpad_content_pending_delete_versions",
			value: state.retention.pendingDeleteCount,
			description: "Number of content versions pending deletion after the latest retention sweep.",
		},
	);

	return observations;
}
