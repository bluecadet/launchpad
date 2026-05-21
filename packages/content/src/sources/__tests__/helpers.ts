import { createMockLogger } from "@bluecadet/launchpad-testing/test-utils.ts";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll } from "vitest";
import { DataStore } from "../../utils/data-store.js";

export function setupMSWServer() {
	const server = setupServer();

	beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
	afterEach(() => server.resetHandlers());
	afterAll(() => server.close());

	return { server };
}

export function createFetchContext() {
	const abortController = new AbortController();
	return {
		logger: createMockLogger(),
		dataStore: new DataStore("/"),
		abortSignal: abortController.signal as AbortSignal,
		_abortController: abortController,
	};
}
