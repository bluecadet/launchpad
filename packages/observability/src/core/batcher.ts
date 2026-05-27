import type { LogEntry } from "./log-entry.js";

export type BatcherConfig = {
	intervalMs: number;
	maxEntries: number;
};

/**
 * Collects LogEntry items and flushes them as batches when either the
 * time interval or the entry count threshold is reached.
 */
export class Batcher {
	private entries: LogEntry[] = [];
	private timer: ReturnType<typeof setInterval> | null = null;

	constructor(
		private readonly config: BatcherConfig,
		private readonly onFlush: (batch: LogEntry[]) => void,
	) {}

	start(): void {
		this.timer = setInterval(() => {
			this.flush();
		}, this.config.intervalMs);
		// Prevent the timer from keeping the process alive
		this.timer.unref?.();
	}

	add(entry: LogEntry): void {
		this.entries.push(entry);
		if (this.entries.length >= this.config.maxEntries) {
			this.flush();
		}
	}

	flush(): void {
		if (this.entries.length === 0) return;
		const batch = this.entries.splice(0);
		this.onFlush(batch);
	}

	stop(): void {
		if (this.timer !== null) {
			clearInterval(this.timer);
			this.timer = null;
		}
		this.flush();
	}
}
