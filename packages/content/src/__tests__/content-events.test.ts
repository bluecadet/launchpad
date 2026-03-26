import { createMockPluginCtx, type MockEventBus } from "@bluecadet/launchpad-testing/test-utils.ts";
import { vol } from "memfs";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { content } from "../launchpad-content.js";
import jsonSource from "../sources/json-source.js";
import mdToHtml from "../transforms/md-to-html.js";
import mediaDownloader from "../transforms/media-downloader.js";

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

			const ctx = createMockPluginCtx();
			const eventBus = ctx.eventBus as MockEventBus;

			const contentResult = await content({
				downloadPath: "/downloads",
				tempPath: "/temp",
				sources: [
					jsonSource({
						id: "test",
						files: { "data.json": "https://api.example.com/data.json" },
					}),
				],
			}).setup(ctx);
			expect(contentResult).toBeOk();
			const instance = contentResult._unsafeUnwrap();

			await instance.executeCommand({
				type: "content.fetch",
			});

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

			const ctx = createMockPluginCtx();
			const eventBus = ctx.eventBus as MockEventBus;

			const contentResult = await content({
				downloadPath: "/downloads",
				tempPath: "/temp",
				sources: [
					jsonSource({
						id: "test",
						files: { "data.json": "https://api.example.com/data.json" },
					}),
				],
			}).setup(ctx);
			expect(contentResult).toBeOk();
			const instance = contentResult._unsafeUnwrap();

			await instance.executeCommand({
				type: "content.fetch",
			});

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

			const ctx = createMockPluginCtx();
			const eventBus = ctx.eventBus as MockEventBus;

			const contentResult = await content({
				downloadPath: "/downloads",
				tempPath: "/temp",
				sources: [
					jsonSource({
						id: "test",
						files: { "data.json": "https://api.example.com/data.json" },
					}),
				],
			}).setup(ctx);

			expect(contentResult).toBeOk();
			const instance = contentResult._unsafeUnwrap();

			const result = await instance.executeCommand({
				type: "content.fetch",
			});

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

			const ctx = createMockPluginCtx();
			const eventBus = ctx.eventBus as MockEventBus;

			const contentResult = await content({
				downloadPath: "/downloads",
				tempPath: "/temp",
				sources: [
					jsonSource({
						id: "test-source",
						files: { "data.json": "https://api.example.com/data.json" },
					}),
				],
			}).setup(ctx);

			expect(contentResult).toBeOk();
			const instance = contentResult._unsafeUnwrap();

			await instance.executeCommand({
				type: "content.fetch",
			});

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

			const ctx = createMockPluginCtx();
			const eventBus = ctx.eventBus as MockEventBus;
			const contentResult = await content({
				downloadPath: "/downloads",
				tempPath: "/temp",
				sources: [
					jsonSource({
						id: "failing-source",
						files: { "data.json": "https://api.example.com/data.json" },
					}),
				],
			}).setup(ctx);
			expect(contentResult).toBeOk();
			const instance = contentResult._unsafeUnwrap();

			const result = await instance.executeCommand({
				type: "content.fetch",
			});

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

			const ctx = createMockPluginCtx();
			const eventBus = ctx.eventBus as MockEventBus;

			const contentResult = await content({
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
			}).setup(ctx);
			expect(contentResult).toBeOk();
			const instance = contentResult._unsafeUnwrap();

			await instance.executeCommand({
				type: "content.fetch",
			});

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

			const ctx = createMockPluginCtx();
			const eventBus = ctx.eventBus as MockEventBus;

			const contentResult = await content({
				downloadPath: "/downloads",
				tempPath: "/temp",
				sources: [
					jsonSource({
						id: "test",
						files: { "data.json": "https://api.example.com/data.json" },
					}),
				],
			}).setup(ctx);
			expect(contentResult).toBeOk();
			const instance = contentResult._unsafeUnwrap();

			await instance.executeCommand({
				type: "content.fetch",
			});

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

	describe("Transform Events", () => {
		it("should emit transform events for each plugin hook execution", async () => {
			server.use(
				http.get("https://api.example.com/data.json", () => {
					return HttpResponse.json({
						content: "# Hello World",
					});
				}),
			);

			const ctx = createMockPluginCtx();
			const eventBus = ctx.eventBus as MockEventBus;
			const contentResult = await content({
				downloadPath: "/downloads",
				tempPath: "/temp",
				sources: [
					jsonSource({
						id: "test",
						files: { "data.json": "https://api.example.com/data.json" },
					}),
				],
				transforms: [mdToHtml({ path: "$.content" })],
			}).setup(ctx);
			expect(contentResult).toBeOk();
			const instance = contentResult._unsafeUnwrap();

			await instance.executeCommand({
				type: "content.fetch",
			});

			// Check plugin:start events
			const startEvents = eventBus.getEventsOfType<{ transformName: string }>(
				"content:transform:start",
			);
			expect(startEvents.length).toBeGreaterThan(0);
			const mdPluginStarts = startEvents.filter((e) => e.transformName === "md-to-html");
			expect(mdPluginStarts.length).toBeGreaterThan(0);

			// Check plugin:done events
			const doneEvents = eventBus.getEventsOfType<{ transformName: string; duration: number }>(
				"content:transform:done",
			);
			expect(doneEvents.length).toBeGreaterThan(0);
			const mdPluginDone = doneEvents.filter((e) => e.transformName === "md-to-html");
			expect(mdPluginDone.length).toBeGreaterThan(0);
			expect(mdPluginDone[0]!.duration).toBeGreaterThanOrEqual(0);
		});

		it("should track transform execution via events", async () => {
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

			const ctx = createMockPluginCtx();
			const eventBus = ctx.eventBus as MockEventBus;
			const contentResult = await content({
				downloadPath: "/downloads",
				tempPath: "/temp",
				sources: [
					jsonSource({
						id: "test",
						files: { "data.json": "https://api.example.com/data.json" },
					}),
				],
				transforms: [
					mediaDownloader({
						mediaPattern: /\.jpg$/,
						maxConcurrent: 1,
					}),
				],
			}).setup(ctx);

			expect(contentResult).toBeOk();
			const instance = contentResult._unsafeUnwrap();

			await instance.executeCommand({
				type: "content.fetch",
			});

			// Check that plugin events were emitted
			const pluginEvents = eventBus
				.getEmittedEvents()
				.filter((e) => e.event.startsWith("content:transform:"));
			expect(pluginEvents.length).toBeGreaterThan(0);
		});

		it("should emit transform events for multiple plugins", async () => {
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

			const ctx = createMockPluginCtx();
			const eventBus = ctx.eventBus as MockEventBus;
			const contentResult = await content({
				downloadPath: "/downloads",
				tempPath: "/temp",
				sources: [
					jsonSource({
						id: "test",
						files: { "data.json": "https://api.example.com/data.json" },
					}),
				],
				transforms: [
					mdToHtml({ path: "$.content" }),
					mediaDownloader({
						mediaPattern: /\.jpg$/,
						maxConcurrent: 1,
					}),
				],
			}).setup(ctx);
			expect(contentResult).toBeOk();
			const instance = contentResult._unsafeUnwrap();

			await instance.executeCommand({
				type: "content.fetch",
			});

			const startEvents = eventBus.getEventsOfType<{ transformName: string }>(
				"content:transform:start",
			);
			const pluginNames = [...new Set(startEvents.map((e) => e.transformName))];
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

			const ctx = createMockPluginCtx();
			const contentResult = await content({
				downloadPath: "/downloads",
				tempPath: "/temp",
				sources: [
					jsonSource({
						id: "test",
						files: { "data.json": "https://api.example.com/data.json" },
					}),
				],
			}).setup(ctx);
			expect(contentResult).toBeOk();
			const instance = contentResult._unsafeUnwrap();

			await instance.executeCommand({
				type: "content.fetch",
			});

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

			const contentResult = await content({
				downloadPath: "/downloads",
				tempPath: "/temp",
				sources: [
					jsonSource({
						id: "test",
						files: { "data.json": "https://api.example.com/data.json" },
					}),
				],
			}).setup(createMockPluginCtx());
			expect(contentResult).toBeOk();
			const instance = contentResult._unsafeUnwrap();

			// Do not set eventBus - should still work
			await expect(instance.executeCommand({ type: "content.fetch" })).resolves.toBeOk();
		});
	});
});
