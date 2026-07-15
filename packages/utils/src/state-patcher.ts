import { enablePatches, type Patch, type Producer, produce } from "immer";

enablePatches();

export type PatchHandler = (patches: Patch[]) => void;

export type PatchHandlerWithVersion = (patches: Patch[], version: number) => void;

export class PatchedStateManager<TState> {
	private _state: Readonly<TState>;
	private _patchHandlers: PatchHandler[] = [];

	constructor(initialState?: TState) {
		if (initialState !== undefined) {
			this._state = initialState;
		} else {
			this._state = {} as TState;
		}
	}

	/**
	 * Subscribe to state patches/updates.
	 * @param handler - Function called with an array of state patches
	 * @returns Unsubscribe function
	 */
	onPatch(handler: PatchHandler): () => void {
		this._patchHandlers.push(handler);

		// Return unsubscribe function
		return () => {
			const index = this._patchHandlers.indexOf(handler);
			if (index > -1) {
				this._patchHandlers.splice(index, 1);
			}
		};
	}

	/**
	 * Update the state using an Immer producer function.
	 * Notifies all subscribed patch handlers with the generated patches.
	 * @param producer - Immer producer function to modify the state
	 * @returns The updated state
	 */
	updateState(producer: Producer<TState>) {
		let capturedPatches: Patch[] = [];
		this._state = produce(this._state, producer, (patches) => {
			capturedPatches = patches;
		});
		if (capturedPatches.length > 0) {
			this._patchHandlers.forEach((handler) => {
				try {
					handler(capturedPatches);
				} catch (err) {
					// A throwing subscriber must not unwind into the code that
					// produced the state update (or skip the remaining handlers).
					console.error("Error in state patch handler:", err);
				}
			});
		}
		return this._state;
	}

	get state() {
		return this._state;
	}
}

export type { Patch } from "immer";
