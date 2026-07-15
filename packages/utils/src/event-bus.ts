import { EventEmitter } from "node:events";
import type { LaunchpadEvents } from "./types.js";

type EventKey<TEvents extends object> = Extract<keyof TEvents, string>;
type EventHandler<TEvents extends object, K extends EventKey<TEvents>> = (data: TEvents[K]) => void;
type AnyEventHandler<TEvents extends object> = <K extends EventKey<TEvents>>(
	event: K,
	data: TEvents[K],
) => void;

/**
 * Generic type-safe EventBus built on Node's EventEmitter.
 * @template TEvents - Mapping of event names to payload types
 */
export class EventBus<TEvents extends object = LaunchpadEvents> extends EventEmitter {
	private _anyHandlers = new Set<(event: string, data: unknown) => void>();

	constructor() {
		super();
		this.setMaxListeners(100);
	}

	override emit<K extends EventKey<TEvents>>(event: K, data: TEvents[K]): boolean {
		this._anyHandlers.forEach((handler) => {
			try {
				handler(event, data);
			} catch (err) {
				console.error(`Error in wildcard event handler for '${event}':`, err);
			}
		});

		// Iterate raw listeners individually (rather than delegating to
		// super.emit) so a throwing listener can't stop later listeners
		// from running and can't reject a caller's in-flight promise chain
		// (e.g. neverthrow) via an unhandled exception/rejection.
		const listeners = this.rawListeners(event) as EventHandler<TEvents, K>[];
		for (const listener of listeners) {
			try {
				listener(data);
			} catch (err) {
				console.error(`Error in event handler for '${event}':`, err);
			}
		}
		return listeners.length > 0;
	}

	override on<K extends EventKey<TEvents>>(event: K, handler: EventHandler<TEvents, K>): this {
		return super.on(event, handler);
	}

	override off<K extends EventKey<TEvents>>(event: K, handler: EventHandler<TEvents, K>): this {
		return super.off(event, handler);
	}

	onAny(handler: AnyEventHandler<TEvents>): this {
		this._anyHandlers.add(handler as (event: string, data: unknown) => void);
		return this;
	}

	offAny(handler: AnyEventHandler<TEvents>): this {
		this._anyHandlers.delete(handler as (event: string, data: unknown) => void);
		return this;
	}

	onPattern(pattern: RegExp, handler: AnyEventHandler<TEvents>): void {
		this.onAny((event, data) => {
			if (pattern.test(event)) {
				handler(event, data);
			}
		});
	}

	override once<K extends EventKey<TEvents>>(event: K, handler: EventHandler<TEvents, K>): this {
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
