import {
	createMockEventBus,
	createMockPluginCtx,
} from "@bluecadet/launchpad-testing/test-utils.ts";
import type { PluginContext } from "@bluecadet/launchpad-utils/plugin-interfaces";
import { PatchedStateManager } from "@bluecadet/launchpad-utils/state-patcher";
import { ok, okAsync } from "neverthrow";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ObservabilityDestination } from "../core/destination.js";
import { type ObservabilityConfig, observability } from "../index.js";
import { type ObservabilityState, ObservabilityStateManager } from "../observability-state.js";

function createContext() {
	const stateManager = new PatchedStateManager<ObservabilityState>({ transports: {} });
	const eventBus = createMockEventBus();
	const updateState = vi.fn<PluginContext<ObservabilityState>["updateState"]>((producer) => {
		stateManager.updateState(producer);
	});
	const context: PluginContext<ObservabilityState> = {
		...createMockPluginCtx(),
		eventBus,
		updateState,
	};
	return { context, eventBus, updateState, getState: () => stateManager.state };
}

afterEach(() => {
	vi.useRealTimers();
});

describe("observability setup validation", () => {
	it.each([{ metrics: false }, { metrics: {} }, { delivery: {} }])(
		"rejects destination-only options with transports before starting legacy delivery: %j",
		async (destinationOptions) => {
			vi.useFakeTimers();
			const { context, eventBus, updateState } = createContext();
			const push = vi.fn(() => okAsync(undefined));
			const disconnect = vi.fn(() => okAsync(undefined));
			// JavaScript callers can bypass the mutually exclusive typed config modes.
			const config = {
				transports: [{ name: "legacy", push, disconnect }],
				...destinationOptions,
			} as unknown as ObservabilityConfig;

			const result = await observability(config).setup(context);

			expect(result.isErr()).toBe(true);
			if (result.isErr()) expect(result.error.message).toContain("cannot be combined");
			expect(updateState).not.toHaveBeenCalled();
			expect(eventBus.onAny).not.toHaveBeenCalled();
			expect(push).not.toHaveBeenCalled();
			expect(disconnect).not.toHaveBeenCalled();
			expect(vi.getTimerCount()).toBe(0);
		},
	);

	it("still sets up, flushes, and disconnects valid legacy transports", async () => {
		vi.useFakeTimers();
		const { context, eventBus, getState } = createContext();
		const push = vi.fn(() => okAsync(undefined));
		const disconnect = vi.fn(() => okAsync(undefined));
		const result = await observability({
			transports: [{ name: "legacy", push, disconnect }],
			batch: { maxEntries: 1 },
		}).setup(context);

		expect(result.isOk()).toBe(true);
		if (result.isErr()) return;
		eventBus.emit("log:info", { message: "legacy", args: [], module: "app" });
		expect((await result.value.executeCommand({ type: "observability.flush" })).isOk()).toBe(true);
		expect(push).toHaveBeenCalledOnce();
		expect(getState().transports.legacy?.totalPushed).toBe(1);
		expect((await result.value.disconnect({ type: "manual" })).isOk()).toBe(true);
		expect(disconnect).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
	});

	it.each([["__proto__"], ["normal", "__proto__"], [" __proto__ "]])(
		"rejects reserved names before creating any exporters: %j",
		async (...names) => {
			vi.useFakeTimers();
			const { context, eventBus, updateState } = createContext();
			const shutdown = vi.fn(() => okAsync(undefined));
			const create = vi.fn(() =>
				ok({ logs: { export: () => okAsync({ rejectedRecords: 0 }) }, shutdown }),
			);
			const destinations: ObservabilityDestination[] = names.map((name) => ({ name, create }));

			const result = await observability({ destinations }).setup(context);

			expect(result.isErr()).toBe(true);
			if (result.isErr()) expect(result.error.message).toContain("__proto__");
			expect(create).not.toHaveBeenCalled();
			expect(shutdown).not.toHaveBeenCalled();
			expect(updateState).not.toHaveBeenCalled();
			expect(eventBus.onAny).not.toHaveBeenCalled();
			expect(vi.getTimerCount()).toBe(0);
		},
	);

	it.each([[""], ["   "], ["same", " same "]])(
		"rejects blank and duplicate names before factories run: %j",
		async (...names) => {
			const { context } = createContext();
			const create = vi.fn(() => ok({ logs: { export: () => okAsync({ rejectedRecords: 0 }) } }));
			const result = await observability({
				destinations: names.map((name) => ({ name, create })),
			}).setup(context);

			expect(result.isErr()).toBe(true);
			expect(create).not.toHaveBeenCalled();
		},
	);

	it("keeps harmless object-property names legal with Immer and serializable state", async () => {
		const { context, eventBus, getState } = createContext();
		const names = ["normal", "constructor", "prototype", "toString"];
		const exportLogs = vi.fn(() => okAsync({ rejectedRecords: 0 }));
		const result = await observability({
			logStorage: { type: "memory" },
			destinations: names.map((name) => ({
				name,
				create: () => ok({ logs: { export: exportLogs } }),
			})),
			batch: { maxEntries: 1 },
		}).setup(context);

		expect(result.isOk()).toBe(true);
		if (result.isErr()) return;
		eventBus.emit("log:info", { message: "hello", args: [], module: "app" });
		await result.value.executeCommand({ type: "observability.flush" });
		expect(exportLogs).toHaveBeenCalledTimes(names.length);
		for (const name of names) {
			expect(Object.hasOwn(getState().destinations ?? {}, name)).toBe(true);
			expect(getState().destinations?.[name]?.logs?.totalPushed).toBe(1);
		}
		expect(Object.keys(JSON.parse(JSON.stringify(getState())).destinations)).toEqual(names);
		await result.value.disconnect({ type: "manual" });
	});

	it.each(["normal", "constructor", "prototype", "toString"])(
		"safely updates all destination health fields for %s with Immer",
		(name) => {
			const { context, getState } = createContext();
			const manager = new ObservabilityStateManager(context.updateState);
			manager.initDestination(name, ["logs", "metrics"]);
			for (const signal of ["logs", "metrics"] as const) {
				manager.applyDestinationTransition(name, signal, {
					type: "failure",
					error: new Error("failed"),
					droppedRecords: 0,
					queuedBatches: 2,
				});
				manager.applyDestinationTransition(name, signal, {
					type: "drop",
					reason: "queue-full",
					droppedRecords: 3,
					queuedBatches: 2,
				});
				manager.applyDestinationTransition(name, signal, { type: "queue", queuedBatches: 0 });
				manager.applyDestinationTransition(name, signal, {
					type: "export",
					acceptedRecords: 4,
					rejectedRecords: 1,
					queuedBatches: 0,
				});
				manager.applyDestinationTransition(name, signal, {
					type: "export",
					acceptedRecords: 5,
					rejectedRecords: 0,
					queuedBatches: 0,
				});
				expect(getState().destinations?.[name]?.[signal]).toEqual({
					status: "ok",
					queueSize: 0,
					lastSuccessAt: expect.any(Date),
					lastError: null,
					totalPushed: 9,
					totalDropped: 4,
				});
			}
		},
	);
});
