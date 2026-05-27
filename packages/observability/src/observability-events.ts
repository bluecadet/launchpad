// Need to import so that declaration merging works
import "@bluecadet/launchpad-utils/types";

export type ObservabilityEvents = {
	/** Emitted when a batch is successfully pushed to a transport. */
	"observability:push:success": {
		transport: string;
		batchSize: number;
		durationMs: number;
	};

	/** Emitted when a push attempt fails. The batch will be retried if retries remain. */
	"observability:push:error": {
		transport: string;
		error: Error;
		batchSize: number;
		retriesLeft: number;
	};

	/** Emitted when a batch is permanently dropped (max retries or buffer full). */
	"observability:push:dropped": {
		transport: string;
		batchSize: number;
		reason: "buffer-full" | "max-retries";
	};

	/** Emitted when the retry buffer cap is hit and an old batch is evicted. */
	"observability:buffer:full": {
		transport: string;
		droppedCount: number;
	};
};

declare module "@bluecadet/launchpad-utils/types" {
	interface LaunchpadEvents extends ObservabilityEvents {}
}
