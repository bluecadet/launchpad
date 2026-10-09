import { ok, okAsync } from "neverthrow";
import { describe, expect, expectTypeOf, it } from "vitest";
import type {
	DestinationExporters,
	MetricBatch,
	ObservabilityDestination,
} from "../core/destination.js";

const exporters: DestinationExporters = {
	logs: {
		export(records, { signal }) {
			expectTypeOf(records).toMatchTypeOf<readonly unknown[]>();
			expectTypeOf(signal).toEqualTypeOf<AbortSignal>();
			return okAsync({ rejectedRecords: 0 });
		},
	},
	metrics: {
		export(batch, { signal }) {
			expectTypeOf(batch).toEqualTypeOf<MetricBatch>();
			expectTypeOf(signal).toEqualTypeOf<AbortSignal>();
			return okAsync({ rejectedRecords: 0 });
		},
	},
	shutdown({ signal }) {
		expectTypeOf(signal).toEqualTypeOf<AbortSignal>();
		return okAsync(undefined);
	},
};

const destination = {
	name: "test",
	create: () => ok(exporters),
} satisfies ObservabilityDestination;

describe("destination contracts", () => {
	it("creates separate log and metric exporters without exporting", () => {
		const result = destination.create();

		expect(result.isOk()).toBe(true);
		if (result.isErr()) return;
		expect(result.value.logs).toBeDefined();
		expect(result.value.metrics).toBeDefined();
	});
});
