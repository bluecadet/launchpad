import { EventEmitter } from "node:events";
import type { EventBus as IEventBus } from "@bluecadet/launchpad-utils";

/**
 * Core controller events.
 *
 * Subsystems can augment this interface via declaration merging:
 *
 * @example
 * ```typescript
 * // In @bluecadet/launchpad-content
 * declare module '@bluecadet/launchpad-controller' {
 *   interface LaunchpadEvents {
 *     'content:fetch:start': { sources?: string[] };
 *     'content:fetch:done': { sources: string[]; totalFiles: number };
 *     'content:fetch:error': { error: Error };
 *   }
 * }
 * ```
 *
 * This gives full type safety when listening to events:
 * ```typescript
 * eventBus.on('content:fetch:start', (data) => {
 *   // data is typed as { sources?: string[] }
 * });
 * ```
 */
export interface LaunchpadEvents {
	// Command lifecycle events (controller-owned)
	"command:start": { commandType: string; [key: string]: unknown };
	"command:success": { commandType: string; result?: unknown };
	"command:error": { commandType: string; error: Error };

	// System events (controller-owned)
	"system:shutdown": { code?: number; signal?: string };
	"system:error": { error: Error; context?: string };
}

/**
 * EventBus implementation using Node's EventEmitter.
 * Provides event-driven communication between subsystems with support for:
 * - Type-safe predefined events
 * - Dynamic custom events
 * - Wildcard subscriptions
 * - Pattern matching
 */
export class EventBus extends EventEmitter implements IEventBus {
	private _anyHandlers = new Set<(event: string, data: unknown) => void>();

	constructor() {
		super();
		// Increase max listeners to avoid warnings for many subscribers
		this.setMaxListeners(100);
	}

	/**
	 * Emit an event with type-safe payload.
	 * - For known events (in LaunchpadEvents interface), payload is type-checked
	 * - For unknown events, payload is accepted as unknown
	 */
	override emit<K extends keyof LaunchpadEvents>(event: K, data: LaunchpadEvents[K]): boolean;
	override emit(event: string, data: unknown): boolean;
	override emit(event: string, data: unknown): boolean {
		// Notify wildcard listeners first
		this._anyHandlers.forEach((handler) => {
			try {
				handler(event, data);
			} catch (err) {
				// Prevent handler errors from stopping other handlers
				console.error(`Error in wildcard event handler for '${event}':`, err);
			}
		});

		// Emit to specific event listeners
		return super.emit(event, data);
	}

	/**
	 * Subscribe to an event with type-safe handler.
	 * - For known events (in LaunchpadEvents interface), handler receives typed data
	 * - For unknown events, handler receives unknown data
	 */
	override on<K extends keyof LaunchpadEvents>(
		event: K,
		handler: (data: LaunchpadEvents[K]) => void,
	): this;
	override on(event: string, handler: (data: unknown) => void): this;
	override on(event: string, handler: (data: unknown) => void): this {
		return super.on(event, handler);
	}

	/**
	 * Unsubscribe from an event
	 */
	override off(event: string, handler: (data: unknown) => void): this {
		return super.off(event, handler);
	}

	/**
	 * Subscribe to all events with a wildcard handler.
	 * The handler receives both the event name and data.
	 */
	onAny(
		handler: <K extends keyof LaunchpadEvents>(event: K, data: LaunchpadEvents[K]) => void,
	): this {
		// Cast to internal handler type - the type safety is enforced at the call site
		this._anyHandlers.add(handler as (event: string, data: unknown) => void);
		return this;
	}

	/**
	 * Unsubscribe a wildcard handler
	 */
	offAny(
		handler: <K extends keyof LaunchpadEvents>(event: K, data: LaunchpadEvents[K]) => void,
	): this {
		// Cast to internal handler type - the type safety is enforced at the call site
		this._anyHandlers.delete(handler as (event: string, data: unknown) => void);
		return this;
	}

	/**
	 * Subscribe to events matching a regular expression pattern.
	 * Useful for subscribing to event namespaces like /^content:.*$/
	 */
	onPattern(
		pattern: RegExp,
		handler: <K extends keyof LaunchpadEvents>(event: K, data: LaunchpadEvents[K]) => void,
	): void {
		this.onAny((event, data) => {
			if (pattern.test(event)) {
				handler(event, data);
			}
		});
	}

	/**
	 * Subscribe to an event once (auto-unsubscribes after first emission)
	 */
	override once<K extends keyof LaunchpadEvents>(
		event: K,
		handler: (data: LaunchpadEvents[K]) => void,
	): this;

	override once(event: string, handler: (data: unknown) => void): this;

	override once(event: string, handler: (data: unknown) => void): this {
		return super.once(event, handler);
	}

	/**
	 * Remove all listeners for a specific event, or all events if no event specified
	 */
	override removeAllListeners(event?: string): this {
		if (!event) {
			// Clear wildcard handlers
			this._anyHandlers.clear();
			return super.removeAllListeners();
		}
		return super.removeAllListeners(event);
	}

	/**
	 * Get count of listeners for an event
	 */
	override listenerCount(event: string): number {
		return super.listenerCount(event);
	}
}
