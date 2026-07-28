/**
 * Fan-out bookkeeping shared by the transports.
 *
 * Both transports keep a set of connected clients and push the same serialized
 * frame to all of them, tolerating per-client write failures. The hub owns that
 * set, the failure logging and the teardown; the transport injects how to write
 * to and close one client, so HTTP responses and raw sockets both fit.
 *
 * Serialization stays with the transport — the two protocols encode frames
 * differently on purpose.
 */

import { ensureError } from "@bluecadet/launchpad-utils/errors";
import type { Logger } from "@bluecadet/launchpad-utils/logger";

export type ClientHubOptions<TClient> = {
	logger: Logger;
	/** How this client is described in log lines, e.g. `"SSE client"`. */
	label: string;
	/** Write one frame to one client. Throws are logged, never propagated. */
	write: (client: TClient, frame: string) => void;
	/** Close one client — `end()` for an HTTP response, `destroy()` for a socket. */
	close: (client: TClient) => void;
	/** Skip clients that can no longer accept writes. Defaults to always writable. */
	isWritable?: (client: TClient) => boolean;
};

export type ClientHub<TClient> = {
	add(client: TClient): void;
	remove(client: TClient): void;
	readonly size: number;
	/** Send frames to one client, in order. */
	send(client: TClient, ...frames: string[]): void;
	/** Send frames to every connected client, in order, per client. */
	broadcast(...frames: string[]): void;
	/** Close every client and forget them. */
	closeAll(): void;
};

/**
 * Writes are fire-and-forget: there is no backpressure handling, so a client
 * that can't keep up may miss frames. Both transports treat push as best-effort
 * sugar over an authoritative poll/query path, so this is accepted by design.
 */
export function createClientHub<TClient>(options: ClientHubOptions<TClient>): ClientHub<TClient> {
	const clients = new Set<TClient>();
	const isWritable = options.isWritable ?? (() => true);

	const send = (client: TClient, ...frames: string[]) => {
		if (!isWritable(client)) {
			return;
		}
		try {
			for (const frame of frames) {
				options.write(client, frame);
			}
		} catch (e) {
			options.logger.verbose(`Failed to write to ${options.label}: ${ensureError(e).message}`);
		}
	};

	return {
		add: (client) => {
			clients.add(client);
		},
		remove: (client) => {
			clients.delete(client);
		},
		get size() {
			return clients.size;
		},
		send,
		broadcast: (...frames) => {
			clients.forEach((client) => send(client, ...frames));
		},
		closeAll: () => {
			clients.forEach((client) => options.close(client));
			clients.clear();
		},
	};
}
