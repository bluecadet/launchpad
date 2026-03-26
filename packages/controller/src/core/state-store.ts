import type { PatchHandlerWithVersion } from "@bluecadet/launchpad-utils/state-patcher";
import { PatchedStateManager } from "@bluecadet/launchpad-utils/state-patcher";
import type { SystemState, VersionedLaunchpadState } from "@bluecadet/launchpad-utils/types";
import type { Producer } from "immer";

/**
 * StateStore aggregates state from all registered plugins.
 *
 * Architecture:
 * - Controller owns system-level state (mode, uptime, version)
 * - Each plugin gets an updater via getPluginUpdater(), which lazily creates
 *   a PatchedStateManager on first call and wires its patches into the aggregated stream
 * - StateStore owns the PatchedStateManager instances and relays patches
 *   to subscribers with adjusted paths
 *
 * Benefits:
 * - Single Responsibility: Plugins manage their own state via the returned updater
 * - No tight coupling: Controller doesn't know plugin state structure
 * - Type safety: Each plugin exports its own state type
 * - Simple: StateStore is just a thin aggregation layer
 */
export class StateStore {
	private _systemState: SystemState;
	private _pluginManagers = new Map<string, PatchedStateManager<unknown>>();
	private _stateVersion = 0;
	private _patchHandlers: PatchHandlerWithVersion[] = [];

	constructor(mode: "task" | "persistent" = "task") {
		this._systemState = {
			startTime: new Date(),
			version: "0.1.0", // TODO: Read from package.json
			mode,
		};
	}

	/**
	 * Get an updater function for a plugin's state slice.
	 *
	 * The first call with a given name lazily creates a PatchedStateManager and wires
	 * its patches into the store's aggregated patch stream. Subsequent calls reuse the
	 * same manager. Plugins should call this at the top of `setup()` with a complete
	 * initial value, then use immer producers for subsequent updates.
	 *
	 * @param name - Unique plugin name (used as key in the plugins state tree)
	 * @returns An updateState function: `(producer) => void`
	 */
	getPluginUpdater<TState = unknown>(name: string): (producer: Producer<TState>) => void {
		return (producer) => {
			let manager = this._pluginManagers.get(name) as PatchedStateManager<TState> | undefined;
			if (!manager) {
				manager = new PatchedStateManager<TState>();
				this._pluginManagers.set(name, manager);
				manager.onPatch((patches) => {
					const adjusted = patches.map((p) => ({
						...p,
						path: ["plugins", name, ...p.path],
					}));
					this._stateVersion++;
					for (const h of this._patchHandlers) h(adjusted, this._stateVersion);
				});
			}
			manager.updateState(producer);
		};
	}

	/**
	 * Get the complete aggregated state from all plugins
	 */
	getState(): VersionedLaunchpadState {
		const pluginStates: Record<string, unknown> = {};

		for (const [name, manager] of this._pluginManagers) {
			pluginStates[name] = manager.state;
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
		const manager = this._pluginManagers.get(name);
		if (manager) {
			return manager.state as TState;
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

	/**
	 * Subscribe to state patches/updates.
	 * @param handler - Function called with an array of state patches and the new version
	 * @returns Unsubscribe function
	 */
	onPatch(handler: PatchHandlerWithVersion): () => void {
		this._patchHandlers.push(handler);

		return () => {
			const index = this._patchHandlers.indexOf(handler);
			if (index > -1) {
				this._patchHandlers.splice(index, 1);
			}
		};
	}
}
