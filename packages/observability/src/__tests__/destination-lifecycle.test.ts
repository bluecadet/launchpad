import { err, errAsync, ok, okAsync, ResultAsync } from "neverthrow";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DestinationExporters, ObservabilityDestination } from "../core/destination.js";
import { createExporters, shutdownDestinations } from "../core/destination-lifecycle.js";
import { destinationObservabilityConfigSchema } from "../observability-config.js";

const logs = { export: () => okAsync({ rejectedRecords: 0 }) };

function config(destinations: readonly ObservabilityDestination[]) {
	return destinationObservabilityConfigSchema.parse({ destinations });
}

afterEach(() => vi.useRealTimers());

describe("destination lifecycle results", () => {
	it("rolls back every created bundle when a file log exporter lacks replay capabilities", async () => {
		const firstShutdown = vi.fn(() => okAsync());
		const invalidShutdown = vi.fn(() => okAsync());
		const result = await createExporters(
			destinationObservabilityConfigSchema.parse({
				logStorage: { type: "file" },
				destinations: [
					{
						name: "first",
						checkpointKey: "first-route",
						create: () =>
							ok({ logs: { ...logs, supportsResourceContext: true }, shutdown: firstShutdown }),
					},
					{
						name: "invalid",
						checkpointKey: "invalid-route",
						create: () => ok({ logs, shutdown: invalidShutdown }),
					},
				],
			}),
		);
		expect(result.isErr()).toBe(true);
		if (result.isErr())
			expect(result.error.message).toContain("supportsResourceContext and checkpointKey");
		expect(firstShutdown).toHaveBeenCalledOnce();
		expect(invalidShutdown).toHaveBeenCalledOnce();
	});

	it("passes the exact source resource snapshot through setup and retains checkpoint identity", async () => {
		const resourceAttributes = Object.freeze({ "service.instance.id": "source-runtime" });
		const create = vi.fn(() => ok({ logs: { ...logs, supportsResourceContext: true as const } }));
		const result = await createExporters(
			destinationObservabilityConfigSchema.parse({
				logStorage: { type: "file" },
				destinations: [{ name: "archive", checkpointKey: "route", create }],
			}),
			resourceAttributes,
		);
		expect(result.isOk()).toBe(true);
		if (result.isOk()) expect(result.value[0]?.checkpointKey).toBe("route");
		expect(create.mock.calls).toEqual([[{ resourceAttributes }]]);
	});

	it("rolls back created exporters and retains the factory failure even if cleanup fails", async () => {
		const failure = new Error("factory failed");
		const shutdown = vi.fn(() => errAsync(new Error("cleanup failed")));
		const result = await createExporters(
			config([
				{ name: "first", create: () => ok({ logs, shutdown }) },
				{ name: "second", create: () => err(failure) },
			]),
		);
		expect(result).toEqual(err(failure));
		expect(shutdown).toHaveBeenCalledOnce();
	});

	it("contains thrown custom factories and still rolls back", async () => {
		const shutdown = vi.fn(() => okAsync());
		const result = await createExporters(
			config([
				{ name: "first", create: () => ok({ logs, shutdown }) },
				{
					name: "second",
					create() {
						throw new Error("custom factory threw");
					},
				},
			]),
		);
		expect(result.isErr()).toBe(true);
		if (result.isErr()) expect(result.error.message).toBe("custom factory threw");
		expect(shutdown).toHaveBeenCalledOnce();
	});

	it("also shuts down a bundle rejected for having no signal exporters", async () => {
		const shutdown = vi.fn(() => okAsync());
		const result = await createExporters(
			config([{ name: "empty", create: () => ok({ shutdown }) }]),
		);
		expect(result.isErr()).toBe(true);
		expect(shutdown).toHaveBeenCalledOnce();
	});

	it("contains a thrown shutdown without skipping other bundles or losing method receivers", async () => {
		const shutdown = vi.fn(function (this: DestinationExporters) {
			expect(this.logs).toBe(logs);
			return okAsync();
		});
		const result = await shutdownDestinations(
			[
				{
					name: "throws",
					exporters: {
						shutdown() {
							throw new Error("custom shutdown threw");
						},
					},
				},
				{ name: "works", exporters: { logs, shutdown } },
			],
			100,
		);
		expect(result.isErr()).toBe(true);
		if (result.isErr()) expect(result.error.message).toBe("custom shutdown threw");
		expect(shutdown).toHaveBeenCalledOnce();
	});

	it("returns a deadline failure and aborts hooks that never settle", async () => {
		vi.useFakeTimers();
		let signal: AbortSignal | undefined;
		const resultPromise = shutdownDestinations(
			[
				{
					name: "ignores-abort",
					exporters: {
						shutdown(context) {
							signal = context.signal;
							return ResultAsync.fromSafePromise(new Promise<void>(() => {}));
						},
					},
				},
			],
			50,
		);
		await vi.advanceTimersByTimeAsync(50);
		const result = await resultPromise;
		expect(result.isErr()).toBe(true);
		if (result.isErr()) expect(result.error.message).toContain("shutdown timed out");
		expect(signal?.aborted).toBe(true);
	});

	it("still invokes shutdown with an already-aborted signal when the deadline has expired", async () => {
		const shutdown = vi.fn(({ signal }: { signal: AbortSignal }) => {
			expect(signal.aborted).toBe(true);
			return okAsync();
		});
		const result = await shutdownDestinations([{ name: "expired", exporters: { shutdown } }], 0);
		expect(shutdown).toHaveBeenCalledOnce();
		expect(result.isErr()).toBe(true);
	});
});
