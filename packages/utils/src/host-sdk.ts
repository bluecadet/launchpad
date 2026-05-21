import type { DashboardRegistry } from "./panel-registry.js";
import type { PluginContext } from "./plugin-interfaces.js";

/**
 * Injected by hosts that support dashboard UI contributions
 * (panels, pages, scripts, styles, routes).
 */
export interface DashboardHostContext {
	/** Dashboard contribution registry for registering panels, pages, scripts, styles, and routes. */
	readonly dashboardRegistry: DashboardRegistry;
}

/**
 * Convenience alias for a host-aware plugin context.
 * Use this when a plugin needs dashboard contributions.
 */
export type HostAwarePluginContext<TState = unknown> = PluginContext<TState> & DashboardHostContext;
