import type { PluginsState } from "@bluecadet/launchpad-utils/types";

/**
 * Union of all known plugin state types.
 *
 * In a fully-typed app, the composition root would define this.
 * For now, this re-exports PluginsState which is augmented via declaration merging.
 */
export type AllPluginsState = PluginsState;
