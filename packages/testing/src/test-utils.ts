import type { EventBus } from "@bluecadet/launchpad-utils/event-bus";
import type { SubsystemContext } from "@bluecadet/launchpad-utils/subsystem-interfaces";
import { vi } from "vitest";

type MockLogger = {
	children: Map<string, MockLogger>;
	// biome-ignore lint/suspicious/noExplicitAny: not actually relevant, just a mock
	child: (options: any) => MockLogger;
	debug: () => void;
	info: () => void;
	warn: () => void;
	error: () => void;
	verbose: () => void;
	log: () => void;
};

export function createMockLogger() {
	const children = new Map<string, MockLogger>();
	return {
		child: (options: Parameters<MockLogger["child"]>[0]) => {
			const child = createMockLogger();
			children.set(options.module, child);
			return child;
		},
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		verbose: vi.fn(),
		log: vi.fn(),
		children,
	};
}

export type MockEventBus = EventBus & {
	on: ReturnType<typeof vi.fn>;
	emit: ReturnType<typeof vi.fn>;
	onAny: ReturnType<typeof vi.fn>;
	offAny: ReturnType<typeof vi.fn>;
	getEmittedEvents: () => Array<{ event: string; data: unknown }>;
	getEventsOfType: <T = unknown>(eventName: string) => T[];
	clearEvents: () => void;
};

/**
 * Creates a mock EventBus for testing event emissions.
 * Captures all emitted events for assertion.
 */
export function createMockEventBus(): MockEventBus {
	const emittedEvents: Array<{ event: string; data: unknown }> = [];
	const anyHandlers: Array<(event: string, data: unknown) => void> = [];

	const mockEventBus = {
		emit: vi.fn((event: string, data: unknown) => {
			emittedEvents.push({ event, data });
			// Call any handlers
			for (const handler of anyHandlers) {
				handler(event, data);
			}
			return true;
		}),
		onAny: vi.fn((handler: (event: string, data: unknown) => void) => {
			anyHandlers.push(handler);
		}),
		offAny: vi.fn((handler: (event: string, data: unknown) => void) => {
			const index = anyHandlers.indexOf(handler);
			if (index > -1) {
				anyHandlers.splice(index, 1);
			}
		}),
		getEmittedEvents: () => emittedEvents,
		getEventsOfType: <T = unknown>(eventName: string): T[] => {
			return emittedEvents.filter((e) => e.event === eventName).map((e) => e.data as T);
		},
		clearEvents: () => {
			emittedEvents.length = 0;
		},
		on: vi.fn(),
	} as MockEventBus;

	return mockEventBus;
}

export function createMockSubsystemCtx(cwd = "/") {
	return {
		logger: createMockLogger(),
		eventBus: createMockEventBus(),
		cwd,
	} satisfies SubsystemContext;
}
