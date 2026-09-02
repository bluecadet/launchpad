import { describe, expect, it } from "vitest";
import { createClient } from "../client.js";
import { createFakeFetch, jsonResponse, rawResponse } from "./fake-fetch.js";

const BASE_URL = "http://127.0.0.1:8710";

function clientFor(handler: (request: Request) => Response | Promise<Response>, token?: string) {
	const fake = createFakeFetch(handler);
	return { fake, client: createClient({ baseUrl: BASE_URL, token, fetch: fake.fetchFn }) };
}

/** Exactly the bodies a Node produces for each failure, copied off the wire. */
const NOT_REGISTERED = {
	error: {
		name: "CommandExecutionError",
		message: "Command 'content.ack' is not registered",
		reason: "not-registered",
		commandType: "content.ack",
	},
};

const INVALID = {
	error: {
		name: "CommandExecutionError",
		message: "Invalid command: content.ack",
		reason: "invalid",
		commandType: "content.ack",
		cause: { name: "ZodError", message: '[{"path":["consumerId"],"code":"invalid_type"}]' },
	},
};

const HANDLER_FAILED = {
	error: {
		name: "CommandExecutionError",
		message: "Plugin command execution failed",
		reason: "handler-failed",
		commandType: "workflow.run",
		cause: { name: "WorkflowError", message: "Workflow 'tour-mode' failed: step 2" },
	},
};

describe("executeCommand", () => {
	it("posts the command type merged with its params and unwraps result", async () => {
		const { fake, client } = clientFor(() => jsonResponse(200, { result: { status: "ok" } }));

		const result = await client.executeCommand("content.ack", { consumerId: "kiosk-1" });

		expect(result).toBeOk();
		expect(result._unsafeUnwrap()).toEqual({ status: "ok" });
		const request = fake.calls[0];
		expect(request?.method).toBe("POST");
		expect(request?.url).toBe(`${BASE_URL}/command`);
		expect(await request?.text()).toBe('{"consumerId":"kiosk-1","type":"content.ack"}');
	});

	it("never lets a params key overwrite the command type", async () => {
		const { fake, client } = clientFor(() => jsonResponse(200, { result: null }));

		await client.executeCommand("content.ack", { type: "workflow.run" });

		expect(await fake.calls[0]?.text()).toBe('{"type":"content.ack"}');
	});

	it("resolves with null for a command that resolves with nothing", async () => {
		const { client } = clientFor(() => jsonResponse(200, { result: null }));

		const result = await client.executeCommand("content.ack");

		expect(result._unsafeUnwrap()).toBeNull();
	});

	it("sends a bearer token when one is configured", async () => {
		const { fake, client } = clientFor(() => jsonResponse(200, { result: null }), "token-value");

		await client.executeCommand("content.ack");

		expect(fake.calls[0]?.headers.get("authorization")).toBe("Bearer token-value");
	});

	it("sends no authorization header when no token is configured", async () => {
		const { fake, client } = clientFor(() => jsonResponse(200, { result: null }));

		await client.executeCommand("content.ack");

		expect(fake.calls[0]?.headers.get("authorization")).toBeNull();
	});

	it("maps a 404 carrying a reason to not-registered", async () => {
		const { client } = clientFor(() => jsonResponse(404, NOT_REGISTERED));

		const result = await client.executeCommand("content.ack");

		const error = result._unsafeUnwrapErr();
		expect(error.reason).toBe("not-registered");
		expect(error.status).toBe(404);
		expect(error.commandType).toBe("content.ack");
	});

	it("maps a 404 with no reason to not-found, not not-registered", async () => {
		const { client } = clientFor(() =>
			jsonResponse(404, { error: { message: "Not found: POST /commnd" } }),
		);

		const result = await client.executeCommand("content.ack");

		expect(result._unsafeUnwrapErr().reason).toBe("not-found");
	});

	it("maps a 400 carrying a reason to invalid and keeps the ZodError cause", async () => {
		const { client } = clientFor(() => jsonResponse(400, INVALID));

		const result = await client.executeCommand("content.ack");

		const error = result._unsafeUnwrapErr();
		expect(error.reason).toBe("invalid");
		expect(error.cause).toEqual(INVALID.error.cause);
	});

	it("maps a 400 with no reason to bad-request", async () => {
		const { client } = clientFor(() =>
			jsonResponse(400, { error: { message: 'Request body must be JSON with a string "type"' } }),
		);

		const result = await client.executeCommand("content.ack");

		expect(result._unsafeUnwrapErr().reason).toBe("bad-request");
	});

	it("maps a 500 carrying a reason to handler-failed and keeps the cause", async () => {
		const { client } = clientFor(() => jsonResponse(500, HANDLER_FAILED));

		const result = await client.executeCommand("workflow.run", { name: "tour-mode" });

		const error = result._unsafeUnwrapErr();
		expect(error.reason).toBe("handler-failed");
		expect(error.commandType).toBe("workflow.run");
		expect(error.cause).toEqual(HANDLER_FAILED.error.cause);
	});

	it("reports the canonical commandType from the body, not the alias that was sent", async () => {
		const { client } = clientFor(() => jsonResponse(500, HANDLER_FAILED));

		const result = await client.executeCommand("workflow.start");

		expect(result._unsafeUnwrapErr().commandType).toBe("workflow.run");
	});

	it.each([
		[401, "unauthorized"],
		[403, "forbidden"],
		[413, "too-large"],
		[503, "unavailable"],
		[502, "server-error"],
		[418, "unknown"],
	])("maps status %i to reason %s", async (status, reason) => {
		const { client } = clientFor(() => jsonResponse(status, { error: { message: "nope" } }));

		const result = await client.executeCommand("content.ack");

		expect(result._unsafeUnwrapErr().reason).toBe(reason);
	});

	it("reports not-allowed for a 403 rejected before allowedCommands", async () => {
		const { client } = clientFor(() =>
			jsonResponse(403, {
				error: { message: "Command not allowed: content.ack", reason: "not-allowed" },
			}),
		);

		const result = await client.executeCommand("content.ack");

		expect(result._unsafeUnwrapErr().reason).toBe("not-allowed");
	});

	it("reports role-denied for a 403 rejected by the token role", async () => {
		const { client } = clientFor(() =>
			jsonResponse(403, {
				error: {
					message: 'Command not permitted for role "kiosk": content.ack',
					reason: "role-denied",
				},
			}),
		);

		const result = await client.executeCommand("content.ack");

		expect(result._unsafeUnwrapErr().reason).toBe("role-denied");
	});

	it("falls back to forbidden for an unrecognised 403 reason", async () => {
		const { client } = clientFor(() =>
			jsonResponse(403, { error: { message: "nope", reason: "some-future-403-reason" } }),
		);

		const result = await client.executeCommand("content.ack");

		expect(result._unsafeUnwrapErr().reason).toBe("forbidden");
	});

	it("falls back to the status code for an unrecognized reason", async () => {
		const { client } = clientFor(() =>
			jsonResponse(400, { error: { message: "slow down", reason: "rate-limited" } }),
		);

		const result = await client.executeCommand("content.ack");

		expect(result._unsafeUnwrapErr().reason).toBe("bad-request");
	});

	it("survives a bare JSON string body", async () => {
		const { client } = clientFor(() =>
			rawResponse(500, '"[unserializable JSON payload: cyclic getter threw]"'),
		);

		const result = await client.executeCommand("content.ack");

		const error = result._unsafeUnwrapErr();
		expect(error.reason).toBe("server-error");
		expect(error.message).toContain("unserializable JSON payload");
	});

	it("maps a fetch rejection to network", async () => {
		const { client } = clientFor(() => {
			throw new TypeError("Failed to fetch");
		});

		const result = await client.executeCommand("content.ack");

		const error = result._unsafeUnwrapErr();
		expect(error.reason).toBe("network");
		expect(error.status).toBeNull();
	});

	it("rejects a 200 whose body has no result key", async () => {
		const { client } = clientFor(() => jsonResponse(200, { ok: true }));

		const result = await client.executeCommand("content.ack");

		expect(result._unsafeUnwrapErr().reason).toBe("malformed-response");
	});
});

