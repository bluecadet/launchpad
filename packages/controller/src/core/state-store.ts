import type { InstantiatedPlugin } from "@bluecadet/launchpad-utils/plugin-interfaces";
import type { PatchHandlerWithVersion } from "@bluecadet/launchpad-utils/state-patcher";
import type { SystemState, VersionedLaunchpadState } from "@bluecadet/launchpad-utils/types";
import type { Patch } from "immer";

/**
 * StateStore aggregates state from all registered plugins.
 *
 * Architecture:
 * - Controller owns system-level state (mode, uptime, version)
 * - Each plugin owns and manages its own state
 * - StateStore queries plugins via StateProvider interface
 * - No event subscriptions needed - state is pulled on demand
 *
 * Benefits:
 * - Single Responsibility: Plugins manage their own state
 * - No tight coupling: Controller doesn't know plugin state structure
 * - Type safety: Each plugin exports its own state type
 * - Simple: StateStore is just a thin aggregation layer
 */
export class StateStore {
	private _systemState: SystemState;
	private _plugins: Map<string, InstantiatedPlugin>;
	private _stateVersion = 0;
	private _patchHandlers: PatchHandlerWithVersion[] = [];

	constructor(plugins: Map<string, InstantiatedPlugin>, mode: "task" | "persistent" = "task") {
		this._plugins = plugins;
		this._systemState = {
			startTime: new Date(),
			version: "0.1.0", // TODO: Read from package.json
			mode,
		};

		for (const [name, plugin] of this._plugins) {
			if (plugin.onStatePatch) {
				plugin.onStatePatch(this._relayPluginPatch.bind(this, name));
			}
		}
	}

	registerPlugin(name: string, instance: InstantiatedPlugin): void {
		this._plugins.set(name, instance);

		if (instance.onStatePatch) {
			instance.onStatePatch(this._relayPluginPatch.bind(this, name));
		}
	}

	/**
	 * Get the complete aggregated state from all plugins
	 */
	getState(): VersionedLaunchpadState {
		const pluginStates: Record<string, unknown> = {};

		// Query each plugin for its state (if it provides one)
		for (const [name, plugin] of this._plugins) {
			if (plugin.getState) {
				pluginStates[name] = plugin.getState();
			}
		}

		return {
			system: this._systemState,
			plugins: pluginStates,
			_version: this._stateVersion,
		};
	}

	/**
	 * Get state from a specific plugin
	 */
	getPluginState<TState = unknown>(name: string): TState | undefined {
		const plugin = this._plugins.get(name);
		if (plugin?.getState) {
			return plugin.getState() as TState;
		}
		return undefined;
	}

	/**
	 * Get system-level state
	 */
	getSystemState(): SystemState {
		return this._systemState;
	}

	/**
	 * Set system-level state property
	 * @internal
	 */
	setSystemState(key: keyof SystemState, value: unknown): void {
		this._systemState[key] = value;
	}

	private _relayPluginPatch(pluginName: string, patches: Patch[]): void {
		// Adjust patch paths to point to plugin within aggregate
		// e.g., ["phase"] becomes ["plugins", "content", "phase"]
		const basePathSegments = ["plugins", pluginName];

		const adjustedPatches: Patch[] = patches.map((patch) => ({
			...patch,
			path: [...basePathSegments, ...patch.path],
		}));

		this._stateVersion++;

		for (const handler of this._patchHandlers) {
			handler(adjustedPatches, this._stateVersion);
		}
	}

	/**
	 * Subscribe to state patches/updates.
	 * @param handler - Function called with an array of state patches
	 * @returns Unsubscribe function
	 */
	onPatch(handler: PatchHandlerWithVersion): () => void {
		this._patchHandlers.push(handler);

		// Return unsubscribe function
		return () => {
			const index = this._patchHandlers.indexOf(handler);
			if (index > -1) {
				this._patchHandlers.splice(index, 1);
			}
		};
	}
}
