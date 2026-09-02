/**
 * The SDK against the real thing: every other test in this package drives a fake
 * `fetch`, so this one boots the controller's own `httpTransport` on a loopback port and
 * talks to it over real HTTP and a real SSE stream.
 *
 * What it is here to catch is the class of bug a fake cannot: a status code the SDK maps
 * from the wrong body field, a sequence number read off the wrong frame, an `Authorization`
 * header the transport does not accept on `/events`, and — the one the acceptance criterion
 * names — a daemon that dies mid-subscription and comes back on the same port.
 */

import { CommandExecutionError } from "@bluecadet/launchpad-controller";
import { httpTransport } from "@bluecadet/launchpad-controller/transports/http";
import { type Session, toSessionId, toVisitorId } from "@bluecadet/launchpad-session";
import {
	createEmptyState,
	createMockPluginCtx,
	createMockStatePatchSource,
} from "@bluecadet/launchpad-testing/test-utils.ts";
import type {
	BaseCommand,
	CommandDispatchError,
} from "@bluecadet/launchpad-utils/plugin-interfaces";
import type { LaunchpadEvents, VersionedLaunchpadState } from "@bluecadet/launchpad-utils/types";
import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient, type EventName, type LaunchpadClient } from "../client.js";
import type { ConnectionEvent, EventFrame } from "../event-stream.js";
import type { SessionView } from "../session-view.js";
import type { VersionedWireState } from "../types.js";

const MANIFEST_RESULT = {
	status: "ok" as const,
	manifest: { versionId: "version-42", versionPath: "/versions/version-42" },
};

const VISITOR_SESSION: Session = {
	sessionId: toSessionId("session-integration-1"),
	visitorId: toVisitorId("visitor-integration-1"),
	language: "es",
	degraded: false,
	seq: 1,
};

const IDLE_STATION = { session: null, profile: null };

/** What `session.current` answers next. Mutable, so a test can move the canon under it. */
let sessionCurrentResult: unknown = IDLE_STATION;

const KIOSK_TOKEN = "kiosk-token-value-0123456789";

/** One token, one role — the smallest configuration that turns auth on. */
const KIOSK_AUTH = {
	roles: { kiosk: ["content.*"] },
	tokens: { "lobby-kiosk": { env: "LAUNCHPAD_TOKEN_KIOSK", role: "kiosk" } },
};

/**
 * One command per outcome the wire contract catalogues: a result, a void result, and the
 * three `reason` values, with anything unknown falling through to `not-registered` exactly
 * as the real dispatcher does.
 */
function dispatchCommand(command: BaseCommand): ResultAsync<unknown, CommandDispatchError> {
	switch (command.type) {
		case "content.manifest.read":
			return okAsync(MANIFEST_RESULT);
		case "content.ack":
			return okAsync(undefined);
		case "session.current":
			return okAsync(sessionCurrentResult);
		case "content.ack.bad":
			return errAsync(
				new CommandExecutionError("Invalid command: content.ack", {
					reason: "invalid",
					commandType: "content.ack",
					cause: new Error("consumerId is required"),
				}),
			);
		case "content.explode":
			return errAsync(
				new CommandExecutionError("Plugin command execution failed", {
					reason: "handler-failed",
					commandType: "content.explode",
					cause: new Error("disk full"),
				}),
			);
		default:
			return errAsync(
				new CommandExecutionError(`Command '${command.type}' is not registered`, {
					reason: "not-registered",
					commandType: command.type,
				}),
			);
	}
}

function stateWith(activeVersion: string, version: number): VersionedLaunchpadState {
	return createEmptyState({ plugins: { content: { activeVersion } }, _version: version });
}

type TransportOptions = Parameters<typeof httpTransport>[0];

const NODE_DEFAULTS: TransportOptions = {
	port: 0,
	allowedCommands: ["content.*", "session.*"],
	events: ["content:*", "session:*"],
	replayEvents: [],
	exposeState: true,
	pushStatePatches: true,
};

const runningNodes: Array<() => Promise<void>> = [];
const openClients: LaunchpadClient[] = [];

/** Boot a transport backed by a driveable ctx, and hand back the levers a test needs. */
async function startNode(options: TransportOptions = {}, state = stateWith("v1", 1)) {
	const patchSource = createMockStatePatchSource();
	let current = state;
	const ctx = createMockPluginCtx("/", {
		mode: "persistent",
		dispatchCommand: vi.fn(dispatchCommand),
		getGlobalState: vi.fn(() => current),
		onGlobalStatePatch: patchSource.onGlobalStatePatch,
	});

	const result = await httpTransport({ ...NODE_DEFAULTS, ...options }).setup(ctx);
	const instance = result._unsafeUnwrap();
	if (instance.address === null) {
		throw new Error("The transport reported success but never listened");
	}
	const { port } = instance.address;

	const stop = async () => {
		await instance.disconnect?.({ type: "manual" });
	};
	runningNodes.push(stop);

	return {
		port,
		baseUrl: `http://127.0.0.1:${port}`,
		emit: <TName extends EventName>(event: TName, data: LaunchpadEvents[TName]) => {
			ctx.eventBus.emit(event, data);
		},
		/** Move the store forward and push the patch, the way a real state write does. */
		patch: (activeVersion: string, version: number) => {
			current = stateWith(activeVersion, version);
			patchSource.emit(
				[{ op: "replace", path: ["plugins", "content", "activeVersion"], value: activeVersion }],
				version,
			);
		},
		stop,
	};
}