const STATUS_SNAPSHOT = {
	header: {
		startTime: "2026-07-14T15:30:47.112Z",
		uptimeMs: 8100000,
		mode: "persistent",
		node: { id: "gallery-kiosk-1", label: "Gallery Kiosk 1" },
	},
	sections: [],
};

describe("getStatus", () => {
	it("returns the snapshot", async () => {
		const { fake, client } = clientFor(() => jsonResponse(200, STATUS_SNAPSHOT));

		const result = await client.getStatus();

		expect(result._unsafeUnwrap()).toEqual(STATUS_SNAPSHOT);
		expect(fake.calls[0]?.url).toBe(`${BASE_URL}/status`);
	});

	it("maps a 401 to unauthorized", async () => {
		const { client } = clientFor(() => jsonResponse(401, { error: { message: "Unauthorized" } }));

		const result = await client.getStatus();

		expect(result._unsafeUnwrapErr().reason).toBe("unauthorized");
	});

	it("rejects a 200 that is not a snapshot", async () => {
		const { client } = clientFor(() => jsonResponse(200, { header: {} }));

		const result = await client.getStatus();

		expect(result._unsafeUnwrapErr().reason).toBe("malformed-response");
	});

	it("strips a trailing slash off the base URL", async () => {
		const fake = createFakeFetch(() => jsonResponse(200, STATUS_SNAPSHOT));
		const client = createClient({ baseUrl: `${BASE_URL}/`, fetch: fake.fetchFn });

		await client.getStatus();

		expect(fake.calls[0]?.url).toBe(`${BASE_URL}/status`);
	});
});

const STATE = {
	system: {
		startTime: "2026-07-14T15:30:47.112Z",
		mode: "persistent",
		node: { id: "a", label: "A" },
	},
	plugins: {},
	_version: 3,
};

describe("getState", () => {
	it("returns the state tree", async () => {
		const { client } = clientFor(() => jsonResponse(200, STATE));

		const result = await client.getState();

		expect(result._unsafeUnwrap()).toEqual(STATE);
	});

	it("maps a 404 to state-not-exposed", async () => {
		const { client } = clientFor(() =>
			jsonResponse(404, { error: { message: "Not found: GET /state" } }),
		);

		const result = await client.getState();

		const error = result._unsafeUnwrapErr();
		expect(error.reason).toBe("state-not-exposed");
		expect(error.status).toBe(404);
	});
});
