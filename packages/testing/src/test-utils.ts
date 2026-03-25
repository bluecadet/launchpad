import type { EventBus } from "@bluecadet/launchpad-utils/event-bus";
import type { PluginContext } from "@bluecadet/launchpad-utils/plugin-interfaces";
import type { LaunchpadState, VersionedLaunchpadState } from "@bluecadet/launchpad-utils/types";
import { okAsync } from "neverthrow";
import { vi } from "vitest";

export type MockLogger = {
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

export function createMockPluginCtx(cwd = "/"): PluginContext {
	return {
		logger: createMockLogger(),
		eventBus: createMockEventBus(),
		cwd,
		abortSignal: new AbortController().signal,
		dispatchCommand: vi.fn().mockReturnValue(okAsync()),
		getGlobalState: vi.fn().mockReturnValue({} as VersionedLaunchpadState),
		onGlobalStatePatch: vi.fn().mockReturnValue(() => {}),
		updateState: vi.fn(),
	} satisfies PluginContext;
}

export function createEmptyState(
	overrides?: Partial<VersionedLaunchpadState>,
): VersionedLaunchpadState {
	return {
		system: { mode: "task", startTime: new Date(0), version: "0.0.0" },
		plugins: {},
		_version: 0,
		...overrides,
	};
}

export type MockIPCClient = {
	connect: ReturnType<typeof vi.fn>;
	disconnect: ReturnType<typeof vi.fn>;
	on: ReturnType<typeof vi.fn>;
	off: ReturnType<typeof vi.fn>;
	once: ReturnType<typeof vi.fn>;
	onAny: ReturnType<typeof vi.fn>;
	offAny: ReturnType<typeof vi.fn>;
	shutdown: ReturnType<typeof vi.fn>;
	queryState: ReturnType<typeof vi.fn>;
	executeCommand: ReturnType<typeof vi.fn>;
	onStateChange: ReturnType<typeof vi.fn>;
};

export function createMockIPCClient(overrides?: Partial<MockIPCClient>): MockIPCClient {
	const emptyState: LaunchpadState = {
		system: { mode: "task", startTime: new Date(0), version: "0.0.0" },
		plugins: {},
	};
	return {
		connect: vi.fn().mockReturnValue(okAsync(undefined)),
		disconnect: vi.fn(),
		on: vi.fn(),
		off: vi.fn(),
		once: vi.fn(),
		onAny: vi.fn(),
		offAny: vi.fn(),
		shutdown: vi.fn().mockReturnValue(okAsync(undefined)),
		queryState: vi.fn().mockReturnValue(okAsync(emptyState)),
		executeCommand: vi.fn().mockReturnValue(okAsync(undefined)),
		onStateChange: vi.fn().mockReturnValue(() => {}),
		...overrides,
	};
}

export type MockController = {
	start: ReturnType<typeof vi.fn>;
	stop: ReturnType<typeof vi.fn>;
	registerPlugin: ReturnType<typeof vi.fn>;
	executeCommand: ReturnType<typeof vi.fn>;
	getEventBus: ReturnType<typeof vi.fn>;
};

export function createMockController(overrides?: Partial<MockController>): MockController {
	return {
		start: vi.fn().mockReturnValue(okAsync(undefined)),
		stop: vi.fn().mockReturnValue(okAsync(undefined)),
		registerPlugin: vi.fn().mockReturnValue(okAsync(undefined)),
		executeCommand: vi.fn().mockReturnValue(okAsync(undefined)),
		getEventBus: vi.fn().mockReturnValue(createMockEventBus()),
		...overrides,
	};
}
