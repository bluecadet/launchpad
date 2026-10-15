import type {
	LoggerSource,
	NormalizedLogRecord,
	ResourceAttributes,
} from "@bluecadet/launchpad-utils/logging";
import { ok, okAsync } from "neverthrow";
import { vi } from "vitest";

export function createControllerLogSource() {
	let resourceAttributes: ResourceAttributes = Object.freeze({
		"service.name": "launchpad",
		"service.instance.id": "controller-runtime",
	});
	const records: NormalizedLogRecord[] = [];
	const calls: string[] = [];
	const source: LoggerSource = {
		identity: {
			sourceId: "controller-source",
			runtimeId: "controller-runtime",
			baseResourceAttributes: resourceAttributes,
		},
		get resourceAttributes() {
			return resourceAttributes;
		},
		status: { available: true, pendingRecords: 0, droppedRecords: 0, lossEvents: 0 },
		configureResourceAttributes(attributes) {
			resourceAttributes = Object.freeze({
				...resourceAttributes,
				...attributes,
				"service.instance.id": "controller-runtime",
			});
		},
		flush: vi.fn(() => okAsync("barrier")),
		createReader: vi.fn(() =>
			okAsync({
				read: vi.fn(() =>
					okAsync({
						records: [...records],
						gaps: [],
						receipt: "receipt",
						reachedThrough: true,
					}),
				),
				ack: vi.fn(() => okAsync(undefined)),
				close: vi.fn(() => okAsync(undefined)),
			}),
		),
	};
	const append = vi.fn((record: NormalizedLogRecord) => {
		calls.push(`append:${record.message}`);
		records.push(record);
		return true;
	});
	const close = vi.fn(() => {
		calls.push("close");
		return okAsync(undefined);
	});
	const createSource = vi.fn(() => ok({ source, append, close }));
	return { source, records, calls, createSource, close };
}
