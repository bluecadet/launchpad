// Need to import so that declaration merging works
import "@bluecadet/launchpad-utils/types";
import type { DeliveryTransition } from "./core/delivery-queue.js";
import { exportFailureMessage } from "./core/export-failure.js";

export type TransportStatus = "ok" | "degraded" | "failing";

export type TransportState = {
	status: TransportStatus;
	bufferSize: number;
	lastPushAt: Date | null;
	lastError: string | null;
	totalPushed: number;
	totalDropped: number;
};

export type DestinationSignal = "logs" | "metrics";
export type DestinationSignalStatus = "unknown" | "ok" | "degraded" | "failing";

export type DestinationSignalState = {
	status: DestinationSignalStatus;
	queueSize: number;
	lastSuccessAt: Date | null;
	lastError: string | null;
	totalPushed: number;
	totalDropped: number;
};

export type DestinationState = Partial<Record<DestinationSignal, DestinationSignalState>>;

export type ObservabilityState = {
	transports: Record<string, TransportState>;
	destinations?: Record<string, DestinationState>;
};

declare module "@bluecadet/launchpad-utils/types" {
	interface PluginsState {
		observability: ObservabilityState;
	}
}

export class ObservabilityStateManager {
	constructor(
		private readonly updateState: (producer: (draft: ObservabilityState) => void) => void,
	) {
		this.updateState(() => ({ transports: {} }));
	}

	initTransport(name: string): void {
		this.updateState((draft) => {
			draft.transports[name] = {
				status: "ok",
				bufferSize: 0,
				lastPushAt: null,
				lastError: null,
				totalPushed: 0,
				totalDropped: 0,
			};
		});
	}

	recordPushSuccess(name: string, batchSize: number): void {
		this.updateState((draft) => {
			const t = draft.transports[name];
			if (!t) return;
			t.status = "ok";
			t.lastPushAt = new Date();
			t.lastError = null;
			t.totalPushed += batchSize;
		});
	}

	recordPushError(name: string, error: Error, bufferSize: number): void {
		this.updateState((draft) => {
			const t = draft.transports[name];
			if (!t) return;
			t.status = bufferSize > 0 ? "degraded" : "failing";
			t.lastError = error.message;
			t.bufferSize = bufferSize;
		});
	}

	recordDropped(name: string, count: number): void {
		this.updateState((draft) => {
			const t = draft.transports[name];
			if (!t) return;
			t.totalDropped += count;
		});
	}

	updateBufferSize(name: string, size: number): void {
		this.updateState((draft) => {
			const t = draft.transports[name];
			if (!t) return;
			t.bufferSize = size;
			if (size === 0 && t.status === "degraded") {
				t.status = "ok";
			}
		});
	}

	initDestination(name: string, signals: readonly DestinationSignal[]): void {
		this.updateState((draft) => {
			draft.destinations ??= {};
			const destination: DestinationState = {};
			for (const signal of signals) {
				destination[signal] = {
					status: "unknown",
					queueSize: 0,
					lastSuccessAt: null,
					lastError: null,
					totalPushed: 0,
					totalDropped: 0,
				};
			}
			draft.destinations[name] = destination;
		});
	}

	/** Apply counters, outcome, and final queue depth as one observable transition. */
	applyDestinationTransition(
		name: string,
		signal: DestinationSignal,
		transition: DeliveryTransition,
	): void {
		this.updateState((draft) => {
			const state = draft.destinations?.[name]?.[signal];
			if (!state) return;
			state.queueSize = transition.queuedBatches;

			switch (transition.type) {
				case "queue":
					return;
				case "drop":
					state.totalDropped += transition.droppedRecords;
					return;
				case "failure":
					state.totalDropped += transition.droppedRecords;
					state.status = transition.queuedBatches > 0 ? "degraded" : "failing";
					state.lastError = exportFailureMessage(transition.error);
					return;
				case "export": {
					const { acceptedRecords: accepted, rejectedRecords: rejected } = transition;
					state.totalPushed += accepted;
					state.totalDropped += rejected;
					if (accepted > 0) {
						state.lastSuccessAt = new Date();
						state.status = rejected > 0 ? "degraded" : "ok";
						state.lastError =
							rejected > 0
								? `Destination rejected ${rejected} record${rejected === 1 ? "" : "s"}`
								: null;
					} else if (rejected > 0) {
						state.status = transition.queuedBatches > 0 ? "degraded" : "failing";
						state.lastError = "Destination rejected all records";
					}
				}
			}
		});
	}
}
