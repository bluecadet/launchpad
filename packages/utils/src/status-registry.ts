/**
 * Shared CLI status contribution registry.
 * Plugins call statusRegistry.contributeStatusSection() during setup() to register
 * their CLI status renderer. The status command reads the registry at render time.
 */

import type { LaunchpadState } from "./types.js";

export interface ContributedStatusSection {
	/** Determines display order. Lower numbers appear first. Defaults to 50. */
	order?: number;
	/** Return a chalk-formatted string, or null if this plugin has no relevant state. */
	render(state: LaunchpadState): string | null;
}

export class StatusRegistry {
	private readonly _sections: ContributedStatusSection[] = [];

	contributeStatusSection(...sections: ContributedStatusSection[]): void {
		this._sections.push(...sections);
	}

	getSections(): readonly ContributedStatusSection[] {
		return [...this._sections].sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
	}

	/** Reset all contributions. For test teardown only. */
	reset(): void {
		this._sections.length = 0;
	}
}

/**
 * @deprecated Use `ctx.statusRegistry` from PluginContext instead.
 * This global singleton will be removed in a future version.
 */
export const statusRegistry = new StatusRegistry();
