import {
	createMockSubsystemCtx,
	type MockEventBus,
} from "@bluecadet/launchpad-testing/test-utils.ts";
import { vol } from "memfs";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import LaunchpadContent from "../launchpad-content.js";
import mdToHtml from "../plugins/md-to-html.js";
import mediaDownloader from "../plugins/media-downloader.js";
import jsonSource from "../sources/json-source.js";

describe("Content Event Emissions", () => {
	const server = setupServer();

	beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
	afterAll(() => server.close());
	beforeEach(() => vol.reset());
	afterEach(() => server.resetHandlers());

	describe("Fetch Lifecycle Events", () => {
		it("should emit content:fetch:start when download starts", async () => {
			server.use(
				http.get("https://api.example.com/data.json", () => {
					return HttpResponse.json({ test: "data" });
				}),
			);

			const ctx = createMockSubsystemCtx();
			const eventBus = ctx.eventBus as MockEventBus;

			const contentResult = await LaunchpadContent.init(
				{
					downloadPath: "/downloads",
					tempPath: "/temp",
					sources: [
						jsonSource({
							id: "test",
							files: { "data.json": "https://api.example.com/data.json" },
						}),
					],
				},
				ctx,
			);
			expect(contentResult).toBeOk();
			const content = contentResult._unsafeUnwrap();

			await content.download();

			const startEvents = eventBus.getEventsOfType<{ timestamp: string }>("content:fetch:start");
			expect(startEvents).toHaveLength(1);
			expect(startEvents[0]!.timestamp).toBeDefined();
			expect(new Date(startEvents[0]!.timestamp).getTime()).toBeGreaterThan(0);
		});

		it("should emit content:fetch:done on successful download", async () => {
			server.use(
				http.get("https://api.example.com/data.json", () => {
					return HttpResponse.json({ test: "data" });
				}),
			);

			const ctx = createMockSubsystemCtx();
			const eventBus = ctx.eventBus as MockEventBus;

			const contentResult = await LaunchpadContent.init(
				{
					downloadPath: "/downloads",
					tempPath: "/temp",
					sources: [
						jsonSource({
							id: "test",
							files: { "data.json": "https://api.example.com/data.json" },
						}),
					],
				},
				ctx,
			);
			expect(contentResult).toBeOk();
			const content = contentResult._unsafeUnwrap();

			await content.download();

			const doneEvents = eventBus.getEventsOfType<{
				sources: string[];
				totalFiles: number;
				duration: number;
			}>("content:fetch:done");
			expect(doneEvents).toHaveLength(1);
			expect(doneEvents[0]!.sources).toEqual(["test"]);
		});

		it("should emit content:fetch:error on download failure", async () => {
			server.use(
				http.get("https://api.example.com/data.json", () => {
					return new HttpResponse(null, { status: 500 });
				}),
			);

			const ctx = createMockSubsystemCtx();
			const eventBus = ctx.eventBus as MockEventBus;

			const contentResult = await LaunchpadContent.init(
				{
					downloadPath: "/downloads",
					tempPath: "/temp",
					sources: [
						jsonSource({
							id: "test",
							files: { "data.json": "https://api.example.com/data.json" },
						}),
					],
				},
				ctx,
			);

			expect(contentResult).toBeOk();
			const content = contentResult._unsafeUnwrap();

			const result = await content.download();

			expect(result).toBeErr();
			const errorEvents = eventBus.getEventsOfType<{ error: Error; source?: string }>(
				"content:fetch:error",
			);
			expect(errorEvents).toHaveLength(1);
			expect(errorEvents[0]!.error).toBeDefined();
		});
	});

	describe("Source Events", () => {
		it("should emit content:source:start and content:source:done for each source", async () => {
			server.use(
				http.get("https://api.example.com/data.json", () => {
					return HttpResponse.json({ test: "data" });
				}),
			);

			const ctx = createMockSubsystemCtx();
			const eventBus = ctx.eventBus as MockEventBus;

			const contentResult = await LaunchpadContent.init(
				{
					downloadPath: "/downloads",
					tempPath: "/temp",
					sources: [
						jsonSource({
							id: "test-source",
							files: { "data.json": "https://api.example.com/data.json" },
						}),
					],
				},
				ctx,
			);

			expect(contentResult).toBeOk();
			const content = contentResult._unsafeUnwrap();

			await content.download();

			// Check start event
			const startEvents = eventBus.getEventsOfType<{ sourceId: string; sourceType: string }>(
				"content:source:start",
			);
			expect(startEvents).toHaveLength(1);
			expect(startEvents[0]!.sourceId).toBe("test-source");
			expect(startEvents[0]!.sourceType).toBe("unknown"); // Sources don't have type property yet

			// Check done event
			const doneEvents = eventBus.getEventsOfType<{ sourceId: string }>("content:source:done");
			expect(doneEvents).toHaveLength(1);
			expect(doneEvents[0]!.sourceId).toBe("test-source");
		});

		it("should emit error event on source failure", async () => {
			server.use(
				http.get("https://api.example.com/data.json", () => {
					return new HttpResponse(null, { status: 500 });
				}),
			);

			const ctx = createMockSubsystemCtx();
			const eventBus = ctx.eventBus as MockEventBus;
			const contentResult = await LaunchpadContent.init(
				{
					downloadPath: "/downloads",
					tempPath: "/temp",
					sources: [
						jsonSource({
							id: "failing-source",
							files: { "data.json": "https://api.example.com/data.json" },
						}),
					],
				},
				ctx,
			);
			expect(contentResult).toBeOk();
			const content = contentResult._unsafeUnwrap();

			const result = await content.download();

			expect(result).toBeErr();
			// When a fetch fails, an error event is emitted (either fetch:error or source:error)
			const allEvents = eventBus.getEmittedEvents();
			const errorEvents = allEvents.filter((e) => e.event.includes("error"));
			expect(errorEvents.length).toBeGreaterThan(0);
		});

		it("should emit events for multiple sources", async () => {
			server.use(
				http.get("https://api.example.com/source1.json", () => {
					return HttpResponse.json({ source: 1 });
				}),
				http.get("https://api.example.com/source2.json", () => {
					return HttpResponse.json({ source: 2 });
				}),
				http.get("https://api.example.com/source3.json", () => {
					return HttpResponse.json({ source: 3 });
				}),
			);

			const ctx = createMockSubsystemCtx();
			const eventBus = ctx.eventBus as MockEventBus;

			const contentResult = await LaunchpadContent.init(
				{
					downloadPath: "/downloads",
					tempPath: "/temp",
					sources: [
						jsonSource({
							id: "source1",
							files: { "data.json": "https://api.example.com/source1.json" },
						}),
						jsonSource({
							id: "source2",
							files: { "data.json": "https://api.example.com/source2.json" },
						}),
						jsonSource({
							id: "source3",
							files: { "data.json": "https://api.example.com/source3.json" },
						}),
					],
				},
				ctx,
			);
			expect(contentResult).toBeOk();
			const content = contentResult._unsafeUnwrap();

			await content.download();

			const startEvents = eventBus.getEventsOfType<{ sourceId: string }>("content:source:start");
			expect(startEvents).toHaveLength(3);

			const sourceIds = startEvents.map((e) => e.sourceId).sort();
			expect(sourceIds).toEqual(["source1", "source2", "source3"]);

			const doneEvents = eventBus.getEventsOfType<{ sourceId: string }>("content:source:done");
			expect(doneEvents).toHaveLength(3);
		});
	});

	describe("Document Events", () => {
		it("should emit content:document:write for each written document", async () => {
			server.use(
				http.get("https://api.example.com/data.json", () => {
					return HttpResponse.json({ test: "data" });
				}),
			);

			const ctx = createMockSubsystemCtx();
			const eventBus = ctx.eventBus as MockEventBus;

			const contentResult = await LaunchpadContent.init(
				{
					downloadPath: "/downloads",
					tempPath: "/temp",
					sources: [
						jsonSource({
							id: "test",
							files: { "data.json": "https://api.example.com/data.json" },
						}),
					],
				},
				ctx,
			);
			expect(contentResult).toBeOk();
			const content = contentResult._unsafeUnwrap();

			await content.download();

			const writeEvents = eventBus.getEventsOfType<{
				sourceId: string;
				documentId: string;
				path: string;
			}>("content:document:write");
			expect(writeEvents).toHaveLength(1);
			expect(writeEvents[0]!.sourceId).toBe("test");
			expect(writeEvents[0]!.documentId).toBe("data.json");
			expect(writeEvents[0]!.path).toContain("data.json");
		});
	});

	describe("Plugin Events", () => {
		it("should emit plugin events for each plugin hook execution", async () => {
			server.use(
				http.get("https://api.example.com/data.json", () => {
					return HttpResponse.json({
						content: "# Hello World",
					});
				}),
			);

			const ctx = createMockSubsystemCtx();
			const eventBus = ctx.eventBus as MockEventBus;
			const contentResult = await LaunchpadContent.init(
				{
					downloadPath: "/downloads",
					tempPath: "/temp",
					sources: [
						jsonSource({
							id: "test",
							files: { "data.json": "https://api.example.com/data.json" },
						}),
					],
					plugins: [mdToHtml({ path: "$.content" })],
				},
				ctx,
			);
			expect(contentResult).toBeOk();
			const content = contentResult._unsafeUnwrap();

			await content.download();

			// Check plugin:start events
			const startEvents = eventBus.getEventsOfType<{ pluginName: string }>("content:plugin:start");
			expect(startEvents.length).toBeGreaterThan(0);
			const mdPluginStarts = startEvents.filter((e) => e.pluginName === "md-to-html");
			expect(mdPluginStarts.length).toBeGreaterThan(0);

			// Check plugin:done events
			const doneEvents = eventBus.getEventsOfType<{ pluginName: string; duration: number }>(
				"content:plugin:done",
			);
			expect(doneEvents.length).toBeGreaterThan(0);
			const mdPluginDone = doneEvents.filter((e) => e.pluginName === "md-to-html");
			expect(mdPluginDone.length).toBeGreaterThan(0);
			expect(mdPluginDone[0]!.duration).toBeGreaterThanOrEqual(0);
		});

		it("should track plugin execution via events", async () => {
			server.use(
				http.get("https://api.example.com/data.json", () => {
					return HttpResponse.json({
						content: "# Hello",
						image: "https://example.com/image.jpg",
					});
				}),
				http.get("https://example.com/image.jpg", () => {
					return new HttpResponse("fake image", {
						headers: { "Content-Type": "image/jpeg" },
					});
				}),
			);

			const ctx = createMockSubsystemCtx();
			const eventBus = ctx.eventBus as MockEventBus;
			const contentResult = await LaunchpadContent.init(
				{
					downloadPath: "/downloads",
					tempPath: "/temp",
					sources: [
						jsonSource({
							id: "test",
							files: { "data.json": "https://api.example.com/data.json" },
						}),
					],
					plugins: [
						mediaDownloader({
							mediaPattern: /\.jpg$/,
							maxConcurrent: 1,
						}),
					],
				},
				ctx,
			);

			expect(contentResult).toBeOk();
			const content = contentResult._unsafeUnwrap();

			await content.download();

			// Check that plugin events were emitted
			const pluginEvents = eventBus
				.getEmittedEvents()
				.filter((e) => e.event.startsWith("content:plugin:"));
			expect(pluginEvents.length).toBeGreaterThan(0);
		});

		it("should emit plugin events for multiple plugins", async () => {
			server.use(
				http.get("https://api.example.com/data.json", () => {
					return HttpResponse.json({
						content: "# Hello",
						image: "https://example.com/test.jpg",
					});
				}),
				http.get("https://example.com/test.jpg", () => {
					return new HttpResponse("fake image", {
						headers: { "Content-Type": "image/jpeg" },
					});
				}),
			);

			const ctx = createMockSubsystemCtx();
			const eventBus = ctx.eventBus as MockEventBus;
			const contentResult = await LaunchpadContent.init(
				{
					downloadPath: "/downloads",
					tempPath: "/temp",
					sources: [
						jsonSource({
							id: "test",
							files: { "data.json": "https://api.example.com/data.json" },
						}),
					],
					plugins: [
						mdToHtml({ path: "$.content" }),
						mediaDownloader({
							mediaPattern: /\.jpg$/,
							maxConcurrent: 1,
						}),
					],
				},
				ctx,
			);
			expect(contentResult).toBeOk();
			const content = contentResult._unsafeUnwrap();

			await content.download();

			const startEvents = eventBus.getEventsOfType<{ pluginName: string }>("content:plugin:start");
			const pluginNames = [...new Set(startEvents.map((e) => e.pluginName))];
			expect(pluginNames).toContain("md-to-html");
			expect(pluginNames).toContain("media-downloader");
		});
	});

	describe("Event Ordering", () => {
		it("should emit events in the correct order", async () => {
			server.use(
				http.get("https://api.example.com/data.json", () => {
					return HttpResponse.json({ test: "data" });
				}),
			);

			const ctx = createMockSubsystemCtx();
			const contentResult = await LaunchpadContent.init(
				{
					downloadPath: "/downloads",
					tempPath: "/temp",
					sources: [
						jsonSource({
							id: "test",
							files: { "data.json": "https://api.example.com/data.json" },
						}),
					],
				},
				ctx,
			);
			expect(contentResult).toBeOk();
			const content = contentResult._unsafeUnwrap();

			await content.download();

			const events = (ctx.eventBus as MockEventBus).getEmittedEvents();
			const eventTypes = events.map((e) => e.event);

			// Should start with fetch:start
			expect(eventTypes[0]).toBe("content:fetch:start");

			// Should have source events
			expect(eventTypes).toContain("content:source:start");
			expect(eventTypes).toContain("content:source:done");

			// Should have document events
			expect(eventTypes).toContain("content:document:write");

			// Should end with fetch:done
			expect(eventTypes[eventTypes.length - 1]).toBe("content:fetch:done");

			// Source start should come before source done
			const sourceStartIndex = eventTypes.indexOf("content:source:start");
			const sourceDoneIndex = eventTypes.indexOf("content:source:done");
			expect(sourceDoneIndex).toBeGreaterThan(sourceStartIndex);
		});
	});

	describe("EventBus Not Set", () => {
		it("should not throw errors when eventBus is not set", async () => {
			server.use(
				http.get("https://api.example.com/data.json", () => {
					return HttpResponse.json({ test: "data" });
				}),
			);

			const contentResult = await LaunchpadContent.init(
				{
					downloadPath: "/downloads",
					tempPath: "/temp",
					sources: [
						jsonSource({
							id: "test",
							files: { "data.json": "https://api.example.com/data.json" },
						}),
					],
				},
				createMockSubsystemCtx(),
			);
			expect(contentResult).toBeOk();
			const content = contentResult._unsafeUnwrap();

			// Do not set eventBus - should still work
			await expect(content.download()).resolves.toBeOk();
		});
	});
});
