/**
 * Server bind/close plumbing shared by the transports.
 *
 * Both transports start a `net.Server` (an `http.Server` is one) whose first
 * bind error must fail plugin setup, and both tear it down exactly once during
 * shutdown. Only that plumbing lives here — protocol handling stays in each
 * transport.
 */

import type net from "node:net";
import { ensureError } from "@bluecadet/launchpad-utils/errors";
import type { DisconnectReason } from "@bluecadet/launchpad-utils/plugin-interfaces";
import { okAsync, ResultAsync } from "neverthrow";
import { TransportError } from "../errors.js";

/**
 * Promisified `server.listen()`: resolves once the server is listening, rejects
 * on a bind error (e.g. EADDRINUSE). Whichever event fires first removes the
 * other listener, so a later socket error can't settle an already-settled
 * promise.
 */
export function listenAsync(server: net.Server, options: net.ListenOptions): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const handleError = (error: Error) => {
			server.removeListener("listening", handleListening);
			reject(error);
		};
		const handleListening = () => {
			server.removeListener("error", handleError);
			resolve();
		};

		server.once("error", handleError);
		server.once("listening", handleListening);
		server.listen(options);
	});
}

/** {@link listenAsync} with the bind failure mapped to a `TransportError`. */
export function listenAsResult(
	server: net.Server,
	options: net.ListenOptions,
	failureMessage: string,
): ResultAsync<void, TransportError> {
	return ResultAsync.fromPromise(
		listenAsync(server, options),
		(error) => new TransportError(failureMessage, { cause: ensureError(error) }),
	);
}

/** Promisified `server.close()`, resolving once every connection has drained. */
export function closeServerAsResult(
	server: net.Server,
	failureMessage: string,
): ResultAsync<void, TransportError> {
	return ResultAsync.fromPromise(
		new Promise<void>((resolve) => {
			server.close(() => resolve());
		}),
		(error) => new TransportError(failureMessage, { cause: ensureError(error) }),
	);
}

export type ShutdownGate = {
	/** True once `disconnect` has been called — in-flight requests can refuse work. */
	isShuttingDown(): boolean;
	disconnect(reason: DisconnectReason): ResultAsync<void, TransportError>;
};

/**
 * Run `teardown` at most once, no matter how many times `disconnect` is called
 * (the controller may disconnect a plugin that already reacted to the abort
 * signal).
 */
export function createShutdownGate(
	teardown: () => ResultAsync<void, TransportError>,
): ShutdownGate {
	let hasStartedShutdown = false;

	return {
		isShuttingDown: () => hasStartedShutdown,
		disconnect: () => {
			if (hasStartedShutdown) {
				return okAsync(undefined);
			}
			hasStartedShutdown = true;
			return teardown();
		},
	};
}
