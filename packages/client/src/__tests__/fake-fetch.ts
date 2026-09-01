/** A `fetch` under the test's control, used everywhere a real Node is not booted. */

import type { FetchLike } from "../http.js";

export type FakeFetch = {
	fetchFn: FetchLike;
	calls: Request[];
};

export function createFakeFetch(
	handler: (request: Request) => Response | Promise<Response>,
): FakeFetch {
	const calls: Request[] = [];
	const fetchFn: FetchLike = async (input, init) => {
		const url = input instanceof URL ? input.toString() : String(input);
		const request = new Request(url, init);
		calls.push(request.clone());
		return handler(request);
	};
	return { fetchFn, calls };
}

export function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

/** A body that is not a JSON object — what a response whose serialization threw returns. */
export function rawResponse(status: number, body: string): Response {
	return new Response(body, { status, headers: { "content-type": "application/json" } });
}

/** Streams `chunks` as an SSE body, then leaves the stream open until `close()`. */
export function sseResponse(chunks: string[]): { response: Response; close: () => void } {
	let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
	const encoder = new TextEncoder();
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controllerRef = controller;
			for (const chunk of chunks) {
				controller.enqueue(encoder.encode(chunk));
			}
		},
	});
	return {
		response: new Response(stream, {
			status: 200,
			headers: { "content-type": "text/event-stream" },
		}),
		close: () => controllerRef?.close(),
	};
}

export type SseConnection = {
	write(text: string): void;
	end(): void;
};

export type SseServer = {
	/** Build a response for one `GET /events`, recording the connection. */
	respond(): Response;
	/** Every connection handed out, oldest first. */
	connections: SseConnection[];
	/** The most recent connection. */
	current(): SseConnection;
};

/** An `/events` endpoint whose frames and disconnections the test drives. */
export function createSseServer(): SseServer {
	const encoder = new TextEncoder();
	const connections: SseConnection[] = [];

	return {
		respond() {
			let sink: ReadableStreamDefaultController<Uint8Array> | null = null;
			let closed = false;
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					sink = controller;
				},
				cancel() {
					closed = true;
				},
			});
			connections.push({
				write(text) {
					if (!closed) {
						sink?.enqueue(encoder.encode(text));
					}
				},
				end() {
					if (!closed) {
						closed = true;
						sink?.close();
					}
				},
			});
			return new Response(stream, {
				status: 200,
				headers: { "content-type": "text/event-stream" },
			});
		},
		connections,
		current() {
			const connection = connections.at(-1);
			if (!connection) {
				throw new Error("No SSE connection has been opened yet");
			}
			return connection;
		},
	};
}
