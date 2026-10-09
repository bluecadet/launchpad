import { Result } from "neverthrow";
import type { Type } from "protobufjs";
import protobuf from "protobufjs/light.js";
import type { ExportFailure } from "./destination.js";
import { DestinationFailure } from "./export-failure.js";
import { otlpProtobufSchema } from "./otlp-protobuf-schema.js";

type OtlpSignal = "logs" | "metrics";

type OtlpMessageTypes = Readonly<{
	request: Readonly<Record<OtlpSignal, Type>>;
	response: Readonly<Record<OtlpSignal, Type>>;
}>;

const getMessageTypes = createLazyMessageTypes();

/** Encodes an already-validated OTLP/HTTP JSON-shaped request as protobuf. */
export function encodeOtlpProtobufRequest(
	signal: "logs" | "metrics",
	payload: object,
): Result<Uint8Array<ArrayBuffer>, ExportFailure> {
	return Result.fromThrowable(
		() => {
			const requestType = getMessageTypes().request[signal];
			const message = requestType.fromObject(payload);
			const encoded = requestType.encode(message).finish();

			// protobufjs can expose an ArrayBufferLike-backed view. Fetch's BodyInit
			// expects an owned ArrayBuffer-backed view under TypeScript's typed arrays.
			const ownedBytes = new Uint8Array(encoded.byteLength);
			ownedBytes.set(encoded);
			return ownedBytes;
		},
		() => new DestinationFailure("OTLP export payload could not be encoded", { retryable: false }),
	)();
}

/** Decodes an OTLP protobuf response to its canonical JSON-shaped plain object. */
export function decodeOtlpProtobufResponse(
	signal: "logs" | "metrics",
	bytes: Uint8Array,
): Result<unknown, ExportFailure> {
	return Result.fromThrowable(
		() => {
			if (bytes.byteLength === 0) return {};

			const responseType = getMessageTypes().response[signal];
			const message = responseType.decode(bytes);
			return responseType.toObject(message, { longs: String });
		},
		() => new DestinationFailure("OTLP response was malformed", { retryable: false }),
	)();
}

function createLazyMessageTypes(): () => OtlpMessageTypes {
	let cachedTypes: OtlpMessageTypes | undefined;

	return () => {
		cachedTypes ??= createMessageTypes();
		return cachedTypes;
	};
}

function createMessageTypes(): OtlpMessageTypes {
	const root = protobuf.Root.fromJSON(otlpProtobufSchema).resolveAll();
	const request = Object.freeze({
		logs: root.lookupType("ExportLogsServiceRequest").setup(),
		metrics: root.lookupType("ExportMetricsServiceRequest").setup(),
	});
	const response = Object.freeze({
		logs: root.lookupType("ExportLogsServiceResponse").setup(),
		metrics: root.lookupType("ExportMetricsServiceResponse").setup(),
	});

	return Object.freeze({ request, response });
}