function connect(baseUrl: string, token?: string): LaunchpadClient {
	// The ceiling matters as much as the base delay: a restart that takes a few rounds to
	// come back would otherwise back off past `waitFor`'s timeout on a loaded CI box.
	const client = createClient({ baseUrl, token, reconnectDelayMs: 10, maxReconnectDelayMs: 25 });
	openClients.push(client);
	return client;
}

/**
 * Opens the stream and resolves once it is up, handing back every connection event since.
 *
 * Two reasons every test calls this before subscribing to anything else: `connected` is
 * a one-shot event a later subscriber never sees, and the transport drops a frame
 * broadcast to nobody, so an event emitted a tick too early never happened.
 */
async function whenConnected(client: LaunchpadClient) {
	const connections: ConnectionEvent[] = [];
	client.onConnection((event) => connections.push(event));
	await vi.waitFor(() => expect(connections).toContainEqual({ type: "connected" }));
	return connections;
}

afterEach(async () => {
	while (openClients.length > 0) {
		openClients.pop()?.close();
	}
	while (runningNodes.length > 0) {
		await runningNodes.pop()?.();
	}
	sessionCurrentResult = IDLE_STATION;
	vi.unstubAllEnvs();
});

describe("client against the HTTP transport", () => {
	describe("executeCommand", () => {
		it("resolves a command's own result", async () => {
			const node = await startNode();

			const result = await connect(node.baseUrl).executeCommand("content.manifest.read");

			expect(result._unsafeUnwrap()).toEqual(MANIFEST_RESULT);
		});

		it("resolves null for a command that returns nothing", async () => {
			const node = await startNode();

			const result = await connect(node.baseUrl).executeCommand("content.ack");

			expect(result._unsafeUnwrap()).toBeNull();
		});

		it("maps a 404 onto not-registered, with the canonical command type", async () => {
			const node = await startNode();

			const result = await connect(node.baseUrl).executeCommand("content.nope");

			const error = result._unsafeUnwrapErr();
			expect(error.reason).toBe("not-registered");
			expect(error.status).toBe(404);
			expect(error.commandType).toBe("content.nope");
		});

		it("maps a 400 onto invalid, keeping the cause the handler reported", async () => {
			const node = await startNode();

			const result = await connect(node.baseUrl).executeCommand("content.ack.bad");

			const error = result._unsafeUnwrapErr();
			expect(error.reason).toBe("invalid");
			expect(error.status).toBe(400);
			// The dispatcher resolves the alias, so the failure names a different command.
			expect(error.commandType).toBe("content.ack");
			expect(error.cause).toMatchObject({ message: "consumerId is required" });
		});

		it("maps a 500 onto handler-failed", async () => {
			const node = await startNode();

			const result = await connect(node.baseUrl).executeCommand("content.explode");

			const error = result._unsafeUnwrapErr();
			expect(error.reason).toBe("handler-failed");
			expect(error.status).toBe(500);
			expect(error.cause).toMatchObject({ message: "disk full" });
		});

		it("maps a command outside the allowlist onto forbidden", async () => {
			const node = await startNode();

			const result = await connect(node.baseUrl).executeCommand("workflow.run", {
				name: "tour-mode",
			});

			const error = result._unsafeUnwrapErr();
			expect(error.reason).toBe("forbidden");
			expect(error.status).toBe(403);
		});
	});

	describe("reads", () => {
		it("returns the status snapshot", async () => {
			const node = await startNode();

			const result = await connect(node.baseUrl).getStatus();

			expect(result._unsafeUnwrap().header.node.id).toBe("test-node");
		});

		it("returns the state tree, with a Date already collapsed to a string", async () => {
			const node = await startNode();

			const result = await connect(node.baseUrl).getState();

			const state = result._unsafeUnwrap();
			expect(state._version).toBe(1);
			expect(state.plugins).toEqual({ content: { activeVersion: "v1" } });
			expect(typeof state.system.startTime).toBe("string");
		});

		it("reports state-not-exposed when the operator did not opt in", async () => {
			const node = await startNode({ exposeState: false, pushStatePatches: false });

			const result = await connect(node.baseUrl).getState();

			const error = result._unsafeUnwrapErr();
			expect(error.reason).toBe("state-not-exposed");
			expect(error.status).toBe(404);
		});

		it("answers an unauthorized read with 401 and accepts a bearer token", async () => {
			vi.stubEnv("LAUNCHPAD_TOKEN_KIOSK", KIOSK_TOKEN);
			const node = await startNode({ auth: KIOSK_AUTH });

			const anonymous = await connect(node.baseUrl).getStatus();
			expect(anonymous._unsafeUnwrapErr().reason).toBe("unauthorized");
			expect(anonymous._unsafeUnwrapErr().status).toBe(401);

			const authorized = await connect(node.baseUrl, KIOSK_TOKEN).getStatus();
			expect(authorized.isOk()).toBe(true);
		});
	});

	describe("events", () => {
		it("delivers typed events with consecutive sequence numbers", async () => {
			const node = await startNode();
			const client = connect(node.baseUrl);
			await whenConnected(client);
			const frames: Array<{ seq?: number; degraded: boolean }> = [];
			client.on("session:degraded", (data, frame) => {
				frames.push({ seq: frame.seq, degraded: data.degraded });
			});

			node.emit("session:degraded", { degraded: true });
			node.emit("session:degraded", { degraded: false });

			await vi.waitFor(() => expect(frames).toHaveLength(2));
			expect(frames[0]?.degraded).toBe(true);
			expect(frames[1]?.degraded).toBe(false);
			expect(frames[1]?.seq).toBe((frames[0]?.seq ?? 0) + 1);
		});

		// The SDK streams `/events` through `fetch`, not `EventSource`, so it presents the
		// token as an `Authorization` header and never needs the `access_token` query
		// parameter the transport also accepts.
		it("streams events for a token presented as a header", async () => {
			vi.stubEnv("LAUNCHPAD_TOKEN_KIOSK", KIOSK_TOKEN);
			const node = await startNode({ auth: KIOSK_AUTH });
			const client = connect(node.baseUrl, KIOSK_TOKEN);
			await whenConnected(client);
			const received: unknown[] = [];
			client.subscribeEvents((frame) => received.push(frame.data));

			node.emit("session:current", { session: null });

			await vi.waitFor(() => expect(received).toHaveLength(1));
			expect(received[0]).toEqual({ session: null });
		});

		it("marks a frame served from the replay backlog as replayed", async () => {
			const node = await startNode({ replayEvents: ["session:current"] });
			// Emitted with nobody connected: the transport keeps the last frame of every
			// replayable event and hands it to the next client, untagged and out of band.
			node.emit("session:current", { session: null });
			const client = connect(node.baseUrl);
			const frames: EventFrame[] = [];
			client.subscribeEvents((frame) => frames.push(frame));

			await vi.waitFor(() => expect(frames).toHaveLength(1));
			expect(frames[0]?.replayed).toBe(true);
			expect(frames[0]?.seq).toBeUndefined();
			expect(frames[0]?.data).toEqual({ session: null });
		});
	});

	describe("sessions", () => {
		it("fills in the profile a session:started frame cannot carry", async () => {
			const node = await startNode();
			const client = connect(node.baseUrl);
			await whenConnected(client);
			const views: SessionView[] = [];
			client.onSession((view) => views.push(view));

			await vi.waitFor(() => expect(views).toHaveLength(1));
			expect(views[0]).toEqual({ session: null, profile: null, degraded: false });

			// The event carries the canon; the Profile only ever crosses the wire in a
			// `session.current` result, so the view has to go back for it.
			sessionCurrentResult = { session: VISITOR_SESSION, profile: { tier: "vip" } };
			node.emit("session:started", { session: VISITOR_SESSION });

			await vi.waitFor(() => expect(views.at(-1)?.profile).toEqual({ tier: "vip" }));
			expect(views.at(-1)?.session).toEqual(VISITOR_SESSION);
			// The canon lands first, with no Profile behind it yet.
			expect(views[1]).toEqual({ session: VISITOR_SESSION, profile: null, degraded: false });
		});
	});

	describe("state mirroring", () => {
		it("applies a pushed patch onto the baseline read", async () => {
			const node = await startNode();
			const client = connect(node.baseUrl);
			await whenConnected(client);
			const states: VersionedWireState[] = [];
			client.subscribeStatePatches((state) => states.push(state));

			await vi.waitFor(() => expect(states).toHaveLength(1));
			expect(states[0]?.plugins).toEqual({ content: { activeVersion: "v1" } });

			node.patch("v2", 2);

			await vi.waitFor(() => expect(states).toHaveLength(2));
			expect(states[1]).toMatchObject({
				_version: 2,
				plugins: { content: { activeVersion: "v2" } },
			});
		});

		it("re-reads state after a daemon restart on the same port", async () => {
			const node = await startNode();
			const client = connect(node.baseUrl);
			const connections = await whenConnected(client);
			const states: VersionedWireState[] = [];
			client.subscribeStatePatches((state) => states.push(state));

			await vi.waitFor(() => expect(states).toHaveLength(1));

			// The daemon dies with the app still subscribed, then comes back on the same
			// port having moved on: a restart the SDK has to notice and reconcile.
			await node.stop();
			await vi.waitFor(() => expect(connections.at(-1)?.type).toBe("disconnected"));
			await startNode({ port: node.port }, stateWith("v9", 9));

			await vi.waitFor(() => expect(connections).toContainEqual({ type: "reconnected" }));
			await vi.waitFor(() => expect(states.length).toBeGreaterThan(1));
			expect(states.at(-1)).toMatchObject({
				_version: 9,
				plugins: { content: { activeVersion: "v9" } },
			});
		});
	});
});
