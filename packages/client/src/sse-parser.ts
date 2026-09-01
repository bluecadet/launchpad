/**
 * A Server-Sent Events parser, fed raw response-body text.
 *
 * This SDK streams `GET /events` over `fetch` rather than using `EventSource`, for three
 * reasons: `Authorization: Bearer` can be sent as a header instead of leaking a token
 * into a query string (and into every log an intermediary keeps), the same code path
 * works in a browser and in Node, and reconnection stays under this SDK's control — which
 * the wire contract requires anyway, since every reconnect has to be treated as a gap.
 *
 * One deliberate difference from `EventSource`: an `id:` is reported per frame instead of
 * persisting as a "last event id" across frames. That is what lets a caller tell a
 * replayed backlog frame (never carries an `id:`) from a live broadcast frame (always
 * does) — a distinction `EventSource` structurally cannot make.
 *
 * Known limitation: a lone `\r` is not treated as a line terminator. The transport writes
 * `\n`, and `\r\n` is handled.
 */

export type SseFrame = {
	/** The frame's own `id:`. Absent on replay-backlog frames. */
	readonly id?: string;
	/** The `event:` name, or `"message"` when the frame carried none. */
	readonly event: string;
	/** Every `data:` line of the frame, joined with newlines. */
	readonly data: string;
};

export type SseParserHandlers = {
	onFrame: (frame: SseFrame) => void;
	/** The server's reconnection hint, written once at the top of every stream. */
	onRetry?: (delayMs: number) => void;
};

export type SseParser = {
	/** Feed a decoded chunk of the response body. Chunks may split mid-frame. */
	push(chunk: string): void;
};

const DIGITS_ONLY = /^\d+$/;

export function createSseParser(handlers: SseParserHandlers): SseParser {
	let pending = "";
	let dataLines: string[] = [];
	let eventName: string | undefined;
	let frameId: string | undefined;

	function dispatch() {
		if (dataLines.length === 0) {
			// A frame with no data is not dispatched, but it still clears the buffers.
			eventName = undefined;
			frameId = undefined;
			return;
		}
		const frame: SseFrame = {
			...(frameId === undefined ? {} : { id: frameId }),
			event: eventName ?? "message",
			data: dataLines.join("\n"),
		};
		dataLines = [];
		eventName = undefined;
		frameId = undefined;
		handlers.onFrame(frame);
	}

	function handleField(field: string, value: string) {
		switch (field) {
			case "event":
				eventName = value;
				return;
			case "data":
				dataLines.push(value);
				return;
			case "id":
				// The spec ignores an id containing a NUL; nothing else is rejected.
				if (!value.includes("\0")) {
					frameId = value;
				}
				return;
			case "retry":
				if (DIGITS_ONLY.test(value)) {
					handlers.onRetry?.(Number(value));
				}
				return;
			default:
				return;
		}
	}

	function handleLine(rawLine: string) {
		const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
		if (line.length === 0) {
			dispatch();
			return;
		}
		if (line.startsWith(":")) {
			return;
		}
		const separator = line.indexOf(":");
		if (separator === -1) {
			handleField(line, "");
			return;
		}
		const value = line.slice(separator + 1);
		handleField(line.slice(0, separator), value.startsWith(" ") ? value.slice(1) : value);
	}

	return {
		push(chunk) {
			pending += chunk;
			let newline = pending.indexOf("\n");
			while (newline !== -1) {
				handleLine(pending.slice(0, newline));
				pending = pending.slice(newline + 1);
				newline = pending.indexOf("\n");
			}
		},
	};
}
