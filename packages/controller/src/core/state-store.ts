import type { Subsystem, SubsystemsState } from "@bluecadet/launchpad-utils";
import type { Patch } from "immer";

/**
 * System-level state (controller-owned)
 */
export type SystemState = {
	startTime: Date;
	version: string;
	mode: "task" | "persistent";
	[key: string]: unknown;
};

/**
 * Complete Launchpad state structure.
 * This is an aggregation of controller state + subsystem states.
 */
export type LaunchpadState = {
	system: SystemState;
	subsystems: Partial<SubsystemsState>;
};

/**
 * Versioned state snapshot returned to clients.
 * Includes the state version number for detecting dropped patches.
 */
export type VersionedLaunchpadState = LaunchpadState & {
	/** Version number - incremented with each patch */
	_version: number;
};

export type PatchHandlerWithVersion = (patches: Patch[], version: number) => void;

/**
 * StateStore aggregates state from all registered subsystems.
 *
 * Architecture:
 * - Controller owns system-level state (mode, uptime, version)
 * - Each subsystem owns and manages its own state
 * - StateStore queries subsystems via StateProvider interface
 * - No event subscriptions needed - state is pulled on demand
 *
 * Benefits:
 * - Single Responsibility: Subsystems manage their own state
 * - No tight coupling: Controller doesn't know subsystem state structure
 * - Type safety: Each subsystem exports its own state type
 * - Simple: StateStore is just a thin aggregation layer
 */
export class StateStore {
	private _systemState: SystemState;
	private _subsystems: Map<string, Subsystem>;
	private _stateVersion = 0;
	private _patchHandlers: PatchHandlerWithVersion[] = [];

	constructor(subsystems: Map<string, Subsystem>, mode: "task" | "persistent" = "task") {
		this._subsystems = subsystems;
		this._systemState = {
			startTime: new Date(),
			version: "0.1.0", // TODO: Read from package.json
			mode,
		};

		for (const [name, subsystem] of this._subsystems) {
			if (subsystem.onStatePatch) {
				subsystem.onStatePatch(this._relaySubsystemPatch.bind(this, name));
			}
		}
	}

	registerSubsystem(name: string, instance: Subsystem): void {
		this._subsystems.set(name, instance);

		if (instance.onStatePatch) {
			instance.onStatePatch(this._relaySubsystemPatch.bind(this, name));
		}
	}

	/**
	 * Get the complete aggregated state from all subsystems
	 */
	getState(): VersionedLaunchpadState {
		const subsystemStates: Record<string, unknown> = {};

		// Query each subsystem for its state (if it provides one)
		for (const [name, subsystem] of this._subsystems) {
			if (subsystem.getState) {
				subsystemStates[name] = subsystem.getState();
			}
		}

		return {
			system: this._systemState,
			subsystems: subsystemStates,
			_version: this._stateVersion,
		};
	}

	/**
	 * Get state from a specific subsystem
	 */
	getSubsystemState<TState = unknown>(name: string): TState | undefined {
		const subsystem = this._subsystems.get(name);
		if (subsystem?.getState) {
			return subsystem.getState() as TState;
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

	private _relaySubsystemPatch(subsystemName: string, patches: Patch[]): void {
		// Adjust patch paths to point to subsystem within aggregate
		// e.g., ["phase"] becomes ["subsystems", "content", "phase"]
		const basePathSegments = ["subsystems", subsystemName];

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
