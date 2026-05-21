import type { PluginConfig } from "@bluecadet/launchpad-utils/plugin-interfaces";
import type { LaunchpadState, Section, StatusSnapshot } from "@bluecadet/launchpad-utils/types";

export function buildStatusSnapshot(
	state: LaunchpadState,
	pluginConfigs: Iterable<PluginConfig>,
): StatusSnapshot {
	const sections: Section[] = [];
	for (const cfg of pluginConfigs) {
		const section = cfg.summarize?.(state);
		if (section) sections.push(section);
	}
	sections.sort((a, b) => (a.order ?? 50) - (b.order ?? 50));

	const startTime = state.system.startTime;
	return {
		header: {
			startTime: startTime.toISOString(),
			uptimeMs: Math.max(0, Date.now() - startTime.getTime()),
			mode: state.system.mode,
		},
		sections,
	};
}
