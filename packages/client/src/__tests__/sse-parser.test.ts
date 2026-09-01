import { describe, expect, it, vi } from "vitest";
import { createSseParser, type SseFrame } from "../sse-parser.js";

function collect() {
	const frames: SseFrame[] = [];
	const onRetry = vi.fn();
	const parser = createSseParser({ onFrame: (frame) => frames.push(frame), onRetry });
	return { frames, onRetry, parser };
}

describe("createSseParser", () => {
	it("parses a sequenced frame", () => {
		const { frames, parser } = collect();

		parser.push('id: 42\nevent: content:version:promoted\ndata: {"versionId":"v1"}\n\n');

		expect(frames).toEqual([
			{ id: "42", event: "content:version:promoted", data: '{"versionId":"v1"}' },
		]);
	});

	it("joins multi-line data with newlines", () => {
		const { frames, parser } = collect();

		parser.push("event: content:foo\ndata: line1\ndata: line2\n\n");

		expect(frames[0]?.data).toBe("line1\nline2");
	});

	it("reports the retry directive and emits no frame for it", () => {
		const { frames, onRetry, parser } = collect();

		parser.push("retry: 2000\n\n");

		expect(onRetry).toHaveBeenCalledWith(2000);
		expect(frames).toHaveLength(0);
	});

	it("ignores comment lines", () => {
		const { frames, parser } = collect();

		parser.push(": ping\n\n");
		parser.push("event: content:foo\ndata: 1\n\n");

		expect(frames).toHaveLength(1);
	});

	it("leaves a replayed frame without an id", () => {
		const { frames, parser } = collect();

		parser.push("event: content:foo\ndata: 1\n\n");

		expect(frames[0]?.id).toBeUndefined();
	});

	it("does not carry an id forward to the next frame", () => {
		const { frames, parser } = collect();

		parser.push("id: 7\nevent: content:foo\ndata: 1\n\n");
		parser.push("event: content:foo\ndata: 2\n\n");

		expect(frames[1]?.id).toBeUndefined();
	});

	it("reassembles a frame split across chunk boundaries", () => {
		const { frames, parser } = collect();

		parser.push("id: 9\neve");
		parser.push('nt: content:foo\ndata: {"a"');
		parser.push(":1}\n");
		parser.push("\n");

		expect(frames).toEqual([{ id: "9", event: "content:foo", data: '{"a":1}' }]);
	});

	it("handles CRLF line endings", () => {
		const { frames, parser } = collect();

		parser.push("id: 3\r\nevent: content:foo\r\ndata: 1\r\n\r\n");

		expect(frames).toEqual([{ id: "3", event: "content:foo", data: "1" }]);
	});

	it("defaults the event name to message", () => {
		const { frames, parser } = collect();

		parser.push("data: hello\n\n");

		expect(frames[0]?.event).toBe("message");
	});

	it("does not dispatch a frame that carried no data", () => {
		const { frames, parser } = collect();

		parser.push("event: content:foo\n\n");
		parser.push("data: 1\n\n");

		expect(frames).toEqual([{ event: "message", data: "1" }]);
	});

	it("strips only one leading space from a value", () => {
		const { frames, parser } = collect();

		parser.push("data:  padded\n\n");

		expect(frames[0]?.data).toBe(" padded");
	});
});
