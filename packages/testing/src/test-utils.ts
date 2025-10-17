import type { EventBus } from "@bluecadet/launchpad-utils";
import { vi } from "vitest";

type MockLogger = {
	children: Map<string, MockLogger>;
	// biome-ignore lint/suspicious/noExplicitAny: not actually relevant, just a mock
	child: (options: any) => MockLogger;
	once: () => void;
	debug: () => void;
	info: () => void;
	warn: () => void;
	error: () => void;
	close: () => void;
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
		once: vi.fn(),
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		close: vi.fn(),
		log: vi.fn(),
		children,
	};
}

export type MockEventBus = EventBus & {
	emit: ReturnType<typeof vi.fn>;
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

	const mockEventBus = {
		emit: vi.fn((event: string, data: unknown) => {
			emittedEvents.push({ event, data });
			return true;
		}),
		getEmittedEvents: () => emittedEvents,
		getEventsOfType: <T = unknown>(eventName: string): T[] => {
			return emittedEvents.filter((e) => e.event === eventName).map((e) => e.data as T);
		},
		clearEvents: () => {
			emittedEvents.length = 0;
		},
	} as MockEventBus;

	return mockEventBus;
}
