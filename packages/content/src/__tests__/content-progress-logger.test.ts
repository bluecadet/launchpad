import { stripVTControlCharacters } from "node:util";
import { EventBus } from "@bluecadet/launchpad-utils/event-bus";
import chalk from "chalk";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import {
	type ArtifactResult,
	ContentProgressLogger,
	type ContentProgressLoggerOptions,
} from "../index.js";

const label = "Transforming Images";
const prefix = `${label}: `;

describe("ContentProgressLogger public interface", () => {
	const originalColumns = Object.getOwnPropertyDescriptor(process.stdout, "columns");
	const originalTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");

	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
		for (const [name, descriptor] of [
			["columns", originalColumns],
			["isTTY", originalTTY],
		] satisfies [string, PropertyDescriptor | undefined][]) {
			if (descriptor) Object.defineProperty(process.stdout, name, descriptor);
			else Reflect.deleteProperty(process.stdout, name);
		}
	});

	function setColumns(columns: number | undefined) {
		Object.defineProperty(process.stdout, "columns", { configurable: true, value: columns });
	}

	function createLogger(total: number, options: Partial<ContentProgressLoggerOptions> = {}) {
		const eventBus = new EventBus();
		const messages: string[] = [];
		const events: string[] = [];
		const onClose = vi.fn();
		eventBus.on("log:tty", ({ message }) => {
			messages.push(message ?? "");
			events.push("update");
		});
		eventBus.on("log:tty:close", (data) => {
			events.push("close");
			onClose(data);
		});
		const logger = new ContentProgressLogger({ eventBus, total, label, ...options });
		return { logger, messages, events, onClose };
	}

	it("exports only the agreed instance interface and accepts artifact results structurally", () => {
		expectTypeOf<ConstructorParameters<typeof ContentProgressLogger>>().toEqualTypeOf<
			[ContentProgressLoggerOptions]
		>();
		expectTypeOf<keyof ContentProgressLogger>().toEqualTypeOf<
			"total" | "fresh" | "cached" | "complete" | "close"
		>();
		expectTypeOf<ArtifactResult>().toExtend<
			NonNullable<Parameters<ContentProgressLogger["complete"]>[0]>
		>();
		const { logger } = createLogger(1);
		const result: ArtifactResult = { reused: true };
		logger.complete(result);
		expectTypeOf(logger.total).toEqualTypeOf<number>();
		expectTypeOf(logger.fresh).toEqualTypeOf<number>();
		expectTypeOf(logger.cached).toEqualTypeOf<number>();
		expect(logger.cached).toBe(1);
		logger.close();
	});

	it("is exported from the published content entry", async () => {
		const content = await import("@bluecadet/launchpad-content");
		expect(content.ContentProgressLogger).toBeTypeOf("function");
		const logger = new content.ContentProgressLogger({ eventBus: new EventBus(), total: 0, label });
		logger.close();
		expect(vi.getTimerCount()).toBe(0);
	});

	it.each([
		{ columns: 0, barLength: 0 },
		{ columns: 1, barLength: 0 },
		{ columns: prefix.length - 1, barLength: 0 },
		{ columns: prefix.length, barLength: 0 },
		{ columns: prefix.length + 4, barLength: 4 },
		{ columns: 81, barLength: 60 },
		{ columns: 120, barLength: 60 },
		{ columns: undefined, barLength: 60 },
	])("renders and closes at terminal width $columns", ({ columns, barLength }) => {
		setColumns(columns);
		const { logger, messages, onClose } = createLogger(2);

		vi.advanceTimersByTime(50);
		logger.complete();
		logger.complete({ reused: true });
		logger.close();

		expect(messages).toHaveLength(4);
		for (const message of messages) {
			expect(stripVTControlCharacters(message).split("\n")[0]).toBe(
				`${prefix}${"=".repeat(barLength)}`,
			);
		}
		expect(stripVTControlCharacters(messages.at(-1) ?? "")).toBe(
			`${prefix}${"=".repeat(barLength)}\nProcessed: 1, Cached: 1, Remaining: 0 \n`,
		);
		expect(logger.fresh).toBe(1);
		expect(logger.cached).toBe(1);
		expect(logger.total).toBe(2);
		expect(onClose).toHaveBeenCalledExactlyOnceWith({});
		expect(vi.getTimerCount()).toBe(0);
	});

	it("keeps independently rounded segments within a one-character bar", () => {
		setColumns(prefix.length + 1);
		const { logger, messages } = createLogger(2);
		logger.complete();
		logger.complete({ reused: true });
		logger.close();

		for (const message of messages) {
			expect(stripVTControlCharacters(message).split("\n")[0]).toBe(`${prefix}=`);
		}
		expect(logger.fresh + logger.cached).toBe(2);
	});

	it("keeps cached-only completion distinct from fresh work", () => {
		setColumns(prefix.length + 12);
		const { logger, messages } = createLogger(2);
		logger.complete({ reused: true });
		expect(messages.at(-1)).toBe(
			`${prefix}${chalk.yellow("======")}${chalk.gray("======")}\nProcessed: ${chalk.green(0)}, Cached: ${chalk.yellow(1)}, Remaining: 1 \n`,
		);
		logger.complete({ reused: true });
		logger.close();
		expect(messages.at(-1)).toBe(
			`${prefix}${chalk.yellow("============")}\nProcessed: ${chalk.green(0)}, Cached: ${chalk.yellow(2)}, Remaining: 0 \n`,
		);
		expect(logger.fresh).toBe(0);
		expect(logger.cached).toBe(2);
	});

	it("preserves fresh, cached, and remaining colors with custom labels", () => {
		setColumns(prefix.length + 12);
		const { logger, messages } = createLogger(3, { freshLabel: "Transformed" });
		logger.complete({ reused: false });
		logger.complete({ reused: true });
		logger.close();

		expect(messages.at(-1)).toBe(
			`${prefix}${chalk.green("====")}${chalk.yellow("====")}${chalk.gray("====")}\nTransformed: ${chalk.green(1)}, Cached: ${chalk.yellow(1)}, Remaining: 1 \n`,
		);
	});

	it("counts uncached tasks after success without any cache dependency", async () => {
		const { logger, messages } = createLogger(1);
		const task = Promise.withResolvers<void>();
		const execution = (async () => {
			try {
				await task.promise;
				logger.complete();
			} finally {
				logger.close();
			}
		})();
		expect(logger.fresh).toBe(0);
		expect(messages).toEqual([]);
		task.resolve();
		await execution;
		expect(logger.fresh).toBe(1);
		expect(messages).toHaveLength(2);
	});

	it("closes after a failed operation without counting it or leaking updates", () => {
		setColumns(1);
		const { logger, events, messages, onClose } = createLogger(3);
		const failure = new Error("generation failed");

		expect(() => {
			try {
				logger.complete({ reused: true });
				logger.complete();
				throw failure;
			} finally {
				logger.close();
			}
		}).toThrow(failure);
		logger.close();
		logger.complete();
		logger.complete({ reused: true });
		vi.advanceTimersByTime(500);

		expect(events).toEqual(["update", "update", "update", "close"]);
		expect(stripVTControlCharacters(messages.at(-1) ?? "")).toContain("Remaining: 1");
		expect(logger.fresh).toBe(1);
		expect(logger.cached).toBe(1);
		expect(logger.total).toBe(3);
		expect(onClose).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
	});

	it.each([0, 1, 80])("handles an empty workload at terminal width %i", (columns) => {
		setColumns(columns);
		const { logger, messages, events, onClose } = createLogger(0);
		vi.advanceTimersByTime(50);
		logger.close();
		logger.complete({ reused: true });

		expect(messages.map(stripVTControlCharacters)).toEqual(
			Array(2).fill(`${prefix}\nProcessed: 0, Cached: 0, Remaining: 0 \n`),
		);
		expect(events).toEqual(["update", "update", "close"]);
		expect(logger.total).toBe(0);
		expect(logger.fresh).toBe(0);
		expect(logger.cached).toBe(0);
		expect(onClose).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("preserves events on non-TTY output with the unknown-width fallback", () => {
		Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: false });
		setColumns(undefined);
		const { logger, messages, events } = createLogger(1);
		logger.complete();
		logger.close();

		expect(messages.map((message) => stripVTControlCharacters(message).split("\n")[0])).toEqual(
			Array(2).fill(`${prefix}${"=".repeat(60)}`),
		);
		expect(events).toEqual(["update", "update", "close"]);
	});

	it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
		"rejects invalid total %s before starting a timer",
		(total) => {
			expect(() => createLogger(total)).toThrow(RangeError);
			expect(vi.getTimerCount()).toBe(0);
		},
	);

	it.each(["", "  ", "two\nlines", "two\rlines", "two\u2028lines", "two\u2029lines"])(
		"rejects invalid labels %j before starting a timer",
		(invalidLabel) => {
			expect(() => createLogger(1, { label: invalidLabel })).toThrow(TypeError);
			expect(() => createLogger(1, { freshLabel: invalidLabel })).toThrow(TypeError);
			expect(vi.getTimerCount()).toBe(0);
		},
	);

	it("validates JavaScript inputs without relying on TypeScript", () => {
		for (const options of [
			{ total: "1", label },
			{ total: 1, label: null },
			{ total: 1, label: undefined },
			{ total: 1, label, freshLabel: 2 },
		]) {
			expect(() =>
				Reflect.construct(ContentProgressLogger, [{ eventBus: new EventBus(), ...options }]),
			).toThrow();
		}
		expect(vi.getTimerCount()).toBe(0);
	});

	it.each([null, {}, { reused: "yes" }, { reused: 1 }])(
		"rejects invalid completion result %j without mutation",
		(result) => {
			const { logger, messages } = createLogger(1);
			expect(() => Reflect.apply(logger.complete, logger, [result])).toThrow(TypeError);
			expect(logger.fresh).toBe(0);
			expect(logger.cached).toBe(0);
			expect(messages).toEqual([]);
			logger.close();
		},
	);

	it.each([0, 1])("rejects completion beyond total %i without mutation or updates", (total) => {
		const { logger, messages } = createLogger(total);
		if (total > 0) logger.complete({ reused: true });
		const countBefore = messages.length;

		expect(() => logger.complete()).toThrow(RangeError);
		expect(() => logger.complete({ reused: true })).toThrow(RangeError);
		expect(logger.fresh).toBe(0);
		expect(logger.cached).toBe(total);
		expect(messages).toHaveLength(countBefore);
		logger.close();
	});
});
