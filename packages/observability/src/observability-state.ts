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

export type ObservabilityState = {
	transports: Record<string, TransportState>;
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
}
