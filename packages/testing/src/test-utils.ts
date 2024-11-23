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
