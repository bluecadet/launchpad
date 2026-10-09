import { afterEach, describe, expect, it, vi } from "vitest";

import {
	activeContext,
	exporters,
	fetchOk,
	fetchProtobufOk,
	logEntry,
	protobufResponse,
} from "./otlp-destination.test-utils.js";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("OTLP responses and failures", () => {
	it.each([401, 503])(
		"awaits streamed HTTP %i response cancellation before settling",
		async (status) => {
			const cancelStarted = Promise.withResolvers<void>();
			const cancelFinished = Promise.withResolvers<void>();
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(new TextEncoder().encode("private collector error"));
					// Deliberately never close: reading the error body would hang.
				},
				cancel() {
					cancelStarted.resolve();
					return cancelFinished.promise;
				},
			});
			const response = new Response(stream, { status, headers: { "Retry-After": "2" } });
			const text = vi.spyOn(response, "text");
			vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
			let settled = false;
			const resultPromise = Promise.resolve(
				exporters().logs!.export([logEntry()], activeContext()),
			).then((result) => {
				settled = true;
				return result;
			});
			await cancelStarted.promise;
			try {
				await new Promise<void>((resolve) => setImmediate(resolve));
				expect(settled).toBe(false);
				expect(text).not.toHaveBeenCalled();
			} finally {
				cancelFinished.resolve();
			}
			const failure = (await resultPromise)._unsafeUnwrapErr();
			expect(failure).toMatchObject({
				message: `OTLP request failed with HTTP status ${status}`,
				retryable: status === 503,
				retryAfterMs: status === 503 ? 2_000 : undefined,
			});
			expect(response.bodyUsed).toBe(true);
		},
	);

	it("preserves the safe HTTP failure when response cancellation rejects", async () => {
		const response = new Response(
			new ReadableStream({
				cancel() {
					return Promise.reject(new Error("private cancellation detail"));
				},
			}),
			{ status: 503 },
		);
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

		const result = await exporters().logs!.export([logEntry()], activeContext());
		expect(result._unsafeUnwrapErr()).toMatchObject({
			message: "OTLP request failed with HTTP status 503",
			retryable: true,
		});
	});

	it("returns a permanent Result for JSON serialization failure", async () => {
		const exporter = exporters().logs!;
		const fetchMock = fetchOk();
		vi.stubGlobal("fetch", fetchMock);
		vi.spyOn(JSON, "stringify").mockImplementationOnce(() => {
			throw new Error("private serialization detail");
		});

		const result = await exporter.export([logEntry()], activeContext());
		expect(result._unsafeUnwrapErr()).toMatchObject({
			message: "OTLP export payload could not be encoded",
			retryable: false,
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("sanitizes synchronous fetch throws without treating retryable fields as trusted", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(() => {
				throw Object.assign(new Error("private branded detail"), { retryable: false });
			}),
		);
		const result = await exporters().logs!.export([logEntry()], activeContext());
		expect(result._unsafeUnwrapErr()).toMatchObject({
			message: "OTLP request failed",
			retryable: true,
		});
	});

	it("decodes responses by configured encoding instead of response Content-Type", async () => {
		const jsonFetch = vi.fn().mockResolvedValue(
			new Response('{"partialSuccess":{"rejectedLogRecords":"1"}}', {
				status: 200,
				headers: { "Content-Type": "application/x-protobuf" },
			}),
		);
		vi.stubGlobal("fetch", jsonFetch);
		const jsonResult = await exporters({ encoding: "json" }).logs!.export(
			[logEntry()],
			activeContext(),
		);

		const protobufFetch = vi.fn().mockResolvedValue(
			new Response(protobufResponse("logs", { rejectedLogRecords: "1" }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);
		vi.stubGlobal("fetch", protobufFetch);
		const protobufResult = await exporters({ encoding: "protobuf" }).logs!.export(
			[logEntry()],
			activeContext(),
		);

		expect(jsonResult._unsafeUnwrap()).toEqual({ rejectedRecords: 1 });
		expect(protobufResult._unsafeUnwrap()).toEqual({ rejectedRecords: 1 });
	});

	it("combines local and protobuf server rejections for logs and data points", async () => {
		const fetchMock = vi
			.fn()
			.mockImplementationOnce(
				async () =>
					new Response(protobufResponse("logs", { rejectedLogRecords: "1" }), { status: 200 }),
			)
			.mockImplementationOnce(
				async () =>
					new Response(protobufResponse("metrics", { rejectedDataPoints: "1" }), { status: 200 }),
			);
		vi.stubGlobal("fetch", fetchMock);
		const destinationExporters = exporters({ encoding: "protobuf" });

		const logResult = await destinationExporters.logs!.export(
			[logEntry({ timestamp: new Date(-1) }), logEntry()],
			activeContext(),
		);
		const metricResult = await destinationExporters.metrics!.export(
			{
				timestamp: new Date("2024-01-01T00:00:00Z"),
				observations: [
					{ name: "up", value: Number.NaN },
					{ name: "up", value: 1 },
				],
			},
			activeContext(),
		);

		expect(logResult._unsafeUnwrap()).toEqual({ rejectedRecords: 2 });
		expect(metricResult._unsafeUnwrap()).toEqual({ rejectedRecords: 2 });
	});

	it.each([
		[{}, 0],
		[{ rejectedLogRecords: "0" }, 0],
		[{ errorMessage: "warning only; do not retry" }, 0],
		[{ rejectedLogRecords: "1", errorMessage: "private server detail" }, 1],
	] as const)("accepts bounded protobuf partial success %#", async (partialSuccess, rejected) => {
		vi.stubGlobal("fetch", fetchProtobufOk(protobufResponse("logs", partialSuccess)));

		const result = await exporters({ encoding: "protobuf" }).logs!.export(
			[logEntry()],
			activeContext(),
		);

		expect(result._unsafeUnwrap()).toEqual({ rejectedRecords: rejected });
	});

	it.each([
		["oversized", { rejectedLogRecords: "2" }],
		["negative", { rejectedLogRecords: "-1" }],
	] as const)("rejects %s protobuf rejection counts", async (_description, partialSuccess) => {
		vi.stubGlobal("fetch", fetchProtobufOk(protobufResponse("logs", partialSuccess)));

		const result = await exporters({ encoding: "protobuf" }).logs!.export(
			[logEntry()],
			activeContext(),
		);

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr().retryable).toBe(false);
		expect(result._unsafeUnwrapErr().message).toBe("OTLP response was malformed");
	});

	it("safely rejects an oversized protobuf metric data point count", async () => {
		vi.stubGlobal(
			"fetch",
			fetchProtobufOk(protobufResponse("metrics", { rejectedDataPoints: "9007199254740993" })),
		);

		const result = await exporters({ encoding: "protobuf" }).metrics!.export(
			{
				timestamp: new Date("2024-01-01T00:00:00Z"),
				observations: [{ name: "up", value: 1 }],
			},
			activeContext(),
		);

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr().retryable).toBe(false);
		expect(result._unsafeUnwrapErr().message).toBe("OTLP response was malformed");
	});

	it.each(["logs", "metrics"] as const)(
		"treats an unterminated protobuf int64 in a %s response as a permanent failure",
		async (signal) => {
			const malformedInt64 = Uint8Array.from([0x0a, 0x05, 0x08, 0x80, 0x80, 0x80, 0x80]);
			vi.stubGlobal("fetch", fetchProtobufOk(malformedInt64));
			const destinationExporters = exporters({ encoding: "protobuf", signals: [signal] });

			const result =
				signal === "logs"
					? await destinationExporters.logs!.export([logEntry()], activeContext())
					: await destinationExporters.metrics!.export(
							{
								timestamp: new Date("2024-01-01T00:00:00Z"),
								observations: [{ name: "up", value: 1 }],
							},
							activeContext(),
						);

			expect(result.isErr()).toBe(true);
			expect(result._unsafeUnwrapErr().retryable).toBe(false);
			expect(result._unsafeUnwrapErr().message).toBe("OTLP response was malformed");
		},
	);

	it("accepts empty protobuf responses and ignores unknown fields", async () => {
		const withUnknownField = Uint8Array.from([0x98, 0x06, 0x01]);
		const fetchMock = vi
			.fn()
			.mockImplementationOnce(async () => new Response(new Uint8Array(), { status: 200 }))
			.mockImplementationOnce(async () => new Response(withUnknownField, { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);
		const logs = exporters({ encoding: "protobuf" }).logs!;

		const emptyResult = await logs.export([logEntry()], activeContext());
		const unknownResult = await logs.export([logEntry()], activeContext());

		expect(emptyResult._unsafeUnwrap()).toEqual({ rejectedRecords: 0 });
		expect(unknownResult._unsafeUnwrap()).toEqual({ rejectedRecords: 0 });
	});

	it("rejects a protobuf response when JSON encoding was selected", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(new Response(protobufResponse("logs", { rejectedLogRecords: "1" }))),
		);

		const result = await exporters({ encoding: "json" }).logs!.export(
			[logEntry()],
			activeContext(),
		);

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toMatchObject({
			message: "OTLP response was malformed",
			retryable: false,
		});
	});

	it.each([
		["truncated protobuf", Uint8Array.from([0x0a, 0x02, 0x08])],
		["JSON in protobuf mode", new TextEncoder().encode('{"private":"response-secret"}')],
	] as const)("treats a malformed %s response as permanent", async (_description, body) => {
		vi.stubGlobal("fetch", fetchProtobufOk(Uint8Array.from(body)));

		const result = await exporters({ encoding: "protobuf" }).logs!.export(
			[logEntry()],
			activeContext(),
		);
		const failure = result._unsafeUnwrapErr();

		expect(failure.retryable).toBe(false);
		expect(failure.message).toBe("OTLP response was malformed");
		expect(failure.message).not.toContain("response-secret");
	});

	it.each([
		"",
		"{}",
		'{"partialSuccess":{}}',
		'{"partialSuccess":{"rejectedLogRecords":"0"}}',
		'{"partialSuccess":{"errorMessage":"warning only; do not retry"}}',
	])("accepts successful log response %j", async (body) => {
		vi.stubGlobal("fetch", fetchOk(body));
		const result = await exporters().logs!.export([logEntry()], activeContext());
		expect(result._unsafeUnwrap()).toEqual({ rejectedRecords: 0 });
	});

	it.each([
		['{"partialSuccess":{"rejectedLogRecords":"1","errorMessage":"unsafe detail"}}', 1],
		['{"partialSuccess":{"rejectedLogRecords":1}}', 1],
	] as const)("returns terminal partial log rejection", async (body, rejectedRecords) => {
		vi.stubGlobal("fetch", fetchOk(body));
		const result = await exporters().logs!.export([logEntry()], activeContext());

		expect(result._unsafeUnwrap()).toEqual({ rejectedRecords });
	});

	it("parses metric data point rejections", async () => {
		vi.stubGlobal(
			"fetch",
			fetchOk('{"partialSuccess":{"rejectedDataPoints":"1","errorMessage":"private"}}'),
		);
		const result = await exporters().metrics!.export(
			{
				timestamp: new Date("2024-01-01T00:00:00Z"),
				observations: [{ name: "up", value: 1 }],
			},
			activeContext(),
		);

		expect(result._unsafeUnwrap()).toEqual({ rejectedRecords: 1 });
	});

	it.each([
		["not-json"],
		["[]"],
		['{"partialSuccess":null}'],
		['{"partialSuccess":{"rejectedLogRecords":-1}}'],
		['{"partialSuccess":{"rejectedLogRecords":"2"}}'],
		['{"partialSuccess":{"rejectedLogRecords":1.5}}'],
	])("treats malformed 200 response as permanent for %s", async (body) => {
		vi.stubGlobal("fetch", fetchOk(body));
		const result = await exporters().logs!.export([logEntry()], activeContext());

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr().retryable).toBe(false);
		expect(result._unsafeUnwrapErr().message).not.toContain(body);
	});

	it.each([
		[429, true],
		[502, true],
		[503, true],
		[504, true],
		[400, false],
		[401, false],
		[500, false],
	])("sets retryability for HTTP %i", async (status, retryable) => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response("backend secret", {
					status,
					statusText: "unsafe status text",
				}),
			),
		);

		const result = await exporters().logs!.export([logEntry()], activeContext());
		const failure = result._unsafeUnwrapErr();

		expect(failure.retryable).toBe(retryable);
		expect(failure.message).toBe(`OTLP request failed with HTTP status ${status}`);
		expect(failure.message).not.toContain("backend secret");
		expect(failure.message).not.toContain("unsafe status text");
	});

	it("honors Retry-After for retryable HTTP responses", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(new Response(null, { status: 429, headers: { "Retry-After": "3" } })),
		);

		const result = await exporters().logs!.export([logEntry()], activeContext());

		expect(result._unsafeUnwrapErr().retryAfterMs).toBe(3_000);
	});

	it("marks network failures retryable without exposing their message", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connect secret-host failed")));

		const result = await exporters().logs!.export([logEntry()], activeContext());
		const failure = result._unsafeUnwrapErr();

		expect(failure.retryable).toBe(true);
		expect(failure.message).toBe("OTLP request failed");
	});

	it("retains network and Retry-After behavior in protobuf mode", async () => {
		const fetchMock = vi
			.fn()
			.mockRejectedValueOnce(new Error("private network detail"))
			.mockResolvedValueOnce(
				new Response("private response body", {
					status: 503,
					headers: { "Retry-After": "4" },
				}),
			);
		vi.stubGlobal("fetch", fetchMock);
		const logs = exporters({ encoding: "protobuf" }).logs!;

		const networkResult = await logs.export([logEntry()], activeContext());
		const retryResult = await logs.export([logEntry()], activeContext());

		expect(networkResult._unsafeUnwrapErr()).toMatchObject({
			message: "OTLP request failed",
			retryable: true,
		});
		expect(retryResult._unsafeUnwrapErr()).toMatchObject({
			message: "OTLP request failed with HTTP status 503",
			retryable: true,
			retryAfterMs: 4_000,
		});
		expect(networkResult._unsafeUnwrapErr().message).not.toContain("private");
		expect(retryResult._unsafeUnwrapErr().message).not.toContain("private");
	});

	it("does not send an already-aborted export", async () => {
		const fetchMock = fetchOk();
		vi.stubGlobal("fetch", fetchMock);
		const controller = new AbortController();
		controller.abort();

		const result = await exporters().logs!.export([logEntry()], { signal: controller.signal });

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr().retryable).toBe(false);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("treats protobuf arrayBuffer read failures as permanent and sanitized", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				status: 200,
				arrayBuffer: async () => {
					throw new Error("private response body detail");
				},
			}),
		);

		const result = await exporters({ encoding: "protobuf" }).logs!.export(
			[logEntry()],
			activeContext(),
		);
		const failure = result._unsafeUnwrapErr();

		expect(failure.retryable).toBe(false);
		expect(failure.message).toBe("OTLP response body could not be read");
		expect(failure.message).not.toContain("private");
	});

	it("treats an abort while reading a protobuf body as permanent cancellation", async () => {
		const controller = new AbortController();
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				status: 200,
				arrayBuffer: async () => {
					controller.abort();
					throw new DOMException("private abort detail", "AbortError");
				},
			}),
		);

		const result = await exporters({ encoding: "protobuf" }).logs!.export([logEntry()], {
			signal: controller.signal,
		});
		const failure = result._unsafeUnwrapErr();

		expect(failure.retryable).toBe(false);
		expect(failure.message).toBe("OTLP export was aborted");
		expect(failure.message).not.toContain("private");
	});

	it("treats an abort while reading a 200 body as permanent", async () => {
		const controller = new AbortController();
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				status: 200,
				text: async () => {
					controller.abort();
					throw new DOMException("aborted detail", "AbortError");
				},
			}),
		);

		const result = await exporters().logs!.export([logEntry()], { signal: controller.signal });

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr().retryable).toBe(false);
		expect(result._unsafeUnwrapErr().message).toBe("OTLP export was aborted");
	});
});
