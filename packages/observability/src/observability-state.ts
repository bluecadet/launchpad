// Need to import so that declaration merging works
import "@bluecadet/launchpad-utils/types";

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

	recordDestinationSuccess(
		name: string,
		signal: DestinationSignal,
		accepted: number,
		rejected: number,
	): void {
		if (accepted <= 0) return;
		this.updateState((draft) => {
			const state = draft.destinations?.[name]?.[signal];
			if (!state) return;
			state.totalPushed += accepted;
			state.lastSuccessAt = new Date();
			if (rejected === 0) {
				state.status = "ok";
				state.lastError = null;
				return;
			}
			state.status = accepted > 0 ? "degraded" : "failing";
			state.lastError = `Destination rejected ${rejected} record${rejected === 1 ? "" : "s"}`;
		});
	}

	recordDestinationError(
		name: string,
		signal: DestinationSignal,
		errorMessage: string,
		queueSize: number,
	): void {
		this.updateState((draft) => {
			const state = draft.destinations?.[name]?.[signal];
			if (!state) return;
			state.status = queueSize > 0 ? "degraded" : "failing";
			state.lastError = errorMessage;
			state.queueSize = queueSize;
		});
	}

	recordDestinationDropped(name: string, signal: DestinationSignal, count: number): void {
		this.updateState((draft) => {
			const state = draft.destinations?.[name]?.[signal];
			if (!state) return;
			state.totalDropped += count;
		});
	}

	updateDestinationQueue(name: string, signal: DestinationSignal, queueSize: number): void {
		this.updateState((draft) => {
			const state = draft.destinations?.[name]?.[signal];
			if (!state) return;
			state.queueSize = queueSize;
			if (queueSize === 0 && state.status === "degraded" && state.lastError === null) {
				state.status = "ok";
			}
		});
	}
}
