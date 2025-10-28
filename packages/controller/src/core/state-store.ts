import type { Subsystem, SubsystemsState } from "@bluecadet/launchpad-utils";

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

	constructor(subsystems: Map<string, Subsystem>) {
		this._subsystems = subsystems;
		this._systemState = {
			startTime: new Date(),
			version: "0.1.0", // TODO: Read from package.json
			mode: "task",
		};
	}

	/**
	 * Get the complete aggregated state from all subsystems
	 */
	getState(): LaunchpadState {
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
}
