import type { LogLevel } from "@bluecadet/launchpad-utils/logger";

export type LogEntry = {
	id: string;
	timestamp: Date;
	level: LogLevel;
	message: string;
	module?: string;
};

/**
 * Circular in-memory buffer of log entries.
 * When full, the oldest entry is evicted to make room for new ones.
 * Subscribers are notified synchronously on each push.
 */
export class LogBuffer {
	private readonly _entries: LogEntry[] = [];
	private readonly _listeners = new Set<(entry: LogEntry) => void>();
	private _nextId = 0;

	constructor(readonly maxEntries: number) {}

	push(level: LogLevel, message: string, module?: string): void {
		const entry: LogEntry = {
			id: String(++this._nextId),
			timestamp: new Date(),
			level,
			message,
			module,
		};
		this._entries.push(entry);
		if (this._entries.length > this.maxEntries) {
			this._entries.shift();
		}
		for (const listener of this._listeners) {
			listener(entry);
		}
	}

	getAll(): readonly LogEntry[] {
		return this._entries;
	}

	/** Subscribe to new entries. Returns an unsubscribe function. */
	onEntry(cb: (entry: LogEntry) => void): () => void {
		this._listeners.add(cb);
		return () => this._listeners.delete(cb);
	}

	clear(): void {
		this._entries.length = 0;
	}
}
