import path from "node:path";
import type { Logger } from "@bluecadet/launchpad-utils/logger";
import {
	type LoggerSource,
	type NormalizedLogRecord,
	REDACTED_VALUE,
	type ResourceAttributes,
} from "@bluecadet/launchpad-utils/logging";
import { definePlugin, type PluginContext } from "@bluecadet/launchpad-utils/plugin-interfaces";
import { ok, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";
import { controllerConfigSchema } from "../controller-config.js";
import { LaunchpadController } from "../launchpad-controller.js";
import { fail, unwrap } from "./log-result-test-utils.js";

function createControllerLogSource() {
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

describe("file-backed logging integration", () => {
	it("exposes the configured canonical source and captures selected events once", async () => {
		const owner = createControllerLogSource();
		const fileConfig = controllerConfigSchema.parse({
			logging: {
				dirname: "runtime-logs",
				overrideConsole: false,
				text: { enabled: false },
			},
		});
		const releaseInstanceLease = vi.fn();
		const controller = new LaunchpadController(fileConfig, "/installation", "task", {
			createSource: owner.createSource,
			acquireInstanceLease: () => ({ release: releaseInstanceLease }),
		});
		let logger: Logger | undefined;
		let source: PluginContext["logSource"];
		let commandSuccessEvents = 0;
		controller.getEventBus().on("command:success", () => {
			commandSuccessEvents += 1;
		});
		await controller.registerPlugin(
			definePlugin({
				name: "logged",
				manifest: { commands: [{ id: "logged.run" }] },
				setup(ctx) {
					logger = ctx.logger;
					source = ctx.logSource;
					return okAsync({ executeCommand: () => okAsync(undefined) });
				},
			}),
		);
		await controller.start();

		logger?.warn("Credential rejected", { password: "do-not-persist" });
		await controller.executeCommand({ type: "logged.run" });

		expect(owner.createSource).toHaveBeenCalledWith(
			expect.objectContaining({ directory: path.resolve("/installation", "runtime-logs") }),
		);
		expect(source).toBe(owner.source);
		expect(source?.status.available).toBe(true);
		expect(source?.identity.baseResourceAttributes).toMatchObject({
			"service.name": "launchpad",
			"service.instance.id": source?.identity.runtimeId,
		});
		expect(commandSuccessEvents).toBe(1);
		const signal = new AbortController().signal;
		if (!source) throw new Error("Expected canonical source");
		const barrier = await source.flush(signal).then((result) => unwrap(result), fail);
		const reader = await source
			.createReader({ checkpointId: "controller-test" }, signal)
			.then((result) => unwrap(result), fail);
		const batch = await reader
			.read({
				maxEntries: 100,
				maxBytes: 1024 * 1024,
				through: barrier,
				signal,
			})
			.then((result) => unwrap(result), fail);
		const credentialRecord = batch?.records.find(
			(record) => record.event === "log:warn" && record.module === "logged",
		);
		expect(credentialRecord?.timestamp).toBeInstanceOf(Date);
		expect(credentialRecord?.resource["service.instance.id"]).toBe(source?.identity.runtimeId);
		expect(credentialRecord?.metadata).toEqual({
			args: ["Credential rejected", { password: REDACTED_VALUE }],
		});
		expect(batch?.records.filter((record) => record.event === "command:success")).toHaveLength(1);
		if (batch && reader) {
			await reader.ack(batch.receipt, signal);
			await reader.close(signal);
		}
		await controller.stop();
		expect(releaseInstanceLease).toHaveBeenCalledOnce();
	});

	it("flushes records written during plugin disconnect before releasing the source", async () => {
		const owner = createControllerLogSource();
		const fileConfig = controllerConfigSchema.parse({
			logging: { dirname: "logs", overrideConsole: false, text: { enabled: false } },
		});
		const releaseInstanceLease = vi.fn();
		const controller = new LaunchpadController(fileConfig, "/installation", "task", {
			createSource: owner.createSource,
			acquireInstanceLease: () => ({ release: releaseInstanceLease }),
		});
		await controller.registerPlugin(
			definePlugin({
				name: "final-writer",
				setup(ctx) {
					return okAsync({
						disconnect: () => {
							ctx.logger.info("Final disconnect record");
							return okAsync(undefined);
						},
					});
				},
			}),
		);
		await controller.start();

		const result = await controller.stop();

		expect(result.isOk()).toBe(true);
		expect(owner.records).toContainEqual(
			expect.objectContaining({
				event: "log:info",
				message: "Final disconnect record",
				module: "final-writer",
			}),
		);
		expect(owner.calls.at(-1)).toBe("close");
		expect(owner.close).toHaveBeenCalledTimes(1);
		expect(releaseInstanceLease).toHaveBeenCalledOnce();
	});
});
