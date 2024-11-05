import { describe, it, expect, vi } from "vitest";
import PluginDriver, { HookContextProvider, PluginError } from "../plugin-driver.js";
import { createMockLogger } from "./test-utils.js";
import type { HookSet, Plugin } from "../plugin-driver.js";

describe("PluginDriver", () => {
	describe("basic functionality", () => {
		it("should initialize with plugins", () => {
			const plugin = {
				name: "test-plugin",
				hooks: {
					testHook: vi.fn(),
				},
			};

			const mockLogger = createMockLogger();
			const driver = new PluginDriver(mockLogger, [plugin]);
			expect(driver.plugins).toContain(plugin);
		});

		it("should add plugins after initialization", () => {
			const mockLogger = createMockLogger();
			const driver = new PluginDriver(mockLogger);
			const plugin = {
				name: "test-plugin",
				hooks: {
					testHook: vi.fn(),
				},
			};

			driver.add(plugin);
			expect(driver.plugins).toContain(plugin);
		});
	});

	describe("hook execution", () => {
		describe("sequential", () => {
			it("should run hooks sequentially", async () => {
				const order = [] as number[];
				const plugin1 = {
					name: "plugin1",
					hooks: {
						testHook: async () => {
							await new Promise((resolve) => setTimeout(resolve, 10));
							order.push(1);
						},
					},
				};
				const plugin2 = {
					name: "plugin2",
					hooks: {
						testHook: () => {
							order.push(2);
						},
					},
				};

				const mockLogger = createMockLogger();

				const driver = new PluginDriver<HookSet>(mockLogger, [plugin1, plugin2]);
				await driver.runHookSequential("testHook");

				expect(order).toEqual([1, 2]);
			});

			it("should stop sequential execution on error", async () => {
				const order = [] as number[];
				const plugin1 = {
					name: "plugin1",
					hooks: {
						testHook: () => {
							order.push(1);
							throw new Error("Test error");
						},
					},
				};
				const plugin2 = {
					name: "plugin2",
					hooks: {
						testHook: () => {
							order.push(2);
						},
					},
				};

				const mockLogger = createMockLogger();
				const driver = new PluginDriver(mockLogger, [plugin1, plugin2]);
				const result = await driver._runHookSequentialWithCtx("testHook", () => ({}), []);

				expect(result.isErr()).toBe(true);
				expect(order).toEqual([1]); // Second plugin should not run
			});
		});

		describe("parallel", () => {
			it("should run hooks in parallel", async () => {
				const executions = [] as { start: number; end: number }[];
				const plugin1 = {
					name: "plugin1",
					hooks: {
						testHook: async () => {
							const start = Date.now();
							await new Promise((resolve) => setTimeout(resolve, 50));
							executions.push({ start, end: Date.now() });
						},
					},
				};
				const plugin2 = {
					name: "plugin2",
					hooks: {
						testHook: async () => {
							const start = Date.now();
							await new Promise((resolve) => setTimeout(resolve, 50));
							executions.push({ start, end: Date.now() });
						},
					},
				};

				const mockLogger = createMockLogger();
				const driver = new PluginDriver(mockLogger, [plugin1, plugin2]);
				const result = await driver._runHookParallelWithCtx("testHook", () => ({}), []);

				expect(result.isOk()).toBe(true);
				expect(executions).toHaveLength(2);

				// Check that executions overlapped in time
				const [exec1, exec2] = executions;
				expect(exec2!.start).toBeLessThan(exec1!.end);
			});

			it("should collect all errors from parallel execution", async () => {
				const plugin1 = {
					name: "plugin1",
					hooks: {
						testHook: () => {
							throw new Error("Error 1");
						},
					},
				};
				const plugin2 = {
					name: "plugin2",
					hooks: {
						testHook: () => {
							throw new Error("Error 2");
						},
					},
				};

				const mockLogger = createMockLogger();
				const driver = new PluginDriver(mockLogger, [plugin1, plugin2]);
				const result = await driver._runHookParallelWithCtx("testHook", () => ({}), []);

				expect(result.isErr()).toBe(true);
				const unwrapped = result._unsafeUnwrapErr();
				expect(unwrapped).toMatchObject([
					new PluginError(new Error("Error 1"), { pluginId: "plugin1" }),
					new PluginError(new Error("Error 2"), { pluginId: "plugin2" }),
				]);
			});

			it("should handle mixed success and failure", async () => {
				const executed = [] as string[];
				const plugin1 = {
					name: "plugin1",
					hooks: {
						testHook: () => {
							executed.push("plugin1");
							throw new Error("Error 1");
						},
					},
				};
				const plugin2 = {
					name: "plugin2",
					hooks: {
						testHook: () => {
							executed.push("plugin2");
						},
					},
				};

				const mockLogger = createMockLogger();
				const driver = new PluginDriver(mockLogger, [plugin1, plugin2]);
				const result = await driver._runHookParallelWithCtx("testHook", () => ({}), []);

				expect(result.isErr()).toBe(true);
				expect(executed).toContain("plugin1");
				expect(executed).toContain("plugin2");
			});
		});

		it("should provide base context to hooks", async () => {
			const plugin: Plugin<HookSet> = {
				name: "test-plugin",
				hooks: {
					testHook: (context) => {
						expect(context.logger).toBeDefined();
						expect(context.abortSignal).toBeDefined();
					},
				},
			};

			const mockLogger = createMockLogger();
			const driver = new PluginDriver(mockLogger, [plugin]);
			await driver.runHookSequential("testHook");
		});
	});
});

describe("HookContextProvider", () => {
	it("should provide additional context to hooks", async () => {
		class TestContextProvider extends HookContextProvider<HookSet, { testValue: string }> {
			override _getPluginContext() {
				return { testValue: "test" };
			}
		}

		const plugin: Plugin<HookSet> = {
			name: "test-plugin",
			hooks: {
				testHook: (context) => {
					expect(context.testValue).toBe("test");
				},
			},
		};

		const mockLogger = createMockLogger();
		const baseDriver = new PluginDriver(mockLogger, [plugin]);
		const provider = new TestContextProvider(baseDriver);

		const result = await provider.runHookSequential("testHook");
		expect(result.isOk()).toBe(true);
	});

	it("should support both sequential and parallel execution", async () => {
		class TestContextProvider extends HookContextProvider<HookSet, { testValue: string }> {
			override _getPluginContext() {
				return { testValue: "test" };
			}
		}

		const order = [] as number[];
		const plugin1 = {
			name: "plugin1",
			hooks: {
				testHook: async () => {
					await new Promise((resolve) => setTimeout(resolve, 50));
					order.push(1);
				},
			},
		};
		const plugin2 = {
			name: "plugin2",
			hooks: {
				testHook: async () => {
					order.push(2);
				},
			},
		};

		const mockLogger = createMockLogger();
		const baseDriver = new PluginDriver(mockLogger, [plugin1, plugin2]);
		const provider = new TestContextProvider(baseDriver);

		// Test sequential
		order.length = 0;
		await provider.runHookSequential("testHook");
		expect(order).toEqual([1, 2]);

		// Test parallel
		order.length = 0;
		await provider.runHookParallel("testHook");
		expect(order).toEqual([2, 1]); // Second hook finishes first due to delay
	});
});
