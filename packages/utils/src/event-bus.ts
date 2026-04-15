import { EventEmitter } from "node:events";

/**
 * Generic type-safe EventBus built on Node's EventEmitter.
 * @template TEvents - Record mapping event names to their payload types
 */
export class EventBus<
	TEvents extends Record<string, unknown> = Record<string, unknown>,
> extends EventEmitter {
	private _anyHandlers = new Set<(event: string, data: unknown) => void>();

	constructor() {
		super();
		this.setMaxListeners(100);
	}

	override emit<K extends keyof TEvents & string>(event: K, data: TEvents[K]): boolean {
		this._anyHandlers.forEach((handler) => {
			try {
				handler(event, data);
			} catch (err) {
				console.error(`Error in wildcard event handler for '${event}':`, err);
			}
		});
		return super.emit(event, data);
	}

	override on<K extends keyof TEvents & string>(
		event: K,
		handler: (data: TEvents[K]) => void,
	): this {
		return super.on(event, handler);
	}

	override off<K extends keyof TEvents & string>(
		event: K,
		handler: (data: TEvents[K]) => void,
	): this {
		return super.off(event, handler);
	}

	onAny(handler: <K extends keyof TEvents & string>(event: K, data: TEvents[K]) => void): this {
		this._anyHandlers.add(handler as (event: string, data: unknown) => void);
		return this;
	}

	offAny(handler: <K extends keyof TEvents & string>(event: K, data: TEvents[K]) => void): this {
		this._anyHandlers.delete(handler as (event: string, data: unknown) => void);
		return this;
	}

	onPattern(
		pattern: RegExp,
		handler: <K extends keyof TEvents & string>(event: K, data: TEvents[K]) => void,
	): void {
		this.onAny((event, data) => {
			if (pattern.test(event)) {
				handler(event, data);
			}
		});
	}

	override once<K extends keyof TEvents & string>(
		event: K,
		handler: (data: TEvents[K]) => void,
	): this;
	override once(event: string, handler: (data: unknown) => void): this;
	override once(event: string, handler: (data: unknown) => void): this {
		return super.once(event, handler);
	}

	override removeAllListeners(event?: string): this {
		if (!event) {
			this._anyHandlers.clear();
			return super.removeAllListeners();
		}
		return super.removeAllListeners(event);
	}

	override listenerCount(event: string): number {
		return super.listenerCount(event);
	}
}
