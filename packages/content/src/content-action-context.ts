import type { PluginContext } from "@bluecadet/launchpad-utils/plugin-interfaces";
import type { ResolvedContentConfig } from "./content-config.js";
import type { ContentStateManager } from "./content-state.js";
import type { ContentSource } from "./source.js";

/** Shared plugin services; each command owns its own run-scoped resources. */
export type ContentActionContext = PluginContext & {
	stateManager: ContentStateManager;
	sourceRegistry: ReadonlyMap<string, ContentSource>;
	resolvedConfig: ResolvedContentConfig;
};
