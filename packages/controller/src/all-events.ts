import type { LaunchpadEvents } from "@bluecadet/launchpad-utils/types";
import type { CoreEvents } from "./core/command-dispatcher.js";

/**
 * Union of all known event types.
 *
 * In a fully-typed app, plugins would pass their event types here.
 * For now, this combines the core events with the base LaunchpadEvents
 * (which is augmented via declaration merging by plugin packages).
 */
export type AllEvents = LaunchpadEvents & CoreEvents;
