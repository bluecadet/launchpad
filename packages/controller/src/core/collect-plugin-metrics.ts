import type { PluginConfig } from "@bluecadet/launchpad-utils/plugin-interfaces";
import type { MetricObservation } from "@bluecadet/launchpad-utils/telemetry";
import type { LaunchpadState } from "@bluecadet/launchpad-utils/types";

export type MetricObservationFailureHandler = (pluginName: string) => void;

/** Collects plugin-owned gauge observations while containing each provider's failures. */
export function collectPluginMetrics(
	state: LaunchpadState,
	pluginConfigs: Iterable<PluginConfig>,
	onFailure: MetricObservationFailureHandler,
): readonly MetricObservation[] {
	const observations: MetricObservation[] = [];

	for (const pluginConfig of pluginConfigs) {
		try {
			const observe = pluginConfig.observe;
			if (!observe) continue;
			observations.push(...observe(state));
		} catch {
			onFailure(pluginConfig.name);
		}
	}

	return observations;
}
