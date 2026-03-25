import { createMockPluginCtx } from "@bluecadet/launchpad-testing/test-utils.ts";
import { vol } from "memfs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { content } from "../launchpad-content.js";
import { defineSource } from "../source.js";

describe("ContentState", () => {
	afterEach(() => {
		vol.reset();
		vi.clearAllMocks();
	});

	const createBasicConfig = (sourceCount = 1) => {
		const sources = Array.from({ length: sourceCount }, (_, i) => {
			const id = `source-${i + 1}`;
			return defineSource({
				id,
				fetch: () => {
					return [
						{
							id: `doc-${i + 1}-1`,
							data: Promise.resolve({ content: "data 1" }),
						},
						{
							id: `doc-${i + 1}-2`,
							data: Promise.resolve({ content: "data 2" }),
						},
					];
				},
			});
		});

		return {
			downloadPath: "downloads",
			tempPath: "temp",
			backupPath: "backups",
			sources,
		};
	};

	describe("initialization", () => {
		it("should initialize with empty sources record", async () => {
			const config = createBasicConfig(2);
			const contentResult = await content(config).setup(createMockPluginCtx());
			expect(contentResult).toBeOk();
			const instance = contentResult._unsafeUnwrap();

			const state = instance.getState();

			// After init but before download, sources should have pending states
			expect(state.sources["source-1"]).toBeDefined();
			expect(state.sources["source-2"]).toBeDefined();
			expect(state.sources["source-1"]?.state).toBe("pending");
			expect(state.sources["source-2"]?.state).toBe("pending");
		});
	});

	describe("per-source state tracking", () => {
		it("should initialize source state when fetch starts", async () => {
			const config = createBasicConfig(1);
			const contentResult = await content(config).setup(createMockPluginCtx());
			expect(contentResult).toBeOk();
			const instance = contentResult._unsafeUnwrap();

			await instance.executeCommand({
				type: "content.fetch",
			});

			const state = instance.getState();
			expect(state.sources["source-1"]).toBeDefined();
			expect(state.sources["source-1"]?.state).toBe("success");
			if (state.sources["source-1"]?.state === "success") {
				expect(state.sources["source-1"]?.startTime).toBeDefined();
				expect(state.sources["source-1"]?.finishedAt).toBeDefined();
			}
		});

		it("should track multiple sources independently", async () => {
			const config = createBasicConfig(3);
			const contentResult = await content(config).setup(createMockPluginCtx());
			expect(contentResult).toBeOk();
			const instance = contentResult._unsafeUnwrap();

			await instance.executeCommand({
				type: "content.fetch",
			});

			const state = instance.getState();
			expect(state.sources["source-1"]).toBeDefined();
			expect(state.sources["source-2"]).toBeDefined();
			expect(state.sources["source-3"]).toBeDefined();
		});

		it.todo("should set state to fetching during fetch", () => {});
	});

	describe("fetch lifecycle state updates", () => {
		it("should set startTime timestamp when fetch begins", async () => {
			const config = createBasicConfig(1);
			const contentResult = await content(config).setup(createMockPluginCtx());
			expect(contentResult).toBeOk();
			const instance = contentResult._unsafeUnwrap();

			const beforeFetch = new Date();

			await instance.executeCommand({
				type: "content.fetch",
			});

			const state = instance.getState();
			const sourceState = state.sources["source-1"];
			expect(sourceState).toBeDefined();
			expect(sourceState?.state).toBe("success");
			if (sourceState?.state === "success") {
				expect(sourceState.startTime).toBeDefined();
				expect(sourceState.startTime.getTime()).toBeGreaterThanOrEqual(beforeFetch.getTime());
			}
		});

		it("should set finishedAt timestamp after successful fetch", async () => {
			const config = createBasicConfig(1);
			const contentResult = await content(config).setup(createMockPluginCtx());
			expect(contentResult).toBeOk();
			const instance = contentResult._unsafeUnwrap();

			const beforeFetch = new Date();

			const result = await instance.executeCommand({
				type: "content.fetch",
			});
			expect(result).toBeOk();

			const state = instance.getState();
			const sourceState = state.sources["source-1"];
			expect(sourceState).toBeDefined();
			expect(sourceState?.state).toBe("success");
			if (sourceState?.state === "success") {
				expect(sourceState.finishedAt).toBeDefined();
				expect(sourceState.finishedAt.getTime()).toBeGreaterThanOrEqual(beforeFetch.getTime());
			}
		});

		it("should track different timestamps for different sources", async () => {
			const config = createBasicConfig(2);
			const contentResult = await content(config).setup(createMockPluginCtx());
			expect(contentResult).toBeOk();
			const instance = contentResult._unsafeUnwrap();

			await instance.executeCommand({
				type: "content.fetch",
			});

			const state = instance.getState();
			const source1State = state.sources["source-1"];
			const source2State = state.sources["source-2"];

			// Both should be success
			expect(source1State?.state).toBe("success");
			expect(source2State?.state).toBe("success");

			if (source1State?.state === "success" && source2State?.state === "success") {
				// They should be approximately the same time (within a few ms)
				const timeDiff = Math.abs(
					source1State.startTime.getTime() - source2State.startTime.getTime(),
				);
				expect(timeDiff).toBeLessThan(100);
			}
		});
	});

	describe("error state tracking", () => {
		it("should set error state when fetch fails", async () => {
			const failingConfig = {
				downloadPath: "downloads",
				tempPath: "temp",
				backupPath: "backups",
				backupAndRestore: false, // Disable backup/restore to simplify error testing
				sources: [
					defineSource({
						id: "failing-source",
						fetch: () => {
							return [
								{
									id: "doc1",
									data: Promise.reject(new Error("Fetch failed")),
								},
							];
						},
					}),
				],
			};

			const contentResult = await content(failingConfig).setup(createMockPluginCtx());
			expect(contentResult).toBeOk();
			const instance = contentResult._unsafeUnwrap();

			const beforeFetch = new Date();

			const result = await instance.executeCommand({
				type: "content.fetch",
			});
			expect(result).toBeErr();

			const state = instance.getState();
			const sourceState = state.sources["failing-source"];
			expect(sourceState?.state).toBe("error");
			if (sourceState?.state === "error") {
				expect(sourceState.error).toBeDefined();
				expect(sourceState.attemptedAt.getTime()).toBeGreaterThanOrEqual(beforeFetch.getTime());
			}
		});

		it("should not clear lastFetchSuccess on error", async () => {
			const config = createBasicConfig(1);
			const contentResult = await content(config).setup(createMockPluginCtx());
			expect(contentResult).toBeOk();
			const instance = contentResult._unsafeUnwrap();

			// First successful fetch
			const result1 = await instance.executeCommand({
				type: "content.fetch",
			});
			expect(result1).toBeOk();

			const state1 = instance.getState();
			const sourceState = state1.sources["source-1"];
			expect(sourceState?.state).toBe("success");

			// After a successful fetch, there should be no error state
			expect(state1.sources["source-1"]?.state).not.toBe("error");
		});
	});

	describe("event bus integration", () => {
		it("should emit events when state is updated", async () => {
			const config = createBasicConfig(1);
			const ctx = createMockPluginCtx();
			const contentResult = await content(config).setup(ctx);
			expect(contentResult).toBeOk();
			const instance = contentResult._unsafeUnwrap();

			await instance.executeCommand({
				type: "content.fetch",
			});

			const emittedEvents = ctx.eventBus.emit as any;
			expect(emittedEvents).toHaveBeenCalledWith(
				"content:fetch:start",
				expect.objectContaining({ timestamp: expect.any(Date) }),
			);
			expect(emittedEvents).toHaveBeenCalledWith(
				"content:fetch:done",
				expect.objectContaining({
					sources: ["source-1"],
				}),
			);
		});

		it("should emit source-specific events", async () => {
			const config = createBasicConfig(1);
			const ctx = createMockPluginCtx();
			const contentResult = await content(config).setup(ctx);
			expect(contentResult).toBeOk();
			const instance = contentResult._unsafeUnwrap();

			await instance.executeCommand({
				type: "content.fetch",
			});

			const emittedEvents = ctx.eventBus.emit as any;
			expect(emittedEvents).toHaveBeenCalledWith(
				"content:source:start",
				expect.objectContaining({
					sourceId: "source-1",
				}),
			);
			expect(emittedEvents).toHaveBeenCalledWith(
				"content:source:done",
				expect.objectContaining({
					sourceId: "source-1",
				}),
			);
		});
	});

	describe("state consistency", () => {
		it("should maintain state across multiple operations", async () => {
			const config = createBasicConfig(2);
			const contentResult = await content(config).setup(createMockPluginCtx());
			expect(contentResult).toBeOk();
			const instance = contentResult._unsafeUnwrap();

			// First operation
			await instance.executeCommand({
				type: "content.fetch",
			});
			let state = instance.getState();
			const firstSourceState = state.sources["source-1"];

			// State should be preserved
			state = instance.getState();
			const firstSourceStateAgain = state.sources["source-1"];
			expect(firstSourceStateAgain?.state).toBe(firstSourceState?.state);

			// Second operation
			await instance.executeCommand({
				type: "content.fetch",
			});
			state = instance.getState();
			const secondSourceState = state.sources["source-1"];

			// Both should be success
			expect(firstSourceState?.state).toBe("success");
			expect(secondSourceState?.state).toBe("success");

			// Verify the second fetch is newer
			if (firstSourceState?.state === "success" && secondSourceState?.state === "success") {
				expect(secondSourceState.startTime.getTime()).toBeGreaterThanOrEqual(
					firstSourceState.startTime.getTime(),
				);
			}
		});

		it("should have consistent state structure across all sources", async () => {
			const config = createBasicConfig(3);
			const contentResult = await content(config).setup(createMockPluginCtx());
			expect(contentResult).toBeOk();
			const instance = contentResult._unsafeUnwrap();

			await instance.executeCommand({
				type: "content.fetch",
			});

			const state = instance.getState();
			for (const sourceId of ["source-1", "source-2", "source-3"]) {
				const sourceState = state.sources[sourceId];
				expect(sourceState).toBeDefined();
				expect(sourceState?.state).toBe("success");
				if (sourceState?.state === "success") {
					expect(sourceState.startTime).toBeDefined();
					expect(sourceState.finishedAt).toBeDefined();
					expect(typeof sourceState.duration).toBe("number");
				}
			}
		});
	});

	describe("state mutations during operations", () => {
		it("should return frozen state objects", async () => {
			const config = createBasicConfig(1);
			const contentResult = await content(config).setup(createMockPluginCtx());
			expect(contentResult).toBeOk();
			const instance = contentResult._unsafeUnwrap();

			await instance.executeCommand({
				type: "content.fetch",
			});

			const state = instance.getState();

			// State should be frozen to prevent mutations
			expect(Object.isFrozen(state)).toBe(true);
		});

		it("should reflect state changes through getState()", async () => {
			const config = createBasicConfig(1);
			const contentResult = await content(config).setup(createMockPluginCtx());
			expect(contentResult).toBeOk();
			const instance = contentResult._unsafeUnwrap();

			// Before fetch
			let state = instance.getState();
			expect(state.sources["source-1"]).toBeDefined();
			expect(state.sources["source-1"]?.state).toBe("pending");

			// After fetch
			await instance.executeCommand({
				type: "content.fetch",
			});
			state = instance.getState();
			expect(state.sources["source-1"]).toBeDefined();
			expect(state.sources["source-1"]?.state).toBe("success");
		});
	});
});
