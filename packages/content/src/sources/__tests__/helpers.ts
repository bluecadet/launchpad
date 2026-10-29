import { createMockLogger } from "@bluecadet/launchpad-testing/test-utils.ts";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll } from "vitest";
import type { FetchContext } from "../../source.js";
import { DataStore } from "../../utils/data-store.js";

export function setupMSWServer() {
	const server = setupServer();

	beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
	afterEach(() => server.resetHandlers());
	afterAll(() => server.close());

	return { server };
}

export function createFetchContext(): FetchContext & { _abortController: AbortController } {
	const abortController = new AbortController();
	return {
		logger: createMockLogger(),
		dataStore: new DataStore("/"),
		abortSignal: abortController.signal,
		_abortController: abortController,
	};
}
