import path from "node:path";
import { EventBus } from "@bluecadet/launchpad-utils/event-bus";
import type {
	LoggerSource,
	LoggerSourceReader,
	NormalizedLogRecord,
	ResourceAttributes,
} from "@bluecadet/launchpad-utils/logging";
import { REDACTED_VALUE } from "@bluecadet/launchpad-utils/logging";
import { err, ok, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";
import winston from "winston";
import { createFileLogger, logConfigSchema } from "../file-logger.js";

function createSourceStub() {
	let resourceAttributes: ResourceAttributes = Object.freeze({
		"service.name": "launchpad",
		"service.instance.id": "runtime-1",
	});
	const records: Array<{ record: NormalizedLogRecord; textLine?: string }> = [];
	const close = vi.fn((_signal: AbortSignal) => okAsync(undefined));
	const reader: LoggerSourceReader = {
		read: vi.fn(() => okAsync({ records: [], gaps: [], receipt: "receipt", reachedThrough: true })),
		ack: vi.fn(() => okAsync(undefined)),
		close: vi.fn(() => okAsync(undefined)),
	};
	const source: LoggerSource = {
		identity: {
			sourceId: "source-1",
			runtimeId: "runtime-1",
			baseResourceAttributes: resourceAttributes,
		},
		get resourceAttributes() {
			return resourceAttributes;
		},
		status: {
			available: true,
			pendingRecords: 0,
			droppedRecords: 0,
			lossEvents: 0,
		},
		configureResourceAttributes(attributes) {
			resourceAttributes = Object.freeze({
				...resourceAttributes,
				...attributes,
				"service.instance.id": "runtime-1",
			});
		},
		flush: vi.fn(() => okAsync("barrier")),
		createReader: vi.fn(() => okAsync(reader)),
	};
	const append = vi.fn((record: NormalizedLogRecord, textLine?: string) => {
		records.push({ record, ...(textLine === undefined ? {} : { textLine }) });
		return true;
	});

	return {
		source,
		records,
		append,
		close,
		createSource: vi.fn(() => ok({ source, append, close })),
	};
}

function resolvedConfig(overrides: Record<string, unknown> = {}) {
	return logConfigSchema.parse({ overrideConsole: false, ...overrides });
}

describe("createFileLogger", () => {
	it("admits every logger level once while rendering human text at info and above by default", () => {
		const source = createSourceStub();
		const eventBus = new EventBus();
		const infoEvents = vi.fn();
		eventBus.on("log:info", infoEvents);
		const fileLogger = createFileLogger(resolvedConfig(), "/installation", eventBus, {
			createSource: source.createSource,
		});

		fileLogger.logger.info("Controller ready");
		fileLogger.logger.debug("Debug detail");
		fileLogger.logger.verbose("Verbose detail");

		expect(source.records.map(({ record }) => record.level)).toEqual(["info", "debug", "verbose"]);
		expect(source.records[0]?.textLine).toContain("info: Controller ready");
		expect(source.records[1]?.textLine).toBeUndefined();
		expect(source.records[2]?.textLine).toBeUndefined();
		expect(infoEvents).toHaveBeenCalledTimes(1);
	});

	it("filters or disables only the human-readable view", () => {
		const filteredSource = createSourceStub();
		const filtered = createFileLogger(
			resolvedConfig({ text: { level: "warn" } }),
			"/installation",
			new EventBus(),
			{ createSource: filteredSource.createSource },
		);

		filtered.logger.info("Routine");
		filtered.logger.error("Failure");

		expect(filteredSource.records).toHaveLength(2);
		expect(filteredSource.records[0]?.textLine).toBeUndefined();
		expect(filteredSource.records[1]?.textLine).toContain("error: Failure");

		const disabledSource = createSourceStub();
		const disabled = createFileLogger(
			resolvedConfig({ text: { enabled: false } }),
			"/installation",
			new EventBus(),
			{ createSource: disabledSource.createSource },
		);
		disabled.logger.error("Still canonical");

		expect(disabledSource.records).toHaveLength(1);
		expect(disabledSource.records[0]?.textLine).toBeUndefined();
	});

	it("applies a custom Winston format only to normalized human text", () => {
		const source = createSourceStub();
		const mutateTextInfo = winston.format((info) => {
			if (Array.isArray(info.args)) info.args.push("text-only");
			return info;
		})();
		const format = winston.format.combine(
			mutateTextInfo,
			winston.format.printf((info) => JSON.stringify(info.args)),
		);
		const fileLogger = createFileLogger(
			resolvedConfig({ format }),
			"/installation",
			new EventBus(),
			{ createSource: source.createSource },
		);

		fileLogger.logger.warn("Request failed", { token: "do-not-persist" });

		expect(source.records[0]?.record.metadata).toEqual({
			args: ["Request failed", { token: REDACTED_VALUE }],
		});
		expect(source.records[0]?.textLine).toContain(REDACTED_VALUE);
		expect(source.records[0]?.textLine).toContain("text-only");
		expect(source.records[0]?.textLine).not.toContain("do-not-persist");
	});

	it("redacts structured arguments before canonical and default text formatting without changing legacy bus messages", () => {
		const source = createSourceStub();
		const eventBus = new EventBus();
		const observed = vi.fn();
		eventBus.on("log:info", observed);
		const fileLogger = createFileLogger(resolvedConfig(), "/installation", eventBus, {
			createSource: source.createSource,
		});

		fileLogger.logger.info("Request %s", "failed", { password: "do-not-persist" });

		expect(source.records).toHaveLength(1);
		expect(source.records[0]?.record.message).toContain("Request failed");
		expect(source.records[0]?.record.message).toContain(REDACTED_VALUE);
		expect(JSON.stringify(source.records)).not.toContain("do-not-persist");
		expect(observed).toHaveBeenCalledOnce();
		expect(observed.mock.calls[0]?.[0].message).toContain("do-not-persist");
	});

	it("captures current resource attributes and child logger scope in each normalized record", () => {
		const source = createSourceStub();
		const fileLogger = createFileLogger(resolvedConfig(), "/installation", new EventBus(), {
			createSource: source.createSource,
		});

		fileLogger.logger.info("Before resource configuration");
		fileLogger.source?.configureResourceAttributes({
			installation: "lobby",
			"service.instance.id": "must-not-replace-runtime",
		});
		fileLogger.logger.child("content").error("Refresh failed");

		expect(source.records[0]?.record.resource).toEqual({
			"service.name": "launchpad",
			"service.instance.id": "runtime-1",
		});
		expect(source.records[1]?.record).toMatchObject({
			module: "content",
			resource: {
				"service.name": "launchpad",
				"service.instance.id": "runtime-1",
				installation: "lobby",
			},
		});
	});

	it("records selected lifecycle events directly without event-bus feedback", () => {
		const source = createSourceStub();
		const eventBus = new EventBus();
		const observed = vi.fn();
		eventBus.onAny(observed);
		const fileLogger = createFileLogger(resolvedConfig(), "/installation", eventBus, {
			createSource: source.createSource,
		});

		fileLogger.recordEvent("command:success", { commandType: "content.fetch" });
		fileLogger.recordEvent("arbitrary:payload", { shouldNotPersist: true });

		expect(source.records).toHaveLength(1);
		expect(source.records[0]?.record).toMatchObject({
			event: "command:success",
			level: "event",
			metadata: { commandType: "content.fetch" },
		});
		expect(observed).not.toHaveBeenCalled();
	});

	it.each(["not-a-size", "0", "-1m", "0.1b", "1b", "1023b", "999999999999999999999g"])(
		"rejects invalid or unrepresentable segment size %s",
		(maxSize) => {
			expect(logConfigSchema.safeParse({ maxSize }).success).toBe(false);
		},
	);

	it.each(["14", "7h", "0d", "-1d", "0.0000000001d", "999999999999999999999d"])(
		"rejects unsupported or unrepresentable retention %s",
		(maxFiles) => {
			expect(logConfigSchema.safeParse({ maxFiles }).success).toBe(false);
		},
	);

	it("warns once when a custom date pattern can no longer control filenames", () => {
		const source = createSourceStub();
		const eventBus = new EventBus();
		const warnings: string[] = [];
		eventBus.on("log:warn", (payload) => warnings.push(payload.message));
		const fileLogger = createFileLogger(
			resolvedConfig({ datePattern: "YYYY-MM" }),
			"/installation",
			eventBus,
			{ createSource: source.createSource },
		);

		fileLogger.logger.info("First record");
		fileLogger.logger.info("Second record");

		expect(warnings).toEqual([
			"logging.datePattern is deprecated and no longer controls owner-managed log filenames",
		]);
		expect(source.append).toHaveBeenCalledTimes(2);
	});

	it("resolves the configured directory and translates valid legacy retention values", () => {
		const source = createSourceStub();
		createFileLogger(
			resolvedConfig({ dirname: "var/log", maxSize: "12mb", maxFiles: "7d" }),
			"/installation",
			new EventBus(),
			{ createSource: source.createSource },
		);

		expect(source.createSource).toHaveBeenCalledWith(
			expect.objectContaining({
				directory: path.resolve("/installation", "var/log"),
				maxSegmentBytes: 12 * 1024 * 1024,
				maxBytes: 256 * 1024 * 1024,
				maxAgeMs: 7 * 24 * 60 * 60 * 1_000,
			}),
		);
	});

	it("leaves admission diagnostics to the source instead of misreporting every failure as queue overflow", () => {
		const source = createSourceStub();
		source.append.mockImplementation(() => false);
		const eventBus = new EventBus();
		const warnings: string[] = [];
		eventBus.on("log:warn", (payload) => warnings.push(payload.message));
		const fileLogger = createFileLogger(resolvedConfig(), "/installation", eventBus, {
			createSource: source.createSource,
		});

		fileLogger.logger.info("First dropped record");
		fileLogger.logger.info("Second dropped record");

		expect(source.append).toHaveBeenCalledTimes(2);
		expect(warnings).toEqual([]);
	});

	it("keeps the in-process logger available when durable source creation fails", () => {
		const eventBus = new EventBus();
		const warnings: string[] = [];
		const infos: string[] = [];
		eventBus.on("log:warn", (payload) => warnings.push(payload.message));
		eventBus.on("log:info", (payload) => infos.push(payload.message));
		const fileLogger = createFileLogger(resolvedConfig(), "/blocked", eventBus, {
			createSource: () => err(new Error("directory is locked")),
		});

		expect(fileLogger.source).toBeUndefined();
		expect(() => fileLogger.logger.info("Controller still starts")).not.toThrow();
		expect(infos).toEqual(["Controller still starts"]);
		expect(warnings).toEqual([expect.stringContaining("directory is locked")]);
	});

	it("closes the owner once with a bounded signal", async () => {
		const source = createSourceStub();
		const fileLogger = createFileLogger(resolvedConfig(), "/installation", new EventBus(), {
			createSource: source.createSource,
			closeTimeoutMs: 50,
		});

		await Promise.all([fileLogger.close(), fileLogger.close()]);

		expect(source.close).toHaveBeenCalledTimes(1);
		expect(source.close.mock.calls[0]?.[0]).toBeInstanceOf(AbortSignal);
	});
});
