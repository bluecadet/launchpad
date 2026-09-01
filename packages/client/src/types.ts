/**
 * Wire-side shapes. These deliberately differ from the server-side types in
 * `@bluecadet/launchpad-utils`: state crosses the wire through a lossy JSON codec, so
 * `system.startTime` is an ISO 8601 string here where the controller holds a `Date`.
 */

import type { ControllerMode, NodeIdentity, PluginsState } from "@bluecadet/launchpad-utils/types";

/** Controller-owned state, as it arrives from `GET /state`. */
export type WireSystemState = {
	/** ISO 8601 timestamp of daemon boot. A `Date` on the server; a string here. */
	startTime: string;
	mode: ControllerMode;
	node: NodeIdentity;
	[key: string]: unknown;
};

/**
 * The state tree `GET /state` returns and `launchpad:state:patch` frames describe.
 *
 * Plugin slices are typed through the declaration-merged `PluginsState` interface, so a
 * plugin package your app imports contributes its own slice type here.
 */
export type WireState<TPlugins extends object = PluginsState> = {
	system: WireSystemState;
	plugins: Partial<TPlugins>;
};

/** {@link WireState} plus the state store's patch counter. */
export type VersionedWireState<TPlugins extends object = PluginsState> = WireState<TPlugins> & {
	/** Increments once per patch batch, shared across every plugin slice. */
	_version: number;
};

/** Drops a subscription. Safe to call more than once. */
export type Unsubscribe = () => void;

/** Options accepted by every `subscribe*` / `on*` method. */
export type SubscribeOptions = {
	/** Aborting this unsubscribes, exactly as calling the returned function would. */
	signal?: AbortSignal;
};
