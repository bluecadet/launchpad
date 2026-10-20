import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { EventBus } from "@bluecadet/launchpad-utils/event-bus";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as httpCache from "../../cache/http-cache.js";
import type { ContentTransformContext } from "../../content-transform.js";
import { mediaDownloader } from "../media-downloader.js";
import { sharp } from "../sharp.js";
import { createTestPluginContext } from "./plugins.test-utils.js";

vi.unmock("node:fs");
vi.unmock("node:fs/promises");
vi.unmock("fs");
vi.unmock("fs/promises");

const image = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
	"base64",
);

describe("built-in shared content progress", () => {
	let directory: string;
	const contexts: ContentTransformContext[] = [];

	beforeEach(() => {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), "launchpad-progress-"));
		vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
	});

	afterEach(async () => {
		for (const context of contexts.splice(0)) await context.data.close();
		vi.restoreAllMocks();
		vi.clearAllTimers();
		vi.useRealTimers();
		fs.rmSync(directory, { recursive: true, force: true });
	});

	async function createContext(images: string[]) {
		const base = await createTestPluginContext({ dataDirectory: path.join(directory, "data") });
		const eventBus = new EventBus();
		const messages: string[] = [];
		const events: string[] = [];
		const onClose = vi.fn();
		eventBus.on("log:tty", ({ message }) => {
			messages.push(stripVTControlCharacters(message ?? ""));
			events.push("update");
		});
		eventBus.on("log:tty:close", () => {
			events.push("close");
			onClose();
		});
		const context = {
			...base,
			eventBus,
			paths: {
				...base.paths,
				getDownloadPath: (sourceId?: string) => path.join(directory, "download", sourceId ?? ""),
				getTempPath: (sourceId?: string) => path.join(directory, "temp", sourceId ?? ""),
			},
		};
		contexts.push(context);
		const namespace = (await context.data.createNamespace("test"))._unsafeUnwrap();
		await namespace.insert("doc", Promise.resolve({ images }));
		return { context, messages, events, onClose };
	}

	function writeImages(context: ContentTransformContext, names: string[]) {
		const root = context.paths.getDownloadPath("test");
		fs.mkdirSync(root, { recursive: true });
		for (const name of names) fs.writeFileSync(path.join(root, name), image);
	}

	function expectClosed(events: string[], onClose: ReturnType<typeof vi.fn>) {
		expect(events.slice(-2)).toEqual(["update", "close"]);
		expect(onClose).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
	}

	it("maps HTTP outcomes once and preserves downloader labels and summaries", async () => {
		const { context, messages, events, onClose } = await createContext([
			"https://example.com/fresh.jpg",
			"https://example.com/cached.jpg",
		]);
		vi.spyOn(httpCache, "downloadHttpArtifact").mockImplementation(async ({ url }) => ({
			cacheHit: url.endsWith("cached.jpg"),
		}));

		await mediaDownloader().apply(context);

		expect(messages.at(-1)).toMatch(/^Syncing Media: =*\nFetched: 1, Cached: 1, Remaining: 0 \n$/);
		expect(context.logger.debug).toHaveBeenCalledExactlyOnceWith("HTTP media cache hit");
		const infoMessages = vi
			.mocked(context.logger.info)
			.mock.calls.map(([message]) =>
				typeof message === "string" ? stripVTControlCharacters(message) : message,
			);
		expect(infoMessages).toContain(
			"Of the 2 media files, 1 were downloaded and 1 were pulled from cache",
		);
		expectClosed(events, onClose);
	});

	it("does not count downloader work before the download resolves", async () => {
		const { context, messages, events, onClose } = await createContext([
			"https://example.com/slow.jpg",
		]);
		const started = Promise.withResolvers<void>();
		const task = Promise.withResolvers<{ cacheHit: boolean }>();
		vi.spyOn(httpCache, "downloadHttpArtifact").mockImplementation(() => {
			started.resolve();
			return task.promise;
		});
		const execution = mediaDownloader().apply(context);
		await started.promise;
		vi.advanceTimersByTime(50);
		expect(messages.at(-1)).toContain("Fetched: 0, Cached: 0, Remaining: 1");
		expect(onClose).not.toHaveBeenCalled();

		task.resolve({ cacheHit: true });
		await execution;
		expect(messages.at(-1)).toContain("Fetched: 0, Cached: 1, Remaining: 0");
		expectClosed(events, onClose);
	});

	it("drains active downloader work before closing after a failure", async () => {
		const { context, messages, events, onClose } = await createContext([
			"https://example.com/slow.jpg",
			"https://example.com/error.jpg",
		]);
		const failed = Promise.withResolvers<void>();
		const task = Promise.withResolvers<{ cacheHit: boolean }>();
		vi.spyOn(httpCache, "downloadHttpArtifact").mockImplementation(async ({ url }) => {
			if (url.endsWith("slow.jpg")) return task.promise;
			failed.resolve();
			throw new Error("download failed");
		});
		const rejection = expect(mediaDownloader({ maxConcurrent: 2 }).apply(context)).rejects.toThrow(
			"Queue encountered",
		);
		await failed.promise;
		await new Promise<void>((resolve) => setImmediate(resolve));
		vi.advanceTimersByTime(50);
		expect(messages.at(-1)).toContain("Fetched: 0, Cached: 0, Remaining: 2");
		expect(onClose).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(1);

		task.resolve({ cacheHit: false });
		await rejection;
		expect(messages.at(-1)).toContain("Fetched: 1, Cached: 0, Remaining: 1");
		expectClosed(events, onClose);
		vi.advanceTimersByTime(500);
		expect(events.at(-1)).toBe("close");
	});

	it("passes Sharp artifact outcomes directly and preserves labels and summaries", async () => {
		const names = ["fresh.jpg", "cached.jpg"];
		const { context, messages, events, onClose } = await createContext(names);
		writeImages(context, names);
		const derive = vi.spyOn(context.cache, "derive").mockImplementation(async (artifact) => {
			if (artifact.inputs[0]?.endsWith("cached.jpg")) return { reused: true };
			await artifact.generate();
			return { reused: false };
		});

		await sharp({ buildTransform: (pipeline) => pipeline.png() }).apply(context);

		expect(derive).toHaveBeenCalledTimes(2);
		expect(messages.at(-1)).toMatch(
			/^Transforming Images: =*\nTransformed: 1, Cached: 1, Remaining: 0 \n$/,
		);
		const infoMessages = vi
			.mocked(context.logger.info)
			.mock.calls.map(([message]) =>
				typeof message === "string" ? stripVTControlCharacters(message) : message,
			);
		expect(infoMessages).toContain(
			"Of the 2 transform images files, 1 were transformed and 1 were pulled from cache",
		);
		expectClosed(events, onClose);
	});

	it("waits for derive resolution even after Sharp generation finishes", async () => {
		const { context, messages, events, onClose } = await createContext(["image.jpg"]);
		writeImages(context, ["image.jpg"]);
		const generated = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		vi.spyOn(context.cache, "derive").mockImplementation(async (artifact) => {
			await artifact.generate();
			generated.resolve();
			await release.promise;
			return { reused: false };
		});
		const execution = sharp({ buildTransform: (pipeline) => pipeline.png() }).apply(context);
		await generated.promise;
		vi.advanceTimersByTime(50);
		expect(messages.at(-1)).toContain("Transformed: 0, Cached: 0, Remaining: 1");
		expect(onClose).not.toHaveBeenCalled();

		release.resolve();
		await execution;
		expect(messages.at(-1)).toContain("Transformed: 1, Cached: 0, Remaining: 0");
		expectClosed(events, onClose);
	});

	it("counts Sharp uncached generation once without derive", async () => {
		const { context, messages, events, onClose } = await createContext(["image.svg"]);
		writeImages(context, []);
		fs.writeFileSync(
			path.join(context.paths.getDownloadPath("test"), "image.svg"),
			'<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="red"/></svg>',
		);
		const derive = vi.spyOn(context.cache, "derive");

		await sharp({ buildTransform: (pipeline) => pipeline.png() }).apply(context);

		expect(derive).not.toHaveBeenCalled();
		expect(fs.existsSync(path.join(context.paths.getDownloadPath("test"), "image@sharp.png"))).toBe(
			true,
		);
		expect(messages.at(-1)).toContain("Transformed: 1, Cached: 0, Remaining: 0");
		expectClosed(events, onClose);
	});

	it("drains active Sharp work before closing after derive fails", async () => {
		const names = ["slow.jpg", "error.jpg"];
		const { context, messages, events, onClose } = await createContext(names);
		writeImages(context, names);
		const failed = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		vi.spyOn(context.cache, "derive").mockImplementation(async (artifact) => {
			if (artifact.inputs[0]?.endsWith("slow.jpg")) {
				await release.promise;
				return { reused: true };
			}
			failed.resolve();
			throw new Error("derive failed");
		});
		const rejection = expect(
			sharp({ buildTransform: (pipeline) => pipeline.png(), concurrency: 2 }).apply(context),
		).rejects.toThrow("derive failed");
		await failed.promise;
		await new Promise<void>((resolve) => setImmediate(resolve));
		vi.advanceTimersByTime(50);
		expect(messages.at(-1)).toContain("Transformed: 0, Cached: 0, Remaining: 2");
		expect(onClose).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(1);

		release.resolve();
		await rejection;
		expect(messages.at(-1)).toContain("Transformed: 0, Cached: 1, Remaining: 1");
		expectClosed(events, onClose);
		vi.advanceTimersByTime(500);
		expect(events.at(-1)).toBe("close");
	});

	it.each([
		{
			name: "downloader",
			transform: () => mediaDownloader(),
			label: "Syncing Media",
			freshLabel: "Fetched",
		},
		{
			name: "Sharp",
			transform: () => sharp({ buildTransform: (pipeline) => pipeline.png() }),
			label: "Transforming Images",
			freshLabel: "Transformed",
		},
	])("flushes and closes an empty $name workload", async ({ transform, label, freshLabel }) => {
		const { context, messages, events, onClose } = await createContext([]);
		await transform().apply(context);

		expect(messages).toEqual([`${label}: \n${freshLabel}: 0, Cached: 0, Remaining: 0 \n`]);
		expectClosed(events, onClose);
	});
});
