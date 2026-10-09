import { describe, expect, it } from "vitest";
import { decodeOtlpProtobufResponse, encodeOtlpProtobufRequest } from "../core/otlp-protobuf.js";
import { wireFixtures } from "./fixtures/otlp-protobuf/wire-fixtures.js";

describe("OTLP protobuf request encoding", () => {
	it("sanitizes protobuf library encoding failures into permanent Results", () => {
		const payload = {
			get resourceLogs() {
				throw new Error("private library input");
			},
		};
		expect(encodeOtlpProtobufRequest("logs", payload)._unsafeUnwrapErr()).toMatchObject({
			message: "OTLP export payload could not be encoded",
			retryable: false,
		});
	});

	it("matches the official logs fixture for 64-bit values and nested AnyValue data", () => {
		const payload = {
			resourceLogs: [
				{
					resource: {
						attributes: [
							{ key: "service.name", value: { stringValue: "codec-test" } },
							{ key: "signed", value: { intValue: "-9007199254740993" } },
						],
						droppedAttributesCount: 2,
					},
					scopeLogs: [
						{
							scope: {
								name: "codec-scope",
								version: "1.2.3",
								attributes: [{ key: "scope.enabled", value: { boolValue: true } }],
								droppedAttributesCount: 1,
							},
							logRecords: [
								{
									timeUnixNano: "1718452800123000000",
									severityNumber: 17,
									severityText: "ERROR",
									body: {
										kvlistValue: {
											values: [
												{
													key: "nested",
													value: {
														arrayValue: {
															values: [
																{ stringValue: "alpha" },
																{ intValue: "-42" },
																{ doubleValue: -0 },
															],
														},
													},
												},
											],
										},
									},
									attributes: [{ key: "event", value: { stringValue: "codec:test" } }],
								},
							],
							schemaUrl: "https://example.test/scope/1.0",
						},
					],
					schemaUrl: "https://example.test/resource/1.0",
				},
			],
		};

		const encoded = encodeOtlpProtobufRequest("logs", payload)._unsafeUnwrap();

		expect(encoded).toEqual(wireFixtures.logsRequest);
		expect(encoded.buffer).toBeInstanceOf(ArrayBuffer);
		expect(encoded.byteOffset).toBe(0);
		expect(encoded.byteLength).toBe(encoded.buffer.byteLength);
	});

	it("matches the official gauge fixture for fixed64 timestamps and doubles", () => {
		const payload = {
			resourceMetrics: [
				{
					resource: {
						attributes: [{ key: "service.name", value: { stringValue: "codec-test" } }],
					},
					scopeMetrics: [
						{
							scope: { name: "codec-scope", version: "1.2.3" },
							metrics: [
								{
									name: "temperature",
									description: "Current temperature",
									unit: "Cel",
									gauge: {
										dataPoints: [
											{
												timeUnixNano: "1718452800123000000",
												asDouble: -0,
												attributes: [{ key: "room", value: { stringValue: "gallery" } }],
											},
											{
												startTimeUnixNano: "1718452799123000000",
												timeUnixNano: "1718452800123000001",
												asDouble: 20.25,
												attributes: [{ key: "floor", value: { intValue: "2" } }],
											},
										],
									},
								},
							],
							schemaUrl: "https://example.test/scope/1.0",
						},
					],
					schemaUrl: "https://example.test/resource/1.0",
				},
			],
		};

		expect(encodeOtlpProtobufRequest("metrics", payload)._unsafeUnwrap()).toEqual(
			wireFixtures.metricsRequest,
		);
	});
});

describe("OTLP protobuf response decoding", () => {
	it("preserves large and negative signed log rejection counts as decimal strings", () => {
		expect(
			decodeOtlpProtobufResponse("logs", wireFixtures.logsResponseLarge)._unsafeUnwrap(),
		).toEqual({
			partialSuccess: {
				rejectedLogRecords: "9223372036854775807",
				errorMessage: "large count",
			},
		});
		expect(
			decodeOtlpProtobufResponse("logs", wireFixtures.logsResponseNegative)._unsafeUnwrap(),
		).toEqual({
			partialSuccess: {
				rejectedLogRecords: "-1",
				errorMessage: "invalid negative count",
			},
		});
	});

	it("preserves a metric rejection count above Number.MAX_SAFE_INTEGER", () => {
		expect(
			decodeOtlpProtobufResponse("metrics", wireFixtures.metricsResponseLarge)._unsafeUnwrap(),
		).toEqual({
			partialSuccess: {
				rejectedDataPoints: "9007199254740993",
				errorMessage: "partial",
			},
		});
	});

	it("treats an empty response as success and ignores unknown fields", () => {
		expect(decodeOtlpProtobufResponse("logs", new Uint8Array())._unsafeUnwrap()).toEqual({});
		expect(
			decodeOtlpProtobufResponse("logs", wireFixtures.logsResponseLargeUnknown)._unsafeUnwrap(),
		).toEqual({
			partialSuccess: {
				rejectedLogRecords: "9223372036854775807",
				errorMessage: "large count",
			},
		});
	});

	it("returns a permanent sanitized Result for a truncated protobuf response", () => {
		const complete = wireFixtures.logsResponseNegative;
		const truncated = complete.subarray(0, complete.byteLength - 1);
		const unterminatedInt64 = Uint8Array.from([0x0a, 0x05, 0x08, 0x80, 0x80, 0x80, 0x80]);

		expect(decodeOtlpProtobufResponse("logs", truncated)._unsafeUnwrapErr()).toMatchObject({
			message: "OTLP response was malformed",
			retryable: false,
		});
		expect(decodeOtlpProtobufResponse("logs", unterminatedInt64)._unsafeUnwrapErr()).toMatchObject({
			message: "OTLP response was malformed",
			retryable: false,
		});
		expect(
			decodeOtlpProtobufResponse("metrics", unterminatedInt64)._unsafeUnwrapErr(),
		).toMatchObject({ message: "OTLP response was malformed", retryable: false });
	});
});
