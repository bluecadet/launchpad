/**
 * Host SDK contracts.
 *
 * These interfaces define **optional** host-specific capabilities that a host
 * (e.g. the dashboard server or CLI status renderer) may inject into the
 * plugin context at registration time.
 *
 * Plugins that need dashboard or status contribution capabilities should
 * declare their `setup()` context parameter as:
 *
 * ```ts
 * setup(ctx: PluginContext<TState> & DashboardHostContext & StatusHostContext)
 * ```
 *
 * The base `PluginContext` remains host-agnostic so the kernel (controller)
 * never forces a dependency on UI concerns.
 */

import type { DashboardRegistry } from "./panel-registry.js";
import type { PluginContext } from "./plugin-interfaces.js";
import type { StatusRegistry } from "./status-registry.js";

/**
 * Injected by hosts that support dashboard UI contributions
 * (panels, pages, scripts, styles, routes).
 */
export interface DashboardHostContext {
	/** Dashboard contribution registry for registering panels, pages, scripts, styles, and routes. */
	readonly dashboardRegistry: DashboardRegistry;
}

/**
 * Injected by hosts that support CLI status section contributions.
 */
export interface StatusHostContext {
	/** Status section registry for contributing CLI status renderers. */
	readonly statusRegistry: StatusRegistry;
}

/**
 * Convenience alias for a fully host-aware plugin context.
 * Use this when a plugin needs both dashboard and status contributions.
 */
export type HostAwarePluginContext<TState = unknown> = PluginContext<TState> &
	DashboardHostContext &
	StatusHostContext;
